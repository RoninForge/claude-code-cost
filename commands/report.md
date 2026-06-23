---
description: Claude Code spend in USD per project and per git branch (today / this week / this month), computed locally from the session logs Claude Code already writes. Never touches API traffic; zero key, zero prompts, zero latency.
argument-hint: "[filter] [--self] [--json]"
allowed-tools: Bash(node:*), Bash(budgetclaw:*)
---

Run the bundled cost reader and show the user their Claude Code spend, grouped by project and git branch.

Run exactly this command with the Bash tool, passing the user's arguments through verbatim:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cost.mjs" --mode report $ARGUMENTS
```

Then present the command's stdout to the user VERBATIM inside a fenced code block. Do not reformat the table, do not add columns, do not re-sort rows, and do not convert it to Markdown. Do not rank projects, editorialize, or add commentary about the numbers unless the user explicitly asks for analysis.

Notes for you (the model), not for the user:

- The script reads only the local JSONL session logs under `~/.claude/projects`. It never touches API traffic. If asked, you can state plainly: zero key, zero prompts, zero latency.
- If `budgetclaw` is installed, the script uses it automatically (richer: persistent database plus budget caps). Otherwise it falls back to a self-contained reader. Pass `--self` to force the built-in reader.
- A first non-flag argument is a case-insensitive substring filter on project or branch name (for example `/claude-code-cost:report roninforge`).
- For spend over time use the sibling commands `/claude-code-cost:by-day`, `/claude-code-cost:by-week`, `/claude-code-cost:by-month`. For a per-project rollup with last-active dates, `/claude-code-cost:by-project`.
- `--json` makes it emit a JSON array instead of the table.
- If the output ends with a "Note:" line about unpriced models, keep it; it surfaces spend the price index could not value yet.
- If the script prints "No Claude Code spend tracked yet." or "No Claude Code session logs found ...", relay that message as-is.
