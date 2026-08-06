import type {
  CanvasPalette,
  OverlapFeedbackColors,
  OverlapFeedbackTuning,
  VisualTweakValues,
  WorldGridTuning,
} from "../field/visual-tuning";
import { defaultVisualTweakValues } from "../field/visual-tuning";

export const VISUAL_TWEAK_DOCUMENT_KIND = "vibefield.visual-tweaks";
export const VISUAL_TWEAK_DOCUMENT_VERSION = 2;
export const VISUAL_TWEAK_FILE_NAME = "vibefield-visual-tweaks.json";

export interface VisualTweakDocumentV2 extends VisualTweakValues {
  kind: typeof VISUAL_TWEAK_DOCUMENT_KIND;
  version: typeof VISUAL_TWEAK_DOCUMENT_VERSION;
}

export class VisualTweakDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisualTweakDocumentError";
  }
}

export function visualTweakDocument(values: VisualTweakValues): VisualTweakDocumentV2 {
  return {
    kind: VISUAL_TWEAK_DOCUMENT_KIND,
    version: VISUAL_TWEAK_DOCUMENT_VERSION,
    canvasPalette: { ...values.canvasPalette },
    worldGrid: {
      spacings: [...values.worldGrid.spacings],
      dotAlpha: values.worldGrid.dotAlpha,
      fadeIn: [...values.worldGrid.fadeIn],
      fadeOut: [...values.worldGrid.fadeOut],
      dotRadius: [...values.worldGrid.dotRadius],
      levelWeight: [...values.worldGrid.levelWeight],
    },
    overlapFeedback: {
      colors: { ...values.overlapFeedback.colors },
      glowAlpha: [...values.overlapFeedback.glowAlpha],
      glowSize: [...values.overlapFeedback.glowSize],
      rimAlpha: [...values.overlapFeedback.rimAlpha],
      rimWidth: values.overlapFeedback.rimWidth,
      rimRadius: values.overlapFeedback.rimRadius,
    },
  };
}

/** Stable, human-editable export with every live visual-tuning property. */
export function serializeVisualTweaks(values: VisualTweakValues): string {
  return `${JSON.stringify(visualTweakDocument(values), null, 2)}\n`;
}

/**
 * Strict import: malformed or out-of-range values reject the whole file. A
 * partial import would make the resulting canvas impossible to reproduce.
 */
export function deserializeVisualTweaks(serialized: string): VisualTweakValues {
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
  const version = document["version"];
  if (version !== 1 && version !== VISUAL_TWEAK_DOCUMENT_VERSION) {
    throw new VisualTweakDocumentError(
      `Unsupported visual tweak version: ${String(document["version"])}.`,
    );
  }

  const palette = record(document["canvasPalette"], "canvasPalette");
  const overlap = record(document["overlapFeedback"], "overlapFeedback");
  const colors = record(overlap["colors"], "overlapFeedback.colors");

  const canvasPalette: CanvasPalette = {
    bgLight: hex(palette["bgLight"], "canvasPalette.bgLight"),
    bgDark: hex(palette["bgDark"], "canvasPalette.bgDark"),
    dotLight: hex(palette["dotLight"], "canvasPalette.dotLight"),
    dotDark: hex(palette["dotDark"], "canvasPalette.dotDark"),
  };
  const overlapColors: OverlapFeedbackColors = {
    glowLight: hex(colors["glowLight"], "overlapFeedback.colors.glowLight"),
    glowDark: hex(colors["glowDark"], "overlapFeedback.colors.glowDark"),
    rimLight: hex(colors["rimLight"], "overlapFeedback.colors.rimLight"),
    rimDark: hex(colors["rimDark"], "overlapFeedback.colors.rimDark"),
  };
  const overlapFeedback: OverlapFeedbackTuning = {
    colors: overlapColors,
    glowAlpha: pair(overlap["glowAlpha"], "overlapFeedback.glowAlpha", 0, 1),
    glowSize: pair(overlap["glowSize"], "overlapFeedback.glowSize", 0, 200),
    rimAlpha: pair(overlap["rimAlpha"], "overlapFeedback.rimAlpha", 0, 1),
    rimWidth: numberIn(overlap["rimWidth"], "overlapFeedback.rimWidth", 0, 6),
    // The reviewed default is 40, so zero is the honest lower bound even though
    // the old Settings field incorrectly declared a minimum of 50.
    rimRadius: numberIn(overlap["rimRadius"], "overlapFeedback.rimRadius", 0, 2_000),
  };

  // Version 1 predates World grid. Its other fields remain complete and strict;
  // migration supplies the reviewed grid defaults rather than inventing values.
  const worldGrid =
    version === 1
      ? defaultVisualTweakValues().worldGrid
      : parseWorldGrid(record(document["worldGrid"], "worldGrid"));

  return { canvasPalette, worldGrid, overlapFeedback };
}

function parseWorldGrid(grid: Record<string, unknown>): WorldGridTuning {
  return {
    spacings: triple(grid["spacings"], "worldGrid.spacings", 1, 100_000),
    dotAlpha: numberIn(grid["dotAlpha"], "worldGrid.dotAlpha", 0, 1),
    fadeIn: pair(grid["fadeIn"], "worldGrid.fadeIn", 0, 100_000),
    fadeOut: pair(grid["fadeOut"], "worldGrid.fadeOut", 0, 100_000),
    dotRadius: pair(grid["dotRadius"], "worldGrid.dotRadius", 0, 50),
    levelWeight: pair(grid["levelWeight"], "worldGrid.levelWeight", -10, 10),
  };
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

function numberIn(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new VisualTweakDocumentError(`${path} must be between ${min} and ${max}.`);
  }
  return value;
}

function pair(value: unknown, path: string, min: number, max: number): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new VisualTweakDocumentError(`${path} must contain candidate and target values.`);
  }
  return [numberIn(value[0], `${path}[0]`, min, max), numberIn(value[1], `${path}[1]`, min, max)];
}

function triple(value: unknown, path: string, min: number, max: number): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new VisualTweakDocumentError(`${path} must contain fine, medium, and coarse values.`);
  }
  return [
    numberIn(value[0], `${path}[0]`, min, max),
    numberIn(value[1], `${path}[1]`, min, max),
    numberIn(value[2], `${path}[2]`, min, max),
  ];
}
