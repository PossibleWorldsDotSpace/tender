import { createResource, Show } from "solid-js";
import { fetchHelp } from "../api.ts";
import { useReload } from "../reload-context.ts";
import "./Help.css";

export function Help() {
  const reload = useReload();
  const [data] = createResource(reload.helpVersion, fetchHelp);
  return (
    <div class="help">
      <Show when={data()} fallback={<div class="help-loading">Loading…</div>}>
        {(d) => (
          <>
            {d().source === "builtin" ? (
              <div class="help-notice">
                Using the built-in user guide. Place a customised copy at <code>docs/user-guide.md</code> in your project to override.
              </div>
            ) : null}
            <article class="help-content" innerHTML={d().html} />
          </>
        )}
      </Show>
    </div>
  );
}
