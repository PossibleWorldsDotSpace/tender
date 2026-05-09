/**
 * Tag tokenizer for the new authoring syntax: `<row label="x">`, `</row>`,
 * `<cover-spiral />`. Pure: takes a source string and an offset, attempts to
 * read a single tag at that position, returns either a TagToken or null.
 *
 * This function is structural — it has no notion of "registered" components.
 * The outer scanner (preprocessTags, in PR 2.2) is what filters by registry
 * membership; tryParseTag's job is to produce a sharp answer to "is there a
 * tag here, and what does it look like." Returning null on malformed input
 * lets the outer scanner treat `<` as a literal character and continue.
 *
 * Grammar (from impl plan §2.4):
 *
 *   tag        := "<" name attrs? "/?" ">"
 *               | "</" name WS? ">"
 *   name       := [a-zA-Z][a-zA-Z0-9-]*
 *   attrs      := (WS attr)* WS?
 *   attr       := name ("=" value)?
 *   value      := '"' [^"]* '"' | "'" [^']* "'" | [^\s>]+
 *
 * Boolean attributes (no `=value`) are returned with `value = "true"` and no
 * value offsets. Unquoted values include any non-WS non-`>` characters, so
 * `<row label=val/>` parses as opener `<row>` with attr `label="val/"` —
 * use `<row label=val />` (or quotes) to self-close.
 */

export interface TagToken {
  kind: "open" | "close" | "self-close";
  name: string;
  attrs: TagAttr[];
  /** Offset of the leading `<` in `source`. */
  start: number;
  /** Offset just past the trailing `>` in `source`. */
  end: number;
}

export interface TagAttr {
  name: string;
  /** Resolved value. Boolean attrs default to "true". */
  value: string;
  /** Offset of the first character of the attribute name. */
  nameStart: number;
  /** Offset just past the last character of the attribute name. */
  nameEnd: number;
  /** Offset of the first character of the (raw) value, undefined for booleans. */
  valueStart?: number;
  /** Offset just past the last character of the (raw) value. */
  valueEnd?: number;
}

const NAME_START = /[a-zA-Z]/;
const NAME_CHAR = /[a-zA-Z0-9-]/;

export function tryParseTag(source: string, offset: number): TagToken | null {
  if (source[offset] !== "<") return null;
  let i = offset + 1;
  if (i >= source.length) return null;

  // Closer: `</name WS? >`.
  if (source[i] === "/") {
    i++;
    const nameStart = i;
    if (i >= source.length || !NAME_START.test(source[i]!)) return null;
    while (i < source.length && NAME_CHAR.test(source[i]!)) i++;
    const name = source.slice(nameStart, i);
    // Optional trailing whitespace, then `>`.
    while (i < source.length && isWs(source[i]!)) i++;
    if (source[i] !== ">") return null;
    return {
      kind: "close",
      name,
      attrs: [],
      start: offset,
      end: i + 1
    };
  }

  // Opener / self-close: `<name attrs? />?>`.
  const nameStart = i;
  if (!NAME_START.test(source[i]!)) return null;
  while (i < source.length && NAME_CHAR.test(source[i]!)) i++;
  const name = source.slice(nameStart, i);

  // Now parse zero or more attributes separated by whitespace, until we hit
  // `>` or `/>` (with optional whitespace before `/`). At least one whitespace
  // character is required between attributes (and between the tag name and the
  // first attribute), matching HTML and the grammar in §2.4.
  const attrs: TagAttr[] = [];
  while (i < source.length) {
    const ch0 = source[i]!;
    if (ch0 === ">") {
      return { kind: "open", name, attrs, start: offset, end: i + 1 };
    }
    if (ch0 === "/") {
      if (source[i + 1] !== ">") return null;
      return { kind: "self-close", name, attrs, start: offset, end: i + 2 };
    }
    // Anything else here must be whitespace introducing an attribute (or the
    // closing `>`/`/>`); reject otherwise.
    if (!isWs(ch0)) return null;
    while (i < source.length && isWs(source[i]!)) i++;
    if (i >= source.length) return null;
    const ch = source[i]!;
    if (ch === ">") {
      return { kind: "open", name, attrs, start: offset, end: i + 1 };
    }
    if (ch === "/") {
      if (source[i + 1] !== ">") return null;
      return { kind: "self-close", name, attrs, start: offset, end: i + 2 };
    }
    if (!NAME_START.test(ch)) return null;
    const attr = parseAttr(source, i);
    if (!attr) return null;
    attrs.push(attr);
    i = attr.valueEnd ?? attr.nameEnd;
  }
  // Ran off end of source without finding `>`.
  return null;
}

function parseAttr(source: string, offset: number): TagAttr | null {
  let i = offset;
  while (i < source.length && NAME_CHAR.test(source[i]!)) i++;
  if (i === offset) return null;
  const nameEnd = i;
  const name = source.slice(offset, nameEnd);

  // Boolean attr: not followed by `=`.
  if (source[i] !== "=") {
    return {
      name,
      value: "true",
      nameStart: offset,
      nameEnd
    };
  }
  i++; // consume `=`
  if (i >= source.length) return null;

  const next = source[i]!;
  if (next === '"' || next === "'") {
    const quote = next;
    const valueStart = i + 1;
    let j = valueStart;
    while (j < source.length && source[j] !== quote) j++;
    if (j >= source.length) return null; // unclosed quote
    const value = source.slice(valueStart, j);
    return {
      name,
      value,
      nameStart: offset,
      nameEnd,
      valueStart,
      valueEnd: j + 1 // includes the closing quote
    };
  }
  // Unquoted value: one or more non-whitespace, non-`>` characters.
  const valueStart = i;
  while (i < source.length && !isWs(source[i]!) && source[i] !== ">") i++;
  if (i === valueStart) return null; // empty unquoted value
  const value = source.slice(valueStart, i);
  return {
    name,
    value,
    nameStart: offset,
    nameEnd,
    valueStart,
    valueEnd: i
  };
}

function isWs(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}
