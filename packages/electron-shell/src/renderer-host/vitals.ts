import { mountVitals } from "@vibefield/field-app/vitals";
import { drainPanelMeasures } from "./dev-measure-drain";

// VT-2 (track VT, 2026-11-24) — the Vitals window's document: field-app's Vitals view over the one stream its
// preload hands it. Nothing of the product mounts here.

// the window that watches the app's memory must not grow by its own redraw: see dev-measure-drain.ts
if (import.meta.env.DEV) drainPanelMeasures();
const root = document.getElementById("root");
if (root === null) throw new Error("Vitals: #root missing from vitals.html");
mountVitals(root, { door: window.vibefieldVitals });
