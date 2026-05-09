import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createConnection,
  createProtocolConnection,
  InitializeRequest,
  type InitializeParams
} from "vscode-languageserver/node.js";
import { startServer } from "../src/server.js";

/**
 * Spin up a Tender LSP on an in-process duplex pair, send an initialize
 * request as a client would, and return the response. No child processes;
 * tests stay fast.
 */
async function withInitialize<T>(
  rootDir: string,
  fn: (capabilities: unknown) => T
): Promise<T> {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const serverConn = createConnection(clientToServer, serverToClient);
  startServer(serverConn);

  const clientConn = createProtocolConnection(serverToClient, clientToServer);
  clientConn.listen();

  const params: InitializeParams = {
    processId: process.pid,
    rootUri: pathToFileURL(rootDir).href,
    workspaceFolders: [{ uri: pathToFileURL(rootDir).href, name: "test" }],
    capabilities: {}
  };

  const response = await clientConn.sendRequest(InitializeRequest.type, params);
  try {
    return fn(response);
  } finally {
    clientConn.end();
  }
}

// vscode-languageserver/node.js attaches process.exit handlers to the
// server's input stream — when the stream closes, the server treats that as
// "client disconnected" and shuts down the host process. In production
// (stdin/stdout) that's exactly right. In tests we close in-process duplex
// streams between assertions, so the handler tries to terminate the test
// runner. Stub process.exit for the duration of these tests so end/close
// events on PassThroughs don't kill vitest.
let exitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
});
afterEach(() => {
  exitSpy.mockRestore();
});

describe("language-server skeleton", () => {
  it("responds to initialize with text-document-sync capability", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-lsp-"));
    try {
      await writeFile(
        join(dir, "project.yaml"),
        "page-templates: { default: { size: A5, margin: 0 } }\n"
      );
      const result = await withInitialize(dir, (resp) => resp);
      const r = result as { capabilities: { textDocumentSync: number } };
      expect(r.capabilities).toBeDefined();
      // 2 = TextDocumentSyncKind.Incremental
      expect(r.capabilities.textDocumentSync).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);

  it("loads the project index from the workspace root during initialize", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tender-lsp-"));
    try {
      await writeFile(
        join(dir, "project.yaml"),
        [
          "page-templates:",
          "  default: { size: A5, margin: 0 }",
          "  cover: { size: A4, margin: 0 }"
        ].join("\n")
      );
      await mkdir(join(dir, "components"), { recursive: true });
      await writeFile(
        join(dir, "components", "callout.tender"),
        "---\ntag: aside\nclass: callout\nparams: [variant]\n---\n"
      );

      // The skeleton stores the index on the handle; fetching it requires
      // running startServer in this process and inspecting the handle. We
      // bypass the duplex client and call startServer directly so the
      // returned handle is in scope.
      const clientToServer = new PassThrough();
      const serverToClient = new PassThrough();
      const serverConn = createConnection(clientToServer, serverToClient);
      const handle = startServer(serverConn);

      const clientConn = createProtocolConnection(serverToClient, clientToServer);
      clientConn.listen();
      try {
        await clientConn.sendRequest(InitializeRequest.type, {
          processId: process.pid,
          rootUri: pathToFileURL(dir).href,
          workspaceFolders: [{ uri: pathToFileURL(dir).href, name: "test" }],
          capabilities: {}
        } as InitializeParams);

        const idx = handle.getProjectIndex();
        expect(idx).not.toBeNull();
        expect(idx!.componentByName.get("callout")?.inline).toBe(false);
        expect(idx!.pageTemplateByName.has("default")).toBe(true);
        expect(idx!.pageTemplateByName.has("cover")).toBe(true);
      } finally {
        clientConn.end();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);
});
