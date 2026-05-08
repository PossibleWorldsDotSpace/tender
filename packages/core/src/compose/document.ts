export interface ComposeInput {
  bodyHtml: string;
  lang: string;
  title: string;
}

export function composeDocument(input: ComposeInput): string {
  return `<!DOCTYPE html>
<html lang="${escapeAttr(input.lang)}">
<head>
<meta charset="UTF-8">
<title>${escapeText(input.title)}</title>
<link rel="stylesheet" href="_project.css">
<link rel="stylesheet" href="styles.css">
</head>
<body>
${input.bodyHtml}
</body>
</html>`;
}

function escapeAttr(s: string) { return s.replace(/"/g, "&quot;"); }
function escapeText(s: string) { return s.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!)); }
