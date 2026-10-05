import { createMemoryProjectIdentityStore } from "@vibecook/puppeteer-monitor";
import {
  AGENT_CATALOG,
  AGENT_FIELD,
  type AgentModelMeshFrame,
  type AgentModelMeshOpen,
  type AgentSessionSummary,
  createAgentCatalogReaders,
  type DeviceInfo,
  type TerminalInfo,
} from "@vibefield/contracts";
import { createFieldSubscription, deskProjector } from "../../../fieldd/src/agent-field";
import { createModelSubscription } from "../../../fieldd/src/agent-model-board";
import {
  type AgentMonitorService,
  createAgentMonitorService,
} from "../../../fieldd/src/agent-monitor";
import { MeshBoard, type MeshBoardFrame } from "../../../fieldd/src/mesh-board";
import {
  profileSetsFrame,
  type ScriptedFold,
  type ScriptedRuntime,
  scriptedDevices,
  scriptedFold,
  scriptedProfiles,
  scriptedRuntime,
  scriptedTerminals,
  stateOf,
} from "../../../fieldd/test/agent-monitor-fixture";
import {
  type Corpus,
  type CorpusPanes,
  type CorpusRecipe,
  type CorpusTick,
  generateCorpus,
  recipeName,
  resolveRecipe,
} from "../../src/godview/monitor/perf/corpus";
import type { RecordedFrame } from "../../src/godview/monitor/perf/frame-recorder";
import {
  MODEL_STREAM_GENERATOR,
  MODEL_STREAM_VERSION,
  type ModelStream,
  type ModelStreamFrame,
} from "../../src/godview/monitor/perf/model-stream";

// THE MODEL STREAM, COMPUTED (MV-3c, build-mv M30). A corpus's fold frames —
// whole rows with puppeteer's mirror — become what fieldd's hosted backend is
// fed live: each mirror the runtime's state on its push bus (`stateOf`, the
// fixture's rule: the mirror IS core's projection), each board the fold's
// publish, the panes the floor's inventory, the roster's row this device. The
// output is the window's ONE door, read off fieldd's own code, not a re-statement
// of it:
//
//   · this desktop: `createAgentMonitorService` (the backend and its host port,
//     `agent-monitor.ts`) under `createModelSubscription` (the model board, its
//     16 ms floor and its urgent leading edge, L12);
//   · the peer: its OWN service and backend under its desk cut
//     (`createFieldSubscription` + `deskProjector`, the 100 ms floor and the
//     heartbeat a mesh upstream asks for), every frame through JSON as the
//     federated link carries it;
//   · the relay: `MeshBoard` itself, `model` projection — this desktop's model
//     board beside the peer's desk board, multiplexed, never re-folded (DS-D4).
//
// TIME is virtual and the caller's (vitest's fake timers, installed at the
// recipe's `baseWall`): every timer the daemon's code arms — the backend's
// tick, the floors, the heartbeat, the relay's sweep — fires on that clock, so
// the stream is a pure function of the recipe. The phase on the 16 ms grid is
// one rule, applied at every tick: the floors that fall due at a tick flush
// BEFORE that tick's runtime states land (a busy board's states arrive
// continuously, so a floor never waits a second window), then the states and
// the fold's publish, then the backend's own tick — where an urgent change
// after a quiet spell goes out at once (the marker's flip, L12's leading edge).
//
// Every row is read as A's player reads it: through JSON, after the corpus is
// complete (the generator's usage rings are shared arrays, so a frame written
// at the end carries the final ring — the same bytes A replays).

/** The caller's virtual clock: `advance` runs every timer that falls due and
 * the microtasks between them (vitest: `advanceTimersByTimeAsync`). */
export interface VirtualTime {
  advance(ms: number): Promise<void>;
  now(): number;
}

export interface ComputedModelStream {
  corpus: Corpus;
  stream: ModelStream;
}

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface HostedDesktop {
  device: string;
  service: AgentMonitorService;
  runtime: ScriptedRuntime;
  fold: ScriptedFold;
  /** the mirror revision last pushed per run: the bus carries changes */
  pushed: Map<string, number>;
}

