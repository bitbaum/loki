# Feedback → implementation production walk

This is the release gate for Loki's core loop. A status badge alone does not pass.

## Expected path

1. A visitor leaves feedback through the site widget.
2. The operator opens **Feedback** and clicks **Implement**.
3. The row immediately opens **Watch** and keeps visible links to **Terminal** and **Chat**.
4. Loki routes the run to the project's stored builder and AI provider.
5. The builder owns a PTY, prepares first-run trust, submits the prompt, and reports post-submit output.
6. Watch changes from **Queued** to **Working** only after the Runner reports delivery and output.
7. Terminal streams the same PTY by run/project identity. Chat retains the same project context.
8. Completion requires evidence: a green PR for code work, or an explicit no-change result for a probe.

## Failure contract

Every stop must show all three:

- **What failed:** builder, workspace, authentication, provider response, verification, CI, or deploy.
- **Why Loki believes that:** the observed event or terminal state.
- **What to do next:** one primary action, such as open Fleet Runner, log in, switch provider, open Terminal, or retry.

Do not use “Failed — Retry” when the required action is different. Do not call a run Working from a timer or from PTY boot output.

## Production test

Use a harmless, identifiable feedback row. Set a provider that passes a live probe on the selected builder. Click through the browser, then verify:

- the path strip survives the inbox refresh;
- Watch, Terminal, and Chat are reachable without navigating elsewhere;
- Watch says Working while Terminal shows post-prompt agent output;
- the run ledger and PTY agree on provider, builder, and outcome;
- the resulting PR/check/deploy evidence returns to the row.

Record the tested production commit and any failure cause in the handoff. If any check fails, fix and repeat this same walk.
