import * as path from "path";
import { ExtensionContext, workspace } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

/**
 * Activate the Tender extension. Triggered by either:
 *   - The workspace containing a project.yaml (any depth), or
 *   - A .tender file being opened.
 *
 * Activation spawns the language server (a node process running
 * @tender/language-server's cli.ts) and registers it for both `tender`
 * and `markdown` documents inside the workspace. The client handles
 * document-sync, request/response routing, and capability negotiation.
 */
export function activate(context: ExtensionContext): void {
  // Resolve the language-server entry point relative to this extension's
  // installation. With workspace:* deps the file lives at
  //   node_modules/@tender/language-server/dist/cli.js
  const serverModule = context.asAbsolutePath(
    path.join("node_modules", "@tender", "language-server", "dist", "cli.js")
  );

  const serverOptions: ServerOptions = {
    run:   { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc }
  };

  const clientOptions: LanguageClientOptions = {
    // The server activates for two document languages:
    //   - `tender`: .tender component files (frontmatter + template + style + palette).
    //   - `markdown`: content.md and friends, where authors write tag-syntax.
    documentSelector: [
      { scheme: "file", language: "tender" },
      { scheme: "file", language: "markdown" }
    ],
    synchronize: {
      // Watch project.yaml and components/**/*.tender so the server can
      // rebuild its project index when files change outside the editor's
      // open buffers.
      fileEvents: [
        workspace.createFileSystemWatcher("**/project.yaml"),
        workspace.createFileSystemWatcher("**/components/**/*.tender")
      ]
    }
  };

  client = new LanguageClient(
    "tender",
    "Tender Language Server",
    serverOptions,
    clientOptions
  );

  client.start();
  context.subscriptions.push({ dispose: () => client?.stop() });
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}
