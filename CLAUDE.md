# Claude Code Instructions

## Git Commits

* Do NOT add "Co-Authored-By: Claude" or any co-author attribution to commit messages
* Keep commit messages short and vague (e.g., "Update portfolio", "Fix bug", "Add feature")

\## Cost \& Token Efficiency Rules

\- \*\*Model Choice:\*\* Use Sonnet 4.5 by default for all implementation and terminal tasks. Only switch to or suggest Opus 4.5 for high-complexity architectural changes or "impossible" debugging scenarios.

\- \*\*Permission Gate:\*\* ALWAYS ask for user confirmation before:

&nbsp;   - Reading files larger than 100KB.

&nbsp;   - Initiating a `subagent` loop (multi-agent tasks).

&nbsp;   - Scanning directories that are not explicitly part of the source code (e.g., ignore build/, dist/, coverage/).

\- \*\*Context Management:\*\* After completing a major task, suggest the `/compact` command to the user to keep the session history lean.

\- \*\*Conciseness:\*\* Provide direct, code-heavy responses. Skip the conversational "fluff" to save output tokens.

