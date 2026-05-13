import { createResource, createSignal, For, Show } from "solid-js";
import { fetchDocs, buildPdfs, type BuildPdfDocResult } from "../api.ts";
import { useReload } from "../reload-context.ts";
import "./Export.css";

type Status =
  | { state: "idle" }
  | { state: "building" }
  | { state: "done"; result: BuildPdfDocResult }
  | { state: "error"; message: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function Export() {
  const reload = useReload();
  const [docs] = createResource(reload.docsVersion, async () => (await fetchDocs()).docs);

  // Per-doc build status, keyed by basename.
  const [statuses, setStatuses] = createSignal<Record<string, Status>>({});
  const [buildingAll, setBuildingAll] = createSignal(false);
  const setStatus = (doc: string, s: Status) =>
    setStatuses(prev => ({ ...prev, [doc]: s }));

  function statusFor(doc: string): Status {
    return statuses()[doc] ?? { state: "idle" };
  }

  async function buildOne(doc: string): Promise<void> {
    setStatus(doc, { state: "building" });
    try {
      const res = await buildPdfs(doc);
      const r = res.results.find(x => x.doc === doc);
      if (!r) {
        setStatus(doc, { state: "error", message: "no result returned" });
      } else if (r.ok) {
        setStatus(doc, { state: "done", result: r });
      } else {
        setStatus(doc, { state: "error", message: r.error ?? "build failed" });
      }
    } catch (err) {
      setStatus(doc, { state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function buildAll(): Promise<void> {
    const list = docs() ?? [];
    if (list.length === 0) return;
    setBuildingAll(true);
    setStatuses(Object.fromEntries(list.map(d => [d.basename, { state: "building" } as Status])));
    try {
      const res = await buildPdfs();
      const byDoc = new Map(res.results.map(r => [r.doc, r]));
      setStatuses(Object.fromEntries(list.map(d => {
        const r = byDoc.get(d.basename);
        if (!r) return [d.basename, { state: "error", message: "no result returned" } as Status];
        return [d.basename, r.ok
          ? { state: "done", result: r } as Status
          : { state: "error", message: r.error ?? "build failed" } as Status];
      })));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatuses(Object.fromEntries(list.map(d => [d.basename, { state: "error", message } as Status])));
    } finally {
      setBuildingAll(false);
    }
  }

  const anyBuilding = () => buildingAll() || Object.values(statuses()).some(s => s.state === "building");

  return (
    <div class="export">
      <header class="export-header">
        <h2>Export PDF</h2>
        <p class="export-blurb">
          Builds PDF(s) into the project's <code>out/</code> directory — the same place
          <code>tender&nbsp;build</code> writes them. The HTML mirror isn't produced here; run
          <code>tender&nbsp;build</code> for that.
        </p>
        <Show when={(docs() ?? []).length > 1}>
          <button class="btn btn--primary export-build-all" disabled={anyBuilding()} onClick={() => void buildAll()}>
            {buildingAll() ? "Building all…" : "Build all PDFs"}
          </button>
        </Show>
      </header>

      <Show when={docs()} fallback={<div class="export-loading">Loading documents…</div>}>
        {(list) => (
          <Show when={list().length > 0} fallback={<div class="export-empty">No documents in this project.</div>}>
            <ul class="export-list">
              <For each={list()}>
                {(d) => {
                  const s = () => statusFor(d.basename);
                  return (
                    <li class="export-row" classList={{
                      "is-building": s().state === "building",
                      "is-done": s().state === "done",
                      "is-error": s().state === "error"
                    }}>
                      <span class="export-doc">{d.filename}</span>
                      <button
                        class="btn btn--sm export-build-one"
                        disabled={s().state === "building" || buildingAll()}
                        onClick={() => void buildOne(d.basename)}
                      >
                        {s().state === "building" ? "Building…" : "Build PDF"}
                      </button>
                      <span class="export-result">
                        <Show when={s().state === "done"}>
                          {(() => {
                            const r = (s() as { state: "done"; result: BuildPdfDocResult }).result;
                            return (
                              <>
                                <span class="export-arrow">→</span>
                                <code class="export-path" title={r.path}>{shortPath(r.path)}</code>
                                <Show when={r.bytes !== undefined}>
                                  <span class="export-size">{formatBytes(r.bytes!)}</span>
                                </Show>
                                <Show when={r.downloadUrl}>
                                  <a class="export-download" href={r.downloadUrl} download={`${r.doc}.pdf`}>Download</a>
                                </Show>
                              </>
                            );
                          })()}
                        </Show>
                        <Show when={s().state === "error"}>
                          <span class="export-error-msg">{(s() as { state: "error"; message: string }).message}</span>
                        </Show>
                      </span>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        )}
      </Show>
    </div>
  );
}

/** Show "out/<file>.pdf" — the project-relative tail people expect. */
function shortPath(abs: string | undefined): string {
  if (!abs) return "";
  const norm = abs.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/out/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}
