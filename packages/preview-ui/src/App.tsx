import { Router, Route, useLocation } from "@solidjs/router";
import { createMemo, createSignal, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { TabBar } from "./components/TabBar.tsx";
import { ErrorBanner } from "./components/ErrorBanner.tsx";
import { DocSwitcher } from "./components/DocSwitcher.tsx";
import { PreviewIframe } from "./tabs/Preview.tsx";
import { Palette } from "./tabs/Palette.tsx";
import { Help } from "./tabs/Help.tsx";
import { Export } from "./tabs/Export.tsx";
import { connectReloadSocket, fetchDocs, type DocsResponse } from "./api.ts";
import { ReloadContext } from "./reload-context.ts";
import "./App.css";

interface LayoutProps {
  errorMessage: Accessor<string | null>;
  onDismissError: () => void;
  docs: Accessor<DocsResponse["docs"]>;
  currentDoc: Accessor<string | null>;
  onDocChange: (doc: string) => void;
  children?: any;
}

const makeLayout = (lp: LayoutProps) => (props: { children?: any }) => {
  const location = useLocation();
  const isPreview = createMemo(() => location.pathname === "/");

  // The iframe is mounted permanently; only its visibility toggles.
  // The route's `Preview` component renders an empty placeholder; the real
  // iframe lives in the layout so it survives tab switches.
  return (
    <div class="app">
      <TabBar>
        <DocSwitcher docs={lp.docs()} current={lp.currentDoc()} onChange={lp.onDocChange} />
      </TabBar>
      <Show when={lp.errorMessage()}>
        <ErrorBanner message={lp.errorMessage()!} onDismiss={lp.onDismissError} />
      </Show>
      <main class="content" classList={{ "content--preview": isPreview() }}>
        <PreviewIframe visible={isPreview()} doc={lp.currentDoc()} />
        <div class="tab-content" classList={{ hidden: isPreview() }}>
          {props.children}
        </div>
      </main>
    </div>
  );
};

export function App() {
  const [paletteVersion, setPaletteVersion] = createSignal(0);
  const [helpVersion, setHelpVersion] = createSignal(0);
  const [docsVersion, setDocsVersion] = createSignal(0);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [docs, setDocs] = createSignal<DocsResponse["docs"]>([]);
  const [currentDoc, setCurrentDoc] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const r = await fetchDocs();
      setDocs(r.docs);
      setCurrentDoc(r.default);
    } catch (err) {
      // Server might not be up yet; the WS reconnect handles it.
      console.error("Failed to fetch /_api/docs:", err);
    }
  });

  async function refreshDocs() {
    try {
      const r = await fetchDocs();
      setDocs(r.docs);
      // If the currently-selected doc was removed, fall back to the new default.
      const cur = currentDoc();
      if (cur && !r.docs.some(d => d.basename === cur)) {
        setCurrentDoc(r.default);
      }
    } catch (err) {
      console.error("Failed to refresh /_api/docs:", err);
    }
  }

  const close = connectReloadSocket((msg) => {
    if (msg.kind === "error") {
      setErrorMessage(msg.message);
      return; // don't reload
    }
    // Recovery: clear any prior error
    if (errorMessage()) setErrorMessage(null);

    if (msg.kind === "docs") {
      refreshDocs();
      setDocsVersion(v => v + 1);
      return;
    }

    if (msg.kind === "content") {
      // Only reload if the change is to the currently-visible doc.
      if (msg.doc !== currentDoc()) return;
      const iframe = document.getElementById("preview-iframe") as HTMLIFrameElement | null;
      iframe?.contentWindow?.location.reload();
      return;
    }

    if (msg.kind === "project" || msg.kind === "components" || msg.kind === "styles" || msg.kind === "assets") {
      const iframe = document.getElementById("preview-iframe") as HTMLIFrameElement | null;
      iframe?.contentWindow?.location.reload();
    }
    if (msg.kind === "project" || msg.kind === "components" || msg.kind === "styles") {
      setPaletteVersion(v => v + 1);
    }
    if (msg.kind === "help") {
      setHelpVersion(v => v + 1);
    }
  });
  onCleanup(close);

  const Layout = makeLayout({
    errorMessage,
    onDismissError: () => setErrorMessage(null),
    docs,
    currentDoc,
    onDocChange: (d) => setCurrentDoc(d)
  });

  return (
    <ReloadContext.Provider value={{ paletteVersion, helpVersion, docsVersion }}>
      <Router root={Layout}>
        <Route path="/" component={() => null} />
        <Route path="/palette" component={Palette} />
        <Route path="/help" component={Help} />
        <Route path="/export" component={Export} />
      </Router>
    </ReloadContext.Provider>
  );
}
