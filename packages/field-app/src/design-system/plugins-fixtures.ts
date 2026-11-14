import {
  DeviceListResult,
  PluginRecord,
  PluginRegistrySnapshot,
  PluginsCatalog,
  PluginsInstallPrepareResult,
  SettingsGetResult,
} from "@vibefield/contracts";
import type { PluginsPort } from "../frame/plugins/plugins-port";

// The Plugins popup's fixtures (MK-4a; DESIGN.md §8 "Plugins — the frame's
// second popup"): data the catalog hands the SHIPPING controller in place of
// what the frame supplies — a port answering the two doors as a fieldd would
// in each state of the read, and the plugins a desktop has. Every value is
// parsed by the contracts at load, so a fixture that drifts from the wire
// fails here, never on screen. MK-4c2a: the port also answers a plugin's
// switches — at once, with a refusal, or never — and moves nothing itself, as
// fieldd's answer moves nothing: the snapshot a plate or a test hands next
// does. MK-4c2b: the port also keeps a plugin's settings, as fieldd answers a
// window — a secret only as kept or not, never its value. O2-C: the port also
// answers an install — the row fieldd would answer for a download, this
// desktop's roster, and the install itself — and moves nothing. MK-UC's UC-C:
// a list held with three updates for plugins the desktop has from it (one that
// needs a newer VibeField), and what an update's download answers — the row and
// what it can do that the version you have can't. No fieldd, no network, no
// child.

/** The clock every plate reads: twelve minutes after its list was read. */
export const PLUGINS_FIXTURE_READ_AT = 1762823100000;
export const PLUGINS_FIXTURE_NOW = PLUGINS_FIXTURE_READ_AT + 12 * 60_000;

const PIN = `sha256:${"a".repeat(64)}`;

const NO_LIST = { checkedAt: null, plugins: [], featured: [], updates: 0 } as const;

export const CATALOG_FIXTURES = {
  unconfigured: PluginsCatalog.parse({ state: "unconfigured", ...NO_LIST }),
  unread: PluginsCatalog.parse({ state: "unread", ...NO_LIST }),
  unreachable: PluginsCatalog.parse({ state: "unreachable", ...NO_LIST }),
  refused: PluginsCatalog.parse({ state: "refused", ...NO_LIST }),
  /** A list held (a state no build reaches today: none configures a registry). */
  ready: PluginsCatalog.parse({
    state: "ready",
    checkedAt: PLUGINS_FIXTURE_READ_AT,
    featured: ["vibefield.simulator"],
    updates: 0,
    plugins: [
      {
        id: "vibefield.simulator",
        listedAs: "vibefield",
        latest: {
          version: "1.2.0",
          artifactUrl: "artifacts/vibefield.simulator-1.2.0.vfplugin",
          sha256: PIN,
          minApp: "0.9.0",
          minContracts: "0.1.0",
          publishedAt: PLUGINS_FIXTURE_READ_AT,
        },
        compatible: true,
        listing: {
          title: "Simulators",
          summary: "An iPhone, an iPad and a Watch, live on your desk.",
          publisherName: "VibeField",
          objects: [
            { type: "vibefield.simulator.phone", label: "Phone", category: "devices" },
            { type: "vibefield.simulator.tablet", label: "Tablet", category: "devices" },
            { type: "vibefield.simulator.watch", label: "Watch", category: "devices" },
          ],
        },
      },
    ],
  }),
} as const;

/** A list held that also lists a community plugin this desktop has (MK-4c's
 * page plate): its maker and its own words come from here alone. */
