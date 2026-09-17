import { createFeedbackClaimToken, verifyFeedbackClaimToken } from "@/lib/feedback/claim-token";

process.env.AUTH_SECRET = "test-only-feedback-claim-secret";

let pass = 0;
let fail = 0;
function check(label: string, value: boolean) {
  if (value) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

const id = "28ed5be9-3700-4e1a-9819-516ed899ec62";
const token = createFeedbackClaimToken(id, 1_000);
check("valid claim resolves only its feedback id", verifyFeedbackClaimToken(token, 2_000) === id);
check("tampered id is rejected", verifyFeedbackClaimToken(`x${token}`, 2_000) === null);
check(
  "expired claim is rejected",
  verifyFeedbackClaimToken(token, 40 * 24 * 60 * 60 * 1000) === null,
);
check("malformed claim is rejected", verifyFeedbackClaimToken("not-a-token", 2_000) === null);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
