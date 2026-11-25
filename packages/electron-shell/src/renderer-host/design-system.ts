import { mountDesignSystem } from "@vibefield/field-app/design-system";
import { drainPanelMeasures } from "./dev-measure-drain";

// A production-build verifier scans for this side-effect marker. If this entry
// is ever pulled into the shipping renderer graph, the normal build fails
// instead of quietly packaging catalog fixtures and controls.
document.documentElement.dataset.vibefieldSurface = "vibefield-design-catalog-only";

// React's development build keeps a measure for every redraw: see dev-measure-drain.ts
if (import.meta.env.DEV) drainPanelMeasures();
const root = document.getElementById("root");
if (root === null) throw new Error("design system: #root missing from design-system.html");

mountDesignSystem(root);
