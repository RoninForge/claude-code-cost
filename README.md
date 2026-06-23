# claude-code-cost

See your Claude Code spend in USD, per project, per git branch, and over time, without leaving Claude Code.

`/claude-code-cost:report` reads the session logs Claude Code already writes to `~/.claude/projects/**/*.jsonl`, prices every assistant response with a dated, point-in-time price index, and prints a per-project, per-branch table. It never touches API traffic. Zero key, zero prompts, zero latency.

```
PROJECT     BRANCH    TODAY   WEEK    MONTH
my-app      main      $6.04   $6.04   $204.58
my-app      feature   $1.75   $1.75   $1.75
other-repo  main      $23.41  $23.41  $85.85
TOTAL                 $31.20  $31.20  $292.18
```

Four sibling commands answer "when did I spend?": `/claude-code-cost:by-day`, `/claude-code-cost:by-week`, `/claude-code-cost:by-month` (each a dated, most-recent-first breakdown), and `/claude-code-cost:by-project` (a per-project rollup with each project's last-active date).

```
> /claude-code-cost:by-day

DATE        SPEND
2026-06-23  $9.98
2026-06-22  $4.20
2026-06-19  $7.49
TOTAL       $21.67
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

Then run `/claude-code-cost:report`.

Requires `node` (>= 18) on your PATH, which Claude Code users almost always have.

## Commands

```
/claude-code-cost:report       spend per project + branch (today / week / month)
/claude-code-cost:by-day       spend per day, dated, most recent first (~30 days)
/claude-code-cost:by-week      spend per Monday-based week, dated (~12 weeks)
/claude-code-cost:by-month     spend per calendar month, dated (~12 months)
/claude-code-cost:by-project   per project (branches merged) + last active date
```

Every command takes an optional case-insensitive substring `[filter]` on the project or branch name, so the dated views double as a per-project history:

```
/claude-code-cost:report my-app     only rows whose project or branch contains "my-app"
/claude-code-cost:by-day my-app     my-app's spend per day, dated
/claude-code-cost:by-month my-app   my-app's spend per month, dated
```

Flags (all commands): `--json` for machine-readable output, `--self` to force the built-in reader instead of BudgetClaw (report only; the by-* views always read the raw logs directly).

## How it works

- Reads every `*.jsonl` under `~/.claude/projects` (including subagent logs).
- Counts only billable assistant responses, and deduplicates the repeated lines Claude Code writes for a single response so nothing is double-counted.
- Attributes each response to a project (the working directory name) and a git branch, both recorded by Claude Code itself.
- Prices each response at its own date with the bundled price index, including cache-read and cache-write tokens.
- Period boundaries: today, the current Monday-based week, and the current calendar month, all in UTC.

## Optional: BudgetClaw integration

If [BudgetClaw](https://roninforge.org/budgetclaw) is installed, `/claude-code-cost:report` uses it automatically for a richer read backed by BudgetClaw's persistent database and budget caps. If it is not installed, the bundled self-contained reader is used instead. Either way the numbers come from your local logs. Pass `--self` to always use the built-in reader. The dated views (`by-day`, `by-week`, `by-month`, `by-project`) always read the raw logs directly, because `budgetclaw status` only emits the pre-rolled today/week/month snapshot with no per-date data.

## Privacy and trust

- No API keys are read or stored.
- No prompts, completions, or file contents leave your machine.
- Nothing is sent anywhere. The plugin reads local files and prints a table.

## Development

```sh
node scripts/cost.mjs --self                      # report, against your real logs
node scripts/cost.mjs --mode by-day --self        # spend per day
node scripts/cost.mjs --mode by-project --self    # per-project rollup
node scripts/cost.mjs --self --json               # JSON output
node scripts/cost.mjs --help                       # all modes and flags
node scripts/test.mjs                              # run the test suite
node scripts/check-manifests.mjs                  # manifest sanity check
claude plugin validate . --strict                 # validate the plugin manifest
```

Each command in `commands/` is a thin wrapper that runs `scripts/cost.mjs` with a `--mode`. The reader makes a single pass over the JSONL (dedup + point-in-time pricing) and every mode aggregates from that one priced-event list.

The pricing data under `scripts/vendor/ai-price-index/` is a bundled snapshot of the published `ai-price-index` package. To refresh it, re-copy `lib/{data.json,engine.js,index.js}` from a newer release and bump the plugin version. See `scripts/vendor/ai-price-index/VENDORED.md`.

## License

MIT for the tooling. The bundled pricing data is CC BY 4.0 (attribution: RoninForge). See [LICENSE](LICENSE).
