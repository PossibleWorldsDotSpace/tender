export interface ComposeInput {
  bodyHtml: string;
  lang: string;
  title: string;
}

export function composeDocument(input: ComposeInput): string {
  // Cascade order matters: _project.css carries @page rules and base
  // typography; _components.css is per-component visual styling; styles.css
  // is user overrides. Authors expect their styles.css to win — keep it last.
  return `<!DOCTYPE html>
<html lang="${escapeAttr(input.lang)}">
<head>
<meta charset="UTF-8">
<title>${escapeText(input.title)}</title>
<link rel="stylesheet" href="_project.css">
<link rel="stylesheet" href="_components.css">
<link rel="stylesheet" href="styles.css">
</head>
<body>
${input.bodyHtml}
</body>
</html>`;
}

function escapeAttr(s: string) { return s.replace(/"/g, "&quot;"); }
function escapeText(s: string) { return s.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!)); }
