import { mountProductHost } from "./product-host";
import { createStudioProductAppearanceSource } from "./studio-product-appearance";
import { installStudioProductIndicator } from "./studio-product-indicator";
import "./studio-product.css";

document.documentElement.dataset.vibefieldComposition = "vibefield-studio-product-only";

const appearance = createStudioProductAppearanceSource(window.vibefieldStudioAppearance);
const disposeIndicator = installStudioProductIndicator(appearance.source);
mountProductHost({
  appearanceOverrideSource: appearance.source,
  disposeAppearanceOverride: () => {
    disposeIndicator();
    appearance.dispose();
  },
});
