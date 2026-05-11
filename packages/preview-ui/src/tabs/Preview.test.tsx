import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { PreviewIframe } from "./Preview.tsx";

describe("PreviewIframe", () => {
  it("renders an iframe pointing at /_preview when no doc is set", () => {
    const { container } = render(() => <PreviewIframe visible={true} doc={null} />);
    const iframe = container.querySelector("iframe");
    expect(iframe?.src).toMatch(/\/_preview$/);
  });

  it("renders an iframe pointing at /_preview?doc=<name> when a doc is set", () => {
    const { container } = render(() => <PreviewIframe visible={true} doc="resume" />);
    const iframe = container.querySelector("iframe");
    expect(iframe?.src).toMatch(/\/_preview\?doc=resume$/);
  });

  it("hides the iframe when not visible", () => {
    const { container } = render(() => <PreviewIframe visible={false} doc={null} />);
    const iframe = container.querySelector("iframe");
    expect(iframe?.classList.contains("hidden")).toBe(true);
  });
});
