#!/usr/bin/env node
// claude-code-cost: show Claude Code spend (USD) per project and per git branch.
//
// It reads only the transcript JSONL that Claude Code already writes locally to
// ~/.claude/projects/**/*.jsonl. It never touches API traffic. Zero key, zero
// prompts, zero latency. This is a usage guard / spend monitor, not a proxy.
//
// Pricing comes from the vendored ai-price-index lib (no runtime network).
//
// Design:
//   - By default, if `budgetclaw` is on PATH, run `budgetclaw status` (richer:
//     persistent DB + budgets) and print its output. On any failure, or with
//     --self, fall back to the self-contained reader below.
//   - The self-contained reader parses the raw JSONL = ground truth.

import { spawnSync } from "node:child_process";
import { readdirSync, existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join, basename, isAbsolute, resolve } from "node:path";

import * as price from "./vendor/ai-price-index/index.js";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    self: false,
    json: false,
    help: false,
    projectsDir: null,
    asof: null, // YYYY-MM-DD; pins period boundaries (testing/determinism)
    filter: null,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self") opts.self = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--projects-dir") opts.projectsDir = argv[++i] ?? null;
    else if (a.startsWith("--projects-dir=")) opts.projectsDir = a.slice("--projects-dir=".length);
    else if (a === "--asof") opts.asof = argv[++i] ?? null;
    else if (a.startsWith("--asof=")) opts.asof = a.slice("--asof=".length);
    else if (a.startsWith("--")) {
      // Unknown flag: ignore rather than crash, but note for help.
      // (kept permissive so future flags do not break invocation)
    } else positionals.push(a);
  }
  // First non-flag arg is the substring filter.
  if (positionals.length > 0) opts.filter = positionals[0];
  return opts;
}

const USAGE = `claude-code-cost  -  Claude Code spend per project and per git branch

Reads the local session logs Claude Code writes to ~/.claude/projects/**/*.jsonl.
Never touches API traffic. Zero key, zero prompts, zero latency.

Usage:
  node cost.mjs [filter] [flags]

Arguments:
  filter                 Case-insensitive substring; keeps rows whose PROJECT
                         or BRANCH contains it (TOTAL + header are preserved).

Flags:
  --self                 Force the self-contained JSONL reader (skip budgetclaw).
  --json                 Emit a JSON array instead of the table.
  --projects-dir <path>  Scan root override (default: ~/.claude/projects).
                         Also via CC_COST_PROJECTS_DIR.
  --asof <YYYY-MM-DD>    Pin "today" for period boundaries (deterministic).
  -h, --help             Show this help.

By default, if budgetclaw is installed it is used (richer: persistent DB +
budget caps). Pass --self to always use the built-in reader.`;

// ---------------------------------------------------------------------------
// Period boundaries (UTC, matching BudgetClaw defaults)
//
// daily   = [today 00:00, +1 day)
// weekly  = Monday-based ISO week: [Mon 00:00, +7 days)
// monthly = [1st of month 00:00, +1 month)
//
// All in UTC for v0 (BudgetClaw's default timezone is UTC). Half-open [start,end).
// We use millisecond instants so an event "counts" when start <= ts < end.
// ---------------------------------------------------------------------------

function periodBounds(now) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  const dayStart = Date.UTC(y, m, d, 0, 0, 0, 0);
  const dayEnd = Date.UTC(y, m, d + 1, 0, 0, 0, 0);

  // Monday-based week: JS getUTCDay() has Sun=0..Sat=6; offset to Monday.
  const offset = (now.getUTCDay() + 6) % 7;
  const weekStart = Date.UTC(y, m, d - offset, 0, 0, 0, 0);
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;

  const monthStart = Date.UTC(y, m, 1, 0, 0, 0, 0);
  const monthEnd = Date.UTC(y, m + 1, 1, 0, 0, 0, 0);

  return {
    day: [dayStart, dayEnd],
    week: [weekStart, weekEnd],
    month: [monthStart, monthEnd],
  };
}

// ---------------------------------------------------------------------------
// JSONL parsing (canonical schema, mirrors BudgetClaw's Go parser)
// ---------------------------------------------------------------------------

