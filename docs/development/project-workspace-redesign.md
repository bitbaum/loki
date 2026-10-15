# Project workspace redesign

The 1000024996 screenshot shows three competing navigation systems before the
first useful work item. Metadata and publishing destinations take the first
screen, and a floating widget covers the current work. The redesign starts
with the person opening a project: where am I, what is happening, and how do I
move it forward?

The page now has one identity header, a short summary, Ask Loki scoped to the
project, and Open site when an address exists. A project setting is not a peer
of those everyday actions. Stage, full description and profile checks live in
Story. Website configuration, code, membership and public publishing live in
Settings. Current work appears once on Overview, followed by the next step.
Attention flags still come before routine status. A queued request uses neutral
colour and names the queue rather than implying a running agent.

One section list produces desktop tabs and a native phone selector. The phone
menu exposes every destination without horizontal clipping, while desktop
supports arrow, Home and End navigation. Existing section hashes survive, and
panels stay mounted so a draft survives a section change. The separate fleet
surface strip is omitted on the project page; the project-scoped Ask Loki link
and current-work progress action supply the relevant destinations. A route-specific loading skeleton preserves this hierarchy while data loads. The page
suppresses its embedded floating widget and redundant desktop assistant trigger.

ProjectWorkspaceView still reads the existing ProjectDossier and derives status
through deriveBuildStatus/projectStateSentence. It does not invent a second
status model or endpoint. ProjectWorkspaceHeader owns identity and everyday
actions; ProjectIdentitySettings owns editable metadata; ProjectConnectionsSection
owns website/code settings; ProjectPublishingSettings owns public destinations.
The existing API permission checks and owner-only controls remain in place.
Shared inline-edit lifecycle, modal, buttons and design tokens are reused.
The shared Modal/Drawer focus hook contains Tab and restores focus on close;
sharing uses that primitive rather than a second popup implementation. New
visual recipes live in globals.css, and the discarded rail/clamp recipes and
share-menu component are removed. Usage is recorded through usage-surfaces.ts.

project-workspace-browser.ts renders the actual page composition and stylesheet
with synthetic dossier data at 320/390/768/1440px. It checks navigation, current
work placement, retained edits, failed name saves, share modal, legacy hashes,
shared access, long names, and both themes. Only the server-only package lookup
and filesystem boundaries are replaced by fixture data. Fixture screenshots
are evidence of that composition, not of a signed-in production account.
