/**
 * Where a user connects, changes or removes their own model — Settings → AI.
 *
 * Its own module, with no imports, because the places that point people here
 * include the budget gate, which is loaded in the database-free test tier and
 * must not pull in the model plumbing to know a path.
 */
export const OWN_MODEL_SETTINGS_PATH = "/settings#ai";
