/**
 * M37 — THE CATALOG'S COPY AGAINST FIELDD'S MAPPING, over the same fold rows.
 *
 * `src/design-system/godview-model-fixture.ts` carries a FIXTURE-GRADE copy of
 * fieldd's summary→host mapping (`hostRunFromSummary`, `hostTerminalFrom`,
 * `hostProfileSetFrom`) and a minimal board cut, because the catalog runs in the
 * browser and may not import fieldd. A copy drifts. This test stands BOTH up on
 * the catalog's own fixture rows — the catalog's board, and fieldd's real service
 * and projection (`model-board-fixture.ts`) — opens each board and asserts that
 * what the WINDOW reads of them is equal: the devices and their standing, each
 * board row's key, kind, shape (`status` present or not) and PTY join, and the
 * model row whole. Wire stamps the window never reads (`revision`, `epoch`,
 * `asOf`) are left out. The clock is pinned so both backends stamp the same now.
 */

import type { AgentModelMeshOpen } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meshPeers } from "../src/design-system/godview-mesh-fixtures";
import { catalogModelBoard } from "../src/design-system/godview-model-fixture";
import {
  PROFILE_TAB_SETS,
  profileTabRows,
  SPAWN_BLOOM_SETS,
  THIS_MAC,
} from "../src/design-system/godview-profiles-fixtures";
import { timelineAfternoon } from "../src/design-system/godview-timeline-fixtures";
import type { ModelBoardPort } from "../src/godview/monitor/remote-door";
import { type ScriptedModelBoard, scriptedModelBoard, terminalInfoOf } from "./model-board-fixture";

const NOW = Date.parse("2026-10-04T15:00:00.000Z");

/** A board's open, as the window would receive it. */
async function openOf(port: ModelBoardPort): Promise<AgentModelMeshOpen> {
  const subscription = await port.subscribe(() => undefined, {});
  try {
    return subscription.snapshot as AgentModelMeshOpen;
  } finally {
    subscription.unsubscribe();
  }
}

/** What the window reads of a board (`ModelBoardFold`, `window-local.ts`): nothing else is compared. */
function windowReads(open: AgentModelMeshOpen) {
  return open.devices.map((device) => ({
    device: device.device,
    state: device.state,
    rows: [...(device.snapshot?.rows ?? [])]
      .sort((left, right) => left.runtimeRunId.localeCompare(right.runtimeRunId))
      .map((row) => ({
        key: row.runtimeRunId,
        kind: row.kind,
        statused: "status" in row,
        // the PTY join as `window-local.ts` reads it (a cell's boot id is the floor's own)
        terminal:
          row.terminal === undefined
            ? undefined
            : {
                hosted: row.terminal.hosted,
                runtimeSessionId: row.terminal.runtimeSessionId,
                replaced: row.terminal.replaced,
              },
        monitorRow: row.monitorRow,
      })),
  }));
}

let disposers: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  vi.useRealTimers();
});

function fielddBoard(options: Parameters<typeof scriptedModelBoard>[0]): ScriptedModelBoard {
  const board = scriptedModelBoard(options);
  disposers.push(() => board.dispose());
  return board;
}

describe("M37 — the catalog's fixture backend says what fieldd's says", () => {
  it("the profile tabs' rows, under the four profiles", async () => {
    const rows = profileTabRows(new Date(NOW).toISOString());
    const catalog = catalogModelBoard({ device: THIS_MAC, rows, profiles: PROFILE_TAB_SETS });
    disposers.push(() => catalog.dispose());
    const fieldd = fielddBoard({ rows, device: THIS_MAC, profiles: PROFILE_TAB_SETS });
    const [ours, theirs] = await Promise.all([openOf(catalog.port), openOf(fieldd.port)]);
    expect(windowReads(ours)).toEqual(windowReads(theirs));
    expect(windowReads(ours)[0]?.rows.length).toBe(rows.length);
  });

  it("the afternoon's rows: ended runs, pending ones, a blocked question", async () => {
    const { rows } = timelineAfternoon(NOW);
    const catalog = catalogModelBoard({ device: THIS_MAC, rows });
    disposers.push(() => catalog.dispose());
    const fieldd = fielddBoard({ rows, device: THIS_MAC });
    const [ours, theirs] = await Promise.all([openOf(catalog.port), openOf(fieldd.port)]);
    expect(windowReads(ours)).toEqual(windowReads(theirs));
  });

  it("a shell born under a profile joins the floor the same way (SB-3)", async () => {
    const rows = profileTabRows(new Date(NOW).toISOString());
    const session = {
      id: "catalog-terminal-1",
      exited: false,
      createdAtMs: NOW,
      cwd: "/Users/you/Projects/scratch",
      title: "zsh",
      activity: { kind: "shell-idle" },
    } as unknown as Parameters<typeof terminalInfoOf>[0];
    const catalog = catalogModelBoard({ device: THIS_MAC, rows, profiles: SPAWN_BLOOM_SETS });
    disposers.push(() => catalog.dispose());
    catalog.born(session, "work");
    const fieldd = fielddBoard({
      rows,
      device: THIS_MAC,
      profiles: SPAWN_BLOOM_SETS,
      terminals: [terminalInfoOf(session)],
      bindings: new Map([["catalog-terminal-1", "work"]]),
    });
    const [ours, theirs] = await Promise.all([openOf(catalog.port), openOf(fieldd.port)]);
    expect(windowReads(ours)).toEqual(windowReads(theirs));
    const terminal = windowReads(ours)[0]?.rows.find((row) => row.kind === "terminal");
    expect(terminal?.monitorRow?.profileSet).toBe("work");
  });

  it("three other desktops on the board: live, asleep, and stale with no board", async () => {
    const nowIso = new Date(NOW).toISOString();
    const rows = profileTabRows(nowIso);
    const peers = meshPeers(nowIso);
    const catalog = catalogModelBoard({ device: THIS_MAC, rows, peers });
    disposers.push(() => catalog.dispose());
    const fieldd = fielddBoard({ rows, device: THIS_MAC });
    for (const peer of peers) {
      if (peer.rows.length === 0) continue;
      fieldd.peer({
        device: peer.device.id,
        name: peer.device.name,
        platform: peer.device.platform,
        state: peer.state,
        rows: peer.rows,
      });
    }
    const [ours, theirs] = await Promise.all([openOf(catalog.port), openOf(fieldd.port)]);
    // fieldd's open lists a desktop with no board only once it has a snapshot;
    // the catalog lists the stale tower as the roster would: compare the ones
    // both boards carry, and check the tower stands with no rows on ours
    const theirDevices = new Set(theirs.devices.map((device) => device.device));
    const oursShared = { ...ours, devices: ours.devices.filter((d) => theirDevices.has(d.device)) };
    expect(windowReads(oursShared)).toEqual(windowReads(theirs));
    const tower = ours.devices.find((device) => device.state === "stale");
    expect(tower).toBeDefined();
    expect(tower?.snapshot).toBeUndefined();
  });
});
