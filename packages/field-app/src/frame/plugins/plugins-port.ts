import {
  type DeviceInfo,
  DeviceListResult,
  PluginsCatalog,
  PluginsInstallPrepareResult,
  SettingsGetResult,
} from "@vibefield/contracts";

// THE PLUGINS POPUP'S PORT (MK-4a; DESIGN.md §8 "Plugins — the frame's second
// popup", "The read on open"): the questions the popup asks, over this
// window's fieldd client — the list fieldd holds, at once
// (`plugins.catalog.get`), and the fresh read, once per opening
// (`plugins.catalog.refresh`, MK-D5: the person's act, on no timer). Every
// answer the popup shows is parsed, never cast. MK-4c2a adds a plugin's
// switches (§8 "Its switches"): its one switch (`plugins.enable` /
// `plugins.disable`) and a power's (`plugins.grants.set`), the requests
// Settings → Plugins sent (until N18), with the same parameters. Their answers are
// not read: the registry snapshot fieldd pushes next is the one truth the
// switches show (the P5 law), so a switch never moves on an answer. MK-4c2b
// adds a plugin's settings (§8 "Its settings"): a setting's value
// (`storage.settings.get`, a secret's never sent to a window) and its new value
// (`storage.settings.set`), the requests Settings → Plugins sent (until N18), with
// the same parameters. MK-4c2c adds a setting's way back (James's click,
// 2026-11-14 08:19:36Z, "Yes, add them to the plugin's page"):
// `storage.settings.reset`, the request Settings → Plugins' Reset sent (until
// N18), with the same parameters; fieldd answers it by setting the value back to its
// default, or, for a secret, by deleting the one it keeps. The port still has
// no undo and no redo (James's MK-O6 pick, 2026-11-11: no Undo on a plugin's
// page until there is one per plugin). The catalog hands the
// controller a fixture port instead. O2-C adds the install card's window half
// (§8 "Every install asks first", MK-O2's A2): the three doors MK-O2B built —
// `plugins.install.prepare` downloads and holds a plugin this desktop doesn't
// have and answers its row, which the card is read from; `commit` installs what
// the card showed; `discard` throws the download away — and this desktop's
// roster (`device.list`), which the card's desktops are read from. A commit's
// answer is not read: the snapshot fieldd pushes next says Installed (the P5
// law). MK-4f adds Remove… (`plugins.uninstall`, `{ id, removeData }`, the
// request Settings → Plugins' More + sent until MK-5): its answer is not read either; the
// snapshot that no longer holds the plugin is. MK-UC's UC-C adds an update's
// download (`plugins.install.prepare` with `update: true`, MK-UC's door, pinned
// to the version Updates' row showed): fieldd answers the downloaded row and,
// for an update, what it can do that the version you have can't. Its card's
// Update and Cancel are the install card's `commit` and `discard`.

export interface PluginsPort {
  /** The list fieldd holds, its state and its time. */
  catalog(): Promise<PluginsCatalog>;
  /** The fresh read: answers once the read has ended. */
  refresh(): Promise<PluginsCatalog>;
  /** Turn a plugin on (`plugins.enable`): settles when fieldd has answered. */
  enable(id: string): Promise<void>;
  /** Turn a plugin off (`plugins.disable`). */
  disable(id: string): Promise<void>;
  /** Give a plugin a power it asked for, or take it back (`plugins.grants.set`). */
  grant(id: string, capability: string, granted: boolean): Promise<void>;
  /** A setting's value as fieldd keeps it, or its default, unset; a secret's says only whether one is kept. */
  settingsGet(id: string, key: string): Promise<SettingsGetResult>;
  /** Keep a setting's new value: settles when fieldd has answered. */
  settingsSet(id: string, key: string, value: unknown): Promise<void>;
  /** MK-4c2c: set a setting back to its default, or delete a kept secret (`storage.settings.reset`): settles when
   * fieldd has answered. */
  settingsReset(id: string, key: string): Promise<void>;
  /** O2-C: download, check and hold a plugin this desktop doesn't have; its card is read from the row. */
  prepare(id: string): Promise<PluginsInstallPrepareResult>;
  /** MK-UC's UC-C: download, check and hold `version` of a plugin this desktop has; the answer says what it can do
   * that the version you have can't (`update.asksFor`). */
  prepareUpdate(id: string, version: string): Promise<PluginsInstallPrepareResult>;
  /** O2-C: install what the card showed: settles when fieldd has answered. */
  commit(candidate: string): Promise<void>;
  /** O2-C: throw a card's download away. */
  discard(candidate: string): Promise<void>;
  /** O2-C: this desktop's roster, which the card's desktops are read from. */
  desktops(): Promise<readonly DeviceInfo[]>;
  /** MK-4f: remove a plugin from every desktop (`plugins.uninstall`), its settings and data deleted on this one
   * alone when `removeData`: settles when fieldd has answered. */
  uninstall(id: string, removeData: boolean): Promise<void>;
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
    async enable(id) {
      await client.request("plugins.enable", { id });
    },
    async disable(id) {
      await client.request("plugins.disable", { id });
    },
    async grant(id, capability, granted) {
      await client.request("plugins.grants.set", { id, capability, granted });
    },
    async settingsGet(id, key) {
      return SettingsGetResult.parse(
        await client.request("storage.settings.get", { pluginId: id, key }),
      );
    },
    async settingsSet(id, key, value) {
      await client.request("storage.settings.set", { pluginId: id, key, value });
    },
    async settingsReset(id, key) {
      await client.request("storage.settings.reset", { pluginId: id, key });
    },
    async prepare(id) {
      return PluginsInstallPrepareResult.parse(
        await client.request("plugins.install.prepare", { id }),
      );
    },
    async prepareUpdate(id, version) {
      return PluginsInstallPrepareResult.parse(
        await client.request("plugins.install.prepare", { id, version, update: true }),
      );
    },
    async commit(candidate) {
      await client.request("plugins.install.commit", { candidate });
    },
    async discard(candidate) {
      await client.request("plugins.install.discard", { candidate });
    },
    async desktops() {
      return DeviceListResult.parse(await client.request("device.list", {})).devices;
    },
    async uninstall(id, removeData) {
      await client.request("plugins.uninstall", { id, removeData });
    },
  };
}
