# Tender CLI style guide

Internal reference for terminal output. Keep `tender build/lint/preview/init`
visually consistent so future additions don't drift.

## Color (`style.ts`)

Single source of truth for whether color is enabled: `colorEnabled`. It's
decided once at module load. The rules:

| Signal | Effect |
|---|---|
| `NO_COLOR` is set (any value, even empty string) | color off |
| `CI` is `"true"` / `"1"` / unset to anything truthy | color off |
| `TERM=dumb` | color off |
| `FORCE_COLOR=1` | color on (overrides TTY check) |
| stdout is not a TTY | color off |

Importers call `red(s)` / `yellow(s)` / `green(s)` / `cyan(s)` / `dim(s)` /
`bold(s)` and get either ANSI-wrapped or untouched text. **Don't write
escape sequences inline** — go through these helpers so the off-switch
works uniformly.

### Color vocabulary

- **`red`**: errors, failures
- **`yellow`**: warnings
- **`green`**: success, "ok"
- **`cyan`**: file paths, URLs, things the user might click/copy
- **`dim`**: secondary information — `[error-codes]`, hints, "Press Ctrl-C"
- **`bold`**: severity emphasis (e.g. error labels), used sparingly
- **`magenta`**: the wordmark accent only

Don't mix purposes (no green file paths). Authors reading the output should
be able to scan by color: red = something to fix; yellow = something to
notice; cyan = a thing in the world.

## Banner (`banner.ts`)

The `tender` wordmark — figlet "ANSI Regular" (uses `█` U+2588). Shown:

- `tender --help` (always, even non-TTY: the user explicitly asked)
- `tender preview` startup (only if `shouldShowBanner()` — TTY + color on)
- `tender init` success (only if `shouldShowBanner()`)

Suppressed under `NO_COLOR`, `CI`, non-TTY pipes, and `--json` paths.

## Spinner (`spinner.ts`)

Hand-rolled. Frames: `| / - \`. Renders to **stderr** so it doesn't pollute
stdout pipelines (`--json` consumers stay clean). No-ops to a single
success/failure line when stderr is not a TTY.

Use for any operation that takes more than ~0.5s of wall-clock — currently
just `tender build` (Paged.js render is the slow part).

```ts
const spinner = startSpinner("Building PDF...");
try {
  await doWork();
  spinner.succeed("Built PDF -> /path/to/out");
} catch (err) {
  spinner.fail(`Build failed: ${err.message}`);
  process.exit(1);
}
```

The `ok` / `FAIL` prefix words are ASCII — same reason as the banner.

## What stays plain

- **`--json` outputs**: never colored, never decorated. Machine-readable.
- **Help text**: commander's default formatting (modulo our root description
  with the banner); `addHelpText("after", …)` for examples per command.
- **Stack traces**: when we let an exception bubble up to Node's default
  handler, we don't try to color it. Predictable.

## Adding a new command

1. Add the file under `commands/`.
2. In `cli.ts`:
   - Register with commander.
   - Use `addHelpText("after", …)` to attach 2–3 example invocations.
   - For long-running work, wrap with `startSpinner`.
   - Use `cyan(path)` for file paths in success messages.
   - Use `red("error")` prefix for human-readable errors before `process.exit(2)`.
3. If introducing structured output, add `--json` and skip color/banner on that path.
4. Update tests to assert against plain text — the test runner is non-TTY,
   so `colorEnabled` is `false` and helpers are pass-through.
