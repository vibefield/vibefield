import { drainPanelMeasures } from "./dev-measure-drain";
import { mountProductHost } from "./product-host";

// the literal `import.meta.env.DEV` folds to false in `vite build`, so a packaged renderer carries no drain
if (import.meta.env.DEV) drainPanelMeasures();
mountProductHost();
