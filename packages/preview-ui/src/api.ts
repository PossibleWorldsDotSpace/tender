export interface PaletteEntry {
  name: string;
  meta: {
    tag?: string;
    class?: string;
    params?: string[];
    slots?: string[];
    inline?: boolean;
  };
  renders: { label?: string; html: string; snippet: string }[];
}

export interface TypographySpecimen {
  id: string;
  label: string;
  html: string;
}

export interface PaletteResponse {
  components: PaletteEntry[];
  typography: TypographySpecimen[];
}

export interface HelpResponse {
  html: string;
  source: "project" | "builtin";
}

export type WsMessage =
  | { kind: "content"; doc: string }
  | { kind: "project" }
  | { kind: "components" }
  | { kind: "styles" }
  | { kind: "help" }
  | { kind: "assets" }
  | { kind: "docs" }
  | { kind: "error"; message: string };

export interface DocsResponse {
  docs: { basename: string; filename: string; isContent: boolean }[];
  default: string | null;
}

export async function fetchDocs(): Promise<DocsResponse> {
  const res = await fetch("/_api/docs");
  if (!res.ok) throw new Error(`/_api/docs ${res.status}`);
  return res.json();
}

export interface BuildPdfDocResult {
  doc: string;
  ok: boolean;
  /** Absolute path of the written PDF (on success). */
  path?: string;
  /** Download URL relative to the server root (on success). */
  downloadUrl?: string;
  /** Byte size of the written PDF (on success). */
  bytes?: number;
  /** Error message (on failure). */
  error?: string;
}

export interface BuildPdfResponse {
  /** Absolute path of the project's out/ directory. */
  outDir: string;
  results: BuildPdfDocResult[];
}

/**
 * Build PDF(s) and write them to the project's out/ directory. Pass a doc
 * basename to build just that document; omit it to build every document.
 */
export async function buildPdfs(doc?: string): Promise<BuildPdfResponse> {
  const url = doc ? `/_api/build?doc=${encodeURIComponent(doc)}` : "/_api/build";
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    let detail = "";
    try { detail = ((await res.json()) as { error?: string }).error ?? ""; } catch { /* non-JSON body */ }
    throw new Error(detail || `build failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchPalette(): Promise<PaletteResponse> {
  const res = await fetch("/_api/palette");
  if (!res.ok) throw new Error(`palette fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchHelp(): Promise<HelpResponse> {
  const res = await fetch("/_api/help");
  if (!res.ok) throw new Error(`help fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchStylesCss(): Promise<string> {
  const res = await fetch("/_api/styles.css");
  if (!res.ok) throw new Error(`styles.css fetch failed: ${res.status}`);
  return res.text();
}

export async function fetchProjectCss(): Promise<string> {
  const res = await fetch("/_api/_project.css");
  if (!res.ok) throw new Error(`_project.css fetch failed: ${res.status}`);
  return res.text();
}

export async function fetchComponentsCss(): Promise<string> {
  const res = await fetch("/_api/_components.css");
  if (!res.ok) throw new Error(`_components.css fetch failed: ${res.status}`);
  return res.text();
}

export function connectReloadSocket(onMessage: (msg: WsMessage) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 500;

  const open = () => {
    if (closed) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/_tender`);
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data) as WsMessage); }
      catch { /* ignore malformed */ }
    };
    ws.onclose = () => {
      if (closed) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 5000);
    };
  };

  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
