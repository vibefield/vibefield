import type { PluginManifestV1 } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";

// PluginRendererContext (design-03 §4.3, P0 subset): everything a plugin's
// renderer code may touch. P0 passes the window's shared FielddClient through;
// per-plugin scoped tokens (D20 principal {kind:"plugin"}) arrive when plugins
// stop being built-ins. Widgets receive this via their plugin's closure —
// never from globals. C1c: the manifest is the canonical V1.

export interface PluginRendererContext {
  readonly manifest: PluginManifestV1;
  /** the product-plane client; null when the shell runs canvas-only (tests) */
  readonly client: FielddClient | null;
}

export function createRendererContext(
  manifest: PluginManifestV1,
  client: FielddClient | null,
): PluginRendererContext {
  return Object.freeze({ manifest, client });
}
