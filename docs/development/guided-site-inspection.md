# Guided project inspection

Open **Review project** on the project Overview. The review is the owner's
workspace, reachable on phone or desktop with the same saved state. Choose
Design and usability, Pages and navigation, Code quality, or Full review.

The stage shows captured views from a real Playwright browser as it follows
links and scrolls. It is a paced sequence of browser screenshots, not a video
stream or an embedded third-party iframe. Loki comments on those screenshots;
findings sit below the stage with their evidence. On a wide screen the
conversation sits beside the browser. On a phone the same sections stack.
There is no second widget, terminal rail, environment picker or new composer.
The shared Composer handles discussion; a short current comment stays beside Pause, and Expand view opens the full captured viewport; the global feedback widget is hidden.

Pause requests stop the next browser action. The interface says **Pausing**
until the worker acknowledges it; a navigation already in flight can finish.
A late screenshot cannot replace the frozen stage. Sending a question also
pauses the review, and only Resume restarts it. Ending a review saves its
coverage and discussion. Request fix ends inspection before dispatching through
the existing project execution pipeline: otherwise the fix would wait behind
the review's paused engineer forever. Watch the fix opens the existing run view.
A requested fix is not labelled deployed or verified.

## Evidence and coverage

Visual comments use the existing vision chain and budget gate. Missing AI,
budget exhaustion and unreadable model responses produce explicit gaps, not
clean bills of health. Navigation is tested by actually following visible
same-origin links; browser errors, HTTP failures and horizontal overflow can
become findings. Each page records viewport, visited/blocked/failed and the
vertical extent actually viewed. Code review runs in the project's existing
agent checkout; findings must cite files and lines, checks actually run and
unreviewed areas. Screenshots never establish code quality.

The runner has a fresh public browser session. It does not receive the owner's
cookies. Signed-in journeys, forms, purchases and writes remain untested.
Unlinked routes must be supplied through Include specific pages. The current
bounded pass follows up to 40 discovered URLs, at 390px and 1440px, up to six
viewport positions per page, for at most two hours. It reports unfinished
coverage. This is not a claim to inspect an unknown site's every possible
route, state, language, role or interactive flow. It does not provide continuous
video, remote input, voice commentary or authenticated browser handoff.

## Separation of responsibilities

- `lib/inspection/contract.ts`: scopes, limits, schemas, route filtering and status types.
- `db/schema/site-reviews.ts`: review control state, latest frame, coverage and event records.
- `db/queries/site-reviews.ts`: tenant boundaries, ticket hashing, private evidence links and event budgets.
- `lib/inspection/worker-handler.ts`: claimed worker protocol and screenshot commentary.
- `scripts/inspection-worker.ts`: browser navigation, screenshots and checkpoints; compiled to a public credential-free program during prebuild.
- `lib/inspection/prompt.ts`: a focused runner handoff and code-review evidence contract.
- `components/inspection/InspectionWorkspace.tsx`: owner controls, stage, conversation and findings using existing primitives.

A random ticket grants only one review's worker endpoint for two hours. Only
its hash is stored, normal task history uses safe display wording instead of the ticket-bearing worker instructions, and the ticket never reaches review UI or screenshot URLs, and one worker
can claim a review. An owner/project partial unique index prevents concurrent
active reviews. The worker cannot dispatch fixes or read conversations. Every
owner endpoint checks the signed-in user against the review's user_id. Images
are served privately and fetched only when a frame changes. Public middleware
exemptions cover only the worker endpoint and credential-free program; feeds
and images stay protected. Review events and findings are bounded atomically.

Navigation is read-only: non-GET/HEAD browser traffic is refused, external
navigation, destructive-looking routes, private addresses and custom ports
are refused, downloads and service workers are disabled. The DNS-check/connect
rebinding limitation is the same as the existing public-site consultation.
The worker polls before each action and while paused. Code agents check before
each file group, so a running shell check is not forcibly interrupted by Pause.

Migration 0103 adds only the two review tables and indexes. Its generated
snapshot also catches up the preview_code field already added by migration
0102; it deliberately does not add that existing column again.

## Verification

- `scripts/test/inspection-worker-browser.ts`: real Chromium navigation at phone/desktop widths, scrolling, pause/resume, stop, image events and network guard rejection.
- `scripts/test/inspection-workspace-browser.ts`: actual component and stylesheet at 320/390/768/1440px, both themes, scopes, discussion draft, pause/resume, fix handoff and no horizontal overflow.
- `scripts/integration/site-review-db.ts`: disposable Postgres, tenant isolation, scoped tickets, exclusive claim, active uniqueness, pause races, private evidence links and atomic finding cap. Requires an explicitly named `*_test` database in TEST_DATABASE_URL. It creates minimal referenced tables; never use a production database.
- Public matcher regression checks keep review feeds and screenshots private.

UI fixtures use synthetic project records and an example site image. They are
not signed-in production proof. Production dispatch, provider commentary and
private-account interaction require a real authenticated account and running
builder; report those separately from fixture and database tests.
