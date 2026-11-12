# The signed-in screens, audited: November 2026

**created_date:** 2026-11-12
**last_modified_date:** 2026-11-12
**last_modified_summary:** First version: how the audit was done, what it found, what was fixed with the measurement before and after, and every finding that remains.

The first part of the November pass ([`ux-pass-2026-11.md`](ux-pass-2026-11.md))
gave the homepage a written audit and said the signed-in screens were owed
one. This is it: what was measured, what was fixed, and the register of what
is left. The bar is not restated here: it is
[`design-reset-2026-10.md`](design-reset-2026-10.md) and fleet `AGENTS.md`.

## How it was done

- Seven groups of screens, one auditor each, against a production build of
  the tree, in a real browser at 390×844 and 1440×900, dark and light, signed
  in to the dense local account and to the demo tenant: Loki chat and Home;
  Projects and the project page; the ways in (new project, import, Terminal,
  onboarding, sign-in); the work queues; Settings and System; the private
  zone; and the shell with the visual system across screens.
- The standard was the homepage's: a finding needs a measurement taken in the
  browser, the viewport and account, a screenshot, the source line, the rule
  it breaks and a fix that names its layer. Each auditor returned twelve.
- Every finding was to get a second, independent check that tries to refute
  it. **Only the Projects group got one** (four confirmed, eight corrected,
  none refuted, five more found). The other six checks and the completeness
  check did not run: the helper agents reached a usage limit. So of 84
  findings, 12 are twice-checked. The rest are once-measured until someone
  reproduces them, and the list below marks which is which.
- What was fixed here was reproduced first by hand, on `main`, with a script
  of its own, and measured again after the fix. One finding did not
  reproduce: `chat-home-2` (Home staying a skeleton when its first load
  fails) was already fixed on `main` that day by #1681.

## What was fixed, and the measurement before and after

| Finding | Before | After |
|---|---|---|
| `chat-home-1` A sent message is drawn narrower than its own words | "What's going on?" was 106px wide on two lines at 1440; one line needs 141px. The bubble was capped at 75–90% of a stack that shrinks to fit it. | 141px on one line. A long message is 75% of the row at 1440 and 90% at 390. The cap is on the stack. |
| `start-paths-1` Onboarding: "Project name" disappears after one keystroke | After the first letter the field was gone, focus was on the page, and the space bar scrolled it 738px. | The field stays and holds "My shop". The read-only row is for a repository that was picked. |
| `start-paths-2` A wrong password says nothing | No message. Auth.js answers a refused sign-in with 200 and the reason in `error`; the form tested `ok`. | "Incorrect email or password.", announced (`role="alert"`). One helper, `lib/auth/sign-in-result`. |
| `start-paths-3` A sentence carried from the homepage over 300 characters ends in "Invalid body" | A 356-character sentence sat whole in a box whose limit was 300; Create refused it. Three numbers: 2000 kept by the homepage, 300 in the box, 300 in the route. | One number, 2000 (`config/project-brief`), for all three. Only the GitHub repository description is short, cut at a word. The refusal is drawn beside the button. |
| `settings-system-1` Revoking a computer's token takes one tap and shows it gone when the server refused | One tap sent the request. With the server answering 500 the row left the list. | The bin opens a sheet that says what revoking does. A refusal reads "It was not revoked. Try again." and the row stays. |
| `shell-system-2`, `chat-home-6`, `private-zone-7` Every desktop load slides the page | Layout shift 0.19 on Home, Projects and Approvals, 0.47–0.51 on the chat: the server drew the sidebar open (288px) and the browser folded it to 80px. | 0.000 on Home, Projects and Approvals, 0.028 on the chat. The choice is in a cookie the server reads; the chat's "Recent" list is hidden by CSS, not by a viewport test after load. |
| `shell-system-5` No skip link in the app | The page's first control was the 22nd Tab stop. | "Skip to content" is the first; the next Tab is inside the page. The sidebar's navigation is named. |
| `shell-system-3` The desktop notifications panel cannot be dismissed | Escape did nothing; a click on the page went through to what was under the panel. Its click-away layer was trapped inside the top bar by the bar's blur. | A dialog on `<body>`: 12 of 12 Tab stops stay inside, Escape closes it and returns focus to the bell, a click outside closes it and does nothing else. |
| `shell-system-4` Three overlays leave the keyboard on the page behind | More sheet: focus on the page, the 22nd stop under the backdrop. Sessions drawer: first reached at the 19th stop. | More sheet 30 of 30 stops inside, Sessions drawer 20 of 20, command palette 20 of 20; Escape closes each. |
| `shell-system-12` Two top-bar controls on a phone are 40px wide | The account button and the page's action measured 40×44. | 44×44, with the 40px circle drawn inside. |

