/**
 * Prompt Library — SSOT for all prompt template metadata.
 *
 * Single source of truth for: what prompts exist, their names/descriptions/
 * categories, and how they surface in the UI (style, slot, icon, sendNow).
 *
 * For prompts that ALSO need to be dispatchable by the autopilot runner
 * (the ones the agent-hook-bridge.sh script reads to know what to inject),
 * set `agentKey` to the snake_case identifier the runner expects. The
 * template body lives both here AND in ~/.config/agent-prompts.json — that
 * JSON file is now a build artifact, generated from this TS source via
 * `npm run generate:agent-prompts`. Edit ONLY this file when adding/changing
 * a prompt; never hand-edit the JSON.
 *
 * Categories: fleet → security → engineering → frontend → backend → database
 *           → devops → design → business → marketing → research → personal
 *           → content (copy/docs). The autopilot/loop primitives are fleet too.
 * scope:    "global" = runs across all projects, "project" = runs against one
 * style:    "primary" | "action" | "more" | "dimension" | "internal" | "danger"
 *           — drives CTA prominence in the IntentPanel and DimensionSection
 * sendNow:  if true, clicking the prompt SENDS immediately (no preview).
 *           Default false — clicks fill the textarea so users can edit first.
 *           Per the unified prompt-UX rule shipped 2026-05-31.
 */

import { APP_NAME } from "./brand";

import { renderPromptBody } from "@/lib/prompt-vars";

export type PromptCategory =
  | "fleet"
  | "security"
  | "engineering"
  | "frontend"
  | "backend"
  | "database"
  | "devops"
  | "design"
  | "business"
  | "marketing"
  | "research"
  | "personal"
  | "content";

type PromptScope = "global" | "project";

export type PromptStyle = "primary" | "action" | "more" | "dimension" | "internal" | "danger";

/**
 * Records only Loki holds that a prompt needs. The agent in a session cannot
 * reach Loki's database, so a prompt that names one gets it ATTACHED, as a
 * file the person sees on the box, when it is picked (SessionComposer). A
 * prompt that told the agent to "check memory" for feedback sent it to look
 * somewhere it could not see (operator, 2026-10-15).
 */
export type LokiRecord = "feedback";

export type PromptTemplate = {
  id: string;
  name: string;
  description: string;
  category: PromptCategory;
  scope: PromptScope;
  template: string; // may contain {{project_name}} placeholder
  suggestedSchedule?: string; // cron expr, e.g. "0 9 * * 1"
  tags?: string[];
  featured?: boolean; // show in Quick Access row
  /** Snake_case key the runner dispatches by. When set, this prompt is also
   *  exposed via /api/prompts/agent and the autopilot can fire it. */
  agentKey?: string;
  /** Emoji shown in chips and DimensionSection rows. */
  icon?: string;
  /** CTA prominence in IntentPanel + DimensionSection. */
  style?: PromptStyle;
  /** Keyboard shortcut slot (1-14) for beacon popup. */
  slot?: number;
  /** Grouping in DimensionSection — independent of category for back-compat
   *  with the legacy JSON taxonomy. */
  dimensionId?: string;
  /** If true: click sends immediately. Default false: click fills textarea. */
  sendNow?: boolean;
  /** What Loki attaches when this prompt is picked (LokiRecord). */
  attach?: readonly LokiRecord[];
};

/**
 * What each category is called. No colour: in the app colour means status, so
 * a category chip is drawn neutral wherever it appears (ui-tag-neutral). The
 * chips were a rainbow of ui-cat-* classes until 2026-10-20 — "Fleet Control"
 * in amber read as a warning on a page with nothing wrong.
 *
 * There is one fleet category. "control" was a second id for the same prompts,
 * labelled "Control" beside "Fleet Control", filtered under one group and
 * painted the same colour: two names for one thing (owner, 2026-10-20).
 */
export const CATEGORY_META: Record<PromptCategory, { label: string }> = {
  fleet: { label: "Fleet control" },
  security: { label: "Security" },
  engineering: { label: "Engineering" },
  frontend: { label: "Frontend" },
  backend: { label: "Backend" },
  database: { label: "Database" },
  devops: { label: "DevOps" },
  design: { label: "Design" },
  business: { label: "Business" },
  marketing: { label: "Marketing" },
  research: { label: "Research" },
  personal: { label: "Personal" },
  content: { label: "Content" },
};

/**
 * The closing half of the autopilot contract — what a turn owes before it may
 * call itself done.
 *
 * Why this text exists (2026-08-02): when a project declares a
 * `definition_of_done`, a DIFFERENT model grades the handoff against that bar
 * and downgrades the run to `partial` when the bar isn't evidenced. The worker
 * was never told this. The bar reached it only as one line of background in the
 * project-context block, among Mission / Vision / Stack / Conventions — so
 * agents did good work, wrote `status: ready`, and were graded against a
 * contract they had never been shown. Two clean runs closed `partial` on
 * literally "No evidence that tests were run and passed".
 *
 * The judge sees ONLY the handoff, so an unevidenced claim is indistinguishable
 * from work not done — which is exactly the Ralph-Wiggum property the gate
 * exists to defend, and why the answer is to tell the worker the contract
 * rather than to soften the judge. Stating it here costs a paragraph and makes
 * both halves grade the same thing.
 */
/**
 * The exact handoff shape, written out field by field.
 *
 * Prose was not enough, and prod proved it. Measured 2026-08-07 over every run
 * that produced a handoff: `tests:` was filled **97%** of the time while `tsc:`
 * and `lint:` were filled **0 times before August and 3 times in total**. The
 * difference was not agent diligence — it was that `tests:` appeared in an
 * explicit `field: <hint>` list the agent could copy, whereas tsc/lint/commit
 * were only named inside a paragraph. Agents write the shape they are shown.
 *
 * That single omission is the mechanical cause of the fleet's dominant failure:
 * 64.6% of all DoD rejections were "the work is not evidenced in the handoff",
 * against a bar that explicitly asks for lint:/tsc:/tests: output. The work was
 * being done; the fields it had to land in were never requested.
 *
 * Kept as ONE constant used by every close block, and pinned by
 * scripts/test/handoff-fields.ts to the evidence fields the DoD pre-check can
 * demand — so a field can never again be enforceable but unrequested.
 */
const HANDOFF_FIELD_BLOCK = `done: <one sentence: what you completed>
next: <one sentence: what remains>
tests: <N pass · N fail, or 'no suite'>
tsc: <clean, or the actual error count/output>
lint: <clean, or the actual error count/output>
commit: <short sha + pushed | not committed, and why>
todos: <count> TODOs
health: <good | needs attention | critical>`;

