# Mobile screenshot review — 15 October 2026

This ledger covers the supplied screenshot batches, including repeated images.
“Implemented” means a code change exists; it does not imply private-account or
physical-device verification. Deployment evidence is recorded below separately.

## Screenshot inventory

| Images (100002….jpg) | Finding | Disposition |
| --- | --- | --- |
| 4747 | Generated status instructions fill the conversation | Compact saved display label and expandable request details shipped in #1191. |
| 4748–4749 | Stale model availability, repeated exhausted choices and confusing fallback claims | Picker refresh, deduplication, truthful unknown/reset states and explicit fallback billing behavior shipped in #1191. |
| 4750–4754 | Model routing prices lack units; catalog rewards batch discounts; excessive metadata and overlays | Pricing units and collapsed routing shipped. #1199 excludes batch-only offers and provides compact phone details, truthful free-route selection and unknown prices. Collision-aware widget placement shipped in #1188. |
| 4755–4756 | Computer model instructions imply every model runs on a laptop and data never leaves it | Hardware, cost and endpoint privacy claims corrected; advanced computer instructions folded in #1197. |
| 4758 | Start-screen composer covered by navigation; clipped suggestions | Scroll/viewport fixes shipped in #1187/#1200; actual-component phone fixtures verify composer clearance. Horizontal suggestion rows remain intentionally scrollable. |
| 4759–4761 | Stale developer handoffs, raw dates and vague suggestion actions | Old/undated continuation suggestions omitted and dates clarified in #1197. This release names the composer-opening action “Review task” rather than claiming work immediately starts. Existing user-authored goal names are preserved. |
| 4762, 4764–4766 | Unreadable raw terminal, squeezed session name, dense mode controls | Conversation view remains the readable default where the runner supports it. Header wrapping shipped in #1200. This release moves phone conversation summary into the header, simplifies source/input hints and exposes send failures. Raw PTY geometry remains stable for other viewers. |
| 4767 | Profile save button disabled before an edit | Expected unchanged-form state; no forced edit or account-data mutation. Global project settings already expose authorized name editing; main-project personal labels are separate. |
| 4768–4771, 4773 | Long budget/provider lists, faint text, compressed header and horizontal overflow | Contrast and quota-header layout shipped in #1200. This release also wraps the personal budget header and folds its per-model list. Existing detailed quota counters remain expandable. Private provider balances/billing are not independently verified. |
| 4774 | Phone users directed toward desktop download | Optional computer connection and cloud eligibility copy shipped in #1197. Unknown-account-status download pitches removed in #1200. This release adds standard PNG install icons and an Apple touch icon to the standalone web-app manifest. |
| 4781 | Recent imported/generated names presented as “main” projects; shared access and renaming unclear | Explicit personal main-project selection, accessible catalog, personal labels and role-gated shared starts shipped in #1197. #1200 enables cloneable repository-only starts. No project is deleted by guessing its purpose. |
| 4782–4783 | Urgent report/approval counts, private-zone lock and dashboard widgets | Historical handoff/runtime distinction and widget collisions addressed. Private-zone protection is intentional. Security-report freshness, approval records, overnight-plan history and account-specific counts require authenticated records; screenshots do not establish whether a report is still open. |
| 4916 | Francesco TLS protocol error | Public HTTPS check on 14 October reached the private access-code screen. Private content was not opened. Rechecked during release verification. |
| 4917–4920 | Loki substitutes old notes for a requested current site review; tiny citation IDs | Fresh bounded public HTML reader shipped in #1197; project-focused retrieval and tappable source dialogs in #1200. HTML reads do not verify interactive workflows, rendered layout or private source code. |
| 4922–4926, 4928–4932 | Internal dispatch packet, personal goals, unrelated fleet notes and exit contracts shown as a user message; blind Allow/Always controls | #1201 made the user-facing transcript readable and removed personal-life context. Follow-up release sends explicit tasks as a short task plus a compact handoff: no full project profile, cross-project notes, fleet stack/package catalog, or verbose operator preamble. Short "ship that fix" follow-ups carry only a bounded excerpt of the matching project's latest recommendation. Broad next-best tasks can still use their project overview. Inferred approvals are removed; an unfinished tool is not evidence of a permission question. Terminal inspection remains available. |
| 4934 | Project override says paused while composer says autopilot on; months-old next step promoted | This release uses the effective project override throughout the Control card, synchronizes optimistic toggle state/copy and no longer promotes stale handoffs as current next steps. |
| 4935 | Stray 1/2 digits in terminal and interrupted agent | Guessed approval buttons sent those literal keys without a verified permission prompt. They are removed. This release keeps interruption distinct from tool failure and preserves drafts when input is not confirmed. Actual authenticated PTY interaction remains unverified here. |
| 4936–4937 | Watch says both queued and working; wrong project in workspace navigation; raw feedback framing | Referential follow-ups such as “Ship that homepage fix” now carry the latest matching project proposal into the agent task, explicitly as an unverified proposal. This release gives invited project members read-only progress without owner-only terminal actions or raw private dispatch context. It labels queued runs as waiting, binds workspace navigation to the authorized page's project, fails clearly on missing/wrong-project pinned runs, and displays the actual feedback request with optional dispatch details. Toggle and explanatory copy update together. |
| 4947 | Interrupted session shows “Thinking” for 22 minutes | This release recognizes interruption markers as stopped. Quiet sessions say no recent update; silence is not treated as completion and Stop remains available. |
| 4948 | Widget review includes a 309-second session request and duplicate cloud wording | Source wording simplified. Watch/sidebar polling is bounded and shares outstanding requests rather than stacking them. The widget now opens as one Loki conversation, distinguishes **Chat with Loki**, **Save feedback**, and owner **Request a fix**, puts less-used scope choices in an accessible menu, separates browse voice notes from composer dictation, follows Loki light/dark design tokens, and removes the visitor-facing Watch pitch. Anonymous /api/auth/session measured HTTP 200 in about 1.3 seconds on 15 October; this does not reproduce or disprove signed-in database/pool latency. The private session incident remains unverified. Browser checks cover menu keyboard/tap behavior, theme mode, feedback flow and voice capture; no physical phone or signed-in production account was exercised.
| 4949–4951 | Long terminal settings sheet and widget on top of it | Source/input explanations simplified; shared modals suppress the embedded floating launcher while open. Agent switching remains explicit because it restarts the current CLI. This release also removes repeated Loki identity, clarifies the feedback/chat/watch roles, and applies the Loki light/dark theme in the widget. The terminal/session controls remain owner-specific; signed-in production behavior is not covered by the anonymous screenshot fixtures.
| 4996 | Fragmented project page: competing navigation, metadata before identity, clipped sections, scattered destinations, and widget covering current work | Rebuilt project header and overview, one responsive section navigator, focused everyday actions, separate Story/Settings responsibilities, neutral queued state, accessible share modal, and no floating widget on the project workspace. See project-workspace-redesign.md for decisions and browser coverage. |
| 4933 (repeated) | Codex/ChatGPT host app showing compaction and queued messages | This is the external application hosting this conversation, not a Loki screen. No claim is made to change its UI or compaction behavior. |

