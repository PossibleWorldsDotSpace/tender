#!/usr/bin/env node
/**
 * Structural lint for claude/skills/tender-author/SKILL.md and friends.
 *
 * Three checks:
 *   1. SKILL.md frontmatter has `name` and `description` (regex-level).
 *   2. Every `examples/<path>` reference in SKILL.md resolves on disk.
 *   3. The synthetic project under examples/ lints clean (`tender lint`).
 *
 * Catches structural rot only — never speaks to prompt quality. The
 * manual smoke-test corpus in test-prompts.md is the regression test for
 * that.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";

const SKILL_DIR = "claude/skills/tender-author";
const SKILL_PATH = `${SKILL_DIR}/SKILL.md`;

let failed = false;
function fail(msg) {
  console.error(`✗ ${msg}`);
  failed = true;
}
function ok(msg) {
  console.log(`✓ ${msg}`);
}

// ---- Check 1: frontmatter has name + description.
let src;
try {
  src = readFileSync(SKILL_PATH, "utf8");
} catch (e) {
  fail(`${SKILL_PATH} not readable: ${e.message}`);
  process.exit(1);
}

const fmMatch = src.match(/^---\n([\s\S]*?)\n---/);
if (!fmMatch) {
  fail(`${SKILL_PATH}: no YAML frontmatter`);
} else {
  const fm = fmMatch[1];
  const hasName = /^name:\s*\S+/m.test(fm);
  const hasDescription = /^description:/m.test(fm);
  if (!hasName) fail(`${SKILL_PATH}: frontmatter missing 'name' key`);
  if (!hasDescription) fail(`${SKILL_PATH}: frontmatter missing 'description' key`);
  if (hasName && hasDescription) ok("frontmatter has name and description");
}

// ---- Check 2: examples/<path> references resolve.
const refs = new Set(src.match(/examples\/[\w./-]+/g) ?? []);
if (refs.size === 0) {
  ok("no example references to validate");
} else {
  for (const ref of refs) {
    const fullPath = resolve(SKILL_DIR, ref);
    try {
      statSync(fullPath);
    } catch {
      fail(`${SKILL_PATH} references missing file: ${ref}`);
    }
  }
  if (!failed) ok(`all ${refs.size} example references resolve`);
}

// ---- Check 3: synthetic project lints clean.
const synthDir = `${SKILL_DIR}/examples/synthetic-project`;
try {
  statSync(synthDir);
} catch {
  fail(`synthetic project missing at ${synthDir}`);
  if (failed) process.exit(1);
}

// Run `node packages/cli/dist/cli.js lint <synthetic-project>`. Build is
// expected to have run before this script.
let lintOutput;
try {
  lintOutput = execSync(`node packages/cli/dist/cli.js lint ${synthDir}`, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });
} catch (e) {
  fail("synthetic project failed to lint:");
  console.error(e.stdout?.toString() ?? "");
  console.error(e.stderr?.toString() ?? "");
  process.exit(1);
}
const trimmed = lintOutput.trim();
if (trimmed === "ok") {
  ok("synthetic project lints clean");
} else {
  fail("synthetic project produced unexpected lint output:");
  console.error(lintOutput);
}

process.exit(failed ? 1 : 0);
