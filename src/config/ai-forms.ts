/**
 * SSOT for every form the assistant is allowed to fill or change.
 *
 * A form appears here once. The API route reads this list to decide what the
 * model may write, and the form components read the same specs for their empty
 * state and labels — so a field cannot exist for the model and not for the UI,
 * or the other way round.
 *
 * Option lists are derived from the constants that already define them. Never
 * retype an enum here.
 */

import { defineFields, type FormTarget } from "@fleet/ai-forms";
import { HABIT_FREQUENCY } from "@/lib/constants/statuses";
import { ROBOT_CLASSES, ROBOT_CLASS_LABEL } from "@/config/actors";
import { TASK_CURRENCIES } from "@/config/crew";
import { VALID_CURRENCIES, VALID_FREQUENCIES } from "@/config/subscriptions";

/** Turn a constant tuple/record of string values into assistant field options. */
function optionsOf(values: readonly string[]) {
  return values.map((value) => ({ value }));
}

export const GOAL_FORM: FormTarget = {
  key: "goal",
  name: "Goal",
  fields: defineFields([
    {
      name: "title",
      label: "Title",
      type: "text",
      required: true,
      maxLength: 120,
      placeholder: "What are you working toward?",
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      maxLength: 600,
      hint: "Context or motivation, not a restatement of the title",
    },
    { name: "targetDate", label: "Target Date", type: "date" },
    // The parent goal is chosen from a live tree the model cannot see.
    { name: "parentGoalId", label: "Parent Goal", type: "text", aiExcluded: true },
  ]),
  instructions: [
    "A goal is an outcome, not a task. Prefer 'Ship the payments layer' over 'work on payments'.",
    "Only set a target date when the user gives one, explicitly or as a relative date.",
  ],
};

export const PROJECT_FORM: FormTarget = {
  key: "project",
  name: "Project",
  fields: defineFields([
    {
      name: "name",
      label: "Name",
      type: "text",
      required: true,
      maxLength: 80,
      placeholder: "e.g. OrangeCat",
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      maxLength: 400,
      placeholder: "e.g. Bitcoin marketplace",
      hint: "One line on what the project is",
    },
  ]),
  instructions: ["Project names are short proper nouns, not sentences."],
};

/**
 * "Build a preview for…": someone who is not a customer yet. Loki researches
 * them and builds a first version of their site (src/lib/previews/create.ts).
 */
export const PREVIEW_FORM: FormTarget = {
  key: "preview",
  name: "Preview",
  fields: defineFields([
    {
      name: "name",
      label: "Who it is for",
      type: "text",
      required: true,
      maxLength: 80,
      placeholder: "e.g. Francesco Tarallo",
    },
    {
      name: "about",
      label: "What you know",
      type: "textarea",
      maxLength: 2000,
      placeholder: "e.g. DJ in Zurich, dub techno. ra.co/dj/francescotarallo",
      hint: "Links, place, trade. Loki researches the rest.",
    },
    {
      name: "address",
      label: "Address",
      type: "text",
      maxLength: 48,
      placeholder: "e.g. francesco",
      hint: "Becomes <address>.orangecat.ch. Empty uses the name.",
    },
    {
      name: "code",
      label: "Access code",
      type: "text",
      maxLength: 40,
      aiExcluded: true,
    },
  ]),
  instructions: [
    "The name is the person's or business's own name, as they write it.",
    "The address is short, lowercase, letters, digits and dashes: a person's first name or a business's whole name (murphys-bar).",
    "Put links, the place and what they do into 'about'.",
  ],
};

export const PERSON_FORM: FormTarget = {
  key: "person",
  name: "Person",
  fields: defineFields([
    {
      name: "name",
      label: "Name",
      type: "text",
      required: true,
      maxLength: 80,
      placeholder: "e.g. Jane Smith",
    },
    {
      name: "description",
      label: "Notes",
      type: "textarea",
      maxLength: 600,
      placeholder: "e.g. Met at ETH conference",
      hint: "How you know them and anything worth remembering",
    },
  ]),
  instructions: ["Never invent biographical detail. Record only what the user said."],
};

