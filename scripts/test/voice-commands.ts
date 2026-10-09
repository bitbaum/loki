// No-screen mode's grammar: every example phrase the vocabulary SSOT shows a
// person is understood as that command, and a sentence that matches no shape
// is a question for Loki — never a guessed action. With the screen off there
// is no confirmation dialog, so "approve" must mean approve and nothing else may.
import assert from "node:assert/strict";
import { NO_SCREEN_COMMANDS } from "../../src/config/no-screen";
import {
  isLocalVoiceCommand,
  normalizeUtterance,
  parseApprovalTarget,
  parseVoiceCommand,
} from "../../src/lib/voice/commands";

const PROJECTS = ["heidi", "orangecat", "solon", "aoz-begleitung", "go"];

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

// 1. The public vocabulary is the parser's vocabulary. A phrase shown on the
//    marketing page that the parser does not recognise is a lie discovered
//    with the eyes closed.
for (const doc of NO_SCREEN_COMMANDS) {
  for (const phrase of doc.say) {
    check(() => {
      const cmd = parseVoiceCommand(phrase, PROJECTS);
      assert.equal(cmd.kind, doc.kind, `"${phrase}" → ${cmd.kind}, expected ${doc.kind}`);
    });
  }
}

// 2. Normalisation: punctuation, case, a leading "Loki,".
check(() => {
  assert.equal(normalizeUtterance("  Hey Loki, what's GOING on?! "), "what's going on");
  assert.equal(normalizeUtterance("Status."), "status");
});

// 3. Dispatch names the project in spoken form and keeps the task verbatim.
check(() => {
  const cmd = parseVoiceCommand("Tell Orange Cat to run the tests and fix what fails", PROJECTS);
  assert.deepEqual(cmd, {
    kind: "dispatch",
    project: "orangecat",
    task: "run the tests and fix what fails",
  });
});
check(() => {
  const cmd = parseVoiceCommand("heidi: make the header fit on a phone", PROJECTS);
  assert.equal(cmd.kind, "dispatch");
  assert.equal(cmd.kind === "dispatch" && cmd.project, "heidi");
});
check(() => {
  // An unknown project is not a dispatch — it is a question.
  const cmd = parseVoiceCommand("tell petvity to add a login", PROJECTS);
  assert.equal(cmd.kind, "ask");
});
check(() => {
  // "tell heidi to approve the design" is work for heidi, not a decision here.
  const cmd = parseVoiceCommand("tell heidi to approve the design review", PROJECTS);
  assert.equal(cmd.kind, "dispatch");
});

// 4. Approvals: by ordinal, by number, by "all"; bare "approve" leaves the
//    choice to the caller (who knows how many there are). Bare "yes" is NOT an
//    approval — it could be answering anything.
check(() => {
  assert.deepEqual(parseApprovalTarget("the first one"), { all: false, index: 0 });
  assert.deepEqual(parseApprovalTarget("number two"), { all: false, index: 1 });
  assert.deepEqual(parseApprovalTarget(" 3"), { all: false, index: 2 });
  assert.deepEqual(parseApprovalTarget("all of them"), { all: true });
  assert.deepEqual(parseApprovalTarget("the last one"), { all: false, index: -1 });
  assert.deepEqual(parseApprovalTarget(""), { all: false, index: null });
});
check(() => {
  assert.deepEqual(parseVoiceCommand("yes, approve the second one", PROJECTS), {
    kind: "approve",
    target: { all: false, index: 1 },
  });
  assert.deepEqual(parseVoiceCommand("Reject number 2", PROJECTS), {
    kind: "reject",
    target: { all: false, index: 1 },
  });
  assert.equal(parseVoiceCommand("yes", PROJECTS).kind, "ask");
  assert.equal(parseVoiceCommand("no", PROJECTS).kind, "ask");
});

// 5. Pause and resume: the fleet, or one project. A bare "stop" is "be quiet",
//    never "stop the fleet".
check(() => {
  assert.deepEqual(parseVoiceCommand("pause everything", PROJECTS), {
    kind: "pause",
    project: null,
  });
  assert.deepEqual(parseVoiceCommand("stop all work", PROJECTS), { kind: "pause", project: null });
  assert.deepEqual(parseVoiceCommand("pause aoz begleitung", PROJECTS), {
    kind: "pause",
    project: "aoz-begleitung",
  });
  assert.deepEqual(parseVoiceCommand("resume heidi", PROJECTS), {
    kind: "resume",
    project: "heidi",
  });
  assert.equal(parseVoiceCommand("stop", PROJECTS).kind, "quiet");
  // "pause going" names no project: `go` must not match inside "going".
  assert.equal(parseVoiceCommand("pause going", PROJECTS).kind, "ask");
});

// 6. Questions stay questions.
for (const q of [
  "what is left to do on heidi",
  "why did the last run on orangecat take so long",
  "summarise today's feedback",
  "how many people are in my crew",
]) {
  check(() => {
    const cmd = parseVoiceCommand(q, PROJECTS);
    assert.equal(cmd.kind, "ask", `"${q}" → ${cmd.kind}`);
    assert.equal(cmd.kind === "ask" && cmd.text, q);
  });
}

// 7. The phone handles exactly three kinds itself.
check(() => {
  assert.equal(isLocalVoiceCommand("quiet"), true);
  assert.equal(isLocalVoiceCommand("repeat"), true);
  assert.equal(isLocalVoiceCommand("end"), true);
  assert.equal(isLocalVoiceCommand("approve"), false);
});

console.log(`voice-commands: ${n} checks ok`);
