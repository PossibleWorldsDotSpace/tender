import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { Help } from "./Help.tsx";

/**
 * Help fetches `/_api/help` AND `/_api/examples`. Default mock returns the
 * built-in user guide and one example (open-circle); individual tests override
 * with stubFetch.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" }
  });
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown): void {
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(jsonResponse(handler(url, init)))
  ));
}

const DEFAULT_HELP = { html: "<h1>User Guide</h1><p>Welcome.</p>", source: "builtin" };
const DEFAULT_EXAMPLES = { examples: ["open-circle"] };

beforeEach(() => {
  stubFetch(url => {
    if (url === "/_api/help") return DEFAULT_HELP;
    if (url === "/_api/examples") return DEFAULT_EXAMPLES;
    return {};
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("Help", () => {
  it("renders fetched HTML", async () => {
    const { findByText } = render(() => <Help />);
    expect(await findByText("User Guide")).toBeTruthy();
  });

  it("shows 'using built-in' notice when source is builtin", async () => {
    const { findByText } = render(() => <Help />);
    expect(await findByText(/built-in user guide/i)).toBeTruthy();
  });

  it("does not show notice when source is project", async () => {
    stubFetch(url => {
      if (url === "/_api/help") return { html: "<h1>Custom</h1>", source: "project" };
      if (url === "/_api/examples") return DEFAULT_EXAMPLES;
      return {};
    });
    const { findByText, queryByText } = render(() => <Help />);
    expect(await findByText("Custom")).toBeTruthy();
    expect(queryByText(/built-in user guide/i)).toBeNull();
  });
});

describe("Help / ExampleLoader", () => {
  it("renders the example loader with each available example", async () => {
    const { findByText } = render(() => <Help />);
    expect(await findByText("Worked examples")).toBeTruthy();
    expect(await findByText("open-circle")).toBeTruthy();
    expect(await findByText("Load example")).toBeTruthy();
  });

  it("shows the conflict list when the server refuses, with Cancel and Overwrite buttons", async () => {
    stubFetch((url, init) => {
      if (url === "/_api/help") return DEFAULT_HELP;
      if (url === "/_api/examples") return DEFAULT_EXAMPLES;
      if (url === "/_api/examples/load" && init?.method === "POST") {
        return {
          targetDir: "/proj", template: "open-circle", files: [],
          conflicts: ["content.md", "styles.css"]
        };
      }
      return {};
    });
    const { findByText, findAllByText, getByText } = render(() => <Help />);
    fireEvent.click(await findByText("Load example"));
    expect(await findByText(/Refused to install/)).toBeTruthy();
    // The conflict list renders each path in a <code>; "content.md" can also
    // appear in surrounding prose (the "would overwrite content.md" line in
    // the future, the user-guide HTML, etc.). Assert at-least-one match.
    expect((await findAllByText("content.md")).length).toBeGreaterThan(0);
    expect((await findAllByText("styles.css")).length).toBeGreaterThan(0);
    expect(getByText("Cancel")).toBeTruthy();
    expect(getByText("Overwrite and load")).toBeTruthy();
  });

  it("shows the success message after a clean install", async () => {
    stubFetch((url, init) => {
      if (url === "/_api/help") return DEFAULT_HELP;
      if (url === "/_api/examples") return DEFAULT_EXAMPLES;
      if (url === "/_api/examples/load" && init?.method === "POST") {
        return {
          targetDir: "/proj", template: "open-circle",
          files: [
            { path: "content.md", action: "created" },
            { path: "project.yaml", action: "created" }
          ],
          conflicts: []
        };
      }
      return {};
    });
    const { findByText } = render(() => <Help />);
    fireEvent.click(await findByText("Load example"));
    expect(await findByText(/Loaded/)).toBeTruthy();
    expect(await findByText(/2 files created/)).toBeTruthy();
  });

  it("hides the loader when the server reports no examples", async () => {
    stubFetch(url => {
      if (url === "/_api/help") return DEFAULT_HELP;
      if (url === "/_api/examples") return { examples: [] };
      return {};
    });
    const { findByText, queryByText } = render(() => <Help />);
    await findByText("User Guide");
    expect(queryByText("Worked examples")).toBeNull();
  });
});
