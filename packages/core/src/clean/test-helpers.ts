import { expect } from "vitest";

/**
 * Assert that a normalizer is a fixed point: running it twice on the same
 * input produces byte-identical output to the first run. Every normalizer's
 * tests should call this to pin idempotency.
 */
export function expectIdempotent(
  fn: (s: string) => string,
  input: string
): void {
  const once = fn(input);
  const twice = fn(once);
  expect(twice).toBe(once);
}
