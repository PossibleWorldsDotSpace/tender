// Copies the tender-author skill payload (canonical: claude/skills/tender-author/
// at the repo root) → packages/cli/skill/ (shipped + scaffolded by `tender
// init` / `tender add-skill`). Only SKILL.md + examples/ ship; STATUS.md and
// test-prompts.md are maintainer-internal.
//
// Run before build (tsup onSuccess also calls the same shape) and before test
// via the npm-script lifecycle, so init.test.ts and the bundled CLI both see a
// payload. packages/cli/skill/ is gitignored — it's regenerated from the
// canonical source; editing it directly would be silently overwritten.
import { cp, mkdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "claude", "skills", "tender-author");
const dst = join(here, "..", "skill");

await rm(dst, { recursive: true, force: true });
await mkdir(join(dst, "examples"), { recursive: true });
await cp(join(src, "SKILL.md"), join(dst, "SKILL.md"));
await cp(join(src, "examples"), join(dst, "examples"), { recursive: true });
