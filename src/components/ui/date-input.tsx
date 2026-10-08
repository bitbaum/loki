"use client";

// The one place Loki takes its date input from. A date is picked, not typed:
// the value reads in words ("Sat, 11 Oct 2026") in the app's own input styling
// while the real date input stays on top — see @bitbaum/whenkit.
// The stylesheet is imported here, once, so no caller has to remember it.
import "@bitbaum/whenkit/styles.css";

export { DateInput } from "@bitbaum/whenkit/react";
