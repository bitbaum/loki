# Speaking while using a site

The widget header offers **Voice note** on browsers that support microphone recording. It closes the panel and shows a compact recording dock, leaving the host site interactive. Point selects an element without activating its link or button; Done transcribes into an editable note. Cancel releases the microphone and invalidates late permission/transcription results.

## Decisions

- Capture context when speaking begins, or when the person explicitly points, rather than when Send is pressed. A short trail records areas visited while speaking. Automatic context identifies the visible area; it does not claim exact word-to-element alignment.
- Keep the person's words separate from structured context. The note carries its original URL (query and fragment removed), title, viewport, scroll position, visible headings and optional element selector. This is DOM context, not screen capture. Form values are not read by this capture helper.
- Let people edit before committing. Save note is the primary action. Verified owners also get Request fix. A draft survives closing and same-tab page loads through sessionStorage, scoped to the site's widget token; it is cleared after a successful send or Cancel. A recording itself cannot survive a full navigation, so the browser warns before leaving.
- Store once in site_feedback. The widget receipt and project Feedback view refer to that row. requires_review holds observations out of the automatic night planner; explicit single/batch dispatch clears the hold. Code reads the context contract without pulling the server validation dependency into the widget bundle.
- Reuse existing transcription, picker, host avoidance, conversation model, receipts and development dispatch. This adds a capture mode, not another chat or terminal.

## Where a comment goes

A saved note enters the project's Feedback view and appears as a receipt in the widget conversation. It is not automatically pasted into project chat or typed into a terminal. Request fix uses the existing dispatch pipeline with a scoped feedback prompt containing the exact comment and fenced page/element evidence. Existing task history, run status and follow links track the work. Ordinary visitor feedback remains available without a Loki account; only a valid project-owner pass grants the widget permission to start a fix. A public widget token alone cannot grant that permission. An owner without a pass uses Loki's signed-in project controls to request work.

## Verification and limits

- Real Chromium widget tests at 320px owner and 390px visitor: host interactions during recording, precise picker, dock avoidance, editable transcript, no automatic submission, owner-only fix action, original context after location changes, no query/private form value leakage.
- Conversation model: draft recovery, exact words/context separation, long-note preservation, explicit fix override, clear-after-success.
- Recorder lifecycle: cancellation while permission is pending and while transcription is pending cannot revive a cancelled take or overwrite a newer take.
- Disposable Postgres: forward migration, context persistence, tenant isolation, held-note archive/reopen and explicit single/batch promotion.

Phone hardware permission prompts, mobile Safari microphone support and a signed-in production owner flow require real-device/session checks. Recordings are limited to 110 seconds and submitted notes to 2,000 characters; an overlong transcript stays editable rather than being silently cut. This mode does not provide continuous screen video or voice recording across full-page navigations.
