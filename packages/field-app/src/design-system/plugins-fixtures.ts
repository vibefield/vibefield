import { PluginRegistrySnapshot, PluginsCatalog, SettingsGetResult } from "@vibefield/contracts";
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
// window — a secret only as kept or not, never its value. No fieldd, no
// network, no child.

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

/** A list held that found two updates (MK-4c's count plate; the Me row's
 * count, which Updates carries). */
export const CATALOG_COUNTED = PluginsCatalog.parse({ ...CATALOG_FIXTURES.ready, updates: 2 });

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

export function pluginsFixturePort(
  read: PluginsFixtureRead,
  acts: PluginsFixtureActs = "answers",
  settings: PluginsFixtureSettings = {},
): PluginsPort {
  const answer = (value: PluginsCatalog | "fails"): Promise<PluginsCatalog> =>
    value === "fails"
      ? Promise.reject(new Error("the fixture's door does not answer"))
      : Promise.resolve(value);
  const act = (): Promise<void> =>
    acts === "answers"
      ? Promise.resolve()
      : acts === "refuses"
        ? Promise.reject(new Error(PLUGINS_FIXTURE_REFUSAL))
        : new Promise<void>(() => undefined);
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
