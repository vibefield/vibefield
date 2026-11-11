import { type ReactElement, useCallback, useState } from "react";
import type { FrameSurface } from "../frame/frame-surface";
import { Plugins } from "../frame/plugins/Plugins";
import type { PluginsTab } from "../frame/plugins/plugins-model";
import {
  CATALOG_FIXTURES,
  PLUGINS_FIXTURE_NOW,
  PLUGINS_FIXTURE_SNAPSHOT,
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
// product's does.

export type PluginsPlateState =
  | "no-registry"
  | "installed"
  | "reading"
  | "offline"
  | "refused"
  | "held"
  | "away";

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
};

export function PluginsPlate({ state }: { state: PluginsPlateState }): ReactElement {
  const [surface, setSurface] = useState<FrameSurface | null>("plugins");
  const [plate, setPlate] = useState<HTMLDivElement | null>(null);
  const [port] = useState(() => pluginsFixturePort(PLATE_READS[state]));
  const now = useCallback(() => PLUGINS_FIXTURE_NOW, []);
  const tab: PluginsTab = state === "installed" ? "installed" : "discover";
  return (
    <div ref={setPlate} className="vf-ds-history-plate" data-state={`plugins-${state}`}>
      <Plugins
        surface={surface}
        onSurfaceChange={setSurface}
        port={port}
        snapshot={PLUGINS_FIXTURE_SNAPSHOT}
        bindKeys={false}
        container={plate}
        takeFocus={false}
        initialTab={tab}
        now={now}
      />
    </div>
  );
}
