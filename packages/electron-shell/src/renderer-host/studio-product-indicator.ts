import type { AppearanceOverrideSource } from "@vibefield/field-app/appearance";

/** Development-only disclosure for the product side of a Studio preview. */
export function installStudioProductIndicator(source: AppearanceOverrideSource): () => void {
  const indicator = document.createElement("div");
  indicator.className = "vf-studio-product-indicator";
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-live", "polite");

  const render = (): void => {
    const snapshot = source.snapshot();
    if (snapshot.appearance === null) {
      indicator.remove();
      return;
    }
    indicator.textContent = `Studio preview · revision ${snapshot.revision}`;
    indicator.dataset.revision = String(snapshot.revision);
    indicator.dataset.magnetGlyph = snapshot.appearance.magnetGrid.glyph;
    indicator.dataset.magnetReach = String(snapshot.appearance.magnetGrid.reach);
    indicator.dataset.rimRadius = String(snapshot.appearance.overlapFeedback.rimRadius);
    if (!indicator.isConnected) document.body.append(indicator);
  };

  const unsubscribe = source.subscribe(render);
  render();
  return () => {
    unsubscribe();
    indicator.remove();
  };
}
