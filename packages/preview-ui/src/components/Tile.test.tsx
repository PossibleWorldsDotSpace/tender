import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { Tile } from "./Tile.tsx";

describe("Tile", () => {
  it("renders title, snippet, and shadow root with HTML", async () => {
    const { container } = render(() => (
      <Tile
        title="callout"
        meta={{ tag: "aside", class: "callout" }}
        renders={[{ label: "default", html: '<aside class="callout">Hello</aside>', snippet: ":::callout\nHello\n:::" }]}
        css=""
      />
    ));
    const heading = container.querySelector(".tile-name");
    expect(heading?.textContent).toBe("callout");
    expect(container.textContent).toContain(":::callout");
    const host = container.querySelector(".tile-render-host") as HTMLElement;
    expect(host).toBeTruthy();
    expect(host.shadowRoot).toBeTruthy();
    expect(host.shadowRoot!.textContent).toContain("Hello");
  });
});
