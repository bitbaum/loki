# Speaking while using a site

The composer's **Talk** (the panel's one microphone) works on browsers that support microphone recording. It closes the panel and shows one dock — ● Recording · Mark · Done · ✕ — with a red edge round the whole screen (it takes no taps), leaving the host site interactive. Mark notes the part of the page in view as the one being talked about; a tap on anything on the site notes the control (by its own label) with the part it is in; Done transcribes into an editable note. Cancel releases the microphone and invalidates late permission/transcription results.

Since 2026-10-17 the note carries a structured list of **moments** beside the words (`widget/moments-contract.ts`): when, which page and part, how far scrolled, the text at the reading line, what was tapped, and what was said while that part was in view. The agent receives them as a fenced "WALK" (`renderMoments`), and the owner's card lists them, with "See what they saw" asking Loki to open that view on the server and take the picture (`/api/feedback/[id]/moment/[n]` over `page-picture.ts`). A walk longer than one take continues into the next take automatically (`MAX_TAKES`), and the takes are joined on one clock (`joinTakes`).

## Decisions

- Capture context when speaking begins rather than when Send is pressed. While speaking, note the part of the page in view (its nearest heading above the middle of the screen), the reading-line text, the scroll position and the last tap, at the start, when scrolling settles, on a tap and on Mark. Whisper returns when each sentence began, so the note groups sentences under the part that was in view at that second (`widget/voice-moments.ts`). The alignment is per sentence, by heading — not per word — and the note says only that. No video or screenshots are taken in the browser; pictures of each view are taken by Loki on the server, on request.
- Keep the person's words separate from structured context. The note carries its original URL (query and fragment removed), title, viewport, scroll position, visible headings and optional element selector. This is DOM context, not screen capture. Form values are not read by this capture helper.
- Let people edit before committing. The card offers Ask (a question about it, answered in the conversation) and sending it: a visitor saves it as feedback for whoever builds the site; the owner or an editor can Fix it or Save. A draft survives closing and same-tab page loads through sessionStorage, scoped to the site's widget token; it is cleared after a successful send or Cancel. A recording itself cannot survive a full navigation, so the browser warns before leaving.
- Store once in site_feedback. The widget receipt and project Feedback view refer to that row. requires_review holds observations out of the automatic night planner; explicit single/batch dispatch clears the hold. Code reads the context contract without pulling the server validation dependency into the widget bundle.
- Reuse existing transcription, picker, host avoidance, conversation model, receipts and development dispatch. This adds a capture mode, not another chat or terminal.

## Where a comment goes

A saved note enters the project's Feedback view and appears as a receipt in the widget conversation. It is not automatically pasted into project chat or typed into a terminal. Fix it uses the existing dispatch pipeline with a scoped feedback prompt containing the exact comment and fenced page/element evidence. Existing task history, run status and follow links track the work. Ordinary visitor feedback remains available without a Loki account; only a valid pass held by the project's owner or one of its editors (`src/lib/feedback/pass-holder.ts`) grants the widget permission to start a fix. A public widget token alone cannot grant that permission. An owner without a pass uses Loki's signed-in project controls to request work.

## Verification and limits

- Real Chromium widget tests at 320px owner and 390px visitor: host interactions during recording, Mark, dock avoidance, editable transcript, no automatic submission, owner-only fix action, original context after location changes, no query/private form value leakage.
- Conversation model: draft recovery, exact words/context separation, long-note preservation, explicit fix override, clear-after-success.
- Recorder lifecycle: cancellation while permission is pending and while transcription is pending cannot revive a cancelled take or overwrite a newer take.
- Disposable Postgres: forward migration, context persistence, tenant isolation, held-note archive/reopen and explicit single/batch promotion.

Phone hardware permission prompts, mobile Safari microphone support and a signed-in production owner flow require real-device/session checks. Recordings are limited to 110 seconds and submitted notes to 2,000 characters; an overlong transcript stays editable rather than being silently cut. This mode does not provide continuous screen video or voice recording across full-page navigations.
