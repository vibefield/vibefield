import { type ReactElement, useCallback, useState } from "react";
import type { FrameSurface } from "../frame/frame-surface";
import { Plugins } from "../frame/plugins/Plugins";
import { type PluginsTab, runtimeFailures } from "../frame/plugins/plugins-model";
import {
  CATALOG_FIXTURES,
  CATALOG_LISTED,
  CATALOG_SHELF,
  CATALOG_UPDATES,
  communityFixtureDoor,
  PLUGINS_FIXTURE_HELD_SNAPSHOT,
  PLUGINS_FIXTURE_LISTED_SNAPSHOT,
  PLUGINS_FIXTURE_NOT_WORKING_SNAPSHOT,
  PLUGINS_FIXTURE_NOW,
  PLUGINS_FIXTURE_OUTDATED_SNAPSHOT,
  PLUGINS_FIXTURE_RUNTIME,
  PLUGINS_FIXTURE_SETTINGS,
  PLUGINS_FIXTURE_SETTINGS_SNAPSHOT,
  PLUGINS_FIXTURE_SETTINGS_UNREAD,
  PLUGINS_FIXTURE_SNAPSHOT,
  PLUGINS_FIXTURE_SWITCHES_SNAPSHOT,
  type PluginsFixtureInstall,
  type PluginsFixtureRead,
  pluginsFixturePort,
} from "./plugins-fixtures";

// Plugins — the frame's second popup, in the catalog (MK-4a; DESIGN.md §8
// "Plugins — the frame's second popup"; docs/UI_SYSTEM.md, Catalog fidelity):
// the SHIPPING controller (`frame/plugins/Plugins.tsx`) over a fixture port
// and a fixture snapshot (`plugins-fixtures.ts`), drawn open in a plate the
// size of the default window, one plate per state of the read. The plate is
// the window: the scrim and the popup are drawn in it. No plate binds a key on
// the page and none takes its focus; a click on its scrim folds it, as the
// product's does. MK-4c adds a plugin's page, read only — a Built in one, and
// a community one the list held names — and Updates carrying a count. MK-4c2a
// adds a plugin's switches: a Built in plugin's page with its one switch and its
// powers' (one taken back, one it can't have here), a Development plugin's page
// while it is off, and the same Built in page while fieldd isn't answering. A
// press on a plate's switch is sent to its fixture port, which answers and moves
// nothing, as fieldd's answer moves nothing: only a snapshot does. MK-4c2b adds
// a plugin's settings: a Built in plugin's page with one setting of each kind,
// a Development plugin's while it is off, and a Built in plugin's whose settings
// all stay on this desktop. No Undo and no Redo on any of them (James's MK-O6).
// And the same Built in page with one setting fieldd refuses to read (§8 Its
// settings, Unread), whose words are James's pick. MK-O3D adds Discover's
// community tile over a list that names a plugin by other people, off, and
// with its ask standing (§8 "The community tile"), and a community plugin held
// while community plugins are off, on Installed and on its page. A press on the
// tile's switch is sent to a fixture door, which answers and moves nothing.
// MK-4e adds Discover's shelf over a list held — its featured set, the sets
// VibeField publishes, one that needs a newer VibeField — and the page of a set
// this desktop doesn't have, read from the list, opened from Discover. O2-C
// adds that page with its Install pressed as the plate opens: the download
// under way, the install card read from the plugin downloaded (four objects,
// two powers, three desktops), the card's Install pressed too, Installing…
// until the plugins this desktop has hold it, and a download refused. Nothing a
// plate presses installs anything. MK-UC's UC-C draws Updates' count plate over
// a list held: its head, a row that asks first, one taken in one press, one that
// needs a newer VibeField, and its note; and adds a row's Update pressed as the
// plate opens, its update card naming the one new power. MK-5b adds Installed
// with plugins that aren't working, read by the product's own `runtimeFailures`
// from a fixture runtime read, Try again on the Built in one alone, and one
// this VibeField can't run; its Try again goes to the fixture port, which
// answers and moves nothing. The away plate now carries Discover's Try again.

export type PluginsPlateState =
  | "no-registry"
  | "installed"
  // MK-5b: Installed with plugins whose runtime failed, and one this VibeField can't run
  | "not-working"
  | "reading"
  | "offline"
  | "refused"
  | "held"
  | "away"
  | "page"
  // MK-6 (N29): the page above in a narrow window. The plate is 720 wide (scenes.css), so the
  // controller's own clamp draws the popup 672 wide, and a page in a popup under 720 stacks its
  // columns, the second above (§8: "A smaller window clamps it", "Its columns")
  | "narrow"
  | "page-listed"
  | "count"
  | "switches"
  | "switches-off"
  | "switches-away"
  | "settings"
  | "settings-off"
  | "settings-here"
  | "settings-unread"
  | "community"
  | "community-ask"
  | "community-held"
  | "community-held-page"
  | "shelf"
  | "shelf-page"
  | "shelf-downloading"
  | "shelf-card"
  | "shelf-installing"
  | "shelf-failed"
  | "update-card";

