import type { Diagnostic, Range } from "vscode-languageserver/node.js";
import { DiagnosticSeverity } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ProjectIndex } from "../project-index.js";
import { parseTags } from "../parsers/tag-parser.js";
import { parseTenderFileRecovery } from "../parsers/tender-file-parser.js";

/**
 * Compute diagnostics for a buffer. Combines the recovery parser's
 * structural diagnostics with registry-aware checks.
 *
 * Markdown buffers (.md):
 *   - Recovery-parser diagnostics (unclosed, mismatched, stray closer).
 *   - Unknown tag name → error.
 *   - Unknown attribute on a known tag → warning.
 *   - Inline-only component used at block level → error.
 *   - Slot marker (`--- name ---`) for an undeclared slot → warning.
 *
 * Tender files (.tender):
 *   - tender-file-parser's structural diagnostics (unclosed sections,
 *     duplicate sections, malformed YAML).
 *
 * The provider returns LSP Diagnostic[] suitable for publishing via
 * connection.sendDiagnostics — the caller decides when to refresh.
 */

export interface DiagnosticsContext {
  index: ProjectIndex | null;
  document: TextDocument;
}

const SLOT_MARKER_RE = /^---\s+([\w-]+)\s+---\s*$/;

export function provideDiagnostics(ctx: DiagnosticsContext): Diagnostic[] {
  const path = uriPath(ctx.document.uri);
  if (path.endsWith(".tender")) return diagnoseTender(ctx);
  if (path.endsWith(".md")) return diagnoseMarkdown(ctx);
  return [];
}

function diagnoseMarkdown(ctx: DiagnosticsContext): Diagnostic[] {
  const text = ctx.document.getText();
  const { tags, diagnostics: parserDiags } = parseTags(text);
  const out: Diagnostic[] = [...parserDiags];

  const idx = ctx.index;
  if (!idx) return out;

  for (const t of tags) {
    const def = idx.componentByName.get(t.name);
    if (!def) {
      out.push({
        severity: DiagnosticSeverity.Error,
        message: `Unknown component "${t.name}".`,
        range: rangeOfName(t.openerRange, t.name)
      });
      continue;
    }
    if (def.inline && t.kind === "block") {
      out.push({
        severity: DiagnosticSeverity.Error,
        message: `Component "${t.name}" is inline-only; cannot use as a block.`,
        range: t.openerRange
      });
    }
    const declared = new Set(def.params);
    for (const a of t.attrs) {
      if (!declared.has(a.name)) {
        out.push({
          severity: DiagnosticSeverity.Warning,
          message: `Unknown attribute "${a.name}" on <${t.name}>. Declared params: ${
            def.params.length === 0 ? "(none)" : def.params.join(", ")
          }.`,
          range: a.nameRange
        });
      }
    }
    // Slot-marker check: scan the body lines for `--- name ---` and flag
    // any name not in def.slots.
    if (t.bodyRange) {
      const bodyStart = ctx.document.offsetAt(t.bodyRange.start);
      const bodyEnd = ctx.document.offsetAt(t.bodyRange.end);
      const body = text.slice(bodyStart, bodyEnd);
      const declaredSlots = new Set(def.slots);
      let cursor = 0;
      let line = t.bodyRange.start.line;
      for (const segment of body.split("\n")) {
        const m = segment.match(SLOT_MARKER_RE);
        if (m) {
          if (!declaredSlots.has(m[1]!)) {
            out.push({
              severity: DiagnosticSeverity.Warning,
              message: `Slot "${m[1]}" is not declared on <${t.name}>. Declared slots: ${
                def.slots.length === 0 ? "(none)" : def.slots.join(", ")
              }.`,
              range: {
                start: { line, character: 0 },
                end: { line, character: segment.length }
              }
            });
          }
        }
        cursor += segment.length + 1;
        line++;
      }
    }
  }
  return out;
}

function diagnoseTender(ctx: DiagnosticsContext): Diagnostic[] {
  const text = ctx.document.getText();
  return parseTenderFileRecovery(text).diagnostics;
}

/**
 * Narrow the opener range to just the tag name. Errors that point at the
 * whole `<row label="x">` opener are noisy; pointing at the name itself
 * places the squiggle where the user expects.
 */
function rangeOfName(openerRange: Range, name: string): Range {
  const start = {
    line: openerRange.start.line,
    character: openerRange.start.character + 1 // skip the `<`
  };
  const end = {
    line: start.line,
    character: start.character + name.length
  };
  return { start, end };
}

function uriPath(uri: string): string {
  if (uri.startsWith("file://")) return uri.slice("file://".length);
  return uri;
}
