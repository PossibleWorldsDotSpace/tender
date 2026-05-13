import "./Orb.css";

/**
 * The Possible Worlds "orb" motif — a cluster of blurred, gradient-filled
 * circles that sit behind the wordmark in the floating topnav. Ported from
 * the PW site's `.nav__logo-orbs`. Purely decorative (aria-hidden); the
 * cluster pulses gently on hover when wrapped in `.tender-logo`.
 */
export function Orb() {
  return (
    <span class="orb-cluster" aria-hidden="true">
      <span class="orb orb--magenta" />
      <span class="orb orb--lime" />
      <span class="orb orb--cyan" />
    </span>
  );
}
