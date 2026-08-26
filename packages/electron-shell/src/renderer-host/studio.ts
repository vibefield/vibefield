import { mountDesignSystem } from "@vibefield/field-app/design-system";

// Production verification scans for this marker. The production renderer has
// no Studio input, so its presence there is always a build-graph regression.
document.documentElement.dataset.vibefieldSurface = "vibefield-studio-only";

const root = document.getElementById("root");
if (root === null) throw new Error("Studio: #root missing from studio.html");

mountDesignSystem(root);
