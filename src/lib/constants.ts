import { homedir } from "os";
import path from "path";
import { envAlias } from "./brand-env";
import { APP_SLUG } from "@/config/brand";

export const HOME = homedir();
const OPENCLAW_DIR = `${HOME}/.openclaw`;
const WORKSPACE_DIR = `${OPENCLAW_DIR}/workspace`;
export const TOOLS_DIR = `${WORKSPACE_DIR}/tools`;
export const CRON_FILE = path.join(HOME, ".openclaw", "cron", "jobs.json");

export const DEFAULT_USER_NAME = envAlias("DEFAULT_USER_NAME", "there");
/** External ID of the owner entity — used to exclude the user from people
 *  queries. "self" is the neutral marker; DBs seeded before 2026-07-17 were
 *  migrated from the legacy value with
 *  `UPDATE entities SET external_id='self' WHERE external_id='george'`. */
export const DEFAULT_USER_EXTERNAL_ID = envAlias("DEFAULT_USER_EXTERNAL_ID", "self");
export const TELEGRAM_CHAT_ID = envAlias("TELEGRAM_CHAT_ID");
export const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";

/** Source attribution for rows created via the app UI. Distinguishes
 *  manual-from-app rows from seeded knowledge.sqlite + contact-resolver
 *  imports so future audit/cleanup queries can filter by origin. */
export const SOURCE_LOKI_UI = `${APP_SLUG}-ui`;

/** How many days of history the /habits page (and its heatmap) covers. */
export const HABIT_HISTORY_DAYS = 30;

/** Default timezone for schedule-related operations (cron jobs, calendar). */
export const DEFAULT_TIMEZONE = envAlias("DEFAULT_TIMEZONE", "Europe/Zurich");

/** Locale used for date/time formatting throughout the app. English-Swiss:
 *  the UI is entirely English, so de-CH rendered jarring German dates
 *  ("Freitag, 19. Juni 2026") under an English greeting. en-CH anglicises the
 *  weekday/month names while preserving Swiss numeric + currency conventions
 *  (apostrophe thousands, "CHF 1’234.50"), so only the dates change. Override
 *  with the LOCALE env var. */
export const APP_LOCALE = envAlias("LOCALE", "en-CH");

/** Lookahead windows for the /today summary cards. */
export const GOALS_DUE_SOON_DAYS = 14;
export const EVENTS_DUE_SOON_DAYS = 30;
export const SUBSCRIPTIONS_UPCOMING_DAYS = 14;

/** How many days before an invitation link expires. */
export const INVITATION_EXPIRY_DAYS = 7;

/** Shared cap for long free-text inputs (project briefs, roadmap/reconcile
 *  pastes, captured prompts). The UI `maxLength` and the API zod `.max` must
 *  agree — both import this so they can't drift. */
export const LONG_TEXT_MAX = 8_000;

/** Cap for a PASTED document — a concept, a spec, notes — that AI reads into a
 *  project's profile or roadmap (brief, roadmap, reconcile). Skif's doctrine is
 *  8.5k characters and its spec 34k; at 8,000 the browser cut the doctrine off
 *  silently and the server answered "at least a sentence". ~6k tokens, which
 *  the free chain still takes in one request. Over it, the text is KEPT and the
 *  person is told, never truncated (see components/ui/char-count.tsx). */
export const DOC_PASTE_MAX = 24_000;
