import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { TabBar } from "./TabBar.tsx";

describe("TabBar", () => {
  it("renders Preview, Palette, Help, and Export links", () => {
    const { getByText } = render(() => (
      <Router root={TabBar}>
        <Route path="/" component={() => null} />
        <Route path="/palette" component={() => null} />
        <Route path="/help" component={() => null} />
        <Route path="/export" component={() => null} />
      </Router>
    ));
    expect(getByText("Preview")).toBeTruthy();
    expect(getByText("Palette")).toBeTruthy();
    expect(getByText("Help")).toBeTruthy();
    expect(getByText("Export")).toBeTruthy();
  });
});
