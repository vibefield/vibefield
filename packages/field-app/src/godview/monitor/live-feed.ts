import { frameScheduler } from "@vibefield/puppeteer-view-sdk/host";
import type { FrameScheduler } from "@vibefield/puppeteer-view-sdk/model";
import type { LiveFeed, LiveFeedSnapshot, LiveFindAgent } from "../../frame/find-door";
import { type DoorClient, historyPortOver, modelBoardOver } from "./doors";
import { createFindAgents } from "./find-agents";
import { createGodviewMonitorFeed, type MonitorFeedState } from "./model-replica";
import { boardJoins, boardJoinsKey } from "./window-local";

// HISTORY'S LIVE NOW (docket PK5 (a), 2026-10-09; DESIGN.md §8 "Search — the
// Peek"). The monitor's own feed (`createGodviewMonitorFeed` over
// `modelBoardOver`, the model board's one ask) built over THIS window's fieldd
// client — no deck, no runtime — for the Peek to read while its Live now shows
// in History, and disposed the moment it stops showing (`Peek.tsx` holds it).
// The rows are the same join Godview's monitor makes (`find-agents.ts`): every
// live run on the board, this desktop's joined with its native session id,
// its mirror clocks and its floor session. Godview's own subscription is
// untouched: a closed Godview still asks nothing (PF6).

function stateOf(state: MonitorFeedState): LiveFeedSnapshot["state"] {
  switch (state.state) {
    case "live":
      return { kind: "live" };
    case "unavailable":
      return { kind: "unavailable", reason: state.reason };
    default:
      return { kind: "connecting" };
  }
}

export function openHistoryLiveFeed(
  client: DoorClient,
  options: { scheduler?: FrameScheduler } = {},
): LiveFeed {
  const feed = createGodviewMonitorFeed({
    board: modelBoardOver(client),
    scheduler: options.scheduler ?? frameScheduler,
  });
  const history = historyPortOver(client);
  const findAgentsOf = createFindAgents();
  let held: { key: readonly unknown[]; snapshot: LiveFeedSnapshot } | null = null;

  const read = (): LiveFeedSnapshot => {
    const model = feed.replica.getSnapshot().model;
    const rows = feed.heldRows();
    const runs = feed.chrome.runs();
    const here = feed.here();
    const state = feed.state();
    // the held rows are a fresh array per read: the joins' own key stands for
    // them (as the window's reads key them), so a read with nothing new hands
    // back the snapshot it had — `useSyncExternalStore` needs that identity
    const key = [model, boardJoinsKey(rows, here), runs, here, state];
    if (held?.key.every((part, index) => part === key[index])) {
      return held.snapshot;
    }
    const joins = boardJoins(rows, here);
    const alive = model.agents.filter((row) => row.alive);
    const found: readonly LiveFindAgent[] = findAgentsOf(
      alive,
      joins.runByRow,
      runs,
      joins.sessionByRow,
    );
    const snapshot: LiveFeedSnapshot = { runs: found, state: stateOf(state) };
    held = { key, snapshot };
    return snapshot;
  };

  return {
    read,
    subscribe(listener) {
      const offReplica = feed.replica.subscribe(listener);
      const offFeed = feed.subscribe(listener);
      const offChrome = feed.chrome.subscribe(listener);
      return () => {
        offReplica();
        offFeed();
        offChrome();
      };
    },
    history,
    dispose: () => feed.dispose(),
  };
}