function projectFromCWD(cwd) {
  if (!cwd) return "unknown";
  const base = basename(cwd);
  if (base === "" || base === "/" || base === ".") return "unknown";
  return base;
}

// Build the token rollup the vendored pricer expects from message.usage.
function tokensFromUsage(usage) {
  const u = usage || {};
  const cc = u.cache_creation || {};
  let write5m = cc.ephemeral_5m_input_tokens || 0;
  let write1h = cc.ephemeral_1h_input_tokens || 0;
  // Correctness improvement over the Go parser: when neither ephemeral field is
  // present but the older flat cache_creation_input_tokens is positive, attribute
  // the whole amount to the 5m bucket so cache-write cost is never silently lost.
  if (write5m === 0 && write1h === 0 && (u.cache_creation_input_tokens || 0) > 0) {
    write5m = u.cache_creation_input_tokens;
  }
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cache_read: u.cache_read_input_tokens || 0,
    cache_write_5m: write5m,
    cache_write_1h: write1h,
  };
}

// Parse one JSONL line. Returns:
//   { event }        billable assistant message
//   { skip: true }   non-billable / synthetic line (ignore silently)
//   { malformed }    bad JSON or assistant line missing required fields
function parseLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { skip: true };

  let r;
  try {
    r = JSON.parse(trimmed);
  } catch {
    return { malformed: true };
  }
  if (!r || typeof r !== "object") return { malformed: true };

  // Only assistant lines are billable.
  if (r.type !== "assistant") return { skip: true };

  const msg = r.message || {};
  const model = msg.model;

  // Synthetic / sentinel models (e.g. "<synthetic>") are framework internals
  // Anthropic does not bill. Any angle-bracket sentinel follows the convention.
  if (typeof model === "string" && model.startsWith("<")) return { skip: true };

  // Required fields on assistant lines.
  if (!r.uuid || !model || !r.timestamp) return { malformed: true };

  const ts = Date.parse(r.timestamp);
  if (Number.isNaN(ts)) return { malformed: true };

  return {
    event: {
      uuid: r.uuid,
      messageId: msg.id || "",
      requestId: r.requestId || "",
      ts, // ms epoch (UTC)
      project: projectFromCWD(r.cwd),
      branch: r.gitBranch && r.gitBranch !== "" ? r.gitBranch : "(no branch)",
      model,
      tokens: tokensFromUsage(msg.usage),
    },
  };
}

// ---------------------------------------------------------------------------
// Self-contained reader
// ---------------------------------------------------------------------------

function* walkJsonl(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkJsonl(full); // recurse (e.g. subagents/)
    } else if (e.isFile() && e.name.endsWith(".jsonl")) {
      yield full;
    }
  }
}

async function readLines(file, onLine) {
  // Stream line-by-line so a multi-GB log never loads into memory at once.
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) onLine(line);
}