export const CATALOG_LISTED = PluginsCatalog.parse({
  ...CATALOG_FIXTURES.ready,
  plugins: [
    ...CATALOG_FIXTURES.ready.plugins,
    {
      id: "acme.kanban",
      listedAs: "community",
      latest: {
        version: "2.1.0",
        artifactUrl: "artifacts/acme.kanban-2.1.0.vfplugin",
        sha256: PIN,
        minApp: "0.9.0",
        minContracts: "0.1.0",
        publishedAt: PLUGINS_FIXTURE_READ_AT,
      },
      compatible: true,
      listing: {
        title: "Kanban",
        summary: "A board and its cards, for the work on your desk.",
        publisherName: "Acme Tools",
        objects: [
          { type: "acme.kanban.board", label: "Board", category: "things" },
          { type: "acme.kanban.card", label: "Card", category: "things" },
        ],
      },
    },
  ],
});

/** A release the list pins, as a fixture entry's `latest`. */
function release(id: string, version: string): Record<string, unknown> {
  return {
    version,
    artifactUrl: `artifacts/${id}-${version}.vfplugin`,
    sha256: PIN,
    minApp: "0.9.0",
    minContracts: "0.1.0",
    publishedAt: PLUGINS_FIXTURE_READ_AT,
  };
}

/** A list held with sets to show (MK-4e's shelf plates): Simulators, featured, which this desktop has as a
 * Built in plugin; Desk things, four objects it doesn't have; Burndown, which needs a newer VibeField; Kanban, a
 * community set, shown only while community plugins are on; and one the list holds with no listing, never
 * shown. */
export const CATALOG_SHELF = PluginsCatalog.parse({
  ...CATALOG_LISTED,
  plugins: [
    ...CATALOG_LISTED.plugins,
    {
      id: "vibefield.desk-things",
      listedAs: "vibefield",
      latest: release("vibefield.desk-things", "1.0.0"),
      compatible: true,
      listing: {
        title: "Desk things",
        summary: "Small things that keep time and measure, for the desk.",
        publisherName: "VibeField",
        objects: [
          { type: "vibefield.desk-things.clock", label: "Clock", category: "things" },
          { type: "vibefield.desk-things.calendar", label: "Calendar", category: "things" },
          { type: "vibefield.desk-things.timer", label: "Timer", category: "things" },
          { type: "vibefield.desk-things.ruler", label: "Ruler", category: "tools" },
        ],
        tools: 0,
        services: 0,
      },
    },
    {
      id: "vibefield.burndown",
      listedAs: "vibefield",
      latest: release("vibefield.burndown", "0.7.0"),
      compatible: false,
      listing: {
        title: "Burndown",
        summary: "How much is left, drawn as it goes.",
        objects: [{ type: "vibefield.burndown.chart", label: "Burndown", category: "things" }],
      },
    },
    {
      id: "acme.unlisted",
      listedAs: "community",
      latest: release("acme.unlisted", "0.1.0"),
      compatible: true,
    },
  ],
});

/** How a plate's fixture port answers: a list, a door that fails, or a read
 * still under way (it never ends, so the plate holds the reading state). */
export interface PluginsFixtureRead {
  readonly catalog: PluginsCatalog | "fails";
  readonly refresh: PluginsCatalog | "fails" | "pending";
}

/** How a plate's fixture port answers a switch (MK-4c2a): at once, with a
 * refusal, or never (the switch stays under way). */
export type PluginsFixtureActs = "answers" | "refuses" | "pending";

/** The text a fixture's refusal carries: a page never says it (§8 "Its
 * switches": a refusal is said in §9's words, never the error's own text). */
export const PLUGINS_FIXTURE_REFUSAL = "fixture refusal: PLUGIN_STATE_CONFLICT at registry row 7";

/** The text a fixture's refused read carries (MK-4c2b, Unread): a made-up phrase a page never
 * says. */
export const PLUGINS_FIXTURE_READ_REFUSAL = "fixture read refusal: SETTING_UNREADABLE at row 4";

/** One setting a fixture's fieldd keeps (MK-4c2b): a value, or, for a secret, only whether one is kept. A key it
 * keeps nothing for answers unset, and the page shows the declared default. */
export interface PluginsFixtureSetting {
  readonly value?: unknown;
  readonly secret?: boolean;
  readonly kept?: boolean;
  /** fieldd refuses to read it (§8 Its settings, Unread), with the made-up text above */
  readonly unread?: boolean;
}

