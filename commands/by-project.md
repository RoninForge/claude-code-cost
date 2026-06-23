---
description: Claude Code spend per project (branches merged) with today / this week / this month and the last active date, ranked by month spend. Computed locally from the session logs Claude Code already writes. Never touches API traffic; zero key, zero prompts, zero latency.
argument-hint: "[filter] [--json]"
allowed-tools: Bash(node:*)
---

Show the user their Claude Code spend rolled up per project, with each project's last active date.

Run exactly this command with the Bash tool, passing the user's arguments through verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cost.mjs" --mode by-project $ARGUMENTS
```

Then present the command's stdout to the user VERBATIM inside a fenced code block. Do not reformat the table, do not add columns, do not re-sort rows, and do not convert it to Markdown. Do not editorialize or add commentary about the numbers unless the user explicitly asks for analysis.

Notes for you (the model), not for the user:

- Output is a `PROJECT  TODAY  WEEK  MONTH  LAST` table, one row per project with its git branches merged together, ranked by month spend, with a TOTAL footer. `LAST` is the most recent day (UTC) that project had any spend.
- The script reads only the local JSONL session logs under `~/.claude/projects`. It never touches API traffic: zero key, zero prompts, zero latency. This view always reads the raw logs directly (it does not use budgetclaw, which has no last-active data).
- A first non-flag argument is a case-insensitive substring filter on the project name, keeping only matching projects (for example `/claude-code-cost:by-project roninforge`).
- `--json` makes it emit a JSON array of `{project, today, week, month, lastActive}` instead of the table.
- If the output ends with a "Note:" line about unpriced models, keep it.
- If the script prints "No Claude Code spend tracked yet." or "No Claude Code session logs found ...", relay that message as-is.
