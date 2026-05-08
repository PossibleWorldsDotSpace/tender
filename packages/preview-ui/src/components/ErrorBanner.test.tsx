import { describe, it, expect, vi } from "vitest";
import { render } from "@solidjs/testing-library";
import { ErrorBanner } from "./ErrorBanner.tsx";

describe("ErrorBanner", () => {
  it("renders the message", () => {
    const { getByText } = render(() => <ErrorBanner message="oops" onDismiss={() => {}} />);
    expect(getByText("oops")).toBeTruthy();
  });

  it("calls onDismiss when × clicked", () => {
    const dismiss = vi.fn();
    const { getByLabelText } = render(() => <ErrorBanner message="oops" onDismiss={dismiss} />);
    getByLabelText("Dismiss").click();
    expect(dismiss).toHaveBeenCalled();
  });
});