export const ROBOT_FORM: FormTarget = {
  key: "robot",
  name: "Robot",
  fields: defineFields([
    {
      name: "name",
      label: "Name",
      type: "text",
      required: true,
      maxLength: 80,
      placeholder: "e.g. Kitchen Roomba",
    },
    {
      name: "class",
      label: "Class",
      type: "select",
      required: true,
      options: ROBOT_CLASSES.map((value) => ({ value, label: ROBOT_CLASS_LABEL[value] })),
    },
    { name: "make", label: "Make", type: "text", maxLength: 80, placeholder: "e.g. iRobot" },
    { name: "model", label: "Model", type: "text", maxLength: 80, placeholder: "e.g. Roomba j7+" },
    {
      name: "description",
      label: "Notes",
      type: "textarea",
      maxLength: 600,
      placeholder: "e.g. Lives under the kitchen sink. Maps the ground floor.",
      hint: "What it does and where it lives. Not a listing blurb.",
    },
  ]),
  instructions: [
    "A robot is a machine the user owns — vacuum, humanoid, drone, industrial. Never a person.",
    "Class must be one of the provided options. Prefer 'vacuum' over inventing a new class.",
    "Never invent a make or model. Record only what the user said.",
  ],
};

export const ASSIGNMENT_FORM: FormTarget = {
  key: "assignment",
  name: "Assignment",
  fields: defineFields([
    {
      name: "title",
      label: "Ask",
      type: "text",
      required: true,
      maxLength: 160,
      placeholder: "e.g. Contact the three Basel suppliers",
    },
    {
      name: "brief",
      label: "Brief",
      type: "textarea",
      maxLength: 6000,
      placeholder: "Who to contact, what to say, what to come back with",
      hint: "Written for the person doing it — everything they need without asking you",
    },
    {
      name: "reason",
      label: "Why",
      type: "textarea",
      maxLength: 2000,
      hint: "Why this matters. The half that earns a yes rather than a shrug",
    },
    { name: "dueDate", label: "Needed by", type: "date" },
    { name: "feeAmount", label: "Fee", type: "number", min: 0 },
    {
      name: "feeCurrency",
      label: "Currency",
      type: "select",
      options: optionsOf(TASK_CURRENCIES),
      overridable: true,
    },
    // Both are picked from live lists the model cannot see.
    { name: "assigneeId", label: "Assignee", type: "text", aiExcluded: true },
    { name: "projectId", label: "Project", type: "text", aiExcluded: true },
  ]),
  instructions: [
    "This is work for a HUMAN, not an agent. Write the brief as instructions a competent stranger could follow without a follow-up question.",
    "Keep the ask itself one line. Detail belongs in the brief.",
    "Only set a fee when the user names one. Unpaid help is normal and must not be invented as paid.",
    "A fee in sats is a BTC fee: 50000 sats is feeAmount 0.0005 with feeCurrency BTC. Never convert between currencies — record the one they said.",
    "Never invent a company, a contact, or a deadline the user did not give.",
  ],
};

export const HABIT_FORM: FormTarget = {
  key: "habit",
  name: "Habit",
  fields: defineFields([
    {
      name: "title",
      label: "Name",
      type: "text",
      required: true,
      maxLength: 80,
      placeholder: "What do you want to build consistently?",
    },
    {
      name: "frequency",
      label: "Frequency",
      type: "select",
      options: optionsOf(Object.values(HABIT_FREQUENCY)),
      // Carries a default rather than user intent, so a fill may replace it.
      overridable: true,
    },
  ]),
  instructions: ["A habit is a repeatable action, phrased in the present tense."],
};

export const SUBSCRIPTION_FORM: FormTarget = {
  key: "subscription",
  name: "Subscription",
  fields: defineFields([
    {
      name: "name",
      label: "Name",
      type: "text",
      required: true,
      maxLength: 80,
      placeholder: "e.g. GitHub Copilot",
    },
    {
      name: "vendor",
      label: "Vendor",
      type: "text",
      maxLength: 80,
      placeholder: "e.g. GitHub Inc.",
    },
    { name: "amount", label: "Amount", type: "number", min: 0 },
    {
      name: "currency",
      label: "Currency",
      type: "select",
      options: optionsOf(VALID_CURRENCIES),
      overridable: true,
    },
    {
      name: "frequency",
      label: "Frequency",
      type: "select",
      options: optionsOf(VALID_FREQUENCIES),
      overridable: true,
    },
    { name: "nextDue", label: "Next Due", type: "date" },
    {
      name: "paymentMethod",
      label: "Payment Method",
      type: "text",
      maxLength: 60,
      placeholder: "e.g. Visa ····1234",
    },
    { name: "notes", label: "Notes", type: "textarea", maxLength: 400 },
  ]),
  instructions: [
    "Amounts are the price per billing period, not an annualised total.",
    "Never guess a payment method or a card number.",
  ],
};

/** Every registered form. The API route accepts these keys and no others. */
export const AI_FORMS: FormTarget[] = [
  GOAL_FORM,
  PROJECT_FORM,
  PREVIEW_FORM,
  PERSON_FORM,
  ROBOT_FORM,
  ASSIGNMENT_FORM,
  HABIT_FORM,
  SUBSCRIPTION_FORM,
];

export type AiFormKey = (typeof AI_FORMS)[number]["key"];
