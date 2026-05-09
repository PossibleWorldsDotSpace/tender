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
  | { kind: "content" }
  | { kind: "project" }
  | { kind: "components" }
  | { kind: "styles" }
  | { kind: "help" }
  | { kind: "assets" }
  | { kind: "error"; message: string };

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
