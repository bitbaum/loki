/** AI next steps: what the model sees, how its answer is read, how it merges. */
import {
  buildNextStepsPrompt,
  mergeSteps,
  NEXT_STEPS_INPUT_CHARS,
  nextStepsSystemPrompt,
  parseNextSteps,
} from "@/lib/terminal-next-steps";

let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

const long = "x".repeat(NEXT_STEPS_INPUT_CHARS) + "TAIL";
const prompt = buildNextStepsPrompt(long, "screen", "loki");
check("keeps the bottom of the screen, where the agent is now", prompt.endsWith("TAIL"));
check("names the project", prompt.startsWith("Project: loki\n"));
check(
  "says what it is reading",
  buildNextStepsPrompt("hi", "reply", null).startsWith("The agent's latest reply:"),
);

check(
  "reads numbered lines",
  parseNextSteps("1. Yes, go ahead.\n2. Run the tests first.\n3. Open a PR.\n4. Extra").join(
    "|",
  ) === "Yes, go ahead.|Run the tests first.|Open a PR.",
);
check(
  "drops a preamble",
  !parseNextSteps("Here are steps:\n- Ship it").includes("Here are steps:"),
);

check(
  "drops a markdown heading, not just a plain preamble",
  parseNextSteps("**Next best steps:**\n- Ship it").join("|") === "Ship it",
);
check(
  "unwraps emphasis around a real step",
  parseNextSteps("1. **Run the tests first.**").join("|") === "Run the tests first.",
);

const rules = ["Yes, go ahead.", "Summarize what you did and what is left."];
check("no AI yet → the rules", mergeSteps(null, rules).join("|") === rules.join("|"));
check("AI failed (empty) → the rules", mergeSteps([], rules).length === 2);
const merged = mergeSteps(["Run the tests first.", "yes, go ahead."], rules);
check("AI leads", merged[0] === "Run the tests first.");
check(
  "a numbered-menu pick is never offered (it would be typed as text)",
  !mergeSteps(["Do option 2.", "2", "Fix the build."], rules).some((s) => /option|^2$/i.test(s)),
);
check("no case-only duplicates", merged.filter((s) => /go ahead/i.test(s)).length === 1);
check("never more than three", mergeSteps(["a", "b", "c"], rules).length === 3);

check(
  "the instructions name the agent in the session",
  nextStepsSystemPrompt("Codex").startsWith("You help someone steer a coding agent (Codex) from"),
);
check(
  "an unknown agent is not guessed",
  nextStepsSystemPrompt(null).startsWith("You help someone steer a coding agent from"),
);
check("the rules follow", /ONLY when the agent's last lines/.test(nextStepsSystemPrompt(null)));

console.log(`\n${passed}/${passed} terminal-next-steps cases passed`);
