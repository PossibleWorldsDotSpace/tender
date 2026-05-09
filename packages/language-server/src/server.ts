import {
  createConnection,
  TextDocuments,
  TextDocumentSyncKind,
  type Connection,
  type InitializeParams,
  type InitializeResult
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "node:url";
import { loadProjectIndex } from "./project-index.js";
import type { ProjectIndex } from "./project-index.js";

/**
 * Boots a Tender language server on the given JSON-RPC connection. Returns
 * a handle the harness can use to peek at internal state (e.g. the current
 * project index) for tests. In production the connection is the stdio
 * transport spun up by `cli.ts`.
 *
 * PR 3.1 is a skeleton: the server initializes, owns a `TextDocuments`
 * registry of open buffers, and loads a `ProjectIndex` per workspace. It
 * does not register any language features yet — completion/hover/diagnostics
 * land in PR 3.3+. The capabilities returned to the client therefore
 * declare only document-sync support so VS Code knows to forward open/close/
 * change events.
 */
export interface ServerHandle {
  /** Currently loaded project index, or null before initialize completes. */
  getProjectIndex(): ProjectIndex | null;
}

export function startServer(connection: Connection): ServerHandle {
  const documents = new TextDocuments(TextDocument);
  let projectIndex: ProjectIndex | null = null;

  connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
    const projectDir = pickProjectDir(params);
    if (projectDir) {
      try {
        projectIndex = await loadProjectIndex(projectDir);
      } catch (err) {
        // loadProjectIndex shouldn't throw, but defend in depth: a thrown
        // error here would otherwise crash initialization for the whole
        // workspace, which is the wrong failure mode for an editor pane.
        connection.console.error(
          `tender: failed to load project at ${projectDir}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental
      }
    };
  });

  documents.listen(connection);
  connection.listen();

  return {
    getProjectIndex() { return projectIndex; }
  };
}

/**
 * Choose a project root from the LSP initialize params. We accept either
 * the (deprecated but still common) `rootUri` or the first entry in
 * `workspaceFolders`. Anything else returns null and the index stays empty.
 */
function pickProjectDir(params: InitializeParams): string | null {
  const folders = params.workspaceFolders;
  if (folders && folders.length > 0) {
    return uriToPath(folders[0]!.uri);
  }
  if (params.rootUri) return uriToPath(params.rootUri);
  return null;
}

function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) return fileURLToPath(uri);
  return uri;
}

/**
 * Production entry point: bind to stdio and start the server. cli.ts is the
 * thin shebang wrapper that calls this.
 */
export function startServerOnStdio(): ServerHandle {
  const connection = createConnection(process.stdin, process.stdout);
  return startServer(connection);
}
