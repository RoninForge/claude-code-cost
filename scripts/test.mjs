#!/usr/bin/env node
// Zero-dependency test for cost.mjs.
//
// Runs the self-contained reader against a hand-made fixture with KNOWN events
// and asserts the dollar totals, dedup, synthetic/non-assistant skipping, and
// the unpriced tally. Dates are pinned in the past and period boundaries are
// pinned with --asof, so results never depend on the wall clock.
//
// Run:  node scripts/test.mjs   (exits non-zero on failure)

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import * as price from "./vendor/ai-price-index/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const COST = join(HERE, "cost.mjs");
const FIXTURES = join(REPO, "test", "fixtures", "projects");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log("  ok   " + name);
  } else {
    failures++;
    console.log("  FAIL " + name + (detail ? "  ->  " + detail : ""));
  }
}
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// --- Expected dollar values, computed from the vendored lib (not hardcoded) ---
const DATE = "2026-06-01";
const cents = (tokens, model) => price.usdForRollup(tokens, "anthropic", model, DATE).cents;
const toUsd = (c) => +(c / 100).toFixed(2);

const expAlphaMain = toUsd(cents({ input: 1000000, output: 200000 }, "claude-opus-4-6"));
const expAlphaFeat = toUsd(
  cents(
    { input: 500000, output: 100000, cache_read: 1000000, cache_write_5m: 200000 },
    "claude-sonnet-4-5-20250929"
  )
);
// beta/main: haiku via the OLD flat cache_creation_input_tokens schema, which the
// reader attributes to the 5m bucket; the unknown model contributes 0.
const expBetaMain = toUsd(cents({ cache_write_5m: 400000 }, "claude-haiku-4-5-20251001"));

const expTotal = +(expAlphaMain + expAlphaFeat + expBetaMain).toFixed(2);

// --- Run cost.mjs --self --json with pinned period boundaries ---
// --asof 2026-06-03 is the same ISO week (Mon 2026-06-01..Sun 2026-06-07) and the
// same calendar month as the events, but a LATER day, so TODAY must be 0 while
// WEEK and MONTH capture everything. That makes the assert clock-independent.
const run = spawnSync(
  process.execPath,
  [COST, "--self", "--json", "--asof", "2026-06-03", "--projects-dir", FIXTURES],
  { encoding: "utf8" }
);

eq("exit code 0", run.status, 0);
if (run.status !== 0) {
  console.error("stderr:", run.stderr);
  process.exit(1);
}

let rows;
try {
  rows = JSON.parse(run.stdout);
} catch (e) {
  check("stdout is a JSON array", false, "parse error: " + e.message + " :: " + run.stdout);
  process.exit(1);
}
check("stdout is a JSON array", Array.isArray(rows), typeof rows);

const byKey = new Map(rows.map((r) => [r.project + "/" + r.branch, r]));

// Three priced rows are present (beta/main present because haiku > 0).
eq("row count", rows.length, 3);

const am = byKey.get("alpha/main");
check("alpha/main present", !!am);
if (am) {
  eq("alpha/main TODAY is 0", am.today, 0);
  eq("alpha/main WEEK", am.week, expAlphaMain);
  eq("alpha/main MONTH", am.month, expAlphaMain);
}

const af = byKey.get("alpha/feature-x");
check("alpha/feature-x present", !!af);
if (af) {
  eq("alpha/feature-x WEEK", af.week, expAlphaFeat);
  eq("alpha/feature-x MONTH", af.month, expAlphaFeat);
}

const bm = byKey.get("beta/main");
check("beta/main present", !!bm);
if (bm) {
  eq("beta/main WEEK (flat cache_creation -> 5m)", bm.week, expBetaMain);
}

// Aggregate MONTH total across all rows is deterministic and matches the sum.
const sumMonth = +rows.reduce((s, r) => s + r.month, 0).toFixed(2);
eq("sum of MONTH across rows", sumMonth, expTotal);

// --- Dedup + synthetic + unpriced behavior via _meta on stderr ---
const metaLine = (run.stderr || "").split("\n").find((l) => l.startsWith("_meta "));
check("_meta emitted on stderr", !!metaLine);
if (metaLine) {
  const meta = JSON.parse(metaLine.slice("_meta ".length));
  eq("one unpriced event", meta.unpricedCount, 1);
  check(
    "unpriced model id surfaced",
    meta.unpricedModels.includes("claude-imaginary-9-0"),
    JSON.stringify(meta.unpricedModels)
  );
  check("at least one malformed line counted", meta.malformedLines >= 1, String(meta.malformedLines));
}

// --- Dedup proof: alpha/main has the opus response on TWO lines (a-1 + a-1-dup,
// same msg_A + req_A). If it were double-counted, alpha/main would be 2x. ---
if (am) {
  eq("duplicate response counted once (not doubled)", am.month, expAlphaMain);
  check("duplicate not doubled", am.month !== +(expAlphaMain * 2).toFixed(2));
}

// --- Filter behavior: a substring keeps only matching rows ---
const filtered = spawnSync(
  process.execPath,
  [COST, "beta", "--self", "--json", "--asof", "2026-06-03", "--projects-dir", FIXTURES],
  { encoding: "utf8" }
);
const frows = JSON.parse(filtered.stdout);
eq("filter 'beta' returns 1 row", frows.length, 1);
check("filter 'beta' row is beta/*", frows.every((r) => r.project === "beta"));

// --- Missing projects dir exits 0 with a friendly message ---
const missing = spawnSync(
  process.execPath,
  [COST, "--self", "--projects-dir", join(FIXTURES, "does-not-exist-xyz")],
  { encoding: "utf8" }
);
eq("missing dir exits 0", missing.status, 0);
check(
  "missing dir prints friendly message",
  missing.stdout.includes("No Claude Code session logs found"),
  missing.stdout.trim()
);

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed.");
process.exit(0);