Also: the folded rail shows an item's name when it is reached by keyboard, not
only under a mouse, and the logo link has a name (`shell-system-6`, in part).

Pinned by `scripts/test/ux-round-two.ts` and `scripts/test/project-brief.ts`.

## What remains

Not fixed here. `✓✓` marks a finding that passed the second check; the others
were measured once. Severity is the auditor's.

**Loki chat and Home**

- `chat-home-3` (major) A "Needs you" row scrolls to a pre-reset project card that never says what is needed
- `chat-home-4` (major) "Gone quiet" and "Done" rows open a session screen that sends the person back to Home
- `chat-home-5` (major) The offline builder is said three times, and the card that says it repeats the two rows above it
- `chat-home-7` (major) Choosing a project is two different pickers, and "New project" is four different forms
- `chat-home-8` (major) A notification about one project opens the list of all of them, and its one useful sentence cannot be read
- `chat-home-9` (major) On a desk the chat box is the 56th Tab stop and is not focused when the chat opens
- `chat-home-10` (minor) Loki's start screen no longer fits a phone, so its content slides under the floating title
- `chat-home-11` (minor) Seven of twelve chats have a title that does not tell them apart, and opening one hides the other ten
- `chat-home-12` (minor) Home's review queue points at a control that is not there and draws one kind of tag two ways

**Projects and the project page**

