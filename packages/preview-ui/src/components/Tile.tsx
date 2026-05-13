import { For, Show, createEffect } from "solid-js";
import { rootToHost } from "../util/scope-css.ts";
import "./Tile.css";

export interface TileProps {
  title: string;
  meta: { tag?: string; class?: string; attrs?: string[]; params?: string[]; slots?: string[]; inline?: boolean };
  renders: { label?: string; html: string; snippet: string }[];
  css: string;
}

export function Tile(props: TileProps) {
  return (
    <article class="tile">
      <header class="tile-header">
        <h3 class="tile-name">{props.title}</h3>
        <dl class="tile-meta">
          {props.meta.tag ? <><dt>tag</dt><dd>{props.meta.tag}</dd></> : null}
          {props.meta.class ? <><dt>class</dt><dd>{props.meta.class}</dd></> : null}
          {props.meta.attrs?.length ? <><dt>attrs</dt><dd>{props.meta.attrs.join(", ")}</dd></> : null}
          {props.meta.params?.length ? <><dt>params</dt><dd>{props.meta.params.join(", ")}</dd></> : null}
          {props.meta.slots?.length ? <><dt>slots</dt><dd>{props.meta.slots.join(", ")}</dd></> : null}
        </dl>
      </header>
      <div class="tile-renders">
        <For each={props.renders}>
          {(r) => <RenderRow html={r.html} label={r.label} css={props.css} />}
        </For>
      </div>
      <Show when={props.renders.some(r => r.snippet)}>
        <footer class="tile-footer">
          <For each={props.renders}>
            {(r) => (
              <Show when={r.snippet}>
                <div class="snippet">
                  {r.label ? <span class="snippet-label">{r.label}</span> : null}
                  <pre><code>{r.snippet}</code></pre>
                  <button class="btn btn--sm" onClick={() => navigator.clipboard.writeText(r.snippet)}>Copy</button>
                </div>
              </Show>
            )}
          </For>
        </footer>
      </Show>
    </article>
  );
}

function RenderRow(props: { html: string; label?: string; css: string }) {
  let hostEl: HTMLDivElement | undefined;
  createEffect(() => {
    if (!hostEl) return;
    let root = hostEl.shadowRoot;
    if (!root) root = hostEl.attachShadow({ mode: "open" });
    const hostBlock = rootToHost(props.css);
    root.innerHTML = `<style>${hostBlock}\n${props.css}</style>${props.html}`;
  });
  return (
    <div class="tile-render-row">
      {props.label ? <span class="tile-render-label">{props.label}</span> : null}
      <div class="tile-render-host" ref={hostEl} />
    </div>
  );
}
