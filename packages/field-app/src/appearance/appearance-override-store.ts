import type { MagnetGridGlyph } from "../field/canvas-appearance";
import { defaultProductAppearance, type ProductAppearance } from "./product-appearance";
import { deserializeVisualTweaks, VisualTweakDocumentError } from "./product-appearance-document";

export type AppearanceRejectCode = "invalid-document" | "stale-revision";

export type AppearanceApplyResult =
  | { status: "applied"; revision: number }
  | { status: "rejected"; revision: number; code: AppearanceRejectCode };

export interface AppearanceOverrideSnapshot {
  /** Highest revision processed, including a rejected invalid document. */
  revision: number;
  appearance: ProductAppearance | null;
}

export interface AppearanceOverrideSource {
  snapshot(): AppearanceOverrideSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface AppearanceOverrideStore extends AppearanceOverrideSource {
  apply(revision: number, serialized: string): AppearanceApplyResult;
  clear(revision: number): AppearanceApplyResult;
}

/**
 * Atomic, constant-space development override. Parsing happens before the
 * visible value changes; a bad newer document leaves the last good appearance
 * active while still fencing a replay of that rejected revision.
 */
export function createAppearanceOverrideStore(): AppearanceOverrideStore {
  let current: AppearanceOverrideSnapshot = { revision: 0, appearance: null };
  const listeners = new Set<() => void>();

  const advance = (revision: number, appearance: ProductAppearance | null): void => {
    current = { revision, appearance };
    for (const listener of [...listeners]) listener();
  };

  const acceptRevision = (revision: number): AppearanceApplyResult | null => {
    if (!Number.isSafeInteger(revision) || revision <= current.revision) {
      return { status: "rejected", revision, code: "stale-revision" };
    }
    return null;
  };

  return {
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    apply(revision, serialized) {
      const rejected = acceptRevision(revision);
      if (rejected !== null) return rejected;
      try {
        advance(revision, deserializeVisualTweaks(serialized));
        return { status: "applied", revision };
      } catch (error) {
        // The public codec's exact messages are for import UI. The Studio
        // boundary exposes only a bounded reason code.
        if (!(error instanceof VisualTweakDocumentError)) throw error;
        current = { ...current, revision };
        return { status: "rejected", revision, code: "invalid-document" };
      }
    },
    clear(revision) {
      const rejected = acceptRevision(revision);
      if (rejected !== null) return rejected;
      advance(revision, null);
      return { status: "applied", revision };
    },
  };
}

/** Product preference is effective only in the absence of a full Studio override. */
export function effectiveProductAppearance(
  override: ProductAppearance | null,
  glyph: MagnetGridGlyph,
): ProductAppearance {
  if (override !== null) return override;
  const defaults = defaultProductAppearance();
  defaults.magnetGrid.glyph = glyph;
  return defaults;
}
