import { AgentListResult, type DeviceInfo } from "@vibefield/contracts";
import type { AgentSessionSummary } from "../facet-types";
import type {
  LocalFieldListener,
  MeshBoardListener,
  MonitorDoor,
  MonitorFeedState,
} from "../remote-door";
import type { RecordedFrame } from "./frame-recorder";

// THE REPLAY DOOR (MV-0): a `MonitorDoor` whose two streams are fed from a
// corpus instead of a daemon. `useLocalAgentField` and `useMeshField` subscribe
// to it exactly as they subscribe to the deck's door, and `deliver(frame)` hands
// them what the recorder wrote down — so what runs downstream is TODAY'S seam on
// recorded or generated inputs, with nothing of the seam replaced.
//
// Two consumers share it. The ORACLE (`perf/godview-oracle.perf.tsx`) delivers
// frames by hand under a fake clock and writes each output `MonitorAgent[]`.
// The ELECTRON LAB's player (`replay-player.ts`) delivers them on the recorder's
// own timeline. Both go through `deliverText` where they can, because the deck's
// `observe` does `AgentListResult.safeParse` on every frame and a replay that
// skipped the parse would measure a seam the product does not have.
//
// What is NOT the corpus's comes from the REAL door when one is given (attach,
// create, mount, the account usage feed, History, the profile sets), so the
// product's chrome keeps working under replay; without one those verbs refuse
// honestly. The roster is the corpus's: a fold whose rows name `desk-here` must
// hear a roster that calls `desk-here` self, or the mesh's own board is drawn
// twice (`mesh-rows.ts` drops only the device the roster says is here).

export interface ReplayDoor extends MonitorDoor {
  /** Hand the subscribers one recorded frame, as the daemon would have. */
  deliver(frame: RecordedFrame): void;
  /** One JSONL line: parsed and, for a fold frame, zod-read exactly as the
   * deck's `observe` reads a frame off the socket. Unreadable lines are reported
   * to the fold's `onError`, as the deck reports an unreadable frame. */
  deliverText(line: string): void;
  /** Listeners standing right now, for a harness to check it is being heard. */
  listeners(): { fold: number; mesh: number; devices: number };
}

export interface ReplayDoorOptions {
  /** The deck's own door, for every verb and feed that is not the corpus's. */
  real?: MonitorDoor | null;
  roster: readonly DeviceInfo[];
  /** A `mark` frame was delivered: the moment of truth for latency. */
  onMark?: (frame: Extract<RecordedFrame, { kind: "mark" }>) => void;
}

const NO_FEED: MonitorFeedState = { state: "no-door" };

export function createReplayDoor(options: ReplayDoorOptions): ReplayDoor {
  const real = options.real ?? null;
  const folds = new Set<LocalFieldListener>();
  const meshes = new Set<MeshBoardListener>();
  const devices = new Set<(devices: readonly DeviceInfo[]) => void>();
  /** The last mesh open, re-delivered to a late (or re-)subscriber the way a
   * daemon re-snapshots a fresh subscription. */
  let lastOpen: Extract<RecordedFrame, { kind: "mesh-open" }>["open"] | null = null;
  const roster = [...options.roster];

  const door: ReplayDoor = {
    observe(listener) {
      folds.add(listener);
      return () => {
        folds.delete(listener);
      };
    },
    observeMesh(listener) {
      meshes.add(listener);
      if (lastOpen !== null) listener.onOpen(lastOpen);
      return () => {
        meshes.delete(listener);
      };
    },
    devices: {
      subscribe(listener) {
        devices.add(listener);
        if (roster.length > 0) listener(roster);
        return () => {
          devices.delete(listener);
        };
      },
    },
    // TL — fieldd's status ledger has nothing to say about a corpus's runs
    statusHistory: { load: async () => [] },
    ...(real?.profiles !== undefined ? { profiles: real.profiles } : {}),
    history: real?.history ?? {
      status: async () => ({
        reachable: false,
        detail: "replay",
        checkedAt: new Date(0).toISOString(),
      }),
      facts: async () => [],
      search: async () => ({
        status: { reachable: false, detail: "replay", checkedAt: new Date(0).toISOString() },
        answered: false,
        hits: [],
        clipped: false,
      }),
    },
    usage: real?.usage ?? {
      snapshot: async () => ({ refreshedAt: new Date(0).toISOString(), entries: [] }),
      subscribe: () => () => undefined,
      subscribeState: (listener) => {
        listener(NO_FEED);
        return () => undefined;
      },
    },
    attach: real ? (request) => real.attach(request) : async () => ({ state: "no-pane" }),
    createTerminal: real
      ? (request) => real.createTerminal(request)
      : async () => ({ state: "no-pane" }),
    mountLocal: real
      ? (sessionId, mountOptions) => real.mountLocal(sessionId, mountOptions)
      : async () => ({ state: "no-pane" }),
    deliver(frame) {
      switch (frame.kind) {
        case "fold":
          for (const listener of [...folds]) listener.onFrame(frame.rows);
          return;
        case "fold-error":
          for (const listener of [...folds]) listener.onError(frame.reason);
          return;
        case "mesh-open":
          lastOpen = frame.open;
          for (const listener of [...meshes]) listener.onOpen(frame.open);
          return;
        case "mesh-frame":
          for (const listener of [...meshes]) listener.onFrame(frame.frame);
          return;
        case "mesh-error":
          for (const listener of [...meshes]) listener.onError(frame.failure);
          return;
        case "mark":
          options.onMark?.(frame);
          return;
      }
    },
    deliverText(line) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (cause) {
        for (const listener of [...folds]) {
          listener.onError(
            `replay: an unreadable line: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
        return;
      }
      const frame = value as RecordedFrame;
      if (frame.kind === "fold") {
        // the deck's own reading of a frame (`GodviewDeck.tsx` `deliver`)
        const parsed = AgentListResult.safeParse({ sessions: frame.rows });
        if (parsed.success) {
          for (const listener of [...folds]) {
            listener.onFrame(parsed.data.sessions as AgentSessionSummary[]);
          }
        } else {
          for (const listener of [...folds]) {
            listener.onError(
              `agent.subscribe answered an unreadable frame: ${parsed.error.issues[0]?.message ?? "invalid"}`,
            );
          }
        }
        return;
      }
      door.deliver(frame);
    },
    listeners: () => ({ fold: folds.size, mesh: meshes.size, devices: devices.size }),
  };
  return door;
}