const PLATE_READS: Readonly<Record<PluginsPlateState, PluginsFixtureRead>> = {
  "no-registry": {
    catalog: CATALOG_FIXTURES.unconfigured,
    refresh: CATALOG_FIXTURES.unconfigured,
  },
  installed: { catalog: CATALOG_FIXTURES.unconfigured, refresh: CATALOG_FIXTURES.unconfigured },
  "not-working": {
    catalog: CATALOG_FIXTURES.unconfigured,
    refresh: CATALOG_FIXTURES.unconfigured,
  },
  reading: { catalog: CATALOG_FIXTURES.unread, refresh: "pending" },
  offline: { catalog: CATALOG_FIXTURES.unreachable, refresh: CATALOG_FIXTURES.unreachable },
  refused: { catalog: CATALOG_FIXTURES.refused, refresh: CATALOG_FIXTURES.refused },
  held: { catalog: CATALOG_FIXTURES.ready, refresh: CATALOG_FIXTURES.ready },
  narrow: { catalog: CATALOG_FIXTURES.unconfigured, refresh: CATALOG_FIXTURES.unconfigured },
  away: { catalog: "fails", refresh: "fails" },
  page: { catalog: CATALOG_FIXTURES.unconfigured, refresh: CATALOG_FIXTURES.unconfigured },
  "page-listed": { catalog: CATALOG_LISTED, refresh: CATALOG_LISTED },
  count: { catalog: CATALOG_UPDATES, refresh: CATALOG_UPDATES },
  switches: { catalog: CATALOG_FIXTURES.unconfigured, refresh: CATALOG_FIXTURES.unconfigured },
  "switches-off": {
    catalog: CATALOG_FIXTURES.unconfigured,
    refresh: CATALOG_FIXTURES.unconfigured,
  },
  "switches-away": {
    catalog: CATALOG_FIXTURES.unconfigured,
    refresh: CATALOG_FIXTURES.unconfigured,
  },
  settings: { catalog: CATALOG_FIXTURES.unconfigured, refresh: CATALOG_FIXTURES.unconfigured },
  "settings-off": {
    catalog: CATALOG_FIXTURES.unconfigured,
    refresh: CATALOG_FIXTURES.unconfigured,
  },
  "settings-here": {
    catalog: CATALOG_FIXTURES.unconfigured,
    refresh: CATALOG_FIXTURES.unconfigured,
  },
  "settings-unread": {
    catalog: CATALOG_FIXTURES.unconfigured,
    refresh: CATALOG_FIXTURES.unconfigured,
  },
  community: { catalog: CATALOG_LISTED, refresh: CATALOG_LISTED },
  "community-ask": { catalog: CATALOG_LISTED, refresh: CATALOG_LISTED },
  "community-held": { catalog: CATALOG_LISTED, refresh: CATALOG_LISTED },
  "community-held-page": { catalog: CATALOG_LISTED, refresh: CATALOG_LISTED },
  shelf: { catalog: CATALOG_SHELF, refresh: CATALOG_SHELF },
  "shelf-page": { catalog: CATALOG_SHELF, refresh: CATALOG_SHELF },
  "shelf-downloading": { catalog: CATALOG_SHELF, refresh: CATALOG_SHELF },
  "shelf-card": { catalog: CATALOG_SHELF, refresh: CATALOG_SHELF },
  "shelf-installing": { catalog: CATALOG_SHELF, refresh: CATALOG_SHELF },
  "shelf-failed": { catalog: CATALOG_SHELF, refresh: CATALOG_SHELF },
  "update-card": { catalog: CATALOG_UPDATES, refresh: CATALOG_UPDATES },
};

/** MK-UC's UC-C: the plates that stand on Updates' rows, and the row whose Update a plate presses as it opens. */
const UPDATES_PLATES: readonly PluginsPlateState[] = ["count", "update-card"];
const PLATE_UPDATES: Readonly<Partial<Record<PluginsPlateState, string>>> = {
  "update-card": "vibefield.notes",
};

/** O2-C: how a plate's install answers, for the plates that press their page's Install as they open: its
 * download under way, its card, the card's Install under way (its install never ends), or a download refused. */
