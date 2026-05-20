import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Parser } from "htmlparser2";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

const FONT_MIME_TYPES: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf"
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
 * Confirm a target path stays inside `projectRoot` *after* symlink
 * resolution. Returns false if the target (or projectRoot itself) doesn't
 * exist; callers must already have done the lexical check, since this
 * function exists only to catch the symlink-escape case.
 */
async function isRealpathInsideProjectDir(targetPath: string, projectRoot: string): Promise<boolean> {
  try {
    const [realTarget, realRoot] = await Promise.all([realpath(targetPath), realpath(projectRoot)]);
    return realTarget === realRoot || realTarget.startsWith(realRoot + sep);
  } catch {
    return false;
  }
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
    if (!(await isRealpathInsideProjectDir(targetPath, projectRoot))) continue;
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

/**
 * Resolve a CSS `url(...)` token's target to an absolute filesystem path,
 * given the base directory the stylesheet is conceptually located in.
 *
 * Returns null for values we must not (or cannot) inline: remote URLs, data
 * URIs, and anything that resolves outside `projectRoot` (directory-traversal
 * guard, mirroring the <img> path checks).
 *
 * Paged.js' polisher rewrites relative `url()`s in injected stylesheets to
 * absolute `file://` URLs (resolved against the render page's location), so in
 * practice the font references we see here are `file://…/assets/fonts/x.woff2`.
 * We also accept still-relative paths in case that ever changes.
 */
function resolveCssUrlTarget(rawValue: string, projectRoot: string): string | null {
  const value = rawValue.trim();
  if (value === "") return null;
  if (value.startsWith("data:")) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return null;
  let candidate: string;
  if (value.startsWith("file://")) {
    try {
      candidate = fileURLToPath(value);
    } catch {
      return null;
    }
  } else {
    // Strip a leading "/" so a root-absolute URL is still treated as
    // project-relative — the only filesystem we can read from here.
    candidate = resolve(projectRoot, value.replace(/^\/+/, ""));
  }
  const target = resolve(candidate);
  if (!isInsideProjectDir(target, projectRoot)) return null;
  return target;
}

/**
 * Same lexical-plus-realpath check used for <img>, surfaced so the font
 * path can apply it after the lexical guard in `resolveCssUrlTarget`.
 */
async function isFontTargetSafe(target: string, projectRoot: string): Promise<boolean> {
  return isRealpathInsideProjectDir(target, projectRoot);
}

/**
 * Embed font files referenced by `@font-face { src: url(...) }` (and any other
 * `url()` pointing at a font file) as `data:` URIs.
 *
 * Run on the CSS *before* it goes to Paged.js so the rendered output is
 * self-contained: a relative `assets/fonts/x.woff2` otherwise survives into the
 * HTML as an absolute `file://` path (works only when the file is opened from
 * disk on the same machine) and 404s when `tender preview` serves the page over
 * http. Mirrors the <img> → data-URI inlining above.
 *
 * `cssDir` is the directory relative `url()`s resolve against — for Tender's
 * generated/user stylesheets that is the project root.
 */
export async function inlineFonts(css: string, cssDir: string): Promise<string> {
  const projectRoot = resolve(cssDir);
  // url( optional-quote  VALUE  optional-quote ) — capture quote so we can
  // re-emit it, and the value so we can resolve it.
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  const cache = new Map<string, string | null>();
  let out = "";
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const whole = m[0];
    const quote = m[1] ?? "";
    // Drop any ?query / #fragment before treating the value as a path.
    const value = m[2]!.split(/[?#]/)[0]!;
    const ext = extname(value).toLowerCase();
    const mime = FONT_MIME_TYPES[ext];
    if (!mime) continue;
    let dataUri = cache.get(value);
    if (dataUri === undefined) {
      const target = resolveCssUrlTarget(value, projectRoot);
      if (target === null) {
        dataUri = null;
      } else if (!(await isFontTargetSafe(target, projectRoot))) {
        dataUri = null;
      } else {
        try {
          const buf = await readFile(target);
          dataUri = `data:${mime};base64,${buf.toString("base64")}`;
        } catch {
          dataUri = null;
        }
      }
      cache.set(value, dataUri);
    }
    if (dataUri === null) continue;
    out += css.slice(lastIndex, m.index) + `url(${quote}${dataUri}${quote})`;
    lastIndex = m.index + whole.length;
  }
  if (lastIndex === 0) return css;
  return out + css.slice(lastIndex);
}
