import { createResource, createEffect, For, Show } from "solid-js";
import { fetchPalette, fetchStylesCss, fetchProjectCss } from "../api.ts";
import { Tile } from "../components/Tile.tsx";
import { hoistFontFaces } from "../util/fonts.ts";
import { useReload } from "../reload-context.ts";
import "./Palette.css";

async function loadAll() {
  const [palette, stylesCss, projectCss] = await Promise.all([
    fetchPalette(),
    fetchStylesCss(),
    fetchProjectCss()
  ]);
  return { palette, css: projectCss + "\n" + stylesCss };
}

export function Palette() {
  const reload = useReload();
  const [data] = createResource(reload.paletteVersion, loadAll);

  createEffect(() => {
    const d = data();
    if (d) hoistFontFaces(d.css);
  });

  return (
    <div class="palette">
      <Show when={data()} fallback={<div class="palette-loading">Loading…</div>}>
        {(d) => (
          <>
            <Show when={d().palette.components.length > 0}>
              <h2 class="palette-section">Components</h2>
              <For each={d().palette.components}>
                {(c) => <Tile title={c.name} meta={c.meta} renders={c.renders} css={d().css} />}
              </For>
            </Show>
            <Show when={d().palette.templates.length > 0}>
              <h2 class="palette-section">Layouts</h2>
              <For each={d().palette.templates}>
                {(t) => <Tile title={t.name} meta={t.meta} renders={t.renders} css={d().css} />}
              </For>
            </Show>
            <h2 class="palette-section">Typography specimen</h2>
            <For each={d().palette.typography}>
              {(t) => <Tile title={t.label} meta={{}} renders={[{ html: t.html, snippet: "" }]} css={d().css} />}
            </For>
          </>
        )}
      </Show>
    </div>
  );
}
