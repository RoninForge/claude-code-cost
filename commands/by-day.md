---
description: Claude Code spend grouped by calendar day, dated, most recent first. Computed locally from the session logs Claude Code already writes. Never touches API traffic; zero key, zero prompts, zero latency.
argument-hint: "[filter] [--json]"
allowed-tools: Bash(node:*)
---

Show the user their Claude Code spend broken down by day.

Run exactly this command with the Bash tool, passing the user's arguments through verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cost.mjs" --mode by-day $ARGUMENTS
```

Then present the command's stdout to the user VERBATIM inside a fenced code block. Do not reformat the table, do not add columns, do not re-sort rows, and do not convert it to Markdown. Do not editorialize or add commentary about the numbers unless the user explicitly asks for analysis.

Notes for you (the model), not for the user:

- Output is a `DATE  SPEND` table covering the last ~30 days, newest day first, with a TOTAL footer. Only days with spend appear.
- The script reads only the local JSONL session logs under `~/.claude/projects`. It never touches API traffic: zero key, zero prompts, zero latency. This view always reads the raw logs directly (it does not use budgetclaw, which has no per-date data).
- A first non-flag argument is a case-insensitive substring filter on project or branch name, scoping the daily totals to that project/branch (for example `/claude-code-cost:by-day roninforge`).
- `--json` makes it emit a JSON array of `{period, spend}` instead of the table.
- If the output ends with a "Note:" line about unpriced models, keep it.
- If the script prints "No Claude Code spend tracked yet." or "No Claude Code session logs found ...", relay that message as-is.
