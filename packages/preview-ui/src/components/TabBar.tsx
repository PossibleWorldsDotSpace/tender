import { A } from "@solidjs/router";
import "./TabBar.css";

export function TabBar() {
  return (
    <nav class="tabbar">
      <A href="/" end class="tab">Preview</A>
      <A href="/palette" class="tab">Palette</A>
      <A href="/help" class="tab">Help</A>
    </nav>
  );
}
