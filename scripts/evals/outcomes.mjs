// Product-specific outcome accounting. No model calls, database writes or dispatches.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const text = (v) => typeof v === "string" && v.trim().length > 0;
const number = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const digest = (v) => createHash("sha256").update(v).digest("hex");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
function requireThat(ok, message) {
  if (!ok) throw new Error(message);
}

export function validateSuite(suite) {
  requireThat(suite.version === 1 && text(suite.suite), "unsupported suite");
  requireThat(["development", "held-out"].includes(suite.split), "invalid split");
  requireThat(Array.isArray(suite.cases) && suite.cases.length > 0, "empty case set");
  const ids = new Set();
  for (const c of suite.cases) {
    requireThat(text(c.id) && !ids.has(c.id), "duplicate or empty case id");
    ids.add(c.id);
    requireThat(text(c.prompt) && text(c.setup) && text(c.category), `${c.id}: missing task`);
    requireThat(
      text(c.source?.path) && /^[a-f0-9]{40}$/.test(c.source?.revision),
      `${c.id}: missing provenance`,
    );
    requireThat(Array.isArray(c.criteria) && c.criteria.length > 0, `${c.id}: no criteria`);
    requireThat(
      new Set(c.criteria.map((x) => x.id)).size === c.criteria.length,
      `${c.id}: duplicate criterion`,
    );
    requireThat(
      c.criteria.every((x) => text(x.id) && text(x.description)),
      `${c.id}: invalid criterion`,
    );
  }
  return suite;
}

// Read the EXISTING run meter; never introduce another pricing table. Unknown,
// partially priced and non-final usage cannot become a complete cost here.
export function meteringFromRun(run) {
  requireThat(text(run.id), "run has no id");
  const partial = (run.usageDetail?.unpricedModels?.length ?? 0) > 0;
  const complete = Boolean(
    run.finishedAt && run.usageDetail?.final && !partial && number(run.costUsd),
  );
  return {
    runId: run.id,
    costUsd: number(run.costUsd) ? run.costUsd : null,
    costStatus: complete ? "complete" : partial ? "partial" : "unknown",
    source: "orchestration-run",
  };
}

export function validateResult(result, suite, artifactRoot) {
  const c = suite.cases.find((x) => x.id === result.caseId);
  requireThat(c, "unknown case id");
  requireThat(text(result.configuration), "configuration label is required");
  requireThat(Number.isInteger(result.repetition) && result.repetition >= 1, "invalid repetition");
  requireThat(text(result.jobId), "jobId is required");
  requireThat(["verified", "failed", "unreviewed"].includes(result.outcome), "invalid outcome");
  requireThat(
    result.humanMinutes === null || number(result.humanMinutes),
    "human time must be measured or null",
  );
  requireThat(
    result.humanMinutes === null || text(result.humanTimeEvidence),
    "measured human time needs evidence",
  );
  requireThat(
    Array.isArray(result.attempts) && result.attempts.length > 0,
    "include every attempt, including failures",
  );
  const runIds = new Set();
  for (const a of result.attempts) {
    requireThat(text(a.runId) && !runIds.has(a.runId), "duplicate or missing run id");
    runIds.add(a.runId);
    requireThat(["complete", "partial", "unknown"].includes(a.costStatus), "invalid cost status");
    requireThat(a.costUsd === null || number(a.costUsd), "invalid cost");
    requireThat(a.costStatus !== "complete" || number(a.costUsd), "complete cost cannot be null");
    requireThat(text(a.source), "meter source is required");
  }
  requireThat(Array.isArray(result.artifacts), "artifacts must be a manifest");
  const artifacts = new Set();
  const root = resolve(artifactRoot);
  for (const a of result.artifacts) {
    requireThat(text(a.id) && !artifacts.has(a.id), "duplicate or missing artifact id");
    artifacts.add(a.id);
    requireThat(text(a.path) && /^[a-f0-9]{64}$/.test(a.sha256), "artifact needs path and SHA-256");
    const path = resolve(root, a.path);
    requireThat(path.startsWith(root + "/"), "artifact must be inside the evidence directory");
    requireThat(digest(readFileSync(path)) === a.sha256, `artifact hash mismatch: ${a.id}`);
  }
  const refs = (list) =>
    Array.isArray(list) && list.length > 0 && list.every((id) => artifacts.has(id));
  if (result.humanMinutes !== null)
    requireThat(artifacts.has(result.humanTimeEvidence), "human time evidence is not in manifest");
  requireThat(Array.isArray(result.checks), "checks must be an array");
  requireThat(
    new Set(result.checks.map((x) => x.id)).size === result.checks.length,
    "duplicate check",
  );
  for (const check of result.checks) {
    requireThat(
      c.criteria.some((x) => x.id === check.id),
      "unknown criterion",
    );
    requireThat(["pass", "fail", "unknown"].includes(check.verdict), "invalid check verdict");
    requireThat(
      check.verdict === "unknown" || refs(check.evidence),
      "a verdict needs hashed evidence",
    );
  }
  if (result.outcome !== "unreviewed") {
    requireThat(
      text(result.reviewer) &&
        text(result.reviewedAt) &&
        Number.isFinite(Date.parse(result.reviewedAt)),
      "independent review identity and timestamp required",
    );
    requireThat(result.checks.length === c.criteria.length, "review every predeclared criterion");
    if (result.outcome === "verified")
      requireThat(
        result.checks.every((x) => x.verdict === "pass"),
        "verified requires every check to pass",
      );
    if (result.outcome === "failed")
      requireThat(
        result.checks.some((x) => x.verdict === "fail"),
        "failed requires a failing check",
      );
  }
  return result;
}

