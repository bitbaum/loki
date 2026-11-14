import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { main, meteringFromRun, summarize, validateResult, validateSuite } from "./outcomes.mjs";

const suite = validateSuite(
  JSON.parse(readFileSync(new URL("../../evals/outcomes/cases.json", import.meta.url), "utf8")),
);
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "outcome-eval-"));
  const bytes = "Independent fixture review; measured two minutes across all attempts.";
  writeFileSync(join(root, "review.txt"), bytes);
  const result = {
    jobId: "job-1",
    caseId: suite.cases[0].id,
    configuration: "baseline",
    repetition: 1,
    outcome: "verified",
    humanMinutes: 2,
    humanTimeEvidence: "review",
    attempts: [{ runId: "run-1", costUsd: 1, costStatus: "complete", source: "test-meter" }],
    reviewer: "independent-fixture-reviewer",
    reviewedAt: "2026-11-14T12:00:00Z",
    artifacts: [
      {
        id: "review",
        path: "review.txt",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
    checks: suite.cases[0].criteria.map((c) => ({
      id: c.id,
      verdict: "pass",
      evidence: ["review"],
    })),
  };
  return { root, result, clean: () => rmSync(root, { recursive: true, force: true }) };
};

test("50 source-grounded development cases, with resolvable source files", () => {
  assert.equal(suite.cases.length, 50);
  assert.equal(suite.split, "development");
  assert.equal(new Set(suite.cases.map((c) => c.category)).size, 10);
  for (const c of suite.cases) readFileSync(new URL(`../../${c.source.path}`, import.meta.url));
  assert.throws(
    () => validateSuite({ ...suite, cases: [suite.cases[0], suite.cases[0]] }),
    /duplicate/,
  );
});

test("empty plan reports unknown spend and no successes", () => {
  const [s] = summarize(suite, [], ["baseline"], 1);
  assert.equal(s.notRun, 50);
  assert.equal(s.totalCostUsd, null);
  assert.equal(s.costPerVerifiedOutcomeUsd, null);
  assert.equal(s.comparisonReady, false);
});

test("all failures and retries are charged to verified outcomes", () => {
  const f = fixture();
  try {
    const first = validateResult(f.result, suite, f.root);
    const second = {
      ...first,
      jobId: "job-2",
      caseId: suite.cases[1].id,
      outcome: "failed",
      attempts: [
        { ...first.attempts[0], runId: "run-2", costUsd: 2 },
        { ...first.attempts[0], runId: "run-3", costUsd: 3 },
      ],
      checks: first.checks.map((c) => ({ ...c, verdict: "fail" })),
      humanMinutes: 8,
    };
    validateResult(second, suite, f.root);
    const [s] = summarize(suite, [first, second], ["baseline"], 1);
    assert.equal(s.costPerVerifiedOutcomeUsd, 6);
    assert.equal(s.humanMinutesPerVerifiedOutcome, 10);
    assert.equal(s.retries, 1);
    assert.equal(s.failed, 1);
    assert.equal(s.comparisonReady, false);
  } finally {
    f.clean();
  }
});

test("missing or partial usage never produces complete cost", () => {
  const run = {
    id: "meter-1",
    finishedAt: "2026-11-14T12:00:00Z",
    costUsd: 0,
    usageDetail: { final: true },
  };
  assert.equal(meteringFromRun(run).costStatus, "complete");
  assert.equal(meteringFromRun({ ...run, usageDetail: {} }).costStatus, "unknown");
  const partial = meteringFromRun({
    ...run,
    costUsd: 0.4,
    usageDetail: { final: true, unpricedModels: ["unpriced"] },
  });
  assert.equal(partial.costStatus, "partial");
  const f = fixture();
  try {
    const [s] = summarize(
      suite,
      [{ ...f.result, attempts: [partial], humanMinutes: null }],
      ["baseline"],
      1,
    );
    assert.equal(s.knownCostSubtotalUsd, 0.4);
    assert.equal(s.totalCostUsd, null);
    assert.equal(s.humanMinutesPerVerifiedOutcome, null);
    assert.equal(s.costPerVerifiedOutcomeUsd, null);
  } finally {
    f.clean();
  }
});

test("an agent claim, missing checks and modified evidence cannot verify a job", () => {
  const f = fixture();
  try {
    assert.throws(() => validateResult({ ...f.result, reviewer: "" }, suite, f.root), /review/);
    assert.throws(() => validateResult({ ...f.result, checks: [] }, suite, f.root), /every/);
    assert.throws(
      () =>
        validateResult(
          { ...f.result, checks: f.result.checks.map((c) => ({ ...c, verdict: "unknown" })) },
          suite,
          f.root,
        ),
      /every check/,
    );
    assert.throws(
      () => validateResult({ ...f.result, humanTimeEvidence: "absent" }, suite, f.root),
      /manifest/,
    );
    writeFileSync(join(f.root, "review.txt"), "changed");
    assert.throws(() => validateResult(f.result, suite, f.root), /hash mismatch/);
  } finally {
    f.clean();
  }
});

test("duplicate billing, case slots and unplanned configurations are rejected", () => {
  const f = fixture();
  try {
    const next = { ...f.result, jobId: "job-2", caseId: suite.cases[1].id };
    assert.throws(() => summarize(suite, [f.result, next], ["baseline"], 1), /charged/);
    assert.throws(
      () => summarize(suite, [f.result, { ...f.result, jobId: "job-2" }], ["baseline"], 1),
      /slot/,
    );
    assert.throws(() => summarize(suite, [f.result], ["other"], 1), /predeclared/);
  } finally {
    f.clean();
  }
});

test("record and report round trip refuses overwrite and suite drift", () => {
  const f = fixture();
  try {
    const directory = join(f.root, "experiment");
    main(["plan", directory, "baseline,candidate"]);
    assert.throws(() => main(["plan", directory, "baseline"]), /EEXIST/);
    writeFileSync(join(directory, "review.txt"), readFileSync(join(f.root, "review.txt")));
    const input = join(f.root, "result.json");
    writeFileSync(input, JSON.stringify(f.result));
    main(["record", directory, input]);
    main(["report", directory]);
    assert.throws(() => main(["record", directory, input]), /duplicate/);
    const changed = JSON.parse(readFileSync(join(directory, "cases.json"), "utf8"));
    changed.cases[0].prompt = "new task";
    writeFileSync(join(directory, "cases.json"), JSON.stringify(changed));
    assert.throws(() => main(["report", directory]), /changed/);
  } finally {
    f.clean();
  }
});

test("critical failures block comparison readiness even with a complete batch", () => {
  const f = fixture();
  try {
    const rows = suite.cases.map((c, i) => ({
      ...f.result,
      jobId: `job-${i}`,
      caseId: c.id,
      attempts: [{ ...f.result.attempts[0], runId: `run-${i}` }],
    }));
    assert.equal(summarize(suite, rows, ["baseline"], 1)[0].comparisonReady, true);
    const critical = rows.find((r) => suite.cases.find((c) => c.id === r.caseId).critical);
    critical.outcome = "failed";
    assert.equal(summarize(suite, rows, ["baseline"], 1)[0].comparisonReady, false);
  } finally {
    f.clean();
  }
});

test("later review retains the original observation and never bills twice", () => {
  const f = fixture();
  try {
    const directory = join(f.root, "review-experiment");
    main(["plan", directory, "baseline"]);
    writeFileSync(join(directory, "review.txt"), readFileSync(join(f.root, "review.txt")));
    const input = join(f.root, "result.json");
    writeFileSync(
      input,
      JSON.stringify({
        ...f.result,
        outcome: "unreviewed",
        checks: [],
        reviewer: null,
        reviewedAt: null,
      }),
    );
    main(["record", directory, input]);
    writeFileSync(
      input,
      JSON.stringify({ ...f.result, attempts: [{ ...f.result.attempts[0], costUsd: 0 }] }),
    );
    assert.throws(() => main(["review", directory, input]), /cannot change attempts/);
    writeFileSync(input, JSON.stringify(f.result));
    main(["review", directory, input]);
    main(["report", directory]);
    assert.equal(readdirSync(join(directory, "results")).length, 2);
    assert.throws(() => main(["review", directory, input]), /once/);
  } finally {
    f.clean();
  }
});
