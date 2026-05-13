import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { Export } from "./Export.tsx";

const DOCS = {
  docs: [
    { basename: "content", filename: "content.md", isContent: true },
    { basename: "resume", filename: "resume.md", isContent: false }
  ],
  default: "content"
};

function stubFetch(handler: (url: string, init?: RequestInit) => unknown): void {
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(handler(url, init)), {
      status: 200, headers: { "content-type": "application/json" }
    }))
  ));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("Export tab", () => {
  it("lists every document with a Build PDF button", async () => {
    stubFetch(url => (url === "/_api/docs" ? DOCS : {}));
    const { findByText, getAllByText } = render(() => <Export />);
    expect(await findByText("content.md")).toBeTruthy();
    expect(await findByText("resume.md")).toBeTruthy();
    expect(getAllByText("Build PDF")).toHaveLength(2);
    expect(await findByText("Build all PDFs")).toBeTruthy();
  });

  it("hides 'Build all' when there is a single document", async () => {
    stubFetch(url => (url === "/_api/docs"
      ? { docs: [DOCS.docs[0]], default: "content" }
      : {}));
    const { findByText, queryByText } = render(() => <Export />);
    expect(await findByText("content.md")).toBeTruthy();
    expect(queryByText("Build all PDFs")).toBeNull();
  });

  it("builds a single doc and shows the out/ path, size, and download link", async () => {
    stubFetch((url, init) => {
      if (url === "/_api/docs") return DOCS;
      if (url.startsWith("/_api/build") && init?.method === "POST") {
        return {
          outDir: "/proj/out",
          results: [{ doc: "resume", ok: true, path: "/proj/out/resume.pdf", downloadUrl: "/_api/out/resume.pdf", bytes: 90112 }]
        };
      }
      return {};
    });
    const { findByText, getAllByText, findByRole } = render(() => <Export />);
    await findByText("resume.md");
    // Second "Build PDF" button is the resume row.
    fireEvent.click(getAllByText("Build PDF")[1]!);
    expect(await findByText("out/resume.pdf")).toBeTruthy();
    expect(await findByText("88.0 KB")).toBeTruthy();
    const link = await findByRole("link", { name: "Download" });
    expect(link.getAttribute("href")).toBe("/_api/out/resume.pdf");
  });

  it("shows the per-doc error message when a build fails", async () => {
    stubFetch((url, init) => {
      if (url === "/_api/docs") return DOCS;
      if (url.startsWith("/_api/build") && init?.method === "POST") {
        return { outDir: "/proj/out", results: [{ doc: "resume", ok: false, error: "Unknown component \"x\"" }] };
      }
      return {};
    });
    const { findByText, getAllByText } = render(() => <Export />);
    await findByText("resume.md");
    fireEvent.click(getAllByText("Build PDF")[1]!);
    expect(await findByText(/Unknown component/)).toBeTruthy();
  });

  it("builds all docs at once", async () => {
    stubFetch((url, init) => {
      if (url === "/_api/docs") return DOCS;
      if (url === "/_api/build" && init?.method === "POST") {
        return {
          outDir: "/proj/out",
          results: [
            { doc: "content", ok: true, path: "/proj/out/content.pdf", downloadUrl: "/_api/out/content.pdf", bytes: 1024 },
            { doc: "resume", ok: true, path: "/proj/out/resume.pdf", downloadUrl: "/_api/out/resume.pdf", bytes: 2048 }
          ]
        };
      }
      return {};
    });
    const { findByText } = render(() => <Export />);
    fireEvent.click(await findByText("Build all PDFs"));
    expect(await findByText("out/content.pdf")).toBeTruthy();
    expect(await findByText("out/resume.pdf")).toBeTruthy();
  });
});