/** What a fixture's fieldd keeps of each plugin's settings, by plugin and key. */
export type PluginsFixtureSettings = Readonly<
  Record<string, Readonly<Record<string, PluginsFixtureSetting>>>
>;

/** How a plate's fixture port answers an install (O2-C): its download (`prepare`, which answers the row
 * `PLUGINS_FIXTURE_DOWNLOADS` holds for a plugin, and refuses any other) and its install (`commit`), each at once,
 * with a refusal, or never. Either answers at once when not said. */
export interface PluginsFixtureInstall {
  readonly prepare?: PluginsFixtureActs;
  readonly commit?: PluginsFixtureActs;
  /** MK-4f: a removal (`uninstall`), which moves nothing either */
  readonly uninstall?: PluginsFixtureActs;
}

/** The handle a fixture's download answers with: fieldd's opaque candidate, as its shape holds it. */
export const PLUGINS_FIXTURE_CANDIDATE = "c".repeat(32);

export function pluginsFixturePort(
  read: PluginsFixtureRead,
  acts: PluginsFixtureActs = "answers",
  settings: PluginsFixtureSettings = {},
  install: PluginsFixtureInstall = {},
): PluginsPort {
  const answer = (value: PluginsCatalog | "fails"): Promise<PluginsCatalog> =>
    value === "fails"
      ? Promise.reject(new Error("the fixture's door does not answer"))
      : Promise.resolve(value);
  const settle = <T>(how: PluginsFixtureActs, value: T): Promise<T> =>
    how === "answers"
      ? Promise.resolve(value)
      : how === "refuses"
        ? Promise.reject(new Error(PLUGINS_FIXTURE_REFUSAL))
        : new Promise<T>(() => undefined);
  const act = (): Promise<void> => settle(acts, undefined);
  // this port's own copy, so a set on one plate or test never reaches another
  const kept = new Map<string, PluginsFixtureSetting>(
    Object.entries(settings).flatMap(([id, keys]) =>
      Object.entries(keys).map(([key, entry]) => [`${id}/${key}`, entry] as const),
    ),
  );
  return {
    catalog: () => answer(read.catalog),
    refresh: () =>
      read.refresh === "pending"
        ? new Promise<PluginsCatalog>(() => undefined)
        : answer(read.refresh),
    enable: act,
    disable: act,
    grant: act,
    settingsGet: async (id, key) => {
      const entry = kept.get(`${id}/${key}`);
      if (entry?.unread === true) throw new Error(PLUGINS_FIXTURE_READ_REFUSAL);
      if (entry?.secret === true) {
        return SettingsGetResult.parse({ isSet: entry.kept === true, secret: true });
      }
      return SettingsGetResult.parse(
        entry?.value === undefined ? { isSet: false } : { isSet: true, value: entry.value },
      );
    },
    settingsSet: (id, key, value) =>
      act().then(() => {
        const was = kept.get(`${id}/${key}`);
        // a secret is kept as kept, never as its value
        kept.set(`${id}/${key}`, was?.secret === true ? { secret: true, kept: true } : { value });
      }),
    prepare: (id) => {
      const record = PLUGINS_FIXTURE_DOWNLOADS[id];
      if (record === undefined) return Promise.reject(new Error(PLUGINS_FIXTURE_REFUSAL));
      const prepared = PluginsInstallPrepareResult.parse({
        candidate: PLUGINS_FIXTURE_CANDIDATE,
        record,
      });
      return settle(install.prepare ?? "answers", prepared);
    },
    // MK-UC's UC-C: an update's download answers the row and what it can do that the version you have can't, as
    // fieldd's does; the version a row pins must be the one the fixture holds
    prepareUpdate: (id, version) => {
      const download = PLUGINS_FIXTURE_UPDATE_DOWNLOADS[id];
      if (download === undefined || download.record.version !== version) {
        return Promise.reject(new Error(PLUGINS_FIXTURE_REFUSAL));
      }
      const prepared = PluginsInstallPrepareResult.parse({
        candidate: PLUGINS_FIXTURE_CANDIDATE,
        record: download.record,
        update: { from: download.from, asksFor: download.asksFor },
      });
      return settle(install.prepare ?? "answers", prepared);
    },
    // an install moves nothing here, as fieldd's answer moves nothing: only a snapshot does
    commit: () => settle(install.commit ?? "answers", undefined),
    discard: () => Promise.resolve(),
    desktops: () => Promise.resolve(PLUGINS_FIXTURE_ROSTER),
    uninstall: () => settle(install.uninstall ?? "answers", undefined),
  };
}

