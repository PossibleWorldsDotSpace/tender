import { describe, it, expect, vi } from "vitest";
import { fetchPalette, fetchHelp, fetchDocs } from "./api.ts";

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
});
