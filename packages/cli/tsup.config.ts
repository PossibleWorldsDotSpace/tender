import { defineConfig } from "tsup";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

// Workspace packages we fold into the bundle. Everything else (commander,
// puppeteer, pagedjs, etc.) stays external and resolves from node_modules
// at install time — see `dependencies` in package.json.
const BUNDLED_WORKSPACE = [
  "@tender/core",
  "@tender/render"
];

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  shims: false,
  // Bundle only the @tender/* workspace siblings; leave third-party deps
  // external so they install from the registry alongside the CLI.
  noExternal: BUNDLED_WORKSPACE,
  async onSuccess() {
    const cliRoot = process.cwd();

    // Copy the preview-ui dist next to the bundled CLI. preview.ts looks
    // here first (and falls back to the workspace path in dev).
    const previewSrc = join(cliRoot, "..", "preview-ui", "dist");
    const previewDest = join(cliRoot, "dist", "preview-ui");
    await rm(previewDest, { recursive: true, force: true });
    await mkdir(previewDest, { recursive: true });
    await cp(previewSrc, previewDest, { recursive: true });

    // Copy the bundled user guide into packages/cli/assets/. Core's
    // render-help.ts looks here when the bundle's `here` is the CLI dist/.
    // Source: packages/core/assets/builtin-user-guide.md (refreshed by
    // core's `prebuild` script from docs/user-guide.md).
    const guideSrc = join(cliRoot, "..", "core", "assets", "builtin-user-guide.md");
    const guideDest = join(cliRoot, "assets", "builtin-user-guide.md");
    await mkdir(join(cliRoot, "assets"), { recursive: true });
    await cp(guideSrc, guideDest);
  }
});
