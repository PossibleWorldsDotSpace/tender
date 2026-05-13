import { describe, it, expect, vi } from "vitest";
import { fetchPalette, fetchHelp, fetchDocs, buildPdfs } from "./api.ts";

describe("api client", () => {
  it("fetchPalette parses JSON from /_api/palette", async () => {
    const fakeResponse = { components: [], typography: [] };
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(fakeResponse), { status: 200, headers: { "content-type": "application/json" } }))
    ));
    const result = await fetchPalette();
    expect(result.components).toEqual([]);
  });

  it("fetchHelp returns html and source", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ html: "<p>ok</p>", source: "builtin" }), { status: 200 }))
    ));
    const result = await fetchHelp();
    expect(result.source).toBe("builtin");
  });

  it("fetchDocs hits /_api/docs and returns the JSON body", async () => {
    const mock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({
        docs: [{ basename: "content", filename: "content.md", isContent: true }],
        default: "content"
      }), { status: 200 }))
    );
    vi.stubGlobal("fetch", mock);
    const res = await fetchDocs();
    expect(res.default).toBe("content");
    expect(res.docs).toHaveLength(1);
    expect(res.docs[0]?.basename).toBe("content");
    expect(mock).toHaveBeenCalledWith("/_api/docs");
    vi.unstubAllGlobals();
  });

  it("buildPdfs POSTs to /_api/build (all docs) or /_api/build?doc=x (one)", async () => {
    const mock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ outDir: "/p/out", results: [] }), { status: 200 }))
    );
    vi.stubGlobal("fetch", mock);
    await buildPdfs();
    expect(mock).toHaveBeenLastCalledWith("/_api/build", { method: "POST" });
    await buildPdfs("resume");
    expect(mock).toHaveBeenLastCalledWith("/_api/build?doc=resume", { method: "POST" });
    vi.unstubAllGlobals();
  });

  it("buildPdfs surfaces the server's error message on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "No document \"nope\"" }), {
        status: 404, headers: { "content-type": "application/json" }
      }))
    ));
    await expect(buildPdfs("nope")).rejects.toThrow(/No document/);
    vi.unstubAllGlobals();
  });
});
