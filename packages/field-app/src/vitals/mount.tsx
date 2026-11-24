import { createRoot } from "react-dom/client";
import "@vibefield/design-kit/tokens.css";
import "./vitals.css";
import { Vitals } from "./Vitals";
import type { VitalsDoor } from "./vitals-feed";

// VT-2 (track VT, 2026-11-24) — the Vitals window's entry. It is not the product: it mounts no desk, holds no
// daemon token and imports none of the product's chunks, so the window that watches the app costs little of it.

export function mountVitals(container: HTMLElement, options: { door: VitalsDoor }): void {
  container.classList.add("vf-vitals-root");
  createRoot(container).render(<Vitals door={options.door} />);
}

export type { VitalsDoor, VitalsFeedEvent, VitalsLogOrigin } from "./vitals-feed";