export function summarize(suite, results, configurations, repetitions) {
  const runIds = new Set();
  const jobs = new Set();
  const slots = new Set();
  for (const r of results) {
    requireThat(configurations.includes(r.configuration), "configuration was not predeclared");
    requireThat(r.repetition <= repetitions, "repetition exceeds plan");
    const slot = `${r.configuration}\0${r.caseId}\0${r.repetition}`;
    requireThat(!slots.has(slot) && !jobs.has(r.jobId), "duplicate job or case slot");
    slots.add(slot);
    jobs.add(r.jobId);
    for (const a of r.attempts) {
      requireThat(!runIds.has(a.runId), "run charged to more than one job");
      runIds.add(a.runId);
    }
  }
  return configurations.map((configuration) => {
    const rows = results.filter((r) => r.configuration === configuration);
    const attempts = rows.flatMap((r) => r.attempts);
    const verified = rows.filter((r) => r.outcome === "verified").length;
    const failed = rows.filter((r) => r.outcome === "failed").length;
    const planned = suite.cases.length * repetitions;
    const reviewed = verified + failed;
    const allCost = attempts.length > 0 && attempts.every((a) => a.costStatus === "complete");
    const allTime = rows.length > 0 && rows.every((r) => r.humanMinutes !== null);
    const knownCostSubtotalUsd = attempts.reduce((n, a) => n + (a.costUsd ?? 0), 0);
    const measuredHumanMinutes = rows.reduce((n, r) => n + (r.humanMinutes ?? 0), 0);
    return {
      configuration,
      planned,
      recorded: rows.length,
      reviewed,
      verified,
      failed,
      unreviewed: rows.length - reviewed,
      notRun: planned - rows.length,
      attempts: attempts.length,
      retries: attempts.length - rows.length,
      knownCostSubtotalUsd: attempts.some((a) => a.costUsd !== null) ? knownCostSubtotalUsd : null,
      incompleteCostAttempts: attempts.filter((a) => a.costStatus !== "complete").length,
      totalCostUsd: allCost ? knownCostSubtotalUsd : null,
      costPerVerifiedOutcomeUsd: allCost && verified > 0 ? knownCostSubtotalUsd / verified : null,
      measuredHumanMinutes: allTime ? measuredHumanMinutes : null,
      humanMinutesPerVerifiedOutcome:
        allTime && verified > 0 ? measuredHumanMinutes / verified : null,
      verifiedShareOfPlan: verified / planned,
      criticalFailures: rows
        .filter(
          (r) => r.outcome === "failed" && suite.cases.find((c) => c.id === r.caseId)?.critical,
        )
        .map((r) => r.caseId),
      comparisonReady:
        reviewed === planned &&
        allCost &&
        allTime &&
        !rows.some(
          (r) => r.outcome === "failed" && suite.cases.find((c) => c.id === r.caseId)?.critical,
        ),
    };
  });
}

function loadPlan(directory) {
  const plan = read(join(directory, "plan.json"));
  const suite = validateSuite(read(join(directory, "cases.json")));
  requireThat(plan.suiteHash === digest(JSON.stringify(suite)), "case set changed after planning");
  requireThat(
    plan.version === 1 &&
      Array.isArray(plan.configurations) &&
      plan.configurations.length > 0 &&
      new Set(plan.configurations).size === plan.configurations.length &&
      plan.configurations.every(text),
    "invalid plan configurations",
  );
  requireThat(
    Number.isInteger(plan.repetitions) && plan.repetitions >= 1,
    "invalid planned repetitions",
  );
  return { plan, suite };
}

