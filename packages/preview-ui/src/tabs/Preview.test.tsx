import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { PreviewIframe } from "./Preview.tsx";

describe("PreviewIframe", () => {
  it("renders an iframe pointing at /_preview", () => {
    const { container } = render(() => <PreviewIframe visible={true} />);
    const iframe = container.querySelector("iframe");
    expect(iframe?.src).toMatch(/\/_preview$/);
  });

  it("hides the iframe when not visible", () => {
    const { container } = render(() => <PreviewIframe visible={false} />);
    const iframe = container.querySelector("iframe");
    expect(iframe?.classList.contains("hidden")).toBe(true);
  });
});
