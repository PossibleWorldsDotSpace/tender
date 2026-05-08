import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@solidjs/testing-library";
import { Help } from "./Help.tsx";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({
      html: "<h1>User Guide</h1><p>Welcome.</p>",
      source: "builtin"
    }), { status: 200 }))
  ));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({
        html: "<h1>Custom</h1>",
        source: "project"
      }), { status: 200 }))
    ));
    const { findByText, queryByText } = render(() => <Help />);
    expect(await findByText("Custom")).toBeTruthy();
    expect(queryByText(/built-in user guide/i)).toBeNull();
  });
});
