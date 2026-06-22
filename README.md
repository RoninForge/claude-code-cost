# claude-code-cost

See your Claude Code spend in USD, per project and per git branch, without leaving Claude Code.

`/cost` reads the session logs Claude Code already writes to `~/.claude/projects/**/*.jsonl`, prices every assistant response with a dated, point-in-time price index, and prints a per-project, per-branch table. It never touches API traffic. Zero key, zero prompts, zero latency.

```
PROJECT     BRANCH    TODAY   WEEK    MONTH
my-app      main      $6.04   $6.04   $204.58
my-app      feature   $1.75   $1.75   $1.75
other-repo  main      $23.41  $23.41  $85.85
TOTAL                 $31.20  $31.20  $292.18
```

## Why

Claude Code shows you a running session cost, but not how much a given project or branch has cost you today, this week, or this month. This plugin answers that question from data already on your disk. It is a usage guard, not a proxy: it parses the local JSONL transcripts, it does not sit in front of the API, store keys, or add latency.

Pricing is point-in-time: each response is valued at the rate that was in effect on the day it ran, using the bundled [ai-price-index](https://www.npmjs.com/package/ai-price-index) dataset (first-party-sourced and dated). No network call is made at runtime. Models the index does not yet know are surfaced as a note rather than silently counted as zero.

## Install

In Claude Code:

```
/plugin marketplace add RoninForge/claude-code-cost
/plugin install claude-code-cost@roninforge
```

Then run `/cost`.

Requires `node` (>= 18) on your PATH, which Claude Code users almost always have.

## Usage

```
/cost                 spend per project and branch (today / week / month)
/cost <filter>        only rows whose project or branch contains <filter>
/cost --self          force the built-in reader (skip BudgetClaw, see below)
/cost --json          machine-readable JSON instead of the table
```

`/cost my-app` filters to one project or branch. The filter is a case-insensitive substring match on either column.

## How it works

- Reads every `*.jsonl` under `~/.claude/projects` (including subagent logs).
- Counts only billable assistant responses, and deduplicates the repeated lines Claude Code writes for a single response so nothing is double-counted.
- Attributes each response to a project (the working directory name) and a git branch, both recorded by Claude Code itself.
- Prices each response at its own date with the bundled price index, including cache-read and cache-write tokens.
- Period boundaries: today, the current Monday-based week, and the current calendar month, all in UTC.

## Optional: BudgetClaw integration

If [BudgetClaw](https://roninforge.org/budgetclaw) is installed, `/cost` uses it automatically for a richer read backed by BudgetClaw's persistent database and budget caps. If it is not installed, the bundled self-contained reader is used instead. Either way the numbers come from your local logs. Pass `--self` to always use the built-in reader.

## Privacy and trust

- No API keys are read or stored.
- No prompts, completions, or file contents leave your machine.
- Nothing is sent anywhere. The plugin reads local files and prints a table.

## Development

```sh
node scripts/cost.mjs --self                 # run against your real logs
node scripts/cost.mjs --self --json          # JSON output
node scripts/test.mjs                         # run the test suite
node scripts/check-manifests.mjs             # manifest sanity check
claude plugin validate . --strict            # validate the plugin manifest
```

The pricing data under `scripts/vendor/ai-price-index/` is a bundled snapshot of the published `ai-price-index` package. To refresh it, re-copy `lib/{data.json,engine.js,index.js}` from a newer release and bump the plugin version. See `scripts/vendor/ai-price-index/VENDORED.md`.

## License

MIT for the tooling. The bundled pricing data is CC BY 4.0 (attribution: RoninForge). See [LICENSE](LICENSE).
