# What “Loki works” means

This is the product acceptance contract. A status badge, accepted command, local commit, or agent message is not success by itself. Loki works when a person can turn an idea or report into a verified live result while always knowing what is happening and what they can do next.

## The core loop

1. **One click:** An authorized owner or editor clicks **Implement** on feedback.
2. **Immediate orientation:** The row opens Watch and gives one-tap paths to Terminal and the same run's Loki chat. It names the selected machine and provider before work starts.
3. **Truthful execution:** Each state is backed by evidence: queued means a named runner has not claimed it; submitted means the prompt reached the CLI; generating requires post-submit model activity; shipped requires a PR or deployment fact; live requires a production check.
4. **Visible completion:** The result returns to the feedback row and chat with the PR, commit, deploy state, and live page to verify. The reporter can see whether their report is received, underway, shipped, or rejected.
5. **Actionable failure:** Every failure states what failed, the observed cause, and the next action. Examples: “Open Fleet Runner on this computer,” “Cursor is not logged in,” or “Grok weekly quota is exhausted; switch provider.” A bare Retry is never the only explanation.

## Trust and low anxiety

- Every product term, badge, count, and control can be opened for a plain-language explanation of what it means, where the fact came from, and what happens next.
- Loki never equates a process, PTY redraw, prompt delivery, or elapsed timer with model generation.
- Watch, Terminal, Chat, Control, Activity, and Feedback project the same run ledger. If two surfaces disagree, Loki treats that as a defect.
- Silence has a deadline. A run that has no fresh evidence becomes stalled or ended and gives a remedy.
- Advanced detail is available without overwhelming the default path: summary first, evidence and event trail on demand.

## Collaboration and tenancy

The project is the authorization boundary. The initial roles are deliberately small:

| Role | See project | Track own reports | Triage feedback | Implement/edit | Manage members |
| --- | --- | --- | --- | --- | --- |
| Reporter | No | Yes | No | No | No |
| Viewer | Yes | Yes | No | No | No |
| Editor | Yes | Yes | Yes | Yes | No |
| Owner | Yes | Yes | Yes | Yes | Yes |

- Anonymous reporters receive a signed tracking link and an invitation to register or sign in. Claiming a report grants access to that report only.
- People can create projects, invite collaborators, request to join existing projects, and have an owner approve the appropriate role.
- Authorization is enforced in server queries and mutations. Hiding a button is never the security boundary.
- An Annushka project editor can implement Annushka-site feedback. An unrelated reporter can track their report but cannot inspect or edit the project.

## Agent and model independence

- Providers, agents, launch commands, capabilities, and model choices come from the agent registry and provider configuration. Product surfaces render this registry; they do not maintain private hardcoded lists.
- Loki distinguishes installed, authenticated, available capacity, last successful interaction, and current outage. “Installed” does not imply “can answer.”
- Switching provider is available at the point of failure and persists for the project. Loki offers only options it has evidence can run on the chosen machine.
- A successful prompt delivery is `submitted`. Only model activity after delivery is `generating`.
- Fleet Runner and cloud runner implement the same command and event contracts, so moving work does not change the mental model.

## Loki chat

Loki chat is the understandable control surface over the same run, project context, and evidence shown elsewhere. It must remain useful with a weak or free model by doing deterministic work outside the model:

- assemble scoped project, run, user, and product context before inference;
- retrieve concise, cited facts instead of sending transcript sludge;
- expose structured actions such as implement, inject, switch provider, open Terminal, and verify live;
- use schemas and deterministic validators for tool calls and completion claims;
- explain uncertainty and link to the underlying evidence;
- reserve stronger models for judgments that require them.

## Packages and shared infrastructure

Use the studio's maintained packages for identity, navigation, design tokens, AI chat, lists, feedback, and other established seams when they satisfy the contract. Extend a shared package when several products need the same capability. Keep product-specific policy in Loki. Do not create a local imitation of a package merely to move faster for one commit.

## Release acceptance

A user-visible loop change is complete only after all applicable checks pass:

1. meaningful unit or contract tests;
2. repository verify and CI green;
3. merged and deployed production commit confirmed;
4. an authenticated browser walk of the real user path;
5. evidence that the selected runner/provider claimed the command;
6. Terminal or Chat shows the real work, or an exact blocker and remedy;
7. completion returns with PR/deploy/live evidence;
8. reporter and editor permissions are tested separately;
9. the handoff records URLs, run IDs, commits, observed failures, and remaining work.

The first four core-loop steps are the P0 product. Broader dashboards, robots, analytics, and automation may build on them; they never compensate for a loop that cannot reliably turn one feedback item into a visible live result.
