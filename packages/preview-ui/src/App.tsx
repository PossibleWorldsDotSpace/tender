import { Router, Route, useLocation } from "@solidjs/router";
import { createMemo, createSignal, onCleanup, Show, type Accessor } from "solid-js";
import { TabBar } from "./components/TabBar.tsx";
import { ErrorBanner } from "./components/ErrorBanner.tsx";
import { PreviewIframe } from "./tabs/Preview.tsx";
import { Palette } from "./tabs/Palette.tsx";
import { Help } from "./tabs/Help.tsx";
import { connectReloadSocket } from "./api.ts";
import { ReloadContext } from "./reload-context.ts";
import "./App.css";

interface LayoutProps {
  errorMessage: Accessor<string | null>;
  onDismissError: () => void;
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
      <Show when={lp.errorMessage()}>
        <ErrorBanner message={lp.errorMessage()!} onDismiss={lp.onDismissError} />
      </Show>
      <TabBar />
      <main class="content">
        <PreviewIframe visible={isPreview()} />
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
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  const close = connectReloadSocket((msg) => {
    if (msg.kind === "error") {
      setErrorMessage(msg.message);
      return; // don't reload
    }
    // Recovery: clear any prior error
    if (errorMessage()) setErrorMessage(null);
    if (msg.kind === "content" || msg.kind === "project" || msg.kind === "styles" || msg.kind === "assets") {
      const iframe = document.getElementById("preview-iframe") as HTMLIFrameElement | null;
      iframe?.contentWindow?.location.reload();
    }
    if (msg.kind === "project" || msg.kind === "styles") {
      setPaletteVersion(v => v + 1);
    }
    if (msg.kind === "help") {
      setHelpVersion(v => v + 1);
    }
  });
  onCleanup(close);

  const Layout = makeLayout({
    errorMessage,
    onDismissError: () => setErrorMessage(null)
  });

  return (
    <ReloadContext.Provider value={{ paletteVersion, helpVersion }}>
      <Router root={Layout}>
        <Route path="/" component={() => null} />
        <Route path="/palette" component={Palette} />
        <Route path="/help" component={Help} />
      </Router>
    </ReloadContext.Provider>
  );
}