/** One of a plugin's objects, as its manifest declares it; `label`, its name
 * tag on the pegboard, when it hangs there under a name of its own. */
function object(title: string, kind: string, label?: string): Record<string, unknown> {
  const hang = { w: 110, h: 140, accessory: "hook", pegs: [[0, -0.5]] };
  return {
    type: kind,
    title,
    schemaVersion: 1,
    size: { w: 220, h: 280 },
    binding: { kind },
    ...(label !== undefined ? { tray: { category: "devices", label, hang } } : {}),
  };
}

function record(fields: {
  id: string;
  title: string;
  version: string;
  source: "bundled" | "dev-linked" | "sideload" | "registry";
  enabled?: boolean;
  objects?: readonly Record<string, unknown>[];
  service?: "none" | "active";
  /** the powers it holds (MK-4c's page plates) */
  granted?: readonly string[];
  /** the powers fieldd denies it, and why (MK-4c2a's switch plates) */
  denied?: readonly { capability: string; reason: string }[];
  /** the powers it asked for, when not every one it holds and every one denied (an off plugin holds none) */
  requested?: readonly string[];
  /** powers of its own it declares */
  declares?: readonly Record<string, unknown>[];
  /** tools for your agents it brings */
  tools?: readonly Record<string, unknown>[];
  /** what a registry plugin's folder says of itself: a display copy no page reads (item 321) */
  registry?: Record<string, unknown>;
  /** the settings it declares, by key (MK-4c2b's plates) */
  settings?: Record<string, Record<string, unknown>>;
}): Record<string, unknown> {
  const enabled = fields.enabled ?? true;
  const granted = fields.granted ?? [];
  const denied = fields.denied ?? [];
  return {
    id: fields.id,
    version: fields.version,
    title: fields.title,
    source: fields.source,
    manifestHash: PIN,
    installRevision: "fixture",
    ...(fields.registry !== undefined ? { registry: fields.registry } : {}),
    state: enabled ? "enabled" : "disabled",
    compatible: true,
    enabled,
    requestedCapabilities: fields.requested ?? [...granted, ...denied.map((d) => d.capability)],
    grantedCapabilities: granted,
    deniedCapabilities: denied,
    contributions: {
      objects: fields.objects ?? [],
      commands: [],
      surfaces: [],
      capabilities: fields.declares ?? [],
      ...(fields.tools !== undefined ? { mcp: { tools: fields.tools, servers: [] } } : {}),
      ...(fields.settings !== undefined ? { settings: { properties: fields.settings } } : {}),
    },
    renderer: (fields.objects ?? []).length > 0 ? "active" : "none",
    service: fields.service ?? "none",
  };
}

/** The plugins a desktop has: two that come with VibeField, one in
 * development, turned off, and one sideloaded that runs a service. */
