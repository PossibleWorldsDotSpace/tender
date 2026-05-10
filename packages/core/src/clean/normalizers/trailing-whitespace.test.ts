import { describe, it, expect } from "vitest";
import { normalizeTrailingWhitespace } from "./trailing-whitespace.js";
import { expectIdempotent } from "../test-helpers.js";

describe("normalizeTrailingWhitespace", () => {
  it("strips trailing spaces from lines", () => {
    const r = normalizeTrailingWhitespace("hello   \nworld   ");
    expect(r.output).toBe("hello\nworld");
    expect(r.change?.count).toBe(2);
  });

  it("strips trailing tabs", () => {
    const r = normalizeTrailingWhitespace("hello\t\t\nworld");
    expect(r.output).toBe("hello\nworld");
  });

  it("preserves trailing two spaces (Markdown hard break)", () => {
    const r = normalizeTrailingWhitespace("hello  \nworld");
    expect(r.output).toBe("hello  \nworld");
    expect(r.change).toBeNull();
  });

  it("does not preserve trailing one space (not a hard break)", () => {
    const r = normalizeTrailingWhitespace("hello \nworld");
    expect(r.output).toBe("hello\nworld");
    expect(r.change?.count).toBe(1);
  });

  it("does not preserve trailing three spaces (not a hard break)", () => {
    const r = normalizeTrailingWhitespace("hello   \nworld");
    expect(r.output).toBe("hello\nworld");
  });

  it("does not preserve trailing tab + space (not a hard break)", () => {
    const r = normalizeTrailingWhitespace("hello\t \nworld");
    expect(r.output).toBe("hello\nworld");
  });

  it("strips trailing whitespace from a whitespace-only line", () => {
    // A line that's just spaces becomes empty.
    const r = normalizeTrailingWhitespace("hello\n   \nworld");
    expect(r.output).toBe("hello\n\nworld");
    expect(r.change?.count).toBe(1);
  });

  it("returns null change when there's nothing to trim", () => {
    const r = normalizeTrailingWhitespace("hello\nworld");
    expect(r.change).toBeNull();
  });

  it("is idempotent", () => {
    const fn = (s: string) => normalizeTrailingWhitespace(s).output;
    expectIdempotent(fn, "hello   \nworld   ");
    expectIdempotent(fn, "hello  \nworld");
    expectIdempotent(fn, "no changes");
  });
});