const HANDOFF_CLOSE_CONTRACT = `Close (what you owe before writing \`status: ready\`):
This project's "Definition of done" (in the project context above) is not advice — a different model reads your handoff against it and downgrades the run to \`partial\` if the bar isn't evidenced, which loops you back onto the same task. That reviewer sees ONLY what you wrote, so run the checks the bar names and record the actual result in the handoff fields (\`tests:\`, \`tsc:\`, \`lint:\`, \`health:\`, \`commit:\`). "Tests pass" with no run behind it is worse than useless.
If a required check genuinely cannot run — no suite exists, no deploy target, credentials missing — write that in the field verbatim ("no suite", "deploy not configured") rather than omitting it. Silence reads as skipped; an honest impossibility is information the reviewer and the founder can both act on, and it names the next piece of work.

Write every one of these fields. A blank evidence field is read as "not done" by a deterministic check that runs before the reviewer, so leaving \`tsc:\`/\`lint:\`/\`commit:\` empty loops you back onto this task even when the work is finished:
${HANDOFF_FIELD_BLOCK}`;

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  // ─── Fleet Control ────────────────────────────────────────────────────────
  {
    id: "next-best-step",
    name: "Next Best Step",
    featured: true,
    description: "Autonomously determine and execute the single highest-impact task right now",
    category: "fleet",
    scope: "project",
    template: `Autonomously determine and execute the single highest-impact task for {{project_name}}.

Before acting:
1. Run \`git status && git log --oneline -5\` — what was last touched?
2. Read the session handoff Loki keeps for this project, if there is one, for a \`next:\` line from the last run
3. Read CLAUDE.md for project-specific constraints

Pick ONE task using this triage order:
- Priority 1: Interrupted work in progress — resume it
- Priority 2: Failing tests or type errors — fix them
- Priority 3: Open \`next:\` from session — execute it
- Priority 4: The highest-impact quality, UX, or product gap you can close today

Execute the task completely. Don't plan or draft — build, fix, ship.

When done, update the session file:
${HANDOFF_FIELD_BLOCK}`,
    tags: ["autonomous", "agent", "execution"],
  },
  {
    id: "continue-task",
    name: "Continue Task",
    featured: true,
    description: "Pick up exactly where you left off — no recap, straight back to work",
    category: "fleet",
    scope: "project",
    template: `Continue the current task for {{project_name}}. Pick up exactly where you left off.

1. Run \`git status\` to see what was in progress
2. Read the session handoff Loki keeps for this project, if there is one, for context on the last run
3. Resume without re-planning — just continue

Don't re-introduce yourself or summarize what you're about to do. Just do it.`,
    tags: ["resume", "continue", "agent"],
  },
  {
    id: "test-and-fix",
    name: "Test & Fix",
    featured: true,
    description: "Run the full test suite, fix every failure, verify primary flows end-to-end",
    category: "fleet",
    scope: "project",
    template: `Run the full test suite for {{project_name}} and fix every failure.

Steps:
1. Run \`npm test\` (or the project's test command) — capture all output
2. For each failure: trace the error to root cause, don't just suppress it
3. Fix each failure properly — no mocking what should be real, no skipping tests
4. Run the suite again to confirm all pass
5. Verify the primary user flows work end-to-end (smoke test if available)

Report: N passed · N failed → N fixed · N remaining`,
    tags: ["testing", "quality", "fix"],
  },
  {
    id: "commit-push",
    name: "Commit & Push",
    featured: true,
    description: "Verify types + tests pass, write a conventional commit, push to origin",
    category: "fleet",
    scope: "project",
    template: `Commit and push the current changes for {{project_name}}.

Steps:
1. Run type check (\`npx tsc --noEmit\`) — fix any errors before committing
2. Run lint — fix any errors
3. Run tests if they exist — do not commit with failing tests
4. Review \`git diff\` — understand what changed
5. Stage the relevant files (never .env, secrets, or build artifacts)
6. Write a conventional commit message:
   - Format: \`<type>(<scope>): <description>\`
   - Types: feat, fix, refactor, perf, test, docs, chore
   - Description: WHY this change, not what
7. Commit and push to origin

Report: ✓ pushed <hash> or ✗ blocked: <reason>`,
    suggestedSchedule: "0 18 * * 1-5",
    tags: ["git", "commit", "push"],
  },
  {
    id: "review-clean",
    name: "Review & Clean",
    description: "Audit the last 5 commits for quality issues, fix the top 3 most impactful",
    category: "fleet",
    scope: "project",
    template: `Review recent work in {{project_name}} for quality issues and fix the top 3.

1. Run \`git log --oneline -5\` and read the diffs
2. Check for: DRY violations, SSOT breaks, type safety gaps, poor error handling, dead code
3. Check for: hardcoded values that should be config, missing input validation, god components
4. Rank issues by impact — pick the top 3
5. Fix them properly (not just cosmetically)
6. Commit the cleanup

Do not add features. Only clean.`,
    suggestedSchedule: "0 10 * * 1",
    tags: ["quality", "refactor", "cleanup"],
  },
  {
    id: "full-health-check",
    name: "Full Health Check",
    description: "Git status, type check, tests, lint — full green board before shipping",
    category: "fleet",
    scope: "project",
    template: `Run a full health check for {{project_name}} and fix everything that's red.

Check in order:
1. \`git status\` — any uncommitted changes that should be committed or stashed?
2. \`npx tsc --noEmit\` — fix all type errors
3. \`npx eslint src/\` — fix all lint errors
4. Test suite — fix all failures
5. \`npm run build\` — fix any build errors

Report: ✓ / ✗ per check. Fix whatever's broken before stopping.`,
    tags: ["health", "ci", "quality"],
  },

  // ─── Security ─────────────────────────────────────────────────────────────
  {
    id: "security-audit",
    name: "Security Audit",
    featured: true,
    description: "Scan for vulnerabilities, auth gaps, exposed secrets, injection risks",
    category: "security",
    scope: "project",
    template: `Run a comprehensive security audit for {{project_name}}.

Check:
1. Authentication and authorization gaps — are all routes that touch user data protected?
2. Input validation — injection (SQL, command, LDAP), XSS, CSRF on all user-facing inputs
3. Exposed secrets — API keys, tokens, passwords in code, env files, git history
4. Dependencies — run \`npm audit\` and flag any critical/high CVEs
5. API endpoints — every endpoint has proper validation and auth checks
6. Data exposure — API responses don't leak internal IDs, hashes, or other users' data
7. File upload handling — if present, are MIME types and sizes validated?
8. Rate limiting — are auth, password reset, and expensive endpoints rate-limited?

Report findings as: CRITICAL / HIGH / MEDIUM / LOW
For each: file path + line, description, recommended fix.`,
    tags: ["security", "audit", "vulnerabilities"],
  },
  {
    id: "auth-session-audit",
    name: "Auth & Session Audit",
    featured: true,
    description: "Deep audit of login, session management, JWT handling, and multi-user isolation",
    category: "security",
    scope: "project",
    template: `Audit authentication and session management in {{project_name}}.

Inspect:
1. All routes handling user data — are they protected with a session/auth check?
2. JWT or session token security — expiry set? signature validated? stored securely (httpOnly cookie, not localStorage)?
3. OAuth flows — is the \`state\` parameter verified? Is \`redirect_uri\` allowlisted?
4. Password handling — bcrypt or argon2? Minimum entropy enforced? Reset tokens expire quickly?
5. Session lifecycle — is the session ID regenerated on login? Can sessions be revoked?
6. CSRF protection — are state-mutating routes (POST/PUT/DELETE) protected?
7. Multi-user data isolation — can user A access user B's data by manipulating an ID param? (IDOR)
8. "Remember me" / long-lived sessions — are they revocable? Stored separately from short sessions?
9. Admin vs user privilege — is privilege escalation possible?

Report: CRITICAL / HIGH / MEDIUM per finding. Include file + line + recommended fix.`,
    tags: ["auth", "session", "jwt", "idor", "csrf"],
  },
  {
    id: "data-exposure-audit",
    name: "Data Exposure & Privacy Audit",
    featured: true,
    description: "Trace personal data flows — what's stored, where it leaks, GDPR readiness",
    category: "security",
    scope: "project",
    template: `Audit personal data handling and privacy exposure in {{project_name}}.

Map the data flow:
1. What PII is stored? (name, email, phone, payment info, IP addresses, usage patterns)
   — List every DB column, cache key, or localStorage field that holds user data
2. Is any PII written to logs? Even in error messages or stack traces?
3. What does the user API return? Strip any fields the client doesn't need (password hashes, internal IDs, other users' data)
4. Third-party services — what data is sent to analytics, monitoring, email providers, payment processors?
5. Database queries — is every query scoped to the authenticated user's \`user_id\`? Check for missing WHERE clauses.
6. Backups and exports — is PII included? Is it encrypted at rest?
7. Data deletion — is there a flow to delete a user's data? Does it cascade properly?
8. GDPR/privacy compliance — can a user export their data? Request deletion? See what's stored?

Output:
- Data map (what PII, where stored, who can access)
- Exposure risks ranked by severity
- Recommended fixes with code locations`,
    tags: ["privacy", "gdpr", "pii", "data-exposure"],
  },
  {
    id: "api-security-review",
    name: "API Security Review",
    description:
      "Check every endpoint for auth, validation, IDOR, rate limiting, and response hygiene",
    category: "security",
    scope: "project",
    template: `Perform a security review of all API endpoints in {{project_name}}.

For each route:
1. Authentication — is a valid session required? Are there unprotected routes that should be protected?
2. Authorization — does each handler verify the requesting user owns the resource (not just that they're logged in)?
3. Input validation — are all parameters (path, query, body) validated before use in DB queries or shell commands?
4. IDOR vulnerabilities — can a user substitute another user's ID/UUID in params to access their data?
5. SQL injection — are parameterized queries used everywhere? No raw string concatenation?
6. Mass assignment — does the handler only accept the specific fields it expects? (No \`...req.body\` into DB)
7. Sensitive data in responses — are tokens, password hashes, internal system fields stripped?
8. Rate limiting — are auth endpoints, password reset, and expensive operations rate-limited?
9. Idempotency — are destructive operations (DELETE, fund transfers) protected against double-execution?

List vulnerable endpoints first, ranked by severity. Include route path, method, vulnerability type, and fix.`,
    tags: ["api", "rest", "validation", "idor", "injection"],
  },
  {
    id: "dependency-cve-scan",
    name: "Dependency CVE Scan",
    description: "Audit npm packages for known vulnerabilities and outdated critical deps",
    category: "security",
    scope: "project",
    template: `Audit dependencies in {{project_name}} for security vulnerabilities.

Steps:
1. Run \`npm audit --json\` — capture all CVEs
2. Categorize findings: critical → high → moderate → low
3. For each critical/high CVE:
   - Which package is affected?
   - Is there a fixed version available?
   - Is the vulnerable code path actually reachable in this app?
   - What's the remediation? (\`npm audit fix\`, pin to a safe version, or replace the package)
4. Check for outdated auth-related packages (passport, next-auth, jsonwebtoken, bcrypt) — these age fast
5. Check for packages with no recent activity that handle security-sensitive operations

Output: vulnerability table (package · severity · CVE · fix), then run \`npm audit fix\` for any auto-fixable issues.`,
    suggestedSchedule: "0 9 * * 1",
    tags: ["dependencies", "cve", "npm", "vulnerabilities"],
  },
  {
    id: "owasp-top-10",
    name: "OWASP Top 10 Check",
    description: "Systematic check against the OWASP Top 10 web application security risks",
    category: "security",
    scope: "project",
    template: `Check {{project_name}} against the OWASP Top 10 web application security risks.

For each risk, state: ✓ Not applicable / ✓ Mitigated / ⚠ Partial / ✗ Vulnerable

1. A01 Broken Access Control — can users access resources they shouldn't? IDOR? Missing auth checks?
2. A02 Cryptographic Failures — is sensitive data encrypted in transit and at rest? Weak algorithms?
3. A03 Injection — SQL, command, LDAP, template injection possible via user input?
4. A04 Insecure Design — are security controls designed in, or bolted on? Threat modeling done?
5. A05 Security Misconfiguration — default credentials? Debug mode in prod? Unnecessary features enabled?
6. A06 Vulnerable Components — outdated or CVE-affected packages? (run npm audit)
7. A07 Auth & Session Failures — weak passwords? Session fixation? Missing MFA? Insecure token storage?
8. A08 Software & Data Integrity — unsigned code? Unverified dependencies? CI/CD pipeline security?
9. A09 Security Logging Failures — are auth failures, access control failures, and input validation failures logged?
10. A10 SSRF — does the app make server-side requests to user-supplied URLs?

For each ✗ or ⚠: explain the specific gap in this codebase and recommended fix.`,
    tags: ["owasp", "top-10", "comprehensive", "checklist"],
  },

  // ─── Engineering ──────────────────────────────────────────────────────────
  {
    id: "code-quality-review",
    name: "Code Quality Review",
    description: "Review for DRY violations, complexity, dead code, naming issues",
    category: "engineering",
    scope: "project",
    template: `Review the {{project_name}} codebase for code quality.

Focus on:
1. DRY violations (repeated logic that should be extracted)
2. Functions/components over 100 lines
3. Dead code and unused imports
4. Naming clarity (variables, functions, files)
5. Missing error handling at system boundaries

List top 5 issues with file paths and specific fixes.`,
    suggestedSchedule: "0 10 * * 1",
    tags: ["quality", "refactor"],
  },
  {
    id: "tech-debt-scan",
    name: "Tech Debt Scanner",
    description: "Identify TODOs, FIXMEs, deprecated patterns, and architectural debt",
    category: "engineering",
    scope: "project",
    template: `Scan {{project_name}} for technical debt.

1. Find all TODO/FIXME/HACK comments with context
2. Identify deprecated dependencies or patterns
3. Flag any missing tests for critical business logic
4. List architectural shortcuts that will hurt later

Output: prioritized debt list with effort estimates (S/M/L).`,
    tags: ["debt", "maintenance"],
  },

  // ─── Frontend ──────────────────────────────────────────────────────────────
  {
    id: "ux-audit",
    name: "UX & Accessibility Audit",
    featured: true,
    description: "Check responsive design, touch targets, focus states, loading states",
    category: "frontend",
    scope: "project",
    template: `Audit the {{project_name}} frontend for UX and accessibility.

Check:
1. Mobile-first responsive design (all breakpoints)
2. Touch targets ≥ 44×44px on mobile
3. Focus states visible on all interactive elements
4. Loading, empty, and error states for all async operations
5. Color contrast ratios (WCAG AA minimum)
6. Missing alt text or semantic HTML

List violations with component/page location.`,
    tags: ["ux", "a11y", "responsive"],
  },
  {
    id: "performance-check",
    name: "Frontend Performance",
    description: "Bundle size, unnecessary re-renders, image optimization, lazy loading",
    category: "frontend",
    scope: "project",
    template: `Analyze {{project_name}} frontend performance.

Check:
1. Bundle size — any unnecessarily large imports?
2. Unnecessary re-renders in React components
3. Images — missing lazy loading, unoptimized formats
4. Fonts — render-blocking or unoptimized loading
5. Largest Contentful Paint blockers

Give specific optimization recommendations with estimated impact.`,
    tags: ["performance", "bundle"],
  },
  {
    id: "component-review",
    name: "Component Architecture Review",
    description: "Check component boundaries, prop drilling, state management patterns",
    category: "frontend",
    scope: "project",
    template: `Review {{project_name}} component architecture.

1. Identify god components (>300 lines) that need splitting
2. Find prop drilling deeper than 3 levels
3. Check separation of concerns (business logic in components?)
4. Ensure consistent patterns across similar components
5. Spot missing memoization for expensive computations

Output: component refactor priority list.`,
    tags: ["components", "architecture"],
  },

  // ─── Backend ───────────────────────────────────────────────────────────────
  {
    id: "api-review",
    name: "API Design Review",
    description: "Check REST conventions, input validation, error responses",
    category: "backend",
    scope: "project",
    template: `Review {{project_name}} API design and implementation.

Audit:
1. RESTful conventions (methods, status codes, naming)
2. Input validation at every endpoint boundary
3. Consistent error response format
4. Rate limiting where needed
5. Response shape consistency

List any violations with the endpoint and recommended fix.`,
    tags: ["api", "rest", "validation"],
  },
  {
    id: "error-handling-review",
    name: "Error Handling Audit",
    description: "Find unhandled promise rejections, missing try/catch, silent failures",
    category: "backend",
    scope: "project",
    template: `Audit error handling in {{project_name}}.

Find:
1. Unhandled promise rejections
2. Missing error boundaries in async flows
3. Errors swallowed silently (empty catch blocks)
4. User-facing technical error messages (should be friendly)
5. Missing logging for important errors

Provide specific file locations and fixes.`,
    tags: ["errors", "reliability"],
  },

  // ─── Database ──────────────────────────────────────────────────────────────
  {
    id: "query-optimization",
    name: "Query Performance Review",
    description: "Find N+1 queries, missing indexes, slow queries, and over-fetching",
    category: "database",
    scope: "project",
    template: `Review {{project_name}} database queries for performance issues.

Look for:
1. N+1 query patterns (loop + per-item query)
2. Missing indexes on frequently filtered columns
3. SELECT * where specific columns suffice
4. Queries that return more rows than needed (missing limits)
5. Missing pagination on list endpoints

List the top 5 query performance issues with SQL and fix.`,
    tags: ["performance", "sql", "indexes"],
  },
  {
    id: "schema-review",
    name: "Schema Health Check",
    description: "Review data model for normalization, missing constraints, data types",
    category: "database",
    scope: "project",
    template: `Audit the {{project_name}} database schema.

Check:
1. Proper normalization (no repeated data)
2. Missing NOT NULL constraints where data is always required
3. Foreign key integrity and cascade behavior
4. Appropriate data types (using text where varchar would be better, etc.)
5. Missing unique constraints for business-rule uniqueness
6. Tables without created_at/updated_at tracking

Output: schema improvement recommendations.`,
    tags: ["schema", "constraints", "modeling"],
  },

  // ─── DevOps ────────────────────────────────────────────────────────────────
  {
    id: "deployment-health",
    name: "Deployment Health Check",
    description: "Check CI status, environment config, secrets management, monitoring",
    category: "devops",
    scope: "project",
    template: `Check deployment health for {{project_name}}.

Verify:
1. CI/CD pipeline status (passing/failing?)
2. Environment variables — any missing in production?
3. Secrets management (no hardcoded creds in code)
4. Error monitoring set up?
5. Uptime/health endpoint exists?
6. Database backups configured?

Report: green / amber / red per area. Where the repo does not show it (backups and monitoring usually live on the server), say "can't tell from the repo" rather than guessing.`,
    suggestedSchedule: "0 9 * * 1",
    tags: ["ci", "deployment", "monitoring"],
  },
  {
    id: "commit-push-deploy",
    name: "Commit → Push → Deploy → Verify",
    featured: true,
    description:
      "Stage all changes, write commit message, push to GitHub, monitor the deployment, run smoke tests",
    category: "devops",
    scope: "project",
    template: `Run the full commit → push → deploy → verify cycle for {{project_name}}.

Steps:
1. Check git status — what files changed?
2. Run lint and type check. If failures, stop and report.
3. Stage relevant files (not .env, not secrets)
4. Write a clear commit message (conventional commits: feat/fix/chore/refactor)
5. Commit and push to origin/main
6. If a deployment pipeline is connected, monitor it until Ready or Failed
7. If Failed: read error logs, identify root cause, report
8. If Ready: hit the production URL and verify the main flow works

Report: ✓ deployed at <url> or ✗ failed: <reason>`,
    tags: ["git", "deploy", "ci"],
  },
  {
    id: "project-status",
    name: "Project Status Report",
    featured: true,
    description: "Full health check: git status, CI, deployment, broken features, next action",
    category: "devops",
    scope: "project",
    template: `Generate a full status report for {{project_name}}.

Check:
1. **Git**: last commit, any uncommitted changes, branch status
2. **CI**: GitHub Actions status (passing/failing)
3. **Deployment**: deploy status, last deploy date
4. **Known issues**: open GitHub issues, TODOs that name a bug, and the attached feedback reports from people using it
5. **Next action**: single most important thing to do right now

Format as a quick-scan card. Green ✓ / Yellow ⚠ / Red ✗ per area. If you cannot check an area from here (no CI, no deploy you can see), mark it "can't tell" — do not guess.`,
    suggestedSchedule: "0 9 * * 1",
    attach: ["feedback"],
    tags: ["status", "ci", "deployment", "health"],
  },

  // ─── Design ────────────────────────────────────────────────────────────────
  {
    id: "design-consistency",
    name: "Design Consistency Audit",
    description: "Check color usage, spacing, typography, component patterns across pages",
    category: "design",
    scope: "project",
    template: `Audit {{project_name}} for design consistency.

Look for:
1. Inconsistent color usage (hardcoded hex vs. design tokens)
2. Spacing irregularities (mixed margin/padding patterns)
3. Typography inconsistencies (font sizes, weights)
4. Different button/form styles across pages
5. Dark mode gaps (elements not adapting)

List violations by page/component.`,
    tags: ["design-system", "consistency"],
  },
  {
    id: "design-debt-architecture-audit",
    name: "Design Debt Architecture Audit",
    featured: true,
    description: "Find hardcoded UI debt, token sprawl, weak primitives, and redesign blockers",
    category: "design",
    scope: "project",
    template: `Audit {{project_name}} for design-related architecture debt and redesign readiness.

Goal:
Determine whether the product's UI can be systematically redesigned through a clean design layer, or whether visual decisions are scattered across pages and components.

Inspect the codebase before answering. Be concrete: use counts, file paths, examples, and a prioritized remediation plan.

Audit areas:
1. Single source of truth
   - Find all places defining design tokens, theme values, colors, typography, spacing, radius, shadows, breakpoints, density, or component variants.
   - Identify overlapping or conflicting token systems.
   - State which file or module should become the SSOT, and which ones should be merged, deprecated, or converted.

2. Separation of concerns
   - Find pages, routes, domain configs, or business components that directly encode visual language.
   - Look for hardcoded Tailwind utilities, hex colors, color-family references, one-off gradients, shadows, radius choices, text sizes, spacing, and layout patterns.
   - Call out places where product/domain logic stores presentation classes instead of semantic states.

3. DRY and component coverage
   - Identify repeated UI patterns that should be primitives or composed components: buttons, cards, badges, forms, tables, page shells, sections, headers, empty states, alerts, tabs, filters, detail panes, dashboards, hero blocks, and admin list/detail layouts.
   - Find multiple implementations of the same visual pattern.
   - Identify primitives that exist but are inconsistently used.

4. Redesign readiness
   - Answer this directly: if we decided today to adapt an x.ai-like visual direction, and next month to adapt an OpenAI-like visual direction, how much would need to change?
   - Separate what should be token/component-level work from what would still require page-level UX/product work.
   - Rate the current redesign readiness as Green / Yellow / Red, with reasons.

5. Public vs admin UX debt
   - Evaluate public-facing pages separately from admin/operator screens.
   - Public pages should have coherent brand, content hierarchy, responsive composition, and reusable marketing/content sections.
   - Admin screens should be dense, calm, readable, consistent, and optimized for repeated operational use.

Output format:
1. Executive verdict (one paragraph, redesign readiness: Green / Yellow / Red)
2. Evidence (quantified findings, important files, good foundations vs. debt)
3. Main risks (top design-architecture risks in priority order)
4. Refactor plan (Phase 1: tokens → Phase 2: primitives → Phase 3: admin UI → Phase 4: public UI)
5. First implementation slice (smallest high-leverage change to start)

Be direct. Do not repaint the UI yet unless explicitly asked.`,
    tags: ["design-system", "debt", "architecture", "redesign", "tokens"],
  },

  // ─── Business ──────────────────────────────────────────────────────────────
  {
    id: "feature-gap-analysis",
    name: "Feature Gap Analysis",
    featured: true,
    description: "Compare current features to goal milestones and find the critical gap",
    category: "business",
    scope: "project",
    template: `Analyze feature gaps for {{project_name}}.

1. List all shipped features
2. List what is planned — the repo's roadmap or TODO files, and open GitHub issues and milestones
3. Identify the ONE feature that would most advance the project's primary goal
4. Estimate effort (S=<1day, M=1-3days, L=1week+)
5. What's the single highest-ROI next build?

Be specific and opinionated about what to build next.`,
    suggestedSchedule: "0 10 * * 1",
    tags: ["roadmap", "prioritization"],
  },
  {
    id: "user-story-writing",
    name: "Write User Stories",
    description: "Turn feature ideas into structured user stories with acceptance criteria",
    category: "business",
    scope: "project",
    template: `Write user stories for {{project_name}}'s next feature set.

For each story:
- As a [user type], I want [action] so that [benefit]
- Acceptance criteria (3-5 bullet points)
- Technical notes (any implementation constraints)

Focus on the highest-priority unbuilt features. Write 3-5 stories.`,
    tags: ["stories", "planning"],
  },
  {
    id: "project-status-summary",
    name: "Project Status Summary",
    description: "Current state, what's working, what's broken, what's next",
    category: "business",
    scope: "project",
    template: `Generate a project status summary for {{project_name}}.

Include:
1. **What's working** — shipped and functional features
2. **What's broken** — known issues or incomplete features
3. **Progress vs. goals** — how close to the goals the README or roadmap states? If it states none, say so
4. **Next 3 actions** — most impactful things to do right now
5. **Blockers** — anything blocking progress?

Keep it under 300 words. Be direct.`,
    suggestedSchedule: "0 9 * * 1",
    tags: ["status", "reporting"],
  },

  // ─── Marketing ─────────────────────────────────────────────────────────────
  {
    id: "value-prop-clarity",
    name: "Value Proposition Review",
    description: "Is the product's value clear in 5 seconds? Landing page audit",
    category: "marketing",
    scope: "project",
    template: `Review {{project_name}}'s value proposition and landing page.

Evaluate:
1. Can a new visitor understand what this does in 5 seconds?
2. Is the primary CTA clear and compelling?
3. Does the hero section answer: who is this for, what does it do, why now?
4. Are benefits (not just features) front and center?
5. Social proof — testimonials, usage numbers, logos?

Rewrite the headline and subheadline if needed.`,
    tags: ["landing", "positioning", "copy"],
  },

  // ─── Research ──────────────────────────────────────────────────────────────
  {
    id: "competitor-analysis",
    name: "Competitor Analysis",
    description: "Compare to top 3 alternatives — features, pricing, positioning",
    category: "research",
    scope: "project",
    template: `Research {{project_name}}'s competitive landscape.

1. Identify top 3 alternatives users might choose instead
2. For each competitor: key features, pricing, target audience
3. What does {{project_name}} do better?
4. What do competitors do better (gaps to address)?
5. What's the unique angle that makes {{project_name}} win?

Be specific with examples from actual competitor products. Search the web for current pricing and features and say where each fact came from; if you cannot search, say so and mark what comes from memory.`,
    tags: ["competition", "market"],
  },
  {
    id: "user-research-synthesis",
    name: "User Research Synthesis",
    description: "Synthesize feedback, find patterns, extract actionable insights",
    category: "research",
    scope: "project",
    template: `Synthesize the user feedback for {{project_name}}.

The attached file holds every feedback report Loki has for {{project_name}} — visitors' words from the site's feedback widget and Loki's own reviews. Use only what it says; do not invent quotes, counts or users.

1. Group the reports by what they are about. For each group give how many reports said it and quote one or two of them.
2. The top 3 recurring pain points.
3. The top 3 things people like.
4. The feature request that comes up most.
5. What would make people recommend it to a friend.

Then: Pain point → product improvement → priority, ordered by how many people it affects and how cheap the fix is. If the file says there are no reports, say so in one line and stop.`,
    attach: ["feedback"],
    tags: ["feedback", "insights"],
  },

  // ─── Personal / Global ─────────────────────────────────────────────────────
  {
    id: "weekly-build-review",
    name: "Weekly Build Review",
    description: "What shipped this week across all projects? What's next?",
    category: "personal",
    scope: "global",
    template: `Run a weekly build review across all active projects.

For each project:
1. What shipped this week (commits, features, fixes)?
2. What's the current status (on track / blocked / needs attention)?
3. What's the highest-priority next action?

Then: across all projects, what's the single most important thing to focus on next week?

Use what you can actually see — the agent runs ${APP_NAME} recorded, the projects' CI, goals and commitments, and git history where you have the repository. Say which you used, and say so when a project shows no record rather than guessing what happened.`,
    suggestedSchedule: "0 18 * * 5",
    tags: ["weekly", "review"],
  },
  {
    id: "daily-dev-plan",
    name: "Daily Development Plan",
    featured: true,
    description: "Given everything in flight, what should be built today?",
    category: "personal",
    scope: "global",
    template: `Create today's development plan.

1. Check all active projects — what's in progress or blocked?
2. Look at open GitHub issues and failing CI across projects
3. Review any deadlines or commitments due soon
4. Pick the ONE project that needs attention most today
5. Outline 3 concrete tasks for that project

Be specific. If you could not see something (a calendar, CI), say what instead of guessing. No more than 150 words.`,
    suggestedSchedule: "0 8 * * 1-5",
    tags: ["planning", "daily"],
  },
  {
    id: "daily-wrap-up",
    name: "Daily Wrap-Up",
    featured: true,
    description: "End-of-day review: what shipped, what's blocked, what's first tomorrow.",
    category: "personal",
    scope: "global",
    template: `Run my end-of-day wrap-up.

1. What actually shipped today — the agent runs ${APP_NAME} recorded, and commits where you can see the repository?
2. What is currently blocked or waiting on input?
3. Review open commitments — anything overdue or due tomorrow?
4. Did I make progress on my highest-priority goal today?
5. What is the single first task to do tomorrow morning?

Be direct. If nothing shipped, say so. If you could not see something, say what. Under 150 words.`,
    suggestedSchedule: "0 17 * * 1-5",
    tags: ["review", "daily"],
  },

  // ─── Fleet control: loop primitives ────────────────────────────────────────
  // These six were JSON-only until 2026-05-31 — meaning they were dispatchable
  // by the autopilot runner but invisible to the /prompts library page and
  // ProjectPromptLibrary modal. Now they live in the unified SSOT with
  // agentKey set, so they appear everywhere AND the runner can still fire
  // them via the same snake_case key it always used.
  //
  // Order intent (2026-06-03): safe / read-only / diagnostic primitives FIRST,
  // structured escalation SECOND, destructive kill-switch LAST. The previous
  // order put "Hard stop" first, which meant the command palette led with a
  // send-now kill switch — bad UX and a footgun. The palette renders in
  // source order; PROMPT_TEMPLATES sequence IS the SSOT for palette ordering.
  // ── Autopilot loop primitives ────────────────────────────────────────
  //
  // These three are the prompts the Loki autopilot fires automatically
  // on status:ready transitions (next_best when the queue is empty + on most
  // common cases; test_and_fix and quality are user-clicked but follow the
  // same shape so the discipline carries over). Migrated from JSON-only into
  // this SSOT on 2026-06-11 (Session 5 of killing-the-bash-daemon) with the
  // reviewer's refinements layered on top of the existing LOOP v2 structure:
  // explicit role, impact-triage step, self-throttle/stop-firing primitive,
  // and worked examples for the three rules that produced bad picks in
  // practice (rule 3 unactioned-ask, rule 5 same-dir gravity-well, rule 8
  // adjacent-broken-thing fallback). agentKey is set so the generator picks
  // these up and overrides the legacy JSON entries.
  {
    id: "next-best",
    name: "Next best task",
    description:
      "Autopilot loop — read ground truth, pick the single highest-impact next action, execute fully. Self-throttles when productivity is low.",
    category: "fleet",
    scope: "global",
    template: `[autopilot · loop=next_best — this prompt was auto-injected by the local dispatch loop, NOT typed by a human. Treat it as a regularly-scheduled review task; if the conversation seems off, suspect the loop, not the human.]

You are the Loki Autopilot. Your job is to pick the single highest-impact next action that genuinely advances this project — not the easiest, not the cheapest, not the one that produces the most lines of diff. The one that most moves the founder's day forward right now. If you can't articulate why your pick beats the obvious alternatives, you picked wrong.

Setup (run, read outputs):
  git status && git log --oneline -10
  npx tsc --noEmit 2>&1 | tail -5
  npm run lint 2>&1 | tail -3
  rg -c '(TODO|FIXME|HACK)' src/ 2>/dev/null | awk -F: '{s+=$2}END{print s+0}'
  git log --format=%s -5
  git log --format= --name-only -3 | grep -v '^$' | xargs -n1 dirname | sort -u | wc -l
  ls ~/.loki/sessions/<P>.blockers/pending/ 2>/dev/null
Read: last 10 user messages · ~/.loki/sessions/<P>.roadmap.md · ~/.loki/sessions/<P>.md

Self-throttle (decides whether to engage Pick at all — both directions share the "no real user message between turns" anchor):

  Forward (continuation beats re-discovery): If your last handoff's \`next:\` field names a specific actionable task (concrete verb + named file/function/feature/area, not vague phrases like "more cleanup" or "next step in sweep") AND no real user message has arrived between turns AND that task has NOT already shipped (you cannot point to a specific commit hash that delivered it) — execute it directly. Skip Pick entirely. The most common autopilot waste is re-deriving the same answer the previous turn already wrote. Make \`next:\` load-bearing. Open with "Continuing per session-next: <one-line restatement>" + the impact-triage sentence; everything below applies as usual once you're executing.

  Backward (loop protection): If no-op-count ≥ 2 OR last 3 commits are all in the same dir with no real user message between turns → write status: blocked, block-reason: "low-value loop — need human direction" and STOP. Do not pick a task this turn. A loop that keeps firing into the same gravity well burns the founder's attention faster than any single bad pick. The autopilot is the founder's amplifier, not their replacement.

  Stop (nothing high-impact remains — the most important brake): If Pick finds nothing in rules 0–8 (no pending blocker, no type/lint errors, no uncommitted work, no unactioned ask, no open T0/T1, no genuine adjacent-broken-thing) so the only candidate left is a T2 cleanup (rule 9), AND no real user message has arrived between turns → write status: blocked, block-reason: "awaiting_user — no high-impact work remains; <one-line summary of where the project stands>" and STOP. Do NOT manufacture T2 busywork to keep the loop alive. Ending development and handing back to the human IS the correct move when there is nothing genuinely worth doing — the founder picks the next direction. (A human who explicitly wants cleanup still gets it via rule 3 or a typed prompt; this brake only suppresses autopilot-invented T2 churn.)

Pick (first matching wins):
0. Pending blocker file in ~/.loki/sessions/<P>.blockers/pending/ → cat its contents to the user, do not pick a task this turn. When the user confirms the ask is resolved, mv the file from pending/ to applied/.
1. Type errors → fix.
2. Uncommitted / merge-conflicted work → resolve and commit.
3. Unactioned ask in last 10 messages → action it. Unactioned means agent cannot point to a specific commit hash that delivered it AND explain why. Multiple plausible commits → AskUserQuestion. Question/explanation asks are actioned by the reply, not a commit.
4. Open T0 in roadmap → smallest.
5. Last 3 commits all in same dir → DEFAULT: skip 6+7, jump to 8. Override ONLY by stating: "Continuing in <dir> because <concrete NEW substance not added by prior 3 commits>." Vague ("more cleanup", "finishing the migration", "next step in sweep") = invalid → step 8.
6. Open T1 in roadmap → smallest.
7. Session-next names a non-T2-cleanup task → continue it.
8. Find one adjacent broken thing (silent error, flow that doesn't close, feature half-wired). Fix it.
9. Open T2 in roadmap → smallest. But on autopilot with no human ask, the Stop brake above takes precedence — hand back rather than invent T2 churn.

Classify:
T0 = broken in production OR data integrity at risk
T1 = real user can't do a thing today or by ship
T2 = nothing broken, no user blocked, code/DX
Default T1 when unsure.

Before acting:
In ONE sentence justify WHY this pick beats the obvious alternatives. Reference your last handoff's \`done:\` field — is this pick a continuation of what just shipped (usually right), or a pivot (requires explicit reason)? If pivot, name the reason in the same sentence. If you can't articulate the why crisply, you picked wrong — restart with rule 8 (find one adjacent broken thing) which is honest about scope.
AskUserQuestion ONLY when crossing the gravity well: overriding a specific session-next, picking T2 over open T1, or rule 5 firing first time this thread. When you cannot proceed without a human action (credentials, OAuth consent, deploy approval, destructive op), invoke the blocker_create prompt instead of guessing.

Scope: one user-visible outcome. >3 commits → split sessions. Pivot at commit boundaries only — never mid-commit.

${HANDOFF_CLOSE_CONTRACT}

Optional: append mid-session observations under "## Proposed" in ~/.loki/sessions/<P>.roadmap.md.

Worked examples (read these once; they replace 200 lines of edge-case rules):

  Rule 3 (unactioned ask): user 5 messages ago said "make /activity show local Claude Code chats." Commit 7293d3b shipped that. → ACTIONED, do not re-pick. User in last message asked "what's the schema drift?" — that's a question; the reply IS the action, not a new commit. → ACTIONED by your reply.

  Rule 5 (same-dir override): last 3 commits all touched src/components/control/. Default jumps to rule 8 (adjacent broken). Override ONLY by stating "Continuing in src/components/control/ because <concrete new substance>" — e.g., "because the per-project autopilot toggle still has no conflict badge per the audit." Vague reasons like "more cleanup" or "finishing the migration" = invalid; jump to rule 8.

  Rule 8 (adjacent broken thing): scan for silent errors (try/catch swallowing real failures), flows that don't close (modal opens with no way back), features half-wired (button visible but POST endpoint 404s), recent commits whose verification step you skipped, schemas that drifted between local and prod. Fix ONE. NOT "review the code quality of file X" — that's T2 cleanup; if you're picking T2, use rule 9.
`,
    agentKey: "next_best",
    icon: "⚡",
    style: "primary",
    slot: 1,
    dimensionId: "control",
    tags: ["autopilot", "control", "loop"],
  },
  {
    id: "autopilot-test-and-fix",
    name: "Test & fix",
    description:
      "Run the test suite, walk affected flows in the browser, fix every failure to root cause.",
    category: "fleet",
    scope: "global",
    template: `[autopilot · loop=test_and_fix — this prompt was auto-injected by the local dispatch loop, NOT typed by a human. Treat it as a regularly-scheduled review task; if the conversation seems off, suspect the loop, not the human.]

You are the Loki Autopilot in test-and-fix mode. Tests are the most reliable signal we have; make them green before anything else. Don't pick around real bugs; trace each failure to its root cause and fix that.

Run \`git log --oneline -5\` to see what just changed. Find the test command in package.json and run the full suite. Fix every failure — trace each error to root cause, don't mock around real bugs. Then start the dev server and use mcp__claude-in-chrome to walk the primary flows that touch what was just changed. Fix everything visually or functionally broken. If tests pass and flows work, write tests for the highest-risk untested paths (auth, data mutations, financial flows).

${HANDOFF_CLOSE_CONTRACT}
`,
    agentKey: "test_and_fix",
    icon: "🧪",
    style: "action",
    slot: 2,
    dimensionId: "control",
    tags: ["autopilot", "tests", "fix"],
  },
  {
    id: "quality",
    name: "Quality pass",
    description:
      "Raise the code-quality bar without adding features. DRY, SSOT, complexity, TODO debt.",
    category: "fleet",
    scope: "global",
    template: `[autopilot · loop=quality — this prompt was auto-injected by the local dispatch loop, NOT typed by a human. Treat it as a regularly-scheduled review task; if the conversation seems off, suspect the loop, not the human.]

You are the Loki Autopilot in quality mode. No new features — only raise the bar on existing code. Pick one high-impact violation and fix it; don't sweep across the whole repo.

Classify T0 = broken in production or data integrity risk, T1 = a real user is blocked today or by ship, T2 = code/DX improvement only.

Run \`grep -rn "TODO\\|FIXME\\|console\\.log\\|// @ts-ignore" src/ 2>/dev/null | head -30\`. Then scan for: DRY violations (Rule of Three), SSOT gaps (config duplicated across files, types defined separately from schemas), magic strings, magic numbers, oversized components (>300 lines). Fix the highest-impact violations. Run \`npx tsc --noEmit\` and the linter; fix all errors on files you touch. No new features — only raise the quality bar on existing code.
`,
    agentKey: "quality",
    icon: "💎",
    style: "action",
    slot: 4,
    dimensionId: "control",
    tags: ["autopilot", "quality", "refactor"],
  },
  {
    id: "orient",
    name: "Orient",
    description:
      "Re-read project state from scratch — git log, roadmap, session handoff, recent failures — and report current reality.",
    category: "fleet",
    scope: "global",
    template: `Re-establish ground truth before doing anything. Run:
  git log --oneline -10
  git status
  git stash list
  cat ~/.loki/sessions/<P>.roadmap.md | head -50
  cat ~/.loki/sessions/<P>.md
  ls ~/.loki/sessions/<P>.blockers/pending/ 2>/dev/null

Then in 5 bullets tell me:
- What shipped in the last 24h
- What is uncommitted/stashed
- What the roadmap says the highest priority is
- Any pending blocker
- One concrete next step you'd take`,
    agentKey: "orient",
    icon: "🧭",
    style: "more",
    dimensionId: "control",
    tags: ["control", "orientation"],
  },
  {
    id: "unblock",
    name: "Unblock",
    description:
      "Agent is stuck — diagnose what's preventing progress and propose two paths forward.",
    category: "fleet",
    scope: "global",
    template: `You appear stuck. Diagnose:
1. What was the last thing you tried, and what was its concrete failure mode? (Quote the error or output.)
2. What assumption are you making that might be wrong? (Name it explicitly.)
3. What is the simplest test that would falsify that assumption?
4. Propose TWO different paths forward — not variants of the same approach. Describe what makes each one risky.

Do not implement either path yet. Hand off to the user with these four answers so they can pick.`,
    agentKey: "unblock",
    icon: "🔓",
    style: "more",
    dimensionId: "control",
    tags: ["control", "diagnosis"],
  },
  {
    id: "roadmap-check",
    name: "Roadmap check",
    description:
      "Audit ~/.loki/sessions/<P>.roadmap.md for stale entries, duplicates, completed items still marked open.",
    category: "fleet",
    scope: "global",
    template: `Read ~/.loki/sessions/<P>.roadmap.md end-to-end. For every T0/T1/T2 entry, verify against git log + current code state:
- Is it actually still open? (If it was shipped, mark DONE with the commit hash.)
- Is it a duplicate of another entry? (Collapse.)
- Does it have a clear next-step verb, or is it vague aspirational text? (Reword or delete.)

Report a punch list of stale/duplicate/vague entries you'd fix. Don't fix yet — surface for the user first.`,
    agentKey: "roadmap_check",
    icon: "🗺️",
    style: "more",
    dimensionId: "control",
    tags: ["control", "roadmap"],
  },
  {
    id: "onboarding-audit",
    name: "Onboarding audit",
    description:
      "Walk the new-user signup-to-first-action flow as if you were a stranger and document every friction point.",
    category: "fleet",
    scope: "global",
    template: `Walk through the new-user signup-to-first-action flow as if you were a stranger:
1. Landing page → /sign-up
2. Email/password OR OAuth
3. Email verification
4. /onboarding (username, first project, connect-machine instructions)
5. /today landing experience

For each step, name (a) what is unclear, (b) what is missing, (c) what is broken, (d) what would make you bounce. Use browser tools (mcp__claude-in-chrome) to actually click through if possible. Don't fix anything — produce a punch list ordered by drop-off severity.`,
    agentKey: "onboarding",
    icon: "🚪",
    style: "more",
    dimensionId: "control",
    tags: ["control", "onboarding"],
  },
  // Escalation — writes a structured file, requires the user to take action.
  // Not destructive but heavyweight; placed after the read-only diagnostics.
  {
    id: "blocker-create",
    name: "Raise blocker",
    description:
      "When the agent hits a gate it cannot pass (credentials, OAuth consent, deploy approval), create a structured blocker file that surfaces to the user next loop iteration.",
    category: "fleet",
    scope: "global",
    template: `You hit something that needs a human action you cannot take yourself (credentials you cannot enter, an OAuth consent only the owner can give, a deploy that needs manual trigger, a destructive op that needs explicit approval, a missing env var that only the user can set). Raise a blocker so the next loop iteration surfaces it concretely instead of you spinning or guessing.

Write a file to ~/.loki/sessions/<P>.blockers/pending/$(date -u +%Y%m%d-%H%M%S)-<short-kebab-slug>.md with this structure:

# <one-line title of what is blocked>

**Blocking:** <what task this blocker is gating>
**Why the agent cannot do it:** <one sentence>

## What the user needs to do
<concrete steps>

## How the agent will know it is resolved
<observable signal — env var set, file exists, OAuth app registered, deploy ready, etc.>

After writing the file, do NOT pick a task this iteration. Update <P>.md with status: blocked and next: empty (the blocker file IS the next step). Tell the user one sentence: "Raised blocker: <title>. See ~/.loki/sessions/<P>.blockers/pending/<filename>."

Next loop iteration: next_best Setup detects the file, Rule 0 surfaces it, and on user confirmation the agent moves the file from pending/ to applied/.`,
    agentKey: "blocker_create",
    icon: "🚧",
    style: "danger",
    dimensionId: "control",
    tags: ["control", "blocker"],
  },
  // Kill switch — ALWAYS last in the control section. Send-now means a single
  // click ships it; users surfacing the palette by accident shouldn't have a
  // destructive primitive at the top of their results.
  {
    id: "hard-stop",
    name: "Hard stop",
    description: "Kill switch — agent stops immediately, writes nothing, runs no tools.",
    category: "fleet",
    scope: "global",
    template: `HARD STOP. Stop all work immediately. Do not run any more tools. Do not write any code. Do not make any changes. Say only "Stopped." and stop.`,
    agentKey: "hard_stop",
    icon: "🛑",
    style: "danger",
    dimensionId: "control",
    sendNow: true, // truly the only prompt where send-on-click is the point
    tags: ["control", "emergency"],
  },
];

