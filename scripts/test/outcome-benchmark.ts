// Outcome-accounting failures can create a false economic winner. Exercise the
// dependency-free CLI through the repository's normal unit-test discovery.
import { execFileSync } from "node:child_process";
execFileSync(process.execPath, ["--test", "scripts/evals/outcomes.test.mjs"], { stdio: "inherit" });
