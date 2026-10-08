import { useSyncExternalStore } from "react";
import type { MonitorPaneFacts } from "../useMonitorAgents";
import { EMPTY_PANES } from "./corpus-codec";
import { godviewReplayRequested } from "./door-instruments";
import { godviewPerfLab, installGodviewPerfLab } from "./lab-bridge";

const noSubscription = (): (() => void) => () => undefined;
const emptySnapshot = (): MonitorPaneFacts => EMPTY_PANES;

/** The monitor consumes the same pane facts as the offline model generator.
 * The deck still owns its real terminal; only this sibling boundary is adapted.
 * Without explicit replay, pass the live object through and install no lab. */
export function useGodviewReplayPanes(
  live: MonitorPaneFacts,
  search = typeof location === "undefined" ? "" : location.search,
): MonitorPaneFacts {
  const player = godviewReplayRequested(search)
    ? (godviewPerfLab() ?? installGodviewPerfLab()).player
    : null;
  const panes = useSyncExternalStore<MonitorPaneFacts>(
    player?.onPanes ?? noSubscription,
    player?.panes ?? emptySnapshot,
    emptySnapshot,
  );
  return player === null ? live : panes;
}
