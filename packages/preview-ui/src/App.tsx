import { Router, Route, useLocation } from "@solidjs/router";
import { createMemo, createSignal, onCleanup } from "solid-js";
import { TabBar } from "./components/TabBar.tsx";
import { PreviewIframe } from "./tabs/Preview.tsx";
import { Palette } from "./tabs/Palette.tsx";
import { Help } from "./tabs/Help.tsx";
import { connectReloadSocket } from "./api.ts";
import { ReloadContext } from "./reload-context.ts";
import "./App.css";

const Layout = (props: { children?: any }) => {
  const location = useLocation();
  const isPreview = createMemo(() => location.pathname === "/");

  // The iframe is mounted permanently; only its visibility toggles.
  // The route's `Preview` component renders an empty placeholder; the real
  // iframe lives in the layout so it survives tab switches.
  return (
    <div class="app">
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

  const close = connectReloadSocket((msg) => {
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
