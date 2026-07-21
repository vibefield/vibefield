import { CARD_BG } from "./CardShell";

// Mini/preview silhouette backgrounds (widgetlab preview.ts, reshaped by P-3):
// widgetlab kept a hardcoded map from widget type → the CSS its card really
// renders. VibeField's single source is the plugin MANIFEST
// (`WidgetDecl.preview`) — the spine registers every manifest preview here at
// boot (FieldView buildRegistry), and folder minis + tray fallbacks read ONE
// helper. Chromeless GL widgets get the glassy fill (widgetlab constant).

const GL_FLOATING_BG = "rgba(165, 175, 225, 0.18)";

const backgrounds = new Map<string, string>();

/** Spine-side wiring: called once per manifest widget entry that declares `preview`. */
export function setPreviewBackground(type: string, css: string): void {
  backgrounds.set(type, css);
}

/** Background for a mini: the card's declared look, else the shell default. */
export function previewBackground(
  type: string | undefined,
  surface: "dom" | "gl" | undefined,
): string {
  if (type !== undefined) {
    const hit = backgrounds.get(type);
    if (hit !== undefined) return hit;
  }
  return surface === "gl" ? GL_FLOATING_BG : CARD_BG;
}
