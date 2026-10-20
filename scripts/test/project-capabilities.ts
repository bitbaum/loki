/**
 * The project permission boundary, pinned.
 *
 * Priority 5 of the 2026-09-17 review asks for the journey to be proved with an
 * editor and a reporter account. The live two-account walk still needs two real
 * sign-ins; this is the half that does NOT — the rule itself, which until now
 * lived inside a DATABASE_URL-bound query and so had no test at all. The only
 * way to discover that a viewer could edit was to sign in as one and look.
 *
 * These are the claims a permission bug would have to break.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  capabilitiesForRole,
  OWNER_CAPABILITIES,
  ROLE_LABELS,
  askPath,
  askReply,
  roleGuide,
  sharedProjectLine,
  type ProjectCapabilities,
} from "@/lib/project-capabilities";
import { PROJECT_ROLE_VALUES } from "@/db/schema/project-memberships";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

check("the owner may do everything, including manage members", () => {
  const owner = capabilitiesForRole("owner");
  assert.equal(owner.canEdit, true);
  assert.equal(owner.canManageMembers, true);
  assert.deepEqual(owner, OWNER_CAPABILITIES);
});

check("an editor works the project but never changes who can reach it", () => {
  const editor = capabilitiesForRole("editor");
  assert.equal(editor.canEdit, true, "an editor is there to do the work");
  assert.equal(
    editor.canManageMembers,
    false,
    "membership is the owner's decision about their own tenant",
  );
});

// A reporter is given `viewer` on the project they filed against: they can watch
// the fix, they cannot spend the owner's runner on another one.
check("a viewer reads and nothing more", () => {
  const viewer = capabilitiesForRole("viewer");
  assert.equal(viewer.canEdit, false, "a reporter must not be able to dispatch work");
  assert.equal(viewer.canManageMembers, false);
});

// The client is who the project is for. They see everything a viewer sees and
// are named as the client on the roster; they do not spend the owner's runner.
check("a client follows and is named, but does not dispatch", () => {
  const client = capabilitiesForRole("client");
  assert.equal(client.canEdit, false, "the client is not the builder");
  assert.equal(client.canManageMembers, false);
  assert.equal(ROLE_LABELS.client.label, "Client");
});

check("every role has a label and a help line the roster can show", () => {
  for (const role of ["owner", ...PROJECT_ROLE_VALUES] as const) {
    assert.ok(ROLE_LABELS[role].label.length > 1, `${role} needs a label`);
    assert.ok(ROLE_LABELS[role].help.startsWith(ROLE_LABELS[role].label), `${role} help names it`);
  }
  assert.equal(
    ROLE_LABELS.editor.label,
    "Builder",
    "the stored value stays editor; the word is Builder",
  );
});

check("NOBODY but the owner can manage members", () => {
  for (const role of PROJECT_ROLE_VALUES) {
    assert.equal(
      capabilitiesForRole(role).canManageMembers,
      false,
      `${role} must not be able to change the member list`,
    );
  }
});

check("every declared role has a decided answer — none falls through", () => {
  for (const role of PROJECT_ROLE_VALUES) {
    const caps: ProjectCapabilities | undefined = capabilitiesForRole(role);
    assert.ok(caps, `${role} has no capabilities entry`);
    assert.equal(typeof caps.canEdit, "boolean", `${role}.canEdit must be decided`);
    assert.equal(
      typeof caps.canManageMembers,
      "boolean",
      `${role}.canManageMembers must be decided`,
    );
  }
});

check("no collaborator role is silently as powerful as the owner", () => {
  for (const role of PROJECT_ROLE_VALUES) {
    assert.notDeepEqual(
      capabilitiesForRole(role),
      OWNER_CAPABILITIES,
      `${role} was granted the full owner capability set`,
    );
  }
});

// The manual a non-technical person reads before and after joining: every
// seat is told the owner decides. A Builder used to be told "nothing waits
// for them" — true only because the build ran on the owner's subscription
// (gone 2026-10-20: whoever asks pays, in their own builder).
check("the role guide says what happens to what they ask for", () => {
  const names = { site: "petvity.orangecat.ch", owner: "George" };
  const builder = roleGuide("editor", names);
  assert.equal(builder.steps.length, 2);
  assert.match(builder.steps[0], /petvity\.orangecat\.ch/);
  for (const role of ["editor", "viewer", "client"] as const) {
    const guide = roleGuide(role, names);
    assert.match(guide.then, /George sees it first/);
    assert.doesNotMatch(guide.then, /Loki builds/);
  }
  assert.match(roleGuide("viewer", { site: null, owner: "George" }).steps[0], /the site/);
});

// Walking the loop as Manu (2026-10-18): Loki's own "Ask Loki" told a Builder
// to edit HTML and install the desktop app. There are two doors now — the
// project's page in Loki and the site — and both say what happens next.
check("an ask from Loki is answered with what happens to it", () => {
  assert.match(
    roleGuide("editor", { site: "petvity.orangecat.ch", owner: "George" }).steps[0],
    /page in Loki/,
  );
  const built = askReply("owner", {
    owner: "George",
    site: "petvity.orangecat.ch",
    building: true,
  });
  assert.match(built, /^Loki is building it now/);
  assert.match(built, /petvity\.orangecat\.ch/);
  assert.doesNotMatch(askReply("owner", { owner: "George", site: null, building: true }), /George/);
  assert.equal(
    askReply("owner", {
      owner: "George",
      site: null,
      building: false,
      buildNote: "Saved. You have sent a lot today.",
    }),
    "Saved. You have sent a lot today.",
    "the owner hears why a build did not start, in the build's own words",
  );
  for (const role of ["editor", "viewer", "client"] as const)
    assert.equal(
      askReply(role, { owner: "George", site: null, building: true }),
      "Sent to George. They decide, and you are told when it ships.",
      "a seat is never told it is being built: the owner decides",
    );
  assert.equal(
    askPath("a873c84a-5030-4068-9fbc-683a86a95c58"),
    "/projects/a873c84a-5030-4068-9fbc-683a86a95c58#ask",
  );
});

check("the chat knows where a shared project is changed", () => {
  const line = sharedProjectLine(
    {
      name: "petvity",
      role: "editor",
      ownerName: "George",
      liveUrl: "https://petvity.orangecat.ch",
    },
    "https://loki.orangecat.ch/projects/x#ask",
  );
  assert.match(line, /you are its Builder/);
  assert.match(line, /projects\/x#ask/);
  assert.match(line, /George decides/);
  assert.match(
    sharedProjectLine({ name: "p", role: "viewer", ownerName: null, liveUrl: null }, "u"),
    /its owner decides/,
  );
  const read = (f: string) => readFileSync(f, "utf8");
  assert.match(read("src/lib/agent/sources-fleet.ts"), /projects_shared_with_you/);
  assert.match(read("src/lib/agent/sources.ts"), /sharedProjectFacts\(userId\)/);
  // Today and Control lead with the shared project, not "Add a project" or a download.
  assert.match(read("src/app/(app)/today/page.tsx"), /<SharedProjectsCard/);
  assert.match(read("src/components/control/ControlPanel.tsx"), /onlyShared && \(/);
  assert.match(read("src/components/projects/ProjectWorkspaceHeader.tsx"), /member \? "#ask"/);
});

console.log(`\nproject-capabilities: ${passed} checks passed`);