async function selfContained(opts) {
  const root =
    opts.projectsDir ||
    process.env.CC_COST_PROJECTS_DIR ||
    join(homedir(), ".claude", "projects");
  const rootAbs = isAbsolute(root) ? root : resolve(process.cwd(), root);

  if (!existsSync(rootAbs)) {
    return { missingPath: rootAbs };
  }

  const now = opts.asof ? new Date(opts.asof + "T12:00:00.000Z") : new Date();
  const bounds = periodBounds(now);

  // Aggregate cents per (project, branch) per period.
  // key = project + " " + branch
  const rows = new Map();
  const ensure = (project, branch) => {
    const k = project + " " + branch;
    let v = rows.get(k);
    if (!v) {
      v = { project, branch, day: 0, week: 0, month: 0 };
      rows.set(k, v);
    }
    return v;
  };

  const seen = new Set(); // dedup keys
  let malformed = 0;
  const unpricedModels = new Map(); // model -> count
  let unpricedCount = 0;

  const inWindow = (ts, [start, end]) => ts >= start && ts < end;

  for (const file of walkJsonl(rootAbs)) {
    // eslint-disable-next-line no-await-in-loop
    await readLines(file, (line) => {
      const res = parseLine(line);
      if (res.malformed) {
        malformed++;
        return;
      }
      if (res.skip || !res.event) return;
      const ev = res.event;

      // Dedup: Claude Code writes the same assistant response on multiple lines
      // (one per tool-result roundtrip), same message.id + requestId, different
      // uuid. Count each unique response once. Fall back to uuid when no id.
      const dedupKey = ev.messageId ? ev.messageId + " " + ev.requestId : ev.uuid;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);

      // Price at the event's UTC calendar date.
      const date = new Date(ev.ts).toISOString().slice(0, 10);
      const { cents, modelKnown } = price.usdForRollup(ev.tokens, "anthropic", ev.model, date);

      if (!modelKnown) {
        unpricedCount++;
        unpricedModels.set(ev.model, (unpricedModels.get(ev.model) || 0) + 1);
        // Do not silently drop: surfaced after rendering. cents is 0 here.
      }

      const row = ensure(ev.project, ev.branch);
      if (inWindow(ev.ts, bounds.day)) row.day += cents;
      if (inWindow(ev.ts, bounds.week)) row.week += cents;
      if (inWindow(ev.ts, bounds.month)) row.month += cents;
    });
  }

  // Drop rows with zero spend in all three periods (matches budgetclaw, which
  // only stores periods with activity). Sort by project then branch.
  const list = [...rows.values()]
    .filter((r) => r.day > 0 || r.week > 0 || r.month > 0)
    .sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0));

  return {
    rows: list,
    malformed,
    unpricedModels,
    unpricedCount,
    dataModified: price.meta.dataModified,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const dollars = (cents) => "$" + (cents / 100).toFixed(2);

function filterRows(rows, filter) {
  if (!filter) return rows;
  const f = filter.toLowerCase();
  return rows.filter(
    (r) => r.project.toLowerCase().includes(f) || r.branch.toLowerCase().includes(f)
  );
}

// Render the same column layout BudgetClaw uses: PROJECT BRANCH TODAY WEEK MONTH
// with at least a 2-space gutter (Go's tabwriter uses padding 3; we compute
// max widths + a 2-space gutter, which lines up identically for plain reading).
function renderTable(rows) {
  if (rows.length === 0) return "No Claude Code spend tracked yet.";

  const header = ["PROJECT", "BRANCH", "TODAY", "WEEK", "MONTH"];
  const body = rows.map((r) => [
    r.project,
    r.branch,
    dollars(r.day),
    dollars(r.week),
    dollars(r.month),
  ]);

  let total = null;
  if (rows.length > 1) {
    const sumD = rows.reduce((s, r) => s + r.day, 0);
    const sumW = rows.reduce((s, r) => s + r.week, 0);
    const sumM = rows.reduce((s, r) => s + r.month, 0);
    total = ["TOTAL", "", dollars(sumD), dollars(sumW), dollars(sumM)];
  }

  const all = [header, ...body, ...(total ? [total] : [])];
  const widths = header.map((_, c) => Math.max(...all.map((row) => row[c].length)));
  const GUTTER = "  ";
  const fmt = (row) =>
    row.map((cell, c) => cell.padEnd(c === row.length - 1 ? 0 : widths[c])).join(GUTTER).replace(/\s+$/, "");

  return all.map(fmt).join("\n");
}

function rowsToJson(rows) {
  return rows.map((r) => ({
    project: r.project,
    branch: r.branch,
    today: +(r.day / 100).toFixed(2),
    week: +(r.week / 100).toFixed(2),
    month: +(r.month / 100).toFixed(2),
  }));
}

function renderUnpricedNote(unpricedModels, unpricedCount) {
  if (unpricedCount === 0) return null;
  const ids = [...unpricedModels.keys()].sort().join(", ");
  return (
    `Note: ${unpricedCount} event(s) used model id(s) not in the price index ` +
    `(${ids}) and were left unpriced. Update ai-price-index to price them.`
  );
}

// ---------------------------------------------------------------------------
// budgetclaw passthrough
// ---------------------------------------------------------------------------

function hasBudgetclaw() {
  const which = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? ["budgetclaw"] : ["-v", "budgetclaw"], {
    encoding: "utf8",
    shell: process.platform !== "win32",
  });
  return which.status === 0 && (which.stdout || "").trim().length > 0;
}

function runBudgetclaw() {
  const res = spawnSync("budgetclaw", ["status"], { encoding: "utf8" });
  if (res.error || res.status !== 0) return null;
  return res.stdout;
}

