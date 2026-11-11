import { type ReactElement, useCallback, useState } from "react";
import type { FrameSurface } from "../frame/frame-surface";
import { Plugins } from "../frame/plugins/Plugins";
import type { PluginsTab } from "../frame/plugins/plugins-model";
import {
  CATALOG_COUNTED,
  CATALOG_FIXTURES,
  CATALOG_LISTED,
  PLUGINS_FIXTURE_LISTED_SNAPSHOT,
  PLUGINS_FIXTURE_NOW,
  PLUGINS_FIXTURE_SNAPSHOT,
  PLUGINS_FIXTURE_SWITCHES_SNAPSHOT,
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
// nothing, as fieldd's answer moves nothing: only a snapshot does.

export type PluginsPlateState =
  | "no-registry"
  | "installed"
  | "reading"
  | "offline"
  | "refused"
  | "held"
  | "away"
  | "page"
  | "page-listed"
  | "count"
  | "switches"
  | "switches-off"
  | "switches-away";

const PLATE_READS: Readonly<Record<PluginsPlateState, PluginsFixtureRead>> = {
  "no-registry": {
    catalog: CATALOG_FIXTURES.unconfigured,
    refresh: CATALOG_FIXTURES.unconfigured,
  },
  installed: { catalog: CATALOG_FIXTURES.unconfigured, refresh: CATALOG_FIXTURES.unconfigured },
  reading: { catalog: CATALOG_FIXTURES.unread, refresh: "pending" },
  offline: { catalog: CATALOG_FIXTURES.unreachable, refresh: CATALOG_FIXTURES.unreachable },
  refused: { catalog: CATALOG_FIXTURES.refused, refresh: CATALOG_FIXTURES.refused },
  held: { catalog: CATALOG_FIXTURES.ready, refresh: CATALOG_FIXTURES.ready },
  away: { catalog: "fails", refresh: "fails" },
  page: { catalog: CATALOG_FIXTURES.unconfigured, refresh: CATALOG_FIXTURES.unconfigured },
  "page-listed": { catalog: CATALOG_LISTED, refresh: CATALOG_LISTED },
  count: { catalog: CATALOG_COUNTED, refresh: CATALOG_COUNTED },
  switches: { catalog: CATALOG_FIXTURES.unconfigured, refresh: CATALOG_FIXTURES.unconfigured },
  "switches-off": {
    catalog: CATALOG_FIXTURES.unconfigured,
    refresh: CATALOG_FIXTURES.unconfigured,
  },
  "switches-away": {
    catalog: CATALOG_FIXTURES.unconfigured,
    refresh: CATALOG_FIXTURES.unconfigured,
  },
};

/** The page a plate opens on, from Installed. */
const PLATE_PAGES: Readonly<Partial<Record<PluginsPlateState, string>>> = {
  page: "vibefield.simulator",
  "page-listed": "acme.kanban",
  switches: "vibefield.simulator",
  "switches-off": "example.desk-clock",
  "switches-away": "vibefield.simulator",
};

/** The plugins a plate's desktop has. */
function plateSnapshot(state: PluginsPlateState) {
  if (state === "page-listed") return PLUGINS_FIXTURE_LISTED_SNAPSHOT;
  if (state.startsWith("switches")) return PLUGINS_FIXTURE_SWITCHES_SNAPSHOT;
  return PLUGINS_FIXTURE_SNAPSHOT;
}

function plateTab(state: PluginsPlateState): PluginsTab {
  if (state === "count") return "updates";
  return state === "installed" || state in PLATE_PAGES ? "installed" : "discover";
}

export function PluginsPlate({ state }: { state: PluginsPlateState }): ReactElement {
  const [surface, setSurface] = useState<FrameSurface | null>("plugins");
  const [plate, setPlate] = useState<HTMLDivElement | null>(null);
  const [port] = useState(() => pluginsFixturePort(PLATE_READS[state]));
  const now = useCallback(() => PLUGINS_FIXTURE_NOW, []);
  const tab = plateTab(state);
  return (
    <div ref={setPlate} className="vf-ds-history-plate" data-state={`plugins-${state}`}>
      <Plugins
        surface={surface}
        onSurfaceChange={setSurface}
        port={port}
        snapshot={plateSnapshot(state)}
        bindKeys={false}
        container={plate}
        takeFocus={false}
        initialTab={tab}
        initialPage={PLATE_PAGES[state] ?? null}
        updates={state === "count" ? CATALOG_COUNTED.updates : null}
        away={state === "switches-away"}
        onMac
        now={now}
      />
    </div>
  );
}
