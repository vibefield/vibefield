import { mountProductHost } from "./product-host";
import { createStudioProductAppearanceSource } from "./studio-product-appearance";

document.documentElement.dataset.vibefieldComposition = "vibefield-studio-product-only";

const appearance = createStudioProductAppearanceSource(window.vibefieldStudioAppearance);
mountProductHost({
  appearanceOverrideSource: appearance.source,
  disposeAppearanceOverride: appearance.dispose,
});