- `projects-1` (major ✓✓) A project page opens on the same boxed "Start" card whatever the project's state; what the list row announced is not on it
- `projects-2` (major ✓✓) One stuck request is told five ways across the project's screens, two of them opposite
- `projects-3` (major ✓✓) "Needs you" offers nothing to press: Retry is a word in a sentence, and the Overview's restart is below the fold under another name
- `projects-4` (major ✓✓) Back from a project returns to the top of a collapsed list
- `projects-5` (major ✓✓) On a phone the Workbench is a three-row menu: the row that leads to it promises a place to say what to change, and its own sentence is cut
- `projects-6` (major ✓✓) Review is the odd sibling: a folder slug as the way back, its one action below the fold, and options that refuse without a way forward
- `projects-7` (major ✓✓) A project has no name where a browser tab or a phone's top bar shows names, and the four project screens disagree about their header
- `projects-8` (major ✓✓) The Feedback section opens on three switches drawn as blobs, then every row carries a filled button and an amber headline
- `projects-9` (major ✓✓) The desktop workbench jumps as it loads, shows two filled buttons, and ends in a message that points at things not on the screen
- `projects-10` (major ✓✓) Keyboard and names: 21 stops before the page with no skip link, an Add form whose fields have no names, and a cancelled rename that drops focus *(partly done: the skip link; the Add form's names and the cancelled state were not)*
- `projects-11` (minor ✓✓) Story: package names cut mid-word, each package in its own box, two different counts out of ten, and a meter in the warning colour
- `projects-12` (minor ✓✓) The list's lenses and search do not use the words the rows use

Also measured by the second check on these screens:

- Watch says the stalled sentence twice on one card. 390x844 dark and 1440x900 light, owner, Camille /watch: "No output for a while — it may be stuck." occurs 2 times inside .ui-watch-live, as the 20px headline (y about 241 at 390) and again as the amber note under "Claude Code went quiet" (y about 450). Source: /workspace/loki/sr
- Built from throws away the last good list when a re-read fails. 390x844 dark, owner: Camille draws 0 package rows with 3 stored, Bitbaum 0 with 5 stored; all 32 scanned projects show only "GitHub's request limit for the hour was reached; the next refresh reads it." Source: /workspace/loki/src/components/packages/ProjectBuiltFrom
- The empty Feedback section is not a quiet empty state. 390x844 dark, demo account, Harbourlight #feedback: two on/off settings about builds (each drawn 40x44, y=382 and y=468) come first; then a heading "The feedback button" with a two-line sentence; then a bordered box 358x123 (1px, 11.2px radius) holding "Not on your site yet"
- The Story's three actions wrap two and one. 390x844 dark, owner, Camille #context: "Describe it" 106x44 and "Read the code" 127x44 on one line (y=615), "Paste a doc" 112x44 alone on the next (y=667), under a second explanation line "How much of the profile is filled in — not a test of the site." (358x40 at y=493; design reset ru
- The project page's own primary action is never drawn. 1440x900 light, owner: the header's "Ask Loki" is present on 0 of 10 sampled project pages (rows reading Something is broken, Site is down, Didn't start, Needs you: 2 notes, Live x4, Paused, Not started yet); "Make it happen" is the only filled button on each. Source: /worksp

**Starting: new project, import, terminal, sign-in, first run**

- `start-paths-4` (major) "New project" opens a different form at every door, and only one asks what to build
- `start-paths-5` (major) Terminal with the cloud computer offline: 14.6 seconds, three states, then a message with no button
- `start-paths-6` (major) Terminal with no computer: "Use this computer" only swaps the sentence, sticks, and has no way back on a phone
- `start-paths-7` (major) Fields, dialogs and close buttons on the start paths have no accessible name
- `start-paths-8` (major) Keyboard focus on a text field is a one-pixel border change the eye cannot find
- `start-paths-9` (major) Import from GitHub, nothing linked: a 799px card around one sentence, two filled buttons, the title dimmer than its body
- `start-paths-10` (major) First-run Home: "None of your 3 projects is connected to its code yet" leads to a list that never mentions code
- `start-paths-11` (minor) Onboarding: the handle shown is not the handle saved, and the last step asks nothing
- `start-paths-12` (minor) One place and one product under several names; "runner" and "dispatch" in front of a first-time person

**Work queues**

- `queues-1` (major) Suggestions: tapping a row to look at it records it as chosen, hides it for 7 days and leaves the page, and nothing on the row says so
- `queues-2` (major) A message Loki cannot send is listed as "Waiting for your approval" and counted as an approval, but on Approvals it cannot be approved and has lost its name
- `queues-3` (major) Today's count sentence disagrees with the pages it links to: its 42 reports are 55 on Feedback, and two failures are counted twice
- `queues-4` (major) Feedback on a phone: 41 of 55 rows are cut at about 35 characters, reading one report whole takes three taps, and the only bulk action is all 55 or nothing
- `queues-5` (major) An open row menu is painted under the next rows' "..." buttons, which also take the tap
- `queues-6` (major) Approvals shows four filled buttons, three of them full-width "Update" bars, including on the update whose checks failed
- `queues-7` (major) When "Run again" fails, one word changes; the reason exists only as a hover tooltip, and it is a raw error
- `queues-8` (major) No way past the navigation: 21 Tab stops before the first control of every queue screen *(partly done: the skip link; the row controls were not touched)*
- `queues-9` (major) One list, four row shapes: Today's "Needs you" is the only queue not built from the shared row, and its urgent items have the smallest titles
- `queues-10` (minor) "My feedback" cannot be reached from the app, is the one screen the top bar does not name, and its empty state offers nothing to do
- `queues-11` (minor) Dates are written seven ways across the queues, one a raw ISO date and one hard-coded to another locale
- `queues-12` (minor) Suggestions says "Get ahead of" about commitments already overdue, cuts every title at 44 characters even on a desktop, and repeats the title on the grey line

**Settings and system**

- `settings-system-2` (major) Agent settings: a change is not saved until a button 1.8 screens below, nothing says so, and leaving drops it silently
- `settings-system-3` (major) System: the schedule switches are drawn broken, say only "Disable", and the rows cannot be opened from the keyboard
- `settings-system-4` (major) "Add a provider" leaves the form that adds a provider and returns to the top of the page it left
- `settings-system-5` (major) Packages: an unreadable fleet is one sentence repeated 32 times, and its way forward opens a page that cannot connect GitHub
- `settings-system-6` (major) System says "All clear. Nothing is wrong with the machinery." above six red errors, and "Recent errors" is a raw log that lists successful sign-ins
- `settings-system-7` (major) On a phone, eight of twelve Settings sections never say which section is open, and section titles come in four shapes
- `settings-system-8` (major) 13 of 30 form fields have no name for a screen reader, and a focused field in the dark theme is marked by a 1.96:1 border
- `settings-system-9` (major) Models on a phone is 27 screens of cards with no model on the first screen and no name in the top bar; on a desk its three filters stack 536px wide
- `settings-system-10` (major) Voice is set in three places that do not mention each other, and "providers" names two different things in two sections
- `settings-system-11` (major) Settings > Agent is written in the builder's words: "runner" 7 times, "dispatch" 3, two file paths, 406 words of explanation
- `settings-system-12` (major) On a desk, Settings > AI jumps by 0.96 to 1.12 as it loads, and every screen in the group jumps by 0.19 when the sidebar folds *(partly done: the sidebar part; the page's own jump as it loads is not)*

**The private zone**

- `private-zone-1` (major) Crew deletes on one tap; the family has three different deletes
- `private-zone-2` (major) A row's "..." menu opens under the bottom bar: on Memory its only action cannot be seen
- `private-zone-3` (major) Events cannot be told when or where they happen: the form only has "Deadline"
- `private-zone-4` (major) Crew tells you to edit an entry that cannot be opened or edited
- `private-zone-5` (major) The "new" forms have no names: dialog, close button and 35 of 39 fields
- `private-zone-6` (major) The robot page hides a failed save and does not share the family's detail shape
- `private-zone-8` (major) Editing has its own form shapes: a subscription edited without labels, a channel picker 26px wide
- `private-zone-9` (major) Detail pages carry unnamed icon buttons; three stay invisible when reached by keyboard
- `private-zone-10` (minor) The "describe it" bar greets a new form with "Tell me what to change...", is cut on a phone and has no microphone
- `private-zone-11` (minor) In every new form the title, the assist bar, the fields and the button touch, and the disabled button has no shape
- `private-zone-12` (minor) One day is written five ways, and Crew prints 10 November as "11/10/2026"

**The app shell and the visual system**

- `shell-system-1` (major) Search opens a command box: Enter runs the typed words as a command, and the resting list is folder names and server paths
- `shell-system-6` (major) The default desktop sidebar is 15 unnamed icons; names appear only under a mouse and three sit below the fold *(partly done: the logo link is named and a focused rail item shows its name; the rail still opens folded with every group shown)*
- `shell-system-7` (major) The floating assistant is a second chat with a hand-made text box and no microphone
- `shell-system-8` (minor) The floating assistant button sits on row actions at tablet widths
- `shell-system-9` (minor) On a phone nothing in the bar or the More sheet says what is waiting, and More lights up for pages it does not hold
- `shell-system-10` (minor) Sibling pages do not share a frame: three column widths and four title treatments
- `shell-system-11` (minor) With reduced motion on, scripted scrolling still glides; everything else stops

## How to reproduce one

```bash
pnpm run seed:showcase     # the dense local account
pnpm run build && pnpm run start
```

Then drive the screen in a browser at the width the finding names. A fix
starts by reproducing the measurement; several of these will turn out, like
`chat-home-2`, to be fixed already.
