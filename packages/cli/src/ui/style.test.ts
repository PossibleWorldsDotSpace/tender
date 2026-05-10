import { describe, it, expect } from "vitest";
import { stripAnsi, colorEnabled, red, dim } from "./style.js";

describe("style helpers", () => {
  it("stripAnsi removes color escapes", () => {
    expect(stripAnsi("\x1b[31mhi\x1b[39m")).toBe("hi");
    expect(stripAnsi("plain")).toBe("plain");
  });

  it("under non-TTY (vitest run), color is disabled and helpers are pass-through", () => {
    // The test runner runs without a TTY, so colorEnabled is false here.
    // This test pins the expected behaviour: lint tests rely on it.
    expect(colorEnabled).toBe(false);
    expect(red("error")).toBe("error");
    expect(dim("hint")).toBe("hint");
  });
});
