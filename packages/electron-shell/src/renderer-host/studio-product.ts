import { mountProductHost } from "./product-host";
import { createStudioProductAppearanceSource } from "./studio-product-appearance";
import { installStudioProductIndicator } from "./studio-product-indicator";
import "./studio-product.css";
import { drainPanelMeasures } from "./dev-measure-drain";

document.documentElement.dataset.vibefieldComposition = "vibefield-studio-product-only";

// History QA (2026-11-24): THIS is the document `pnpm dev` shows as the desk (the runner's product page), and it
// was left without the drain HQ-8 gave `index.ts`: measured in it, 574,861 of React's panel measures in under four
// minutes and the window at 2.3 GB. Every entry that mounts React drains them (test/dev-measure-drain.test.ts).
if (import.meta.env.DEV) drainPanelMeasures();
const appearance = createStudioProductAppearanceSource(window.vibefieldStudioAppearance);
const disposeIndicator = installStudioProductIndicator(appearance.source);
mountProductHost({
  appearanceOverrideSource: appearance.source,
  onPresentationContextChange: (context) => window.vibefieldStudioAppearance.reportContext(context),
  disposeAppearanceOverride: () => {
    disposeIndicator();
    appearance.dispose();
  },
});