export const PLUGINS_FIXTURE_SNAPSHOT = PluginRegistrySnapshot.parse({
  generation: 1,
  problems: [],
  plugins: [
    record({
      id: "vibefield.simulator",
      title: "Simulators",
      version: "1.2.0",
      source: "bundled",
      objects: [
        object("Phone", "SimPhone"),
        object("Tablet", "SimTablet"),
        object("Watch", "SimWatch", "Apple Watch"),
      ],
      granted: ["surface.capture", "canvas.read"],
    }),
    record({
      id: "vibefield.comment-pad",
      title: "Comment pad",
      version: "0.1.0",
      source: "bundled",
      objects: [object("Comment pad", "commentPad")],
    }),
    record({
      id: "example.desk-clock",
      title: "Desk clock",
      version: "0.3.0",
      source: "dev-linked",
      enabled: false,
      objects: [object("Clock", "DeskClock")],
    }),
    record({
      id: "example.kv-service",
      title: "Key-value store",
      version: "0.2.0",
      source: "sideload",
      service: "active",
    }),
  ],
});

/** The same desktop with a community plugin from the list (MK-4c's page
 * plate): it adds two objects, brings a tool for your agents and holds a power
 * it names itself. Its folder calls its maker "Someone Else", which no page
 * reads: the list held calls it "Acme Tools". */
export const PLUGINS_FIXTURE_LISTED_SNAPSHOT = PluginRegistrySnapshot.parse({
  generation: 2,
  problems: [],
  plugins: [
    ...PLUGINS_FIXTURE_SNAPSHOT.plugins,
    record({
      id: "acme.kanban",
      title: "Kanban",
      version: "2.1.0",
      source: "registry",
      objects: [object("Board", "AcmeBoard", "Board"), object("Card", "AcmeCard", "Card")],
      granted: ["canvas.write", "x.acme.kanban.sync"],
      declares: [
        {
          id: "x.acme.kanban.sync",
          title: "Keep your boards in step",
          description: "Copies a board's cards to the boards you share.",
          risk: "write",
        },
      ],
      tools: [
        {
          name: "add_card",
          title: "Add a card",
          description: "Adds a card to a board.",
          method: "cards.add",
        },
      ],
      registry: {
        indexRef: "index.json",
        artifactSha256: `sha256:${"b".repeat(64)}`,
        publisher: "acme",
        publisherName: "Someone Else",
      },
    }),
  ],
});

/** The same desktop as its powers' switches show it (MK-4c2a's switch plates):
 * Simulators, on, holds two powers, had one taken back, and asked for one its
 * kind of plugin can't have; Desk clock, in development and off, asked for two,
 * one taken back. Each record says what fieldd's would: an off plugin holds no
 * power, and every power it asked for is held or denied. */
export const PLUGINS_FIXTURE_SWITCHES_SNAPSHOT = PluginRegistrySnapshot.parse({
  generation: 3,
  problems: [],
  plugins: [
    record({
      id: "vibefield.simulator",
      title: "Simulators",
      version: "1.2.0",
      source: "bundled",
      objects: [
        object("Phone", "SimPhone"),
        object("Tablet", "SimTablet"),
        object("Watch", "SimWatch", "Apple Watch"),
      ],
      granted: ["surface.capture", "canvas.read"],
      denied: [
        { capability: "canvas.write", reason: "revoked" },
        { capability: "process.spawn", reason: "entry-kind" },
      ],
      requested: ["surface.capture", "canvas.read", "canvas.write", "process.spawn"],
    }),
    record({
      id: "vibefield.comment-pad",
      title: "Comment pad",
      version: "0.1.0",
      source: "bundled",
      objects: [object("Comment pad", "commentPad")],
    }),
    record({
      id: "example.desk-clock",
      title: "Desk clock",
      version: "0.3.0",
      source: "dev-linked",
      enabled: false,
      objects: [object("Clock", "DeskClock")],
      denied: [{ capability: "net.outbound", reason: "revoked" }],
      requested: ["canvas.read", "net.outbound"],
    }),
    record({
      id: "example.kv-service",
      title: "Key-value store",
      version: "0.2.0",
      source: "sideload",
      service: "active",
    }),
  ],
});

/** The same desktop as a plugin's settings show it (MK-4c2b's plates): Simulators, on, declares one setting of
 * each kind the page draws, and one it can't; Desk clock, in development and off, one that syncs; Comment pad, on,
 * one kept on this desktop alone; a plugin from the list and a Sideloaded one declare settings their read-only pages
 * never show or ask for (U2). */
