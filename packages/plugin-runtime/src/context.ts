import type { FielddClient } from "@vibefield/fieldd-client";
import type { PluginManifest } from "./manifest";

// PluginRendererContext (design-03 §4.3, P0 subset): everything a plugin's
// renderer code may touch. P0 passes the window's shared FielddClient through;
// per-plugin scoped tokens (D20 principal {kind:"plugin"}) arrive when plugins
// stop being built-ins. Widgets receive this via their plugin's closure —
// never from globals.

export interface PluginRendererContext {
  readonly manifest: PluginManifest;
  /** the product-plane client; null when the shell runs canvas-only (tests) */
  readonly client: FielddClient | null;
}

export function createRendererContext(
  manifest: PluginManifest,
  client: FielddClient | null,
): PluginRendererContext {
  return Object.freeze({ manifest, client });
}
