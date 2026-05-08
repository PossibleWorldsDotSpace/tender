import { Router, Route } from "@solidjs/router";
import { TabBar } from "./components/TabBar.tsx";
import { Preview } from "./tabs/Preview.tsx";
import { Palette } from "./tabs/Palette.tsx";
import { Help } from "./tabs/Help.tsx";
import "./App.css";

const Layout = (props: { children?: any }) => (
  <div class="app">
    <TabBar />
    <main class="content">{props.children}</main>
  </div>
);

export function App() {
  return (
    <Router root={Layout}>
      <Route path="/" component={Preview} />
      <Route path="/palette" component={Palette} />
      <Route path="/help" component={Help} />
    </Router>
  );
}