export const PLUGINS_FIXTURE_SETTINGS_SNAPSHOT = PluginRegistrySnapshot.parse({
  generation: 4,
  problems: [],
  plugins: [
    record({
      id: "vibefield.simulator",
      title: "Simulators",
      version: "1.2.0",
      source: "bundled",
      objects: [object("Phone", "SimPhone"), object("Tablet", "SimTablet")],
      settings: {
        showFrame: {
          title: "Show each device's frame",
          description: "The bezel around its screen.",
          scope: "user",
          schema: { type: "boolean", default: true },
        },
        phone: {
          title: "Phone to show",
          scope: "user",
          schema: { type: "string", enum: ["iPhone 17", "iPhone 17 Pro", "iPhone Air"] },
        },
        frameRate: {
          title: "Frames each second",
          description: "How often a screen is drawn on your desk.",
          scope: "device",
          schema: { type: "integer", minimum: 1, maximum: 60, default: 30 },
        },
        caption: {
          title: "Caption under each device",
          scope: "user",
          schema: { type: "string", default: "" },
        },
        token: {
          title: "Account token",
          description: "Kept on this Mac.",
          scope: "secret",
          schema: { type: "string" },
        },
        sizes: {
          title: "Screen sizes",
          scope: "user",
          schema: { type: "array" },
        },
      },
    }),
    record({
      id: "vibefield.comment-pad",
      title: "Comment pad",
      version: "0.1.0",
      source: "bundled",
      objects: [object("Comment pad", "commentPad")],
      settings: {
        resolved: {
          title: "Show resolved comments",
          scope: "device",
          schema: { type: "boolean", default: false },
        },
      },
    }),
    record({
      id: "example.desk-clock",
      title: "Desk clock",
      version: "0.3.0",
      source: "dev-linked",
      enabled: false,
      objects: [object("Clock", "DeskClock")],
      settings: {
        secondHand: {
          title: "Second hand",
          scope: "user",
          schema: { type: "boolean", default: true },
        },
      },
    }),
    record({
      id: "acme.kanban",
      title: "Kanban",
      version: "2.1.0",
      source: "registry",
      objects: [object("Board", "AcmeBoard", "Board")],
      settings: {
        columns: { title: "Columns on a new board", scope: "user", schema: { type: "integer" } },
      },
    }),
    record({
      id: "example.kv-service",
      title: "Key-value store",
      version: "0.2.0",
      source: "sideload",
      service: "active",
      settings: {
        limit: { title: "Largest value", scope: "device", schema: { type: "integer" } },
      },
    }),
  ],
});

/** What the settings plates' fieldd keeps: Simulators' frame turned off, a phone chosen and a token kept (its value
 * never here); every other setting unset, so its page shows the declared default. */
export const PLUGINS_FIXTURE_SETTINGS: PluginsFixtureSettings = {
  "vibefield.simulator": {
    showFrame: { value: false },
    phone: { value: "iPhone 17 Pro" },
    token: { secret: true, kept: true },
  },
};

/** The unread plate's fieldd (MK-4c2b, Unread): the settings plates' own, with Simulators' frame
 * rate one it refuses to read. */
export const PLUGINS_FIXTURE_SETTINGS_UNREAD: PluginsFixtureSettings = {
  ...PLUGINS_FIXTURE_SETTINGS,
  "vibefield.simulator": {
    ...PLUGINS_FIXTURE_SETTINGS["vibefield.simulator"],
    frameRate: { unread: true },
  },
};

/** MK-O3D: the same desktop as the stop holds it (O3-C; James's MK-O3 pick, "Stop"): Kanban, a
 * plugin by other people, held while community plugins are off. It is off as if turned off, holds
 * no power, draws nothing, and fieldd says why (`held`); the powers it asked for are the ones it
 * holds when on (the listed plates' Kanban). */