const slotKey = (r) => digest(`${r.configuration}\0${r.caseId}\0${r.repetition}`);

function validateReview(previous, next) {
  requireThat(
    previous.outcome === "unreviewed" && next.outcome !== "unreviewed",
    "review closes an unreviewed job once",
  );
  for (const key of ["jobId", "caseId", "configuration", "repetition", "attempts"]) {
    requireThat(
      JSON.stringify(previous[key]) === JSON.stringify(next[key]),
      `review cannot change ${key}`,
    );
  }
  requireThat(
    previous.humanMinutes === null || previous.humanMinutes === next.humanMinutes,
    "review cannot rewrite measured human time",
  );
  for (const artifact of previous.artifacts) {
    requireThat(
      next.artifacts.some((a) => JSON.stringify(a) === JSON.stringify(artifact)),
      "review must preserve original evidence",
    );
  }
}

function loadResults(directory, suite) {
  const records = readdirSync(join(directory, "results"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({
      file: f,
      result: validateResult(read(join(directory, "results", f)), suite, directory),
    }));
  const latest = new Map();
  for (const { file, result } of records) {
    const key = slotKey(result);
    if (file === `${key}.review.json`) {
      requireThat(latest.has(key), "review has no original observation");
      validateReview(latest.get(key), result);
    } else
      requireThat(
        file === `${key}.json` && !latest.has(key),
        "unexpected or duplicate result file",
      );
    latest.set(key, result);
  }
  return [...latest.values()];
}

export function main(args) {
  const [command, directory, ...rest] = args;
  requireThat(
    directory,
    "Usage: node scripts/evals/outcomes.mjs plan|record|review|report <private-directory> [arguments]",
  );
  if (command === "plan") {
    const [labels, count = "1"] = rest;
    const configurations = labels?.split(",");
    requireThat(
      configurations?.every(text) && new Set(configurations).size === configurations.length,
      "give unique comma-separated configuration labels",
    );
    const repetitions = Number(count);
    requireThat(
      Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 20,
      "repetitions must be 1–20",
    );
    const suite = validateSuite(read(join(ROOT, "evals/outcomes/cases.json")));
    // mkdir without recursive refuses to overwrite an existing experiment.
    mkdirSync(directory);
    mkdirSync(join(directory, "results"));
    writeFileSync(join(directory, "cases.json"), JSON.stringify(suite, null, 2) + "\n", {
      flag: "wx",
    });
    writeFileSync(
      join(directory, "plan.json"),
      JSON.stringify(
        {
          version: 1,
          suiteHash: digest(JSON.stringify(suite)),
          configurations,
          repetitions,
          plannedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log(
      `Planned ${suite.cases.length * repetitions} jobs per configuration; no jobs dispatched.`,
    );
  } else if (command === "record") {
    const { plan, suite } = loadPlan(directory);
    requireThat(rest.length === 1, "record requires one result JSON file");
    const result = validateResult(read(rest[0]), suite, directory);
    const results = loadResults(directory, suite);
    summarize(suite, [...results, result], plan.configurations, plan.repetitions);
    // Sequential local recorder. Hash-named case slots prevent replacement.
    const key = slotKey(result);
    writeFileSync(
      join(directory, "results", `${key}.json`),
      JSON.stringify(result, null, 2) + "\n",
      { flag: "wx" },
    );
    console.log(`Recorded ${result.caseId}: ${result.outcome}`);
  } else if (command === "review") {
    const { plan, suite } = loadPlan(directory);
    requireThat(rest.length === 1, "review requires one reviewed result JSON file");
    const result = validateResult(read(rest[0]), suite, directory);
    const results = loadResults(directory, suite);
    const previous = results.find((r) => slotKey(r) === slotKey(result));
    requireThat(previous, "record the job before reviewing it");
    validateReview(previous, result);
    summarize(
      suite,
      results.map((r) => (r === previous ? result : r)),
      plan.configurations,
      plan.repetitions,
    );
    writeFileSync(
      join(directory, "results", `${slotKey(result)}.review.json`),
      JSON.stringify(result, null, 2) + "\n",
      { flag: "wx" },
    );
    console.log(`Reviewed ${result.caseId}: ${result.outcome}; original observation retained.`);
  } else if (command === "report") {
    const { plan, suite } = loadPlan(directory);
    const results = loadResults(directory, suite);
    console.log(
      JSON.stringify(
        {
          suite: suite.suite,
          split: suite.split,
          note: "Development cases are not held-out evidence. No automatic winner is selected.",
          summary: summarize(suite, results, plan.configurations, plan.repetitions),
        },
        null,
        2,
      ),
    );
  } else throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
