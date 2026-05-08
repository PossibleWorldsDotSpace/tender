/**
 * Extract :root custom-property declarations from `css` and return them
 * as a :host block, suitable for injecting at the top of a shadow-root
 * stylesheet. Custom properties in :root don't apply inside Shadow DOM
 * because :root targets the document's <html>, not the shadow host.
 * Mirroring them onto :host makes them inheritable inside the tree.
 */
export function rootToHost(css: string): string {
  // Match :root { ... } blocks (allow whitespace between `:root` and `{`).
  // Greedy on body but stop at first matching close brace; assumes no nested
  // braces inside :root (true for all design-token blocks).
  const re = /:root\s*\{([^{}]*)\}/g;
  const decls: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    decls.push(m[1]!);
  }
  if (decls.length === 0) return "";
  return `:host { ${decls.join(" ")} }`;
}
