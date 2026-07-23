import { PluginsOpenRendererSessionResult } from "@vibefield/contracts";
import { FielddClient } from "@vibefield/fieldd-client";
import type { PluginProductClient } from "@vibefield/plugin-sdk";

// P3b — plugin-bound product clients (§11.2): every plugin call rides its OWN
// connection whose bearer token is a short-lived, plugin-scoped lease minted
// by plugins.openRendererSession. fieldd derives {kind:"local-token"} scoped
// to the plugin's grant — attribution AND enforcement, not the window's
// shared principal. The credential lives inside this module's closures; it is
// never a context property and never persisted (§11.2).
//
// The backend (the window's own client) arrives from FieldView once the spine
// connection exists; before that — and whenever fieldd is away — plugin calls
// reject honestly. Leases renew ~60s before expiry; the retired connection is
// closed, in-flight calls on it complete or fail on their own terms.

interface LeaseEntry {
  client: FielddClient;
  expiresAt: number;
}

let backend: { windowClient: FielddClient } | null = null;
const leased = new Map<string, LeaseEntry>();
const inflight = new Map<string, Promise<FielddClient>>();

export function setPluginClientBackend(next: { windowClient: FielddClient } | null): void {
  backend = next;
  if (next === null) {
    for (const entry of leased.values()) entry.client.close();
    leased.clear();
    inflight.clear();
  }
}

async function leasedClient(pluginId: string): Promise<FielddClient> {
  const current = backend;
  if (current === null)
    throw new Error(`plugin ${pluginId}: no fieldd connection (daemon away or still booting)`);
  const existing = leased.get(pluginId);
  if (existing !== undefined && Date.now() < existing.expiresAt - 60_000) return existing.client;
  const pending = inflight.get(pluginId);
  if (pending !== undefined) return pending;
  const lease = (async () => {
    const raw = await current.windowClient.request("plugins.openRendererSession", { pluginId });
    const parsed = PluginsOpenRendererSessionResult.safeParse(raw);
    if (!parsed.success)
      throw new Error(`plugin ${pluginId}: unreadable lease (${parsed.error.issues[0]?.message})`);
    existing?.client.close(); // retire the dying connection only once the new lease is real
    const client = new FielddClient({
      url: current.windowClient.url,
      token: parsed.data.token,
      clientKind: "renderer",
    });
    client.connect();
    leased.set(pluginId, { client, expiresAt: parsed.data.expiresAt });
    return client;
  })();
  inflight.set(pluginId, lease);
  try {
    return await lease;
  } finally {
    inflight.delete(pluginId);
  }
}

/** The ctx.client the harness hands a plugin — lazy: no lease, no connection
 * until the plugin actually calls. */
export function createPluginProductClient(pluginId: string): PluginProductClient {
  return {
    async request(method: string, params?: unknown): Promise<unknown> {
      const client = await leasedClient(pluginId);
      return client.request(method, params);
    },
    async subscribe(
      method: string,
      params: unknown,
      onEvent: (payload: unknown) => void,
    ): Promise<{ snapshot: unknown; unsubscribe: () => void }> {
      const client = await leasedClient(pluginId);
      const sub = await client.subscribe(method, params, (payload) => onEvent(payload));
      return { snapshot: sub.snapshot, unsubscribe: sub.unsubscribe };
    },
  };
}
