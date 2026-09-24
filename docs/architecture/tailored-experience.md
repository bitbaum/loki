# Tailored experience — the product is shaped by the person using it

**Created:** 2026-09-24
**Last modified:** 2026-09-24
**Last modified summary:** First statement of the direction, and the first shipped step: "Change it for me / Show me how" in the widget, plus `window.Loki.report({ target, intent, pick })`.

**Status:** direction, with step 1 live. This is the SSOT for the direction
across the fleet (OrangeCat, Loki, Solon, evig, heidi, substrata). Other docs
state it in one paragraph and link here; they do not restate the steps. Its
permanent home is bitbaum/fleet `AGENTS.md`, and this file points there once it
is written.

---

## The direction in one sentence

**Whatever you don't like, you point at it and say so, and Loki either builds the
experience you want or shows you the way to it. Over time every person ends up
with a product fitted to them.**

## Where it came from

The founder was reading a Cat draft card in OrangeCat on their phone
(2026-09-24): three stacked "Draft product" cards, Publish / Save draft / Open
full form. They did not like it, and there was nowhere to take that. The
feedback widget existed, but it was a bug form: its framing was "what is
wrong", and a person who simply wants something to work differently has no
bug to report. What they asked for:

> When I read it and I don't like something — I don't like the user
> experience there — I should be able to just click on that thing and tell
> Loki to build that user experience for me, or to tell me how to get there,
> and it would help me, essentially move me forward. In the grand scheme of
> things this is the customized, super customized, tailored user experiences
> for people. That's where we're going.

## Two answers, one loop

A person pointing at a surface they don't like means one of two things, and
they are different jobs:

| Intent  | The person says                | Loki does                                                                                                                                                                                                  |
| ------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build` | "Change it for me."            | An agent changes the experience and ships it: Implement → PR → deployed.                                                                                                                                  |
| `guide` | "Show me how to get there."    | First checks whether the product already does what they want. If it does, the fix is the **path**: make it findable from where they were standing, and send them the steps. If it doesn't, builds the smallest version that gets them there. |

`guide` is never answered in prose alone. If one person got lost at that spot,
the next one will too, so the answer always includes a change to the product
itself.

Both run the existing feedback loop (`docs/architecture/feedback-widget.md`):
report → project inbox → Implement → shipped → reporter told. The intent is a
routing hint on the row (`site_feedback.intent`, SSOT
`FEEDBACK_INTENT_VALUES`), not a second pipeline. The prompt difference is in
`src/lib/feedback/compose-dispatch.ts`.

## Pointing at the thing

The widget's element picker already existed. What was missing was getting there
in one step from the thing itself:

- **From the widget:** the panel opens with "Change it for me" / "Show me how"
  above the scope chips. "An element" starts the picker.
- **From the host product:** any surface can carry its own "Change this"
  control. It passes itself as the target, so the person never has to go and
  find the thing they were already looking at:

  ```js
  window.Loki?.report({
    target: cardElement,   // preselected; scope becomes "element"
    intent: "build",       // or "guide"; default build
    message: "I'd like this draft card to work differently: ",
  });
  window.Loki?.report({ pick: true }); // open straight into pick mode
  ```

  OrangeCat's implementation is `src/components/feedback/ChangeThisLink.tsx`:
  put `data-loki-target` on the surface, drop the control inside it. It is
  always a real link to `/feedback`, and only when `window.Loki.ready` is true
  does it open the panel instead (the no-dead-end rule).

## Where it goes next (not built — do not describe as shipped)

1. **Per-person, not per-product.** Today a `build` change ships for everyone.
   The end state is tailoring for one person: a change that fits them without
   forcing it on everyone else, e.g. layout, density, defaults, which fields a
   draft card shows. This needs a per-actor preference layer that the product
   reads at render time. That is where the change should land when it is a
   preference rather than a defect.
2. **The Cat and Loki answer in place.** The widget's Chat mode
   (`widget/surface-modes.ts`, not shipped) is where `guide` should eventually
   be answered live, on the page, instead of through the inbox.
3. **Operator judgement stays.** Nothing auto-dispatches today, and a
   visitor's report on someone else's product is untrusted input
   (`src/lib/feedback/untrusted.ts`). Tailoring for one person may later skip
   the operator for low-risk preferences. Changing the product for everyone
   never will.

## Rules that follow from it

- **Every surface a person might dislike can be pointed at.** New
  customer-facing surfaces in any fleet product that embeds the widget should
  carry `data-loki-target` (and, where it earns the space, a "Change this"
  control). There is no separate feedback form to build.
- **Say what Loki will do, never "submit feedback".** The copy is "Change it for
  me" / "Show me how", and the reporter is told where to follow it up (claim
  link, `/my-feedback`).
- **Keep this doc true.** When a step above ships, move it up and date it.