/** A desktop's fieldd, as far as the monitor is concerned. */
async function hostDesktop(
  device: { id: string; name?: string; platform?: string },
  rows: readonly AgentSessionSummary[],
  floor: readonly TerminalInfo[],
  time: VirtualTime,
): Promise<HostedDesktop> {
  const runtime = scriptedRuntime(rows.filter((row) => row.monitor !== undefined).map(stateOf));
  const fold = scriptedFold(rows);
  const service = createAgentMonitorService({
    runtime: runtime.runtime,
    fold,
    terminals: scriptedTerminals(floor),
    devices: scriptedDevices(device),
    profiles: scriptedProfiles(profileSetsFrame([])),
    catalog: createAgentCatalogReaders(AGENT_CATALOG),
    identity: createMemoryProjectIdentityStore(),
  });
  const ready = service.ready;
  await time.advance(0);
  await ready;
  const pushed = new Map<string, number>();
  for (const row of rows) {
    if (row.monitor !== undefined) pushed.set(row.runtimeRunId, row.monitor.revision);
  }
  return { device: device.id, service, runtime, fold, pushed };
}

/** One fold tick on a desktop: the states that moved on the runtime's bus,
 * then the fold's publish (the order a daemon sees them in). */
function liveTick(desktop: HostedDesktop, rows: readonly AgentSessionSummary[]): void {
  for (const row of rows) {
    const mirror = row.monitor;
    if (mirror === undefined || desktop.pushed.get(row.runtimeRunId) === mirror.revision) continue;
    desktop.pushed.set(row.runtimeRunId, mirror.revision);
    desktop.runtime.push(stateOf(row));
  }
  desktop.fold.publish(rows);
}

/** This desktop's floor: every pane's PTY, the agents' included (the backend
 * dedupes the PTY a run claims and draws the rest as bare terminals). */
function floorOfPanes(panes: CorpusPanes, agentPtys: ReadonlySet<string>): TerminalInfo[] {
  return panes.sessions.map((session) => ({
    sessionId: session.id,
    pid: session.pid ?? undefined,
    createdAt: session.createdAtMs,
    ...(session.title !== undefined && session.title !== "" ? { title: session.title } : {}),
    ...(session.cwd !== undefined && session.cwd !== null ? { cwd: session.cwd } : {}),
    cell: {
      cellInstanceId: 1,
      cellBootId: "corpus-cell-1",
      workloadClass: agentPtys.has(session.id) ? "agent" : "interactive",
    },
  })) as TerminalInfo[];
}

/** The peer's floor: its agents' PTYs (the corpus gives the peer no panes). */
function floorOfRows(rows: readonly AgentSessionSummary[]): TerminalInfo[] {
  const floor: TerminalInfo[] = [];
  for (const row of rows) {
    const terminal = row.terminal;
    if (terminal?.hosted !== "local" || terminal.runtimeSessionId === undefined) continue;
    floor.push({
      sessionId: terminal.runtimeSessionId,
      createdAt: Date.parse(row.createdAt),
      ...(row.workspace?.root !== undefined ? { cwd: row.workspace.root } : {}),
      title: row.label,
      cell: { cellInstanceId: 1, cellBootId: "corpus-peer-cell-1", workloadClass: "agent" },
    });
  }
  return floor;
}

function deviceOf(
  roster: readonly DeviceInfo[],
  id: string,
): { id: string; name?: string; platform?: string } {
  const row = roster.find((entry) => entry.deviceId === id);
  return {
    id,
    ...(row?.name !== undefined ? { name: row.name } : {}),
    ...(row?.platform !== undefined ? { platform: row.platform } : {}),
  };
}

/**
 * Does this frame carry the marker's change to the window's views — its MODEL
 * row in the new status? The backend hears the runtime's state before the fold
 * publishes, so the first such frame can still carry the old desk half beside
 * the new model row: it is what B's views draw, so it is what the mark times.
 * The fold's four words read as the model's three (`unknown` draws as working).
 */
