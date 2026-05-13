import { createResource, createMemo, createSignal, Show, For } from "solid-js";
import { fetchHelp, fetchExamples, loadExample, type LoadExampleResponse } from "../api.ts";
import { buildToc } from "../util/toc.ts";
import "./Help.css";

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "conflicts"; name: string; conflicts: string[] }
  | { kind: "done"; result: LoadExampleResponse }
  | { kind: "error"; message: string };

function ExampleLoader() {
  const [examples] = createResource(async () => (await fetchExamples()).examples);
  const [state, setState] = createSignal<LoadState>({ kind: "idle" });

  async function load(name: string, force: boolean): Promise<void> {
    setState({ kind: "loading" });
    try {
      const result = await loadExample(name, force);
      if (result.conflicts.length > 0) {
        setState({ kind: "conflicts", name, conflicts: result.conflicts });
      } else {
        setState({ kind: "done", result });
      }
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <Show when={(examples() ?? []).length > 0}>
      <aside class="example-loader" aria-label="Worked examples">
        <div class="example-loader-head">
          <h3>Worked examples</h3>
          <p>
            Load a complete example project into the current directory — components, tokens, page templates,
            and a populated <code>content.md</code> — to see Tender's full feature set in one place.
          </p>
        </div>
        <For each={examples()}>
          {(name) => (
            <div class="example-loader-row">
              <span class="example-loader-name">{name}</span>
              <button
                class="btn btn--sm"
                disabled={state().kind === "loading"}
                onClick={() => void load(name, false)}
              >
                {state().kind === "loading" ? "Loading…" : "Load example"}
              </button>
            </div>
          )}
        </For>
        <Show when={state().kind === "conflicts"}>
          {(() => {
            const s = state() as { kind: "conflicts"; name: string; conflicts: string[] };
            return (
              <div class="example-loader-conflicts">
                <p>
                  Refused to install <code>{s.name}</code>: {s.conflicts.length} file{s.conflicts.length === 1 ? "" : "s"}
                  {s.conflicts.length === 1 ? " already exists" : " already exist"} in this project. Loading the example
                  would overwrite:
                </p>
                <ul>
                  <For each={s.conflicts}>{(p) => <li><code>{p}</code></li>}</For>
                </ul>
                <div class="example-loader-actions">
                  <button class="btn btn--sm" onClick={() => setState({ kind: "idle" })}>Cancel</button>
                  <button class="btn btn--primary btn--sm" onClick={() => void load(s.name, true)}>
                    Overwrite and load
                  </button>
                </div>
              </div>
            );
          })()}
        </Show>
        <Show when={state().kind === "done"}>
          {(() => {
            const s = state() as { kind: "done"; result: LoadExampleResponse };
            const created = s.result.files.filter(f => f.action === "created").length;
            const overwritten = s.result.files.filter(f => f.action === "overwritten").length;
            return (
              <div class="example-loader-done">
                Loaded <code>{s.result.template}</code> — {created} file{created === 1 ? "" : "s"} created
                {overwritten > 0 ? `, ${overwritten} overwritten` : ""}. The preview is reloading.
              </div>
            );
          })()}
        </Show>
        <Show when={state().kind === "error"}>
          <div class="example-loader-error">
            {(state() as { kind: "error"; message: string }).message}
          </div>
        </Show>
      </aside>
    </Show>
  );
}

export function Help() {
  const [data] = createResource(fetchHelp);

  const processed = createMemo(() => {
    const d = data();
    if (!d) return null;
    return { ...d, ...buildToc(d.html) };
  });

  return (
    <div class="help">
      <Show when={processed()} fallback={<div class="help-loading">Loading…</div>}>
        {(p) => (
          <>
            <Show when={p().toc.length > 0}>
              <nav class="help-toc" aria-label="Help table of contents">
                <ul>
                  <For each={p().toc}>
                    {(entry) => (
                      <li class={`help-toc-l${entry.level}`}>
                        <a href={`#${entry.slug}`}>{entry.text}</a>
                      </li>
                    )}
                  </For>
                </ul>
              </nav>
            </Show>
            <div class="help-main">
              <ExampleLoader />
              <article class="help-content" innerHTML={p().html} />
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
