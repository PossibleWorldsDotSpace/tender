# Tender for VS Code

Authoring support for [Tender](https://github.com/joshajh/tender) — layout-as-code for print PDFs.

The extension is a thin shell over `@tender/language-server`:

- Activates on workspaces containing a `project.yaml` or any opened `.tender` file.
- Registers `.tender` as its own language with bracket-pair, comment, and indentation rules.
- Spawns the LSP and forwards both `tender` and `markdown` documents.
- Watches `project.yaml` and `components/**/*.tender` so the server's project index stays current with on-disk changes.
- Snippets:
  - In `.md`: `<page>`, `<row>`, `<callout>`, self-closing tags.
  - In `.tender`: wrapper, block-template, multi-slot scaffolds; `<palette>` example.

The marketplace VSIX build (`pnpm package`) lives at `dist/`. PR 3.7 will add TextMate grammars for tag highlighting; PR 3.8 brings end-to-end tests via `@vscode/test-cli`; PR 3.9 handles publication.
