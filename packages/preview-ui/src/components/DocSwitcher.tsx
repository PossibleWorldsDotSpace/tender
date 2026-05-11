import { For, Show } from "solid-js";
import type { DocsResponse } from "../api.ts";
import "./DocSwitcher.css";

export function DocSwitcher(props: {
  docs: DocsResponse["docs"];
  current: string | null;
  onChange: (doc: string) => void;
}) {
  return (
    <Show when={props.docs.length > 1}>
      <label class="doc-switcher">
        <span class="doc-switcher-label">Doc</span>
        <select
          class="doc-switcher-select"
          value={props.current ?? ""}
          onChange={(e) => props.onChange(e.currentTarget.value)}
        >
          <For each={props.docs}>
            {(d) => <option value={d.basename}>{d.basename}</option>}
          </For>
        </select>
      </label>
    </Show>
  );
}