const PLATE_INSTALLS: Readonly<Partial<Record<PluginsPlateState, PluginsFixtureInstall>>> = {
  "shelf-downloading": { prepare: "pending" },
  "shelf-card": {},
  "shelf-installing": { commit: "pending" },
  "shelf-failed": { prepare: "refuses" },
};

/** The page a plate opens on, from Installed. */
const PLATE_PAGES: Readonly<Partial<Record<PluginsPlateState, string>>> = {
  page: "vibefield.simulator",
  narrow: "vibefield.simulator",
  "page-listed": "acme.kanban",
  switches: "vibefield.simulator",
  "switches-off": "example.desk-clock",
  "switches-away": "vibefield.simulator",
  settings: "vibefield.simulator",
  "settings-off": "example.desk-clock",
  "settings-here": "vibefield.comment-pad",
  "settings-unread": "vibefield.simulator",
  "community-held-page": "acme.kanban",
  "shelf-page": "vibefield.desk-things",
  "shelf-downloading": "vibefield.desk-things",
  "shelf-card": "vibefield.desk-things",
  "shelf-installing": "vibefield.desk-things",
  "shelf-failed": "vibefield.desk-things",
};

/** MK-5b: the plugins whose runtime the not-working plate's fieldd says failed, read as the frame reads them. */
const PLATE_FAILED = runtimeFailures(PLUGINS_FIXTURE_RUNTIME);

/** The plugins a plate's desktop has. */
function plateSnapshot(state: PluginsPlateState) {
  if (state === "not-working") return PLUGINS_FIXTURE_NOT_WORKING_SNAPSHOT;
  if (UPDATES_PLATES.includes(state)) return PLUGINS_FIXTURE_OUTDATED_SNAPSHOT;
  if (state === "page-listed") return PLUGINS_FIXTURE_LISTED_SNAPSHOT;
  if (state.startsWith("community-held")) return PLUGINS_FIXTURE_HELD_SNAPSHOT;
  if (state.startsWith("switches")) return PLUGINS_FIXTURE_SWITCHES_SNAPSHOT;
  if (state.startsWith("settings")) return PLUGINS_FIXTURE_SETTINGS_SNAPSHOT;
  return PLUGINS_FIXTURE_SNAPSHOT;
}

function plateTab(state: PluginsPlateState): PluginsTab {
  if (UPDATES_PLATES.includes(state)) return "updates";
  // MK-4e: the shelf's plates stand on Discover, and a page opens from there
  if (state.startsWith("shelf")) return "discover";
  if (state === "not-working") return "installed";
  return state === "installed" || state === "community-held" || state in PLATE_PAGES
    ? "installed"
    : "discover";
}

/** MK-O3D: the plates whose window has read the community switch, off, and sends it through a
 * fixture door; every other plate's has not read it. */
const communityPlate = (state: PluginsPlateState): boolean => state.startsWith("community");

export function PluginsPlate({ state }: { state: PluginsPlateState }): ReactElement {
  const [surface, setSurface] = useState<FrameSurface | null>("plugins");
  const [plate, setPlate] = useState<HTMLDivElement | null>(null);
  const [port] = useState(() =>
    pluginsFixturePort(
      PLATE_READS[state],
      "answers",
      state === "settings-unread" ? PLUGINS_FIXTURE_SETTINGS_UNREAD : PLUGINS_FIXTURE_SETTINGS,
      PLATE_INSTALLS[state] ?? {},
    ),
  );
  const now = useCallback(() => PLUGINS_FIXTURE_NOW, []);
  const [communityDoor] = useState(() =>
    communityPlate(state) ? communityFixtureDoor() : undefined,
  );
  const tab = plateTab(state);
  return (
    <div ref={setPlate} className="vf-ds-history-plate" data-state={`plugins-${state}`}>
      <Plugins
        surface={surface}
        onSurfaceChange={setSurface}
        port={port}
        snapshot={plateSnapshot(state)}
        failed={state === "not-working" ? PLATE_FAILED : undefined}
        bindKeys={false}
        container={plate}
        takeFocus={false}
        initialTab={tab}
        initialPage={PLATE_PAGES[state] ?? null}
        updates={UPDATES_PLATES.includes(state) ? CATALOG_UPDATES.updates : null}
        away={state === "switches-away"}
        community={communityPlate(state) ? false : null}
        onCommunity={communityDoor}
        initialAsk={state === "community-ask"}
        initialInstall={state in PLATE_INSTALLS}
        initialConfirm={state === "shelf-installing"}
        initialUpdate={PLATE_UPDATES[state] ?? null}
        onMac
        now={now}
      />
    </div>
  );
}