// Filter budgetclaw's plain-text output by substring on PROJECT/BRANCH while
// preserving the header row and a TOTAL footer. The TOTAL is recomputed from the
// kept rows (the last three "$x.xx" columns) so it reflects the filtered subset
// rather than budgetclaw's global total. If parsing a row's amounts ever fails
// we drop the recomputed TOTAL rather than show a wrong number.
const MONEY_RE = /\$(-?\d+(?:\.\d+)?)/g;

function trailingAmounts(line) {
  const nums = [...line.matchAll(MONEY_RE)].map((m) => parseFloat(m[1]));
  // status rows end in exactly three money columns: TODAY WEEK MONTH.
  if (nums.length < 3) return null;
  return nums.slice(-3);
}

function filterBudgetclawOutput(text, filter) {
  if (!filter) return text;
  const f = filter.toLowerCase();
  const lines = text.split("\n");
  if (lines.length === 0) return text;

  const out = [];
  let sawTotal = false;
  let totalTemplate = null;
  let sumD = 0;
  let sumW = 0;
  let sumM = 0;
  let summable = true;
  let keptRows = 0;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (line.startsWith("PROJECT") || line.trim() === "") {
      out.push(line);
      continue;
    }
    if (line.startsWith("TOTAL")) {
      sawTotal = true;
      totalTemplate = line; // keep its column layout for the rebuilt footer
      continue; // re-emitted at the end with recomputed sums
    }
    if (lower.includes(f)) {
      out.push(line);
      keptRows++;
      const amts = trailingAmounts(line);
      if (amts) {
        sumD += amts[0];
        sumW += amts[1];
        sumM += amts[2];
      } else {
        summable = false;
      }
    }
  }

  // Rebuild a TOTAL footer when budgetclaw showed one and we can sum the kept
  // rows. Reuse budgetclaw's TOTAL line as a width template; just swap amounts.
  if (sawTotal && keptRows > 1 && summable && totalTemplate) {
    const fixed = [sumD, sumW, sumM].map((n) => "$" + n.toFixed(2));
    let i = -1;
    const rebuilt = totalTemplate.replace(MONEY_RE, () => {
      i++;
      return i < 3 ? fixed[i] : "$0.00";
    });
    out.push(rebuilt);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }

  // Try budgetclaw unless --self, --json, or a custom projects dir forces the
  // built-in reader. (--json and --projects-dir imply the self-contained path,
  // because budgetclaw status emits neither JSON nor a scan-root override.)
  if (!opts.self && !opts.json && !opts.projectsDir && hasBudgetclaw()) {
    const out = runBudgetclaw();
    if (out !== null) {
      process.stdout.write(filterBudgetclawOutput(out, opts.filter));
      if (!out.endsWith("\n")) process.stdout.write("\n");
      return 0;
    }
    // budgetclaw failed; fall through to the self-contained reader.
  }

  const result = await selfContained(opts);

  if (result.missingPath) {
    if (opts.json) {
      process.stdout.write("[]\n");
    } else {
      process.stdout.write(`No Claude Code session logs found at ${result.missingPath}.\n`);
    }
    return 0;
  }

  const rows = filterRows(result.rows, opts.filter);

  if (opts.json) {
    // stdout stays a pure JSON array of {project, branch, today, week, month}.
    // _meta (dataModified + unpriced/malformed info) goes to stderr so stdout is
    // safe to pipe into `jq` or JSON.parse without stripping anything.
    const payload = rowsToJson(rows);
    process.stdout.write(JSON.stringify(payload) + "\n");
    const meta = {
      dataModified: result.dataModified,
      unpricedCount: result.unpricedCount,
      unpricedModels: [...result.unpricedModels.keys()].sort(),
      malformedLines: result.malformed,
    };
    process.stderr.write("_meta " + JSON.stringify(meta) + "\n");
    return 0;
  }

  process.stdout.write(renderTable(rows) + "\n");
  const note = renderUnpricedNote(result.unpricedModels, result.unpricedCount);
  if (note) process.stdout.write("\n" + note + "\n");
  return 0;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    process.stderr.write("claude-code-cost error: " + (err && err.message ? err.message : String(err)) + "\n");
    process.exit(1);
  });