export const PLUGINS_FIXTURE_HELD_SNAPSHOT = PluginRegistrySnapshot.parse({
  generation: 5,
  problems: [],
  plugins: [
    ...PLUGINS_FIXTURE_SNAPSHOT.plugins,
    {
      ...record({
        id: "acme.kanban",
        title: "Kanban",
        version: "2.1.0",
        source: "registry",
        enabled: false,
        objects: [object("Board", "AcmeBoard", "Board"), object("Card", "AcmeCard", "Card")],
        requested: ["canvas.write", "x.acme.kanban.sync"],
        declares: [
          {
            id: "x.acme.kanban.sync",
            title: "Keep your boards in step",
            description: "Copies a board's cards to the boards you share.",
            risk: "write",
          },
        ],
      }),
      renderer: "inactive",
      held: "community-off",
    },
  ],
});

/** MK-O3D: a plate's or a test's community switch door: it answers at once, with a refusal, or
 * never, as a switch's does, and moves nothing, as fieldd's answer moves nothing: the preferences
 * a plate or a test hands next do. */
export function communityFixtureDoor(
  acts: PluginsFixtureActs = "answers",
): (on: boolean) => Promise<void> {
  return () =>
    acts === "answers"
      ? Promise.resolve()
      : acts === "refuses"
        ? Promise.reject(new Error(PLUGINS_FIXTURE_REFUSAL))
        : new Promise<void>(() => undefined);
}

/** What a fixture's fieldd answers for a download (O2-C), by plugin: the row the card is read from. Desk things,
 * from the shelf's list, adds four objects and asks for two powers. Any other plugin's download is refused. */
export const PLUGINS_FIXTURE_DOWNLOADS: Readonly<Record<string, PluginRecord>> = {
  "vibefield.desk-things": PluginRecord.parse(
    record({
      id: "vibefield.desk-things",
      title: "Desk things",
      version: "1.0.0",
      source: "registry",
      objects: [
        object("Clock", "DeskThingsClock", "Clock"),
        object("Calendar", "DeskThingsCalendar", "Calendar"),
        object("Timer", "DeskThingsTimer", "Timer"),
        object("Ruler", "DeskThingsRuler", "Ruler"),
      ],
      granted: ["canvas.read", "storage.self"],
    }),
  ),
};

/** MK-UC's UC-C: the plugins a desktop has, with three from the plugin list that the list holds newer releases of
 * (Updates' plates): Burndown 0.6.0, one object; Notes 0.6.1, no object, a service; Timers 1.0.0, a Timer and a
 * Stopwatch. */
export const PLUGINS_FIXTURE_OUTDATED_SNAPSHOT = PluginRegistrySnapshot.parse({
  generation: 5,
  problems: [],
  plugins: [
    ...PLUGINS_FIXTURE_SNAPSHOT.plugins,
    record({
      id: "vibefield.burndown",
      title: "Burndown",
      version: "0.6.0",
      source: "registry",
      objects: [object("Burndown", "VfBurndownChart", "Burndown")],
      granted: ["canvas.read"],
    }),
    record({
      id: "vibefield.notes",
      title: "Notes",
      version: "0.6.1",
      source: "registry",
      service: "active",
      granted: ["storage.self"],
    }),
    record({
      id: "vibefield.timers",
      title: "Timers",
      version: "1.0.0",
      source: "registry",
      objects: [
        object("Timer", "VfTimer", "Timer"),
        object("Stopwatch", "VfStopwatch", "Stopwatch"),
      ],
      granted: ["canvas.read"],
    }),
  ],
});

/** MK-UC's UC-C: the list held for Updates' plates: Burndown 0.7.0, which needs a newer VibeField; Notes 0.7.0,
 * published Nov 7; Timers 1.1.0, whose listing keeps the Timer, adds an Alarm and drops the Stopwatch. Two of
 * them can be taken, as the Me row counts. */
