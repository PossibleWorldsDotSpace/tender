import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@solidjs/testing-library";
import { Palette } from "./Palette.tsx";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/_api/palette") {
      return Promise.resolve(new Response(JSON.stringify({
        components: [
          { name: "callout", kind: "component", meta: { tag: "aside", class: "callout" },
            renders: [{ label: "default", html: '<aside>Hi</aside>', snippet: ":::callout\nHi\n:::" }] }
        ],
        templates: [],
        typography: [
          { id: "h1", label: "Heading 1", html: "<h1>Hello</h1>" }
        ]
      }), { status: 200 }));
    }
    if (url === "/_api/styles.css") {
      return Promise.resolve(new Response("body { font: serif; }", { status: 200 }));
    }
    if (url === "/_api/_project.css") {
      return Promise.resolve(new Response("@page { size: A5; }", { status: 200 }));
    }
    return Promise.reject(new Error("unexpected " + url));
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Palette", () => {
  it("fetches and renders component tiles", async () => {
    const { findByRole } = render(() => <Palette />);
    const heading = await findByRole("heading", { level: 3, name: "callout" });
    expect(heading).toBeTruthy();
  });

  it("renders typography specimen", async () => {
    const { findByText } = render(() => <Palette />);
    expect(await findByText("Heading 1")).toBeTruthy();
  });
});
