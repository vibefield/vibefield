import type { ProductAppearance } from "../appearance/product-appearance";

export interface DesignSystemStudioState {
  appearance: ProductAppearance;
  live: boolean;
  productConnection: "unavailable" | "connecting" | "connected" | "reconnecting";
  productContext: { theme: "light" | "dark"; zoom: number } | null;
  transportError:
    | "malformed"
    | "oversized"
    | "rate-limited"
    | "version-mismatch"
    | "transport-closed"
    | null;
  requestedSection: "design" | "appearance" | null;
  navigationRevision: number;
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
