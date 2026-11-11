import { PluginsCatalog } from "@vibefield/contracts";

// THE PLUGINS POPUP'S PORT (MK-4a; DESIGN.md §8 "Plugins — the frame's second
// popup", "The read on open"): the two questions the popup asks, over this
// window's fieldd client — the list fieldd holds, at once
// (`plugins.catalog.get`), and the fresh read, once per opening
// (`plugins.catalog.refresh`, MK-D5: the person's act, on no timer). Every
// answer is parsed, never cast. The catalog hands the controller a fixture
// port instead; nothing here installs, removes or turns a plugin on or off.

export interface PluginsPort {
  /** The list fieldd holds, its state and its time. */
  catalog(): Promise<PluginsCatalog>;
  /** The fresh read: answers once the read has ended. */
  refresh(): Promise<PluginsCatalog>;
}

/** What the port asks of a fieldd client: one request door. */
export interface PluginsDoorClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export function pluginsPortOver(client: PluginsDoorClient): PluginsPort {
  return {
    async catalog() {
      return PluginsCatalog.parse(await client.request("plugins.catalog.get", {}));
    },
    async refresh() {
      return PluginsCatalog.parse(await client.request("plugins.catalog.refresh", {}));
    },
  };
}
