import { mountVitals } from "@vibefield/field-app/vitals";

// VT-2 (track VT, 2026-11-24) — the Vitals window's document: field-app's Vitals view over the one stream its
// preload hands it. Nothing of the product mounts here.

const root = document.getElementById("root");
if (root === null) throw new Error("Vitals: #root missing from vitals.html");
mountVitals(root, { door: window.vibefieldVitals });
