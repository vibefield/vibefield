import type { ProductAppearance } from "../appearance/product-appearance";

export interface DesignSystemStudioState {
  appearance: ProductAppearance;
  live: boolean;
  productConnected: boolean;
  revision: number | null;
  appliedRevision: number | null;
  rejection: "invalid-document" | "stale-revision" | null;
}

export interface DesignSystemStudioController {
  snapshot(): DesignSystemStudioState;
  subscribe(listener: () => void): () => void;
  setAppearance(appearance: ProductAppearance): void;
  setLive(live: boolean): void;
  focusProduct(): void;
}
