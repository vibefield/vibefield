// B1 spike page entry (test-only; built under VITE_SPIKE=1). The page is a
// shell harness; the implementation lives behind field-app's /spike export
// because only field-app carries the canvas dependencies it exercises.
import { drainPanelMeasures } from "./dev-measure-drain";

// React's development build keeps a measure for every redraw: see dev-measure-drain.ts
if (import.meta.env.DEV) drainPanelMeasures();

// biome-ignore-start assist/source/organizeImports: the spike mounts on import, after the drain
import "@vibefield/field-app/spike";
// biome-ignore-end assist/source/organizeImports: the spike mounts on import, after the drain
