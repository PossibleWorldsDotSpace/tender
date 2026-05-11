import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDocuments, RESERVED_DOC_NAMES } from "./list-documents.js";

async function fixture(files: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tender-listdocs-"));
  for (const f of files) {
    if (f.includes("/")) {
      const first = f.split("/")[0]!;
      await mkdir(join(dir, first), { recursive: true });
    }
    await writeFile(join(dir, f), "");
  }
  return dir;
}

describe("listDocuments", () => {
  it("returns content.md as the only doc in a single-doc project", async () => {
    const dir = await fixture(["content.md", "project.yaml", "styles.css"]);
    const docs = await listDocuments(dir);
    expect(docs.map(d => d.basename)).toEqual(["content"]);
    expect(docs[0]!.isContent).toBe(true);
  });

  it("returns every root .md, sorted alphabetically, content.md first if present", async () => {
    const dir = await fixture(["resume.md", "cover-letter.md", "content.md"]);
    const docs = await listDocuments(dir);
    expect(docs.map(d => d.basename)).toEqual(["content", "cover-letter", "resume"]);
  });

  it("skips reserved names (README.md and _*.md)", async () => {
    const dir = await fixture(["README.md", "_draft.md", "resume.md"]);
    const docs = await listDocuments(dir);
    expect(docs.map(d => d.basename)).toEqual(["resume"]);
  });

  it("ignores .md files in subdirectories", async () => {
    const dir = await fixture(["resume.md", "components/x.md"]);
    const docs = await listDocuments(dir);
    expect(docs.map(d => d.basename)).toEqual(["resume"]);
  });

  it("returns [] when no documents exist", async () => {
    const dir = await fixture(["project.yaml"]);
    const docs = await listDocuments(dir);
    expect(docs).toEqual([]);
  });

  it("exposes the reserved-name set", () => {
    expect(RESERVED_DOC_NAMES.has("README.md")).toBe(true);
  });
});
