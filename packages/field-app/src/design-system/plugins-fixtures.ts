import { PluginRegistrySnapshot, PluginsCatalog } from "@vibefield/contracts";
import type { PluginsPort } from "../frame/plugins/plugins-port";

// The Plugins popup's fixtures (MK-4a; DESIGN.md §8 "Plugins — the frame's
// second popup"): data the catalog hands the SHIPPING controller in place of
// what the frame supplies — a port answering the two doors as a fieldd would
// in each state of the read, and the plugins a desktop has. Every value is
// parsed by the contracts at load, so a fixture that drifts from the wire
// fails here, never on screen. No fieldd, no network, no child.

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

/** How a plate's fixture port answers: a list, a door that fails, or a read
 * still under way (it never ends, so the plate holds the reading state). */
export interface PluginsFixtureRead {
  readonly catalog: PluginsCatalog | "fails";
  readonly refresh: PluginsCatalog | "fails" | "pending";
}

export function pluginsFixturePort(read: PluginsFixtureRead): PluginsPort {
  const answer = (value: PluginsCatalog | "fails"): Promise<PluginsCatalog> =>
    value === "fails"
      ? Promise.reject(new Error("the fixture's door does not answer"))
      : Promise.resolve(value);
  return {
    catalog: () => answer(read.catalog),
    refresh: () =>
      read.refresh === "pending"
        ? new Promise<PluginsCatalog>(() => undefined)
        : answer(read.refresh),
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
  source: "bundled" | "dev-linked" | "sideload";
  enabled?: boolean;
  objects?: readonly Record<string, unknown>[];
  service?: "none" | "active";
}): Record<string, unknown> {
  const enabled = fields.enabled ?? true;
  return {
    id: fields.id,
    version: fields.version,
    title: fields.title,
    source: fields.source,
    manifestHash: PIN,
    installRevision: "fixture",
    state: enabled ? "enabled" : "disabled",
    compatible: true,
    enabled,
    requestedCapabilities: [],
    grantedCapabilities: [],
    contributions: { objects: fields.objects ?? [], commands: [], surfaces: [] },
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
