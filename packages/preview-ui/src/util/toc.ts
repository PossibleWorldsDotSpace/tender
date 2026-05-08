export interface TocEntry {
  level: 2 | 3;
  text: string;
  slug: string;
}

export function buildToc(html: string): { html: string; toc: TocEntry[] } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const toc: TocEntry[] = [];
  const seen = new Map<string, number>();

  for (const el of Array.from(doc.querySelectorAll("h2, h3"))) {
    const text = el.textContent?.trim() ?? "";
    if (!text) continue;
    let slug = text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
    if (!slug) continue;
    const count = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, count);
    if (count > 1) slug = `${slug}-${count}`;
    el.setAttribute("id", slug);
    toc.push({ level: el.tagName === "H2" ? 2 : 3, text, slug });
  }

  return { html: doc.body.innerHTML, toc };
}
