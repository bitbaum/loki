// Regenerate src/lib/starter-app.generated.ts from scripts/site-template.
// Run by scripts/templates/sync-starter.sh; run it by hand only after a sync.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { STARTER_MODULE, starterModuleSource } from "./starter-files";

const root = process.cwd();
writeFileSync(join(root, STARTER_MODULE), starterModuleSource(root));
console.log(`wrote ${STARTER_MODULE}`);
