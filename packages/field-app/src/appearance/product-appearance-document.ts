import type { CanvasPalette, ProductAppearance } from "./product-appearance";

export const VISUAL_TWEAK_DOCUMENT_KIND = "vibefield.visual-tweaks";
export const VISUAL_TWEAK_DOCUMENT_VERSION = 4;
export const VISUAL_TWEAK_FILE_NAME = "vibefield-visual-tweaks.json";

/** Every version this reader opens: 4 writes, and 1–3 are read past what retired (below). */
const READABLE_VERSIONS: readonly unknown[] = [1, 2, 3, VISUAL_TWEAK_DOCUMENT_VERSION];

export interface VisualTweakDocumentV4 extends ProductAppearance {
  kind: typeof VISUAL_TWEAK_DOCUMENT_KIND;
  version: typeof VISUAL_TWEAK_DOCUMENT_VERSION;
}

export class VisualTweakDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisualTweakDocumentError";
  }
}

export function visualTweakDocument(values: ProductAppearance): VisualTweakDocumentV4 {
  return {
    kind: VISUAL_TWEAK_DOCUMENT_KIND,
    version: VISUAL_TWEAK_DOCUMENT_VERSION,
    canvasPalette: { ...values.canvasPalette },
  };
}

/** Stable, human-editable export with every live visual-tuning property. */
export function serializeVisualTweaks(values: ProductAppearance): string {
  return `${JSON.stringify(visualTweakDocument(values), null, 2)}\n`;
}

/**
 * Strict import of what the desk still draws: a malformed or out-of-range ground rejects the whole
 * file, because a partial import would make the resulting canvas impossible to reproduce.
 *
 * TOLERANT of what retired (DK-17, v3 → v4): versions 1–3 carry the 0.11 ground's tuning — `worldGrid`
 * (v2, v3), `magnetGrid` (v3) and the grid's inks in the palette (`dotLight`, `dotDark`,
 * `magnetDotDark`) — and the DOM card's `overlapFeedback`. Nothing on the desk draws any of them, so the
 * reader reads past them, valid or not: a v3 export (James's machines hold them) still imports, and
 * yields exactly its ground.
 */
export function deserializeVisualTweaks(serialized: string): ProductAppearance {
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new VisualTweakDocumentError("The selected file is not valid JSON.");
  }

  const document = record(raw, "document");
  if (document["kind"] !== VISUAL_TWEAK_DOCUMENT_KIND) {
    throw new VisualTweakDocumentError(`Expected kind "${VISUAL_TWEAK_DOCUMENT_KIND}".`);
  }
  if (!READABLE_VERSIONS.includes(document["version"])) {
    throw new VisualTweakDocumentError(
      `Unsupported visual tweak version: ${String(document["version"])}.`,
    );
  }

  const palette = record(document["canvasPalette"], "canvasPalette");
  const canvasPalette: CanvasPalette = {
    bgLight: hex(palette["bgLight"], "canvasPalette.bgLight"),
    bgDark: hex(palette["bgDark"], "canvasPalette.bgDark"),
  };
  return { canvasPalette };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VisualTweakDocumentError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function hex(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new VisualTweakDocumentError(`${path} must be a six-digit hex color.`);
  }
  return value.toUpperCase();
}
