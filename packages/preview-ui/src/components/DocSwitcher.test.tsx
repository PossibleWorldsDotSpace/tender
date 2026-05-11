import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { DocSwitcher } from "./DocSwitcher.tsx";

const docs2 = [
  { basename: "content", filename: "content.md", isContent: true },
  { basename: "resume", filename: "resume.md", isContent: false }
];

describe("DocSwitcher", () => {
  it("renders nothing when there is at most one doc", () => {
    const { container } = render(() => (
      <DocSwitcher docs={[docs2[0]!]} current="content" onChange={() => {}} />
    ));
    expect(container.querySelector("select")).toBeNull();
  });

  it("renders a select with one option per doc when there are 2+", () => {
    const { container } = render(() => (
      <DocSwitcher docs={docs2} current="content" onChange={() => {}} />
    ));
    const select = container.querySelector("select");
    expect(select).toBeTruthy();
    expect(select?.querySelectorAll("option").length).toBe(2);
  });

  it("calls onChange with the selected basename", () => {
    const onChange = vi.fn();
    const { container } = render(() => (
      <DocSwitcher docs={docs2} current="content" onChange={onChange} />
    ));
    const select = container.querySelector("select") as HTMLSelectElement;
    select.value = "resume";
    fireEvent.change(select);
    expect(onChange).toHaveBeenCalledWith("resume");
  });
});
