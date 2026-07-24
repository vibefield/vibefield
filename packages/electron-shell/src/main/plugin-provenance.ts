import { type PluginRecord, PluginRegistrySnapshot } from "@vibefield/contracts";
import type { PluginLogProvenanceV1 } from "@vibefield/contracts/logging";
import { pluginLogProvenance } from "@vibefield/logging";

export type RendererPluginResolution =
  | { kind: "pending" }
  | { kind: "rejected" }
  | { kind: "resolved"; provenance: PluginLogProvenanceV1 };

export interface RendererPluginResolver {
  resolve(pluginId: string, windowId: string): RendererPluginResolution;
  onChange(listener: () => void): () => void;
}

interface RegistryClient {
  subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }>;
}

/** Electron's host-side view of fieldd's validated install registry. Renderer
 * bytes carry only an ID hint; this catalog supplies every persisted identity
 * field and rejects disabled, absent, or entry-less installs. */
export class RendererPluginProvenanceCatalog implements RendererPluginResolver {
  private readonly records = new Map<string, PluginRecord>();
  private readonly listeners = new Set<() => void>();
  private ready = false;

  invalidate(): void {
    this.records.clear();
    this.ready = false;
    for (const listener of this.listeners) listener();
  }

  update(raw: unknown): boolean {
    const parsed = PluginRegistrySnapshot.safeParse(raw);
    this.records.clear();
    this.ready = true;
    if (!parsed.success) {
      for (const listener of this.listeners) listener();
      return false;
    }
    for (const record of parsed.data.plugins) this.records.set(record.id, record);
    for (const listener of this.listeners) listener();
    return true;
  }

  resolve(pluginId: string, windowId: string): RendererPluginResolution {
    if (!this.ready) return { kind: "pending" };
    const record = this.records.get(pluginId);
    if (record === undefined) return { kind: "rejected" };
    const provenance = pluginLogProvenance(record, "renderer", windowId);
    return provenance === null ? { kind: "rejected" } : { kind: "resolved", provenance };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async observe(client: RegistryClient): Promise<() => void> {
    let eventReceived = false;
    const subscription = await client.subscribe("plugins.subscribe", {}, (payload) => {
      eventReceived = true;
      this.update(payload);
    });
    // The client installs the live route before resolving subscribe(). A
    // same-frame delta can therefore arrive before this continuation; never
    // overwrite that newer full-snapshot delta with the older reply snapshot.
    if (!eventReceived) this.update(subscription.snapshot);
    return subscription.unsubscribe;
  }
}