## Evig security alert

The current source at `bitbaum/evig` main commit
`56bf64fe3c1a76946b025324c5e2baaba1976551` was inspected. `registerUser`
assigns the customer role and no staff permissions; JWT staff claims require a
verified email and the stored staff flag. The public health endpoint reports
healthy. These are source/health observations, not a reproduction of the
registration flow or proof that the old private alert was resolved. Its record
was not dismissed or relabelled without authenticated evidence.

## OC2 / orangecat-2

GitHub's repository record identifies `bitbaum/orangecat-2` as a non-fork created
on 7 October 2026, with description “Started from Loki · orangecat-2”. That
establishes creation through Loki, not who requested it or why. The corresponding
account audit trail is not available in this workspace. It has not been deleted,
archived or marked as a main project by inference.

## Verification

Previous releases: #1191 (picker/display), #1197 (projects/reader/setup), #1199
(catalog), #1200 (phone controls/repository-only starts), with the last combined
verified deployment `fd62b05f6d629b7cf4a1dce9aadf7dcbb3b0db5f` on 14 October.

Current release validation is exercised by the canonical `pnpm run verify` gate.
Final CI and deployment evidence are recorded on the release pull request. Browser fixtures render actual
components and styles with synthetic records at 320px and 390px. They cover
collapsed dispatches, interruption and queued state, absence of guessed approval
keys, retained failed drafts, summary access, and consistent autopilot. They are
not screenshots of a signed-in production account.

Not verified here: private account records, real provider billing, an actual
mobile keyboard/installed-app lifecycle, push delivery, private preview content,
or an authenticated work launch. The phone install remains a web app rather
than a newly built native iOS/Android application. Broader shared-cloud access is
not enabled by bypassing existing account-isolation gates.

Install icon sources are `public/icon.svg`; regenerate the checked-in raster
assets with `npm run generate:brand`. Install assets and the push
worker are public static resources; private application routes remain protected.
