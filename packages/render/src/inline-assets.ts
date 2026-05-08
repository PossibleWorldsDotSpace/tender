import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Parser } from "htmlparser2";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

interface ImgMatch {
  start: number;
  end: number;
  src: string;
}

/**
 * Find every `<img>` tag in the document and report its source-string range
 * plus its `src` attribute. Uses a real HTML tokenizer rather than a regex,
 * so multi-line tags, single/double-quoted attributes, and tags appearing
 * inside <script>/<style>/comments are all handled correctly.
 *
 * Tags inside HTML comments are *not* reported, because htmlparser2 does
 * not emit `onopentag` for them.
 */
function findImgTags(html: string): ImgMatch[] {
  const matches: ImgMatch[] = [];
  let pendingSrc: string | undefined;
  let pendingStart = -1;

  const parser = new Parser({
    onopentagname(name) {
      if (name === "img") {
        // Token start is the `<` two characters before the tagname start.
        // htmlparser2 doesn't expose token offsets directly via the callback
        // API, so we recover it from the parser's `startIndex`.
        pendingStart = parser.startIndex;
        pendingSrc = undefined;
      }
    },
    onattribute(attrName, value) {
      if (attrName === "src" && pendingStart !== -1 && pendingSrc === undefined) {
        pendingSrc = value;
      }
    },
    onopentag(name) {
      if (name === "img" && pendingStart !== -1) {
        const end = parser.endIndex + 1;
        if (pendingSrc !== undefined) {
          matches.push({ start: pendingStart, end, src: pendingSrc });
        }
        pendingStart = -1;
        pendingSrc = undefined;
      }
    }
  }, { decodeEntities: false, recognizeSelfClosing: true });

  parser.write(html);
  parser.end();
  return matches;
}

function isExternal(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://");
}

function isDataUri(src: string): boolean {
  return src.startsWith("data:");
}

function isInsideProjectDir(targetPath: string, projectRoot: string): boolean {
  return targetPath === projectRoot || targetPath.startsWith(projectRoot + sep);
}

/**
 * Replaces a single attribute value within a tag's source range. We rewrite
 * only the `src=` attribute, leaving the rest of the tag (and the document
 * around it) byte-identical to the input.
 */
function replaceSrcInTag(tagSource: string, oldSrc: string, newSrc: string): string {
  // Match src="..." or src='...' specifically; we want to swap only the value
  // and preserve the surrounding quoting and other attributes verbatim.
  const dq = `src="${oldSrc}"`;
  const sq = `src='${oldSrc}'`;
  if (tagSource.includes(dq)) return tagSource.replace(dq, `src="${newSrc}"`);
  if (tagSource.includes(sq)) return tagSource.replace(sq, `src='${newSrc}'`);
  // Unquoted src=foo — rare in practice, but htmlparser2 will still parse it.
  // Fall back to a tighter regex anchored on the attribute name.
  return tagSource.replace(
    new RegExp(`\\bsrc\\s*=\\s*${oldSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s/>])`),
    `src="${newSrc}"`
  );
}

export async function inlineAssets(html: string, projectDir: string): Promise<string> {
  const projectRoot = resolve(projectDir);
  const tags = findImgTags(html);

  // Resolve every replacement first, then rebuild the document in one pass.
  // Collecting offset-keyed replacements lets us apply them right-to-left,
  // which keeps earlier offsets valid as we splice.
  interface Replacement { start: number; end: number; replaced: string }
  const replacements: Replacement[] = [];

  for (const tag of tags) {
    const src = tag.src;
    if (!src) continue;
    if (isExternal(src) || isDataUri(src)) continue;
    const ext = extname(src).toLowerCase();
    const mime = MIME_TYPES[ext];
    if (!mime) continue;
    const targetPath = resolve(projectRoot, src);
    if (!isInsideProjectDir(targetPath, projectRoot)) continue;
    let buf: Buffer;
    try {
      buf = await readFile(targetPath);
    } catch {
      continue;
    }
    const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
    const tagSource = html.slice(tag.start, tag.end);
    const replacedTag = replaceSrcInTag(tagSource, src, dataUri);
    if (replacedTag === tagSource) continue;
    replacements.push({ start: tag.start, end: tag.end, replaced: replacedTag });
  }

  if (replacements.length === 0) return html;

  // Apply right-to-left so unmodified offsets stay valid.
  replacements.sort((a, b) => b.start - a.start);
  let out = html;
  for (const { start, end, replaced } of replacements) {
    out = out.slice(0, start) + replaced + out.slice(end);
  }
  return out;
}
