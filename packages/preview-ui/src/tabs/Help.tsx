import { createResource, createMemo, Show, For } from "solid-js";
import { fetchHelp } from "../api.ts";
import { buildToc } from "../util/toc.ts";
import { useReload } from "../reload-context.ts";
import "./Help.css";

export function Help() {
  const reload = useReload();
  const [data] = createResource(reload.helpVersion, fetchHelp);

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
              <Show when={p().source === "builtin"}>
                <div class="help-notice">
                  Using the built-in user guide. Place a customised copy at <code>docs/user-guide.md</code> in your project to override.
                </div>
              </Show>
              <article class="help-content" innerHTML={p().html} />
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