export const CATALOG_UPDATES = PluginsCatalog.parse({
  ...CATALOG_FIXTURES.ready,
  updates: 2,
  plugins: [
    ...CATALOG_FIXTURES.ready.plugins,
    {
      id: "vibefield.burndown",
      listedAs: "vibefield",
      latest: release("vibefield.burndown", "0.7.0"),
      compatible: false,
      listing: {
        title: "Burndown",
        objects: [{ type: "VfBurndownChart", label: "Burndown", category: "things" }],
      },
    },
    {
      id: "vibefield.notes",
      listedAs: "vibefield",
      latest: {
        ...release("vibefield.notes", "0.7.0"),
        // Nov 7, 2025, at noon UTC: the row says "Nov 7" in every time zone from UTC−12 to UTC+11
        publishedAt: Date.UTC(2025, 10, 7, 12),
      },
      compatible: true,
      listing: { title: "Notes", publisherName: "VibeField", objects: [] },
    },
    {
      id: "vibefield.timers",
      listedAs: "vibefield",
      latest: release("vibefield.timers", "1.1.0"),
      compatible: true,
      listing: {
        title: "Timers",
        publisherName: "VibeField",
        objects: [
          { type: "VfTimer", label: "Timer", category: "things" },
          { type: "VfAlarm", label: "Alarm", category: "things" },
        ],
      },
    },
  ],
});

/** MK-UC's UC-C: what a fixture's fieldd answers for an update's download. */
export interface PluginsFixtureUpdateDownload {
  /** the row the card is read from */
  readonly record: PluginRecord;
  /** the version you have */
  readonly from: string;
  /** what it can do that the version you have can't */
  readonly asksFor: string[];
}

type UpdateDownloads = Readonly<Record<string, PluginsFixtureUpdateDownload>>;

/** MK-UC's UC-C: an update's download, by plugin: Notes 0.7.0 can also reach the internet; Timers 1.1.0 asks for
 * nothing new and drops the Stopwatch. Any other plugin's, or another version's, is refused. */
export const PLUGINS_FIXTURE_UPDATE_DOWNLOADS: UpdateDownloads = {
  "vibefield.notes": {
    record: PluginRecord.parse(
      record({
        id: "vibefield.notes",
        title: "Notes",
        version: "0.7.0",
        source: "registry",
        service: "active",
        granted: ["storage.self", "net.outbound"],
      }),
    ),
    from: "0.6.1",
    asksFor: ["net.outbound"],
  },
  "vibefield.timers": {
    record: PluginRecord.parse(
      record({
        id: "vibefield.timers",
        title: "Timers",
        version: "1.1.0",
        source: "registry",
        objects: [object("Timer", "VfTimer", "Timer"), object("Alarm", "VfAlarm", "Alarm")],
        granted: ["canvas.read"],
      }),
    ),
    from: "1.0.0",
    asksFor: [],
  },
};

/** This desktop's roster as a fixture's fieldd answers it (O2-C): studio, the desktop the plate stands on; mini and
 * tower, whose VibeField has said itself; and a phone on the tailnet that runs none, which no card counts. */
export const PLUGINS_FIXTURE_ROSTER = DeviceListResult.parse({
  devices: [
    {
      deviceId: "fixture-studio",
      name: "studio",
      platform: "darwin",
      fielddVersion: "0.9.0",
      self: true,
      online: true,
      lastSeenAt: PLUGINS_FIXTURE_READ_AT,
    },
    {
      deviceId: "fixture-tower",
      name: "tower",
      platform: "win32",
      fielddVersion: "0.9.0",
      self: false,
      online: false,
      lastSeenAt: PLUGINS_FIXTURE_READ_AT,
    },
    {
      deviceId: "fixture-mini",
      name: "mini",
      platform: "darwin",
      fielddVersion: "0.9.0",
      self: false,
      online: true,
      lastSeenAt: PLUGINS_FIXTURE_READ_AT,
    },
    {
      deviceId: "fixture-phone",
      name: "iPhone",
      self: false,
      online: true,
      lastSeenAt: PLUGINS_FIXTURE_READ_AT,
    },
  ],
}).devices;