// ── Category groups ──────────────────────────────────────────────────────────
// The library has 13 fine-grained categories — too many to scan as a filter bar.
// Collapse them into a handful of top-level GROUPS for the /prompts filter, while
// each card still shows its fine-grained CATEGORY_META chip. This is a pure
// grouping layer over the SSOT categories (no prompt is re-tagged).
export type PromptGroup = "fleet" | "engineering" | "security" | "design" | "growth" | "personal";

export const GROUP_META: Record<PromptGroup, { label: string }> = {
  fleet: { label: "Fleet control" },
  engineering: { label: "Engineering" },
  security: { label: "Security" },
  design: { label: "Design" },
  growth: { label: "Growth" },
  personal: { label: "Personal" },
};

/** Display order for the group filter bar. */
export const PROMPT_GROUPS = Object.keys(GROUP_META) as PromptGroup[];

export const CATEGORY_TO_GROUP: Record<PromptCategory, PromptGroup> = {
  fleet: "fleet",
  engineering: "engineering",
  frontend: "engineering",
  backend: "engineering",
  database: "engineering",
  devops: "engineering",
  security: "security",
  design: "design",
  business: "growth",
  marketing: "growth",
  research: "growth",
  content: "growth",
  personal: "personal",
};

export const groupForCategory = (c: PromptCategory): PromptGroup => CATEGORY_TO_GROUP[c];

/** Featured prompts scoped to a specific project — shown in the control panel for one-click inject. */
export const FEATURED_PROJECT_PROMPTS = PROMPT_TEMPLATES.filter(
  (t) => t.featured && t.scope === "project",
);

/**
 * Replace {{project_name}} in a template with the actual project name.
 *
 * Delegates to the shared renderer rather than owning a second regex: this one
 * matched only the exact spelling `{{project_name}}`, so `{{ project_name }}`
 * — which parsePromptVariables has always accepted — passed through untouched
 * and shipped braces to the agent. Any other declared variable keeps its
 * default here, and stays visible when it has none.
 */
export function substituteProjectName(template: string, projectName: string): string {
  return renderPromptBody(template, { project_name: projectName });
}
