export function extractFontFaces(css: string): string {
  // Match @font-face { ... } blocks (handles flat property-value pairs;
  // not nested braces).
  const out: string[] = [];
  const re = /@font-face\s*\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.push(m[0]);
  return out.join("\n");
}

export function hoistFontFaces(css: string): void {
  const faces = extractFontFaces(css);
  if (!faces) return;
  let style = document.head.querySelector<HTMLStyleElement>("style[data-tender-fonts]");
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("data-tender-fonts", "");
    document.head.appendChild(style);
  }
  style.textContent = faces;
}