function carriesMark(
  frame: AgentModelMeshFrame,
  mark: Extract<RecordedFrame, { kind: "mark" }>,
): boolean {
  const detail = mark.detail ?? {};
  if (!("delta" in frame) || frame.device !== detail["device"]) return false;
  const to = detail["to"] === "unknown" ? "working" : detail["to"];
  return frame.delta.upserts.some((row) => {
    if (row.runtimeRunId !== detail["runtimeRunId"]) return false;
    const model = (row as { monitorRow?: { status?: unknown } }).monitorRow;
    return model !== undefined
      ? model.status === to
      : (row as { status?: unknown }).status === detail["to"];
  });
}

/**
 * The model stream for a recipe, and the corpus it belongs to. The caller has
 * installed fake timers at the recipe's `baseWall` and hands their clock over.
 */
export async function computeModelStream(
  input: CorpusRecipe,
  time: VirtualTime,
): Promise<ComputedModelStream> {
  const recipe = resolveRecipe(input);
  const baseWall = recipe.baseWall;
  if (time.now() !== baseWall) {
    throw new Error(
      `the virtual clock must start at the recipe's baseWall (${baseWall}); it reads ${time.now()}`,
    );
  }
  const lived: CorpusTick[] = [];
  const corpus = generateCorpus(recipe, (tick) => lived.push(tick));
  // through JSON once the corpus is complete: the rows A's player replays
  const ticks = wire(lived);
  const first = ticks[0];
  if (first?.tMs !== 0 || first.here === undefined || first.peer === undefined) {
    throw new Error("the corpus's first tick carries no boards");
  }

  // the corpus frame each tick ends on, for `after`
  const lastSeqBefore = (tMs: number): number => {
    let seq = 0;
    for (const frame of corpus.frames) {
      if (frame.t >= tMs) break;
      seq = frame.seq;
    }
    return seq;
  };
  const lastSeqAt = (tMs: number): number => {
    let seq = 0;
    for (const frame of corpus.frames) {
      if (frame.t > tMs) break;
      seq = frame.seq;
    }
    return seq;
  };

  const agentPtys = new Set(
    first.here.flatMap((row) =>
      row.terminal?.runtimeSessionId !== undefined ? [row.terminal.runtimeSessionId] : [],
    ),
  );
  const here = await hostDesktop(
    deviceOf(corpus.roster, corpus.meta.here),
    first.here,
    floorOfPanes(corpus.panes, agentPtys),
    time,
  );
  const peer = await hostDesktop(
    deviceOf(corpus.roster, corpus.meta.peer),
    first.peer,
    floorOfRows(first.peer),
    time,
  );

  // the roster as the relay reads it: the peer is a desktop (DS-D7's test)
  const roster: DeviceInfo[] = corpus.roster.map((row) =>
    row.self
      ? row
      : ({
          ...row,
          capabilities: { docHost: true, push: false },
        } as DeviceInfo),
  );
  const epochs = { here: 0, peer: 0 };
  const board = new MeshBoard({
    selfDevice: () => here.device,
    roster: { list: () => roster, on: () => undefined, off: () => undefined },
    links: { linkState: () => "connected", on: () => undefined, off: () => undefined },
    now: () => Date.now(),
    // this desktop's board at the window's ask: `openLocalBoard("model", …)`
    openLocal: (_projection, minIntervalMs, emit) => {
      const epoch = `${here.device}-boot.${++epochs.here}`;
      const local = createModelSubscription({
        fold: here.fold,
        monitor: here.service,
        emit,
        epoch,
        minIntervalMs,
      });
      return { snapshot: { ...local.snapshot, epoch }, dispose: local.dispose };
    },
    // the peer's door: `agent.subscribe {projection: "desk", minIntervalMs,
    // heartbeatMs}` at ITS local scope, answered by its own fieldd
    upstreams: {
      attach: async (_device, _method, params, emit) => {
        const ask = params as { minIntervalMs: number; heartbeatMs: number };
        const epoch = `${peer.device}-boot.${++epochs.peer}`;
        const desk = createFieldSubscription({
          list: () => peer.fold.list(),
          subscribe: (fn) => {
            const offFold = peer.fold.subscribe(fn);
            const offModel = peer.service.subscribe(() => fn());
            return () => {
              offFold();
              offModel();
            };
          },
          emit: (delta) => emit(wire(delta), "delta"),
          epoch,
          project: deskProjector((runtimeRunId) => peer.service.rowForRun(runtimeRunId)),
          minIntervalMs: ask.minIntervalMs,
          heartbeatMs: ask.heartbeatMs,
        });
        return { snapshot: wire({ ...desk.snapshot, epoch }), dispose: desk.dispose };
      },
    },
  });

  const frames: ModelStreamFrame[] = [];
  let seq = 0;
  let after = 0;
  let pendingMark: Extract<RecordedFrame, { kind: "mark" }> | null = null;
  const stamp = (): { seq: number; t: number; wall: number } => {
    const now = time.now();
    seq += 1;
    return { seq, t: now - baseWall, wall: now };
  };
  const record = (frame: MeshBoardFrame): void => {
    const read = wire(frame) as AgentModelMeshFrame;
    if (pendingMark !== null && carriesMark(read, pendingMark)) {
      const { name, detail } = pendingMark;
      frames.push({
        ...stamp(),
        kind: "mark",
        name,
        ...(detail !== undefined ? { detail } : {}),
        after,
      });
      pendingMark = null;
    }
    frames.push({ ...stamp(), kind: "model-frame", frame: read, after });
  };

  // a warm reader first, so the window's open finds the peer's board held (the
  // relay keeps it across readers, DS-L8) instead of a `stale` peer whose
  // snapshot follows a moment later
  const warm = board.open("model", AGENT_FIELD.FULL_TICK_MS, () => undefined);
  await time.advance(0);
  // the window's model board IS its screen (L5, M20): fieldd opens the screen
  // with the subscription and an empty report (`daemon.ts` openScreen), so marks
  // accrue from here, as they do for the lab's window (build-mv M51)
  const screen = here.service.openScreen("the-lab-window");
  const reader = board.open("model", AGENT_FIELD.FULL_TICK_MS, record);
  warm.dispose();
  const open = wire(reader.open) as AgentModelMeshOpen;
  if (open.devices.length !== 2 || open.devices.some((device) => device.snapshot === undefined)) {
    throw new Error(
      `the open did not hold both desktops' boards: ${JSON.stringify(open.devices.map((d) => [d.device, d.state, d.snapshot !== undefined]))}`,
    );
  }
  frames.push({ ...stamp(), kind: "model-open", open, after: 0 });

  for (const tick of ticks.slice(1)) {
    after = lastSeqBefore(tick.tMs);
    await time.advance(baseWall + tick.tMs - time.now());
    // armed before the states land: an urgent change leaves on their push
    if (tick.mark !== undefined) pendingMark = tick.mark;
    if (tick.here !== undefined) liveTick(here, tick.here);
    if (tick.peer !== undefined) liveTick(peer, tick.peer);
    after = lastSeqAt(tick.tMs);
    await time.advance(0);
  }
  // the trailing floors: what the last ticks' changes still owe the window
  await time.advance(recipe.deskTickMs);
  if (pendingMark !== null) {
    throw new Error(`no model frame carried the marker's change (${JSON.stringify(pendingMark)})`);
  }
  screen();
  reader.dispose();
  board.dispose();
  here.service.dispose();
  peer.service.dispose();

  let marks = 0;
  let upserts = 0;
  let bytes = 0;
  let modelFrames = 0;
  for (const frame of frames) {
    bytes += JSON.stringify(frame).length + 1;
    if (frame.kind === "mark") marks += 1;
    if (frame.kind === "model-frame") {
      modelFrames += 1;
      if ("delta" in frame.frame) upserts += frame.frame.delta.upserts.length;
    }
  }
  return {
    corpus,
    stream: {
      meta: {
        generator: MODEL_STREAM_GENERATOR,
        version: MODEL_STREAM_VERSION,
        corpus: recipeName(recipe),
        corpusFrames: corpus.frames.length,
        recipe,
        here: corpus.meta.here,
        peer: corpus.meta.peer,
        marker: corpus.meta.marker,
        floors: { model: AGENT_FIELD.FULL_TICK_MS, desk: AGENT_FIELD.DESK_MIN_INTERVAL_MS },
        counts: { open: 1, frames: modelFrames, marks, upserts, bytes },
      },
      frames,
    },
  };
}
