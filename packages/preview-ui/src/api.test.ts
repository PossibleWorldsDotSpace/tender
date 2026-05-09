import { describe, it, expect, vi } from "vitest";
import { fetchPalette, fetchHelp } from "./api.ts";

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
});
