#!/usr/bin/env node
// Lightweight manifest sanity check for CI: confirms plugin.json and
// marketplace.json parse as JSON and carry the fields Claude Code requires.
// The authoritative schema check is `claude plugin validate . --strict`, run
// locally before publishing; this keeps CI self-contained (no claude install).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log("  FAIL " + msg);
};
const ok = (msg) => console.log("  ok   " + msg);

function load(rel) {
  const path = join(REPO, rel);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`${rel} is not valid JSON: ${err.message}`);
    return null;
  }
}

const plugin = load(".claude-plugin/plugin.json");
if (plugin) {
  if (typeof plugin.name === "string" && plugin.name) ok("plugin.json has name");
  else fail("plugin.json missing required 'name'");
  if (plugin.name === "claude-code-cost") ok("plugin name is claude-code-cost");
  else fail(`plugin name is '${plugin.name}', expected claude-code-cost`);
}

const market = load(".claude-plugin/marketplace.json");
if (market) {
  if (typeof market.name === "string" && market.name) ok("marketplace.json has name");
  else fail("marketplace.json missing required 'name'");
  if (market.owner && typeof market.owner.name === "string") ok("marketplace owner.name present");
  else fail("marketplace.json missing required owner.name");
  if (Array.isArray(market.plugins) && market.plugins.length > 0) {
    ok("marketplace has plugins[]");
    for (const p of market.plugins) {
      if (p.name && p.source) ok(`plugin entry '${p.name}' has name + source`);
      else fail(`a marketplace plugin entry is missing name or source: ${JSON.stringify(p)}`);
    }
  } else {
    fail("marketplace.json plugins[] is empty or missing");
  }
}

if (failures > 0) {
  console.log(`\n${failures} manifest check(s) failed.`);
  process.exit(1);
}
console.log("\nAll manifest checks passed.");
