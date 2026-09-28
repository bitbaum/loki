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
import {
  capabilitiesForRole,
  OWNER_CAPABILITIES,
  ROLE_LABELS,
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

console.log(`\nproject-capabilities: ${passed} checks passed`);
