import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { entities } from "./entities";
import { orgs } from "./orgs";

export type DevLogEntry = {
  date: string;
  done: string;
  next: string;
  tests: string;
  todos: string;
  health: string;
};

export type ProjectResource = {
  id: string;
  kind: "link" | "doc" | "spec" | "dataset" | "credential" | "environment" | "design" | "other";
  visibility?: "private" | "team" | "public";
  sensitivity?: "normal" | "internal" | "secret" | "credential";
  title: string;
  url?: string;
  notes?: string;
  createdAt: string;
};

export const userProjects = pgTable(
  "user_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "set null" }),
    entityProjectId: uuid("entity_project_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(), // display name + zellij tab identifier
    dirPath: text("dir_path"), // absolute local path (null = cloud-only)
    gitUrl: text("git_url"), // GitHub / GitLab URL
    // Where this project lives on the public web. Loki knew every project's
    // REPO but never its SITE, so "give me the link" was a question only a human
    // (or an agent with ssh) could answer. This is the SSOT for that answer;
    // site_snapshots holds what probing the URL actually found.
    liveUrl: text("live_url"), // public site URL (null = not deployed)
    description: text("description"),
    stack: text("stack"),
    agentPref: text("agent_pref"), // per-project agent override
    modelPref: text("model_pref"), // per-project model override
    // Where this project's agent work runs. Null = the cloud tier (the always-on
    // box). "local" = the operator's own machine through Fleet Runner. A stored
    // decision, never inferred from which runner happens to be online — that
    // inference is how a closed lid used to kill work (see execution-access.ts).
    builderPref: text("builder_pref"),
    /**
     * "Ship fixes automatically": may Loki merge the pull request an
     * agent opened for a visitor's feedback, once it is genuinely green?
     *
     * NULL is a third state on purpose — the operator has never chosen, so the
     * Feedback section invites them instead of showing a switch that looks
     * like a decision someone made. false means chosen off; stop asking.
     * Default off protects client sites by construction: Loki cannot
     * tell a client site from its own (that ledger lives in apps.conf on the
     * box, not here), so nothing ships itself until a person says so.
     */
    autoShip: boolean("auto_ship"),
    position: integer("position").default(0), // user-defined sort order
    isActive: boolean("is_active").default(true).notNull(),
    // Consent to appear in Loki's OWN public catalogue at /fleet. Default false,
    // and that default is the point: Loki is multi-tenant, so a page that speaks
    // for the product must never enrol a tenant's projects by existing. A user's
    // own profile (/u/[username]) is a different question — that page is the user
    // speaking, and it has always been scoped by getPublicProjects.
    //
    // Before this column, /fleet called getUserProjects on whichever account owns
    // the oldest entity named "loki" and listed EVERY row it got back — the only
    // public surface using the unfiltered query. Nothing recorded a decision
    // because nothing asked for one.
    listedPublicly: boolean("listed_publicly").default(false).notNull(),
    // Operator's editorial pick, on top of the owner's consent above. Same
    // shape and same doctrine as site_feedback.featured_at: consent decides
    // whether a thing MAY be shown, featuring decides whether it IS shown in
    // the small curated space (the landing hero). Null = not featured.
    //
    // Two gates, because they answer to different people: the owner may always
    // withdraw consent, and no amount of featuring overrides that — every
    // showcase query is consent AND featured, never featured alone.
    featuredAt: timestamp("featured_at", { withTimezone: true }),
    notes: text("notes"), // free-form scratchpad visible in the profile panel
    resources: jsonb("resources").$type<ProjectResource[]>().default([]).notNull(),
    devLog: jsonb("dev_log").$type<DevLogEntry[]>().default([]).notNull(),
    // Cross-product bridge Part C: the published OrangeCat project this project
    // projects onto (opt-in "Publish to OrangeCat"). Null = not published.
    orangecatProjectId: uuid("orangecat_project_id"),
    // Canonical identity. The fleet register (src/lib/register) joins the four
    // surfaces — this table, apps.conf, OrangeCat, Solon — and "which project is
    // this" was answered by NAME, which has drifted into several spellings
    // (aoz-begleitung/aoz-wohnen, datacat/datacat-web, s-ink/sink…). `slug` is the
    // repository name and the one key every other register must use.
    slug: text("slug"),
    // The apps.conf row this project is served by (its `name` column), when it
    // is hosted on the box. Null = not hosted. Explicit rather than inferred
    // from the name, because apps.conf keys are systemd unit names and cannot
    // be renamed cheaply when a project is.
    hostedApp: text("hosted_app"),
    // The Solon organisation this project is governed by, if any.
    solonOrgSlug: text("solon_org_slug"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_user_projects_user_id").on(t.userId),
    index("idx_user_projects_user_active").on(t.userId, t.isActive),
    index("idx_user_projects_entity_project_id").on(t.entityProjectId),
    index("idx_user_projects_org_id").on(t.orgId),
    // One project name per owner. Feeds project_states' (user_id, project_key) PK —
    // without this, a user could register two "cockpit" projects and their runtime
    // state would silently merge.
    uniqueIndex("uq_user_projects_user_name").on(t.userId, t.name),
  ],
);

export type UserProject = typeof userProjects.$inferSelect;
export type NewUserProject = typeof userProjects.$inferInsert;
