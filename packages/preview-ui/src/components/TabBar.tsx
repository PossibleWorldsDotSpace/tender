import { A } from "@solidjs/router";
import { Orb } from "./Orb.tsx";
import "./TabBar.css";

/**
 * The floating topnav — modelled on the Possible Worlds site nav: a
 * fixed bar inset from the window edges, dotted border, rounded corners,
 * the orb motif glowing behind the wordmark on the left, pill-shaped
 * tab links on the right. `children` (the doc switcher) tucks in after
 * the tabs. */
export function TabBar(props: { children?: any }) {
  return (
    <nav class="topnav">
      <a href="https://possibleworlds.space/tools/tender" class="tender-logo" target="_blank" rel="noreferrer">
        <Orb />
        <span class="tender-wordmark">TENDER</span>
      </a>
      <div class="topnav-links">
        <A href="/" end class="topnav-link">Preview</A>
        <A href="/palette" class="topnav-link">Palette</A>
        <A href="/help" class="topnav-link">Help</A>
        <A href="/export" class="topnav-link">Export</A>
      </div>
      <div class="topnav-trailing">{props.children}</div>
    </nav>
  );
}
