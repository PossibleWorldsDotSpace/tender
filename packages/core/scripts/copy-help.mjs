// Copies docs/user-guide.md (canonical) → assets/builtin-user-guide.md (shipped).
// Run automatically before build/test/typecheck via the npm-script lifecycle so
// the bundled help is always in sync with the canonical guide. See
// src/help/render-help.ts for the consumer.
//
// We deliberately don't track assets/builtin-user-guide.md in git — it's
// regenerated from docs/user-guide.md on every build. Editing it directly
// would silently get overwritten.
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "docs", "user-guide.md");
const dst = join(here, "..", "assets", "builtin-user-guide.md");

await mkdir(dirname(dst), { recursive: true });
await cp(src, dst);
