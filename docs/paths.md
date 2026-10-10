# The paths

Who comes to Loki, what they came to do, and the fewest taps that do it.
This is the product contract the screens are held to; `user-flow-audit.md`
is the route-by-route health matrix underneath it. When a screen and this
file disagree, one of them is wrong — fix the screen or correct the path.

The test for every path, in the owner's words (2026-10-10): a 65-year-old who
owns a farmhouse in Canton Schwyz or West Virginia says what they want built
and for what, puts the phone away, picks it up when it is done, sees exactly
what was done and why, shares that with whoever, and says what to change.
Fewer taps, fewer page loads, less to hold in the head, and the feeling of
having done it themselves.

## The one loop

```
say it  →  it builds  →  it tells you it is done  →  you look (walkthrough)
   ↑                                                        │
   └──────────────  you say what is still wrong  ◄──────────┘
```

Every surface is one step of this loop or it does not belong. A screen that
cannot say which step it is — Control's old "Stalled · restart the desktop
app", the feedback page's green "Shipped" under "Needs you" — is where people
stopped.

## The paths

### 1. On my own site, something looks wrong → fixed, live

Who: the owner, on their phone, using their site. The widget is on.

| | Taps |
|---|---|
| Today | Loki noticed it (or they tap ⊚ and point) → **Fix this** → it builds, merges, deploys → Telegram "live" → **Watch the fix** on the page. |
| What broke it | "Fix this" queued the work for a laptop that was shut; the hero and the feedback card then asked a person on a phone to open a desktop app. Fixed 2026-10-09 (#1119): the cloud takes it, and says so. |
| Still owed | The site's own text and layout faults were invisible to the watcher — see path 2. |

### 2. Loki should notice what a visitor would feel, not only what a ruler measures

Who: the owner, same place. They saw a page that said nothing first, two
controls for one thing, parts thrown together — and Loki said "4 pieces of
text under 12px".

| | |
|---|---|
| Today | The page checks measure (type size, targets, labels, contrast, jumps). From this change, Watch also **reads** each page once per visit as a first-time visitor on a phone — purpose, hierarchy, content, fit, function — and says at most three things, each quoting the page, or nothing. Same "Fix this" as any notice. |
| Rule | Silence when fine. A read that lists five polish items with a button each is the noise the review rubric already forbids; the read is held to the same bar. |
| Next | A read of the *flow* across pages (the taps trail already exists; the review uses it on request — "Review my last few minutes"). Make that unasked too once the per-page read has earned trust. |

### 3. I want something built → built, without me

Who: anyone who owns a project. From Loki's chat, the widget, or a site
hand-off.

| | |
|---|---|
| Today | Say it (typed or spoken) → one agent run → PR → auto-merge → deploy → "done" with a link. The chat says where it runs and that nothing is needed. |
| What broke it | A hand-off from the site was dispatched as work instead of answered (#1118); a voice turn heard "Thank you." in silence (#1118); a preference for a shut laptop parked the work (#1119). |
| Still owed | Autopilot overnight: finish what is queued and greet with "while you were away" (safe), or also review the sites on a schedule and build its own fixes up to a nightly limit (bold). The owner's call, open. |

### 4. It is done → I look, I understand why, I share it

Who: the owner, later, picking the phone back up.

| | |
|---|---|
| Today | Telegram says it is live → **Watch the fix** walks the live page: what was wrong, the change shown on the page, "Why this way", the alternatives not chosen → **Share** gives anyone the same walkthrough. |
| Rule | The walkthrough is the receipt. A row that says "Done" with no way to see what was done is a bank statement without the amount. Done rows keep Watch the fix and Share. |

### 5. It is done but not right → I say so, it changes

Who: the owner, or whoever they shared the walkthrough with.

| | |
|---|---|
| Today | Last card of the walkthrough: **Not quite** → say what is still wrong (typed or recorded) → **Show me** previews it on the page, **Send to Loki** builds it. No page load, no chat to open. |
| Rule | Steering lives where the work is seen. Never route a correction through a different page than the one showing the result. |

### 6. What needs me? (the feedback page)

Who: the owner checking in. One question: is anything waiting on me?

| | |
|---|---|
| Today | Three lenses, by who acts: **Needs you · Under way · Done**. A row's badge names its state in the same family — "Live — check it", "Failed", "Not started", "Done" — and its colour follows who acts: amber when it is yours, red when it broke, green only when nothing waits on you. |
| What broke it | The lens said "Shipped", the rows in it said "Done", and rows under "Needs you" wore a green "Shipped · confirm" — three words and two colours for two states. One vocabulary from this change. |
| Still owed | A failed row offers three buttons (provider switch · Retry · Watch). One primary, the rest behind it. |

## Rules these paths impose

- **One vocabulary per surface.** Lens, badge and button use the same family of words. "Shipped" is a deploy's word, not a person's.
- **Colour means who acts**, never what happened. Green = nothing waits on you.
- **One Ask per page.** The floating pill is it; a second "Ask" in a hero is a second door to the same room.
- **Silence when fine.** The watcher, the read, the review: nothing to say is an allowed answer and is said as "nothing stands out", in the notes, not as a card.
- **No step asks for a different device.** A phone started it; a phone finishes it. The cloud builder takes work a shut laptop cannot.
- **Steer where you see.** Corrections start on the page that shows the result.
- **A done thing can be shown.** Every Done keeps its walkthrough and its Share link.
