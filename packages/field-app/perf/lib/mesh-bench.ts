import { AGENT_FIELD, type AgentSessionSummary, type DeviceInfo } from "@vibefield/contracts";
import { createRemoteSubscription } from "../../../fieldd/src/agent-model-board";
import {
  MeshBoard,
  type MeshBoardFrame,
  type MeshBoardOpen,
  type MeshCursor,
} from "../../../fieldd/src/mesh-board";
import {
  type CorpusRecipe,
  type CorpusTick,
  generateCorpus,
  recipeName,
  resolveRecipe,
} from "../../src/godview/monitor/perf/corpus";
import {
  deviceOf,
  floorOfPanes,
  floorOfRows,
  type HostedDesktop,
  hostDesktop,
  liveTick,
  type VirtualTime,
  wire,
} from "./model-stream";

// THE PHONE'S MESH BENCH (PG-9 S4a, `lanes/ios/PG9-PLAN.md` S4). What the phone's one door costs on the wire: the
// bytes per second its home sends at the phone's floor, busy and idle, and what an app switch costs with the
// cursors PG-9 gave it against the whole open it cost before. Numbers from committed corpora, before any device:
// James's M1/M2 on the phone read the same quantities live (S4b's traffic line and open answers).
//
// The door as `daemon.ts` serves it to a tailnet principal: `agent.subscribe {projection: "remote", scope:
// "mesh"}` is `MeshBoard.subscribe` on the `remote|1000` hub (`boardFloor`: REMOTE_PHONE_MIN_INTERVAL_MS). The
// hub holds this desktop's own remote board (`openLocalBoard`'s remote branch: the floor, no heartbeat) beside
// the peer's remote board, asked at the same floor with the mesh heartbeat (`upstreamProjection`/
// `upstreamFloor`, the hub's ask). Every one of those is fieldd's own code, imported as the model stream imports
// it; the desktops are hosted as `model-stream.ts` hosts them, on virtual time.
//
// THE BYTES are the door's: each frame is the notification `product-api.ts` sends (`{jsonrpc, method:
// "agent.delta" | "agent.snapshot", params: {subId, payload}}`), and the open is the subscribe's reply (`{jsonrpc,
// id, result: {subId, snapshot}}`), as UTF-8 JSON. Not counted: the WebSocket frame's header (2–14 bytes a
// frame), TLS and WireGuard; and PG-1c's hold, which needs a socket's backlog (this bench never falls behind).
// The terminal gate is open (`terminalPublished`), as on a desktop whose terminal doors are published.
//
// Two passes per recipe, each on fresh desktops and a fresh clock (deterministic: any host serves):
//   · STREAM — the phone opens on a warm hub at t0 and reads the whole corpus (BUSY), then IDLE_MS with no tick
//     (IDLE: the heartbeats, and whatever the backend's own clock moves). Then it switches away twice: for
//     AWAY_IDLE_MS (the hub lingers, MESH_HUB_LINGER_MS) and for PAST_LINGER_MS (the hub is gone; the boards
//     come back on new chains).
//   · BUSY SWITCH — the phone leaves halfway through the corpus for AWAY_BUSY_MS while the swarm works on.
// Each comeback names the cursors the phone held, as FieldLink does (`params.resuming(remote.cursors)`), and a
// whole open is taken beside it at the same instant: the saving is measured, never assumed.

/** The idle tail after the corpus: thirty heartbeats. */
export const IDLE_MS = 30_000;
/** A short app switch, well inside the hub's linger. */
export const AWAY_IDLE_MS = 5_000;
/** An app switch the hub does not outlive. */
export const PAST_LINGER_MS = AGENT_FIELD.MESH_HUB_LINGER_MS + 30_000;
/** The busy switch's away, at most a quarter of the corpus. */
export const AWAY_BUSY_MS = 2_000;

/** The phone's floor at its home (`boardFloor` for a tailnet principal). */
export const PHONE_FLOOR_MS = AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS;

/** A door's first subscription id: its length rides every frame. */
const SUB_ID = "ps-1";
const utf8 = new TextEncoder();
const bytesOf = (value: unknown): number => utf8.encode(JSON.stringify(value)).length;
const frameBytes = (payload: unknown, kind: "delta" | "snapshot"): number =>
  bytesOf({ jsonrpc: "2.0", method: `agent.${kind}`, params: { subId: SUB_ID, payload } });
const openBytes = (open: MeshBoardOpen): number =>
  bytesOf({ jsonrpc: "2.0", id: 1, result: { subId: SUB_ID, snapshot: open } });

/** What the phone heard over one window. */
export interface WireTally {
  windowMs: number;
  frames: number;
  /** empty deltas: the mesh heartbeat */
  heartbeats: number;
  /** a device's whole board mid-stream (a re-present or a repair, PG-1d) */
  resets: number;
  /** a device's state alone (connected, stale, …) */
  states: number;
  /** the whole mesh again (PG-1c's resync; none without a socket) */
  resyncs: number;
  upserts: number;
  removed: number;
  bytes: number;
  bytesPerSecond: number;
}

/** How one open answered its desktops (S4b's `MeshOpenAnswers`, on the desk). */
export interface OpenAnswers {
  resumed: number;
  delta: number;
  whole: number;
  unanswered: number;
}

export interface SwitchResult {
  name: string;
  awayMs: number;
  answers: OpenAnswers;
  /** the comeback's open, answered by cursor */
  bytes: number;
  /** a whole open at the same instant */
  wholeBytes: number;
  /** the rows the comeback carried: a delta's upserts, a whole board's rows */
  rows: number;
  /** the first floor after the comeback: what still follows it (a desktop's board on a new chain is a reset
   * here, which the open alone would not show) */
  after: { frames: number; resets: number; bytes: number };
}

export interface MeshBenchResult {
  recipe: string;
  n: number;
  durationMs: number;
  floorMs: number;
  /** what the hub asked the peer's door */
  upstreamAsk: { minIntervalMs: number; heartbeatMs: number | null };
  open: { devices: number; rows: number; bytes: number };
  busy: WireTally;
  idle: WireTally;
  switches: SwitchResult[];
}

/** A corpus with both desktops' ticks, generated once; each pass replays a fresh copy. */
export interface MeshCorpus {
  recipe: CorpusRecipe;
  name: string;
  baseWall: number;
  durationMs: number;
  here: ReturnType<typeof deviceOf>;
  peer: ReturnType<typeof deviceOf>;
  roster: DeviceInfo[];
  hereFloor: ReturnType<typeof floorOfPanes>;
  ticks: CorpusTick[];
}

export function prepareMeshCorpus(input: CorpusRecipe): MeshCorpus {
  const recipe = resolveRecipe(input);
  const lived: CorpusTick[] = [];
  const corpus = generateCorpus(recipe, (tick) => lived.push(tick));
  const ticks = wire(lived);
  const first = ticks[0];
  if (first?.tMs !== 0 || first.here === undefined || first.peer === undefined) {
    throw new Error("the corpus's first tick carries no boards");
  }
  const agentPtys = new Set(
    first.here.flatMap((row) =>
      row.terminal?.runtimeSessionId !== undefined ? [row.terminal.runtimeSessionId] : [],
    ),
  );
  return {
    recipe: input,
    name: recipeName(input),
    baseWall: recipe.baseWall,
    durationMs: recipe.durationMs,
    here: deviceOf(corpus.roster, corpus.meta.here),
    peer: deviceOf(corpus.roster, corpus.meta.peer),
    // the roster as the relay reads it: the peer is a desktop (DS-D7's test), as the model stream reads it
    roster: corpus.roster.map((row) =>
      row.self ? row : ({ ...row, capabilities: { docHost: true, push: false } } as DeviceInfo),
    ),
    hereFloor: floorOfPanes(corpus.panes, agentPtys),
    ticks,
  };
}

interface HostedPair {
  here: HostedDesktop;
  peer: HostedDesktop;
  board: MeshBoard;
  upstreamAsk: MeshBenchResult["upstreamAsk"];
  dispose(): void;
}

async function hostPair(
  prepared: MeshCorpus,
  ticks: CorpusTick[],
  time: VirtualTime,
): Promise<HostedPair> {
  if (time.now() !== prepared.baseWall) {
    throw new Error(
      `the virtual clock must start at the recipe's baseWall (${prepared.baseWall}); it reads ${time.now()}`,
    );
  }
  const first = ticks[0] as CorpusTick & {
    here: AgentSessionSummary[];
    peer: AgentSessionSummary[];
  };
  const here = await hostDesktop(prepared.here, first.here, prepared.hereFloor, time);
  const peer = await hostDesktop(prepared.peer, first.peer, floorOfRows(first.peer), time);
  const epochs = { here: 0, peer: 0 };
  const upstreamAsk: MeshBenchResult["upstreamAsk"] = { minIntervalMs: 0, heartbeatMs: null };
  const board = new MeshBoard({
    selfDevice: () => here.device,
    roster: { list: () => prepared.roster, on: () => undefined, off: () => undefined },
    links: { linkState: () => "connected", on: () => undefined, off: () => undefined },
    now: () => Date.now(),
    // this desktop's own board for the phone's hub: `openLocalBoard("remote", …)`
    openLocal: (projection, minIntervalMs, emit) => {
      if (projection !== "remote") {
        throw new Error(`the mesh bench opens the phone's remote hub alone, not ${projection}`);
      }
      const epoch = `${here.device}-boot.${++epochs.here}`;
      const local = createRemoteSubscription({
        fold: here.fold,
        monitor: here.service,
        emit,
        epoch,
        minIntervalMs,
        terminalPublished: () => true,
      });
      return { snapshot: { ...local.snapshot, epoch }, dispose: local.dispose };
    },
    // the peer's door, answered by its own fieldd at what the hub asks
    upstreams: {
      attach: async (_device, _method, params, emit) => {
        const ask = params as { minIntervalMs: number; heartbeatMs?: number };
        upstreamAsk.minIntervalMs = ask.minIntervalMs;
        upstreamAsk.heartbeatMs = ask.heartbeatMs ?? null;
        const epoch = `${peer.device}-boot.${++epochs.peer}`;
        const remote = createRemoteSubscription({
          fold: peer.fold,
          monitor: peer.service,
          // through JSON, as the federated link carries it; the kind as sent (PG-1d)
          emit: (frame, kind) => emit(wire(frame), kind),
          epoch,
          minIntervalMs: ask.minIntervalMs,
          ...(ask.heartbeatMs !== undefined ? { heartbeatMs: ask.heartbeatMs } : {}),
          terminalPublished: () => true,
        });
        return { snapshot: wire({ ...remote.snapshot, epoch }), dispose: remote.dispose };
      },
    },
  });
  return {
    here,
    peer,
    board,
    upstreamAsk,
    dispose() {
      board.dispose();
      here.service.dispose();
      peer.service.dispose();
    },
  };
}

function emptyTally(): WireTally {
  return {
    windowMs: 0,
    frames: 0,
    heartbeats: 0,
    resets: 0,
    states: 0,
    resyncs: 0,
    upserts: 0,
    removed: 0,
    bytes: 0,
    bytesPerSecond: 0,
  };
}

function closed(tally: WireTally, windowMs: number): WireTally {
  return {
    ...tally,
    windowMs,
    bytesPerSecond: Math.round((tally.bytes / (windowMs / 1_000)) * 10) / 10,
  };
}

/** The phone: one subscription through the door's own install, the cursors FieldLink keeps, and a tally. */
class Phone {
  readonly cursors = new Map<string, MeshCursor>();
  tally = emptyTally();
  #reader: { dispose: () => void } | null = null;
  readonly #board: MeshBoard;

  constructor(board: MeshBoard) {
    this.#board = board;
  }

  /** Subscribe, naming the cursors held (none on a first open); the open's bytes and answers. */
  open(): { open: MeshBoardOpen; bytes: number; answers: OpenAnswers; rows: number } {
    const since = this.cursors.size > 0 ? Object.fromEntries(this.cursors) : undefined;
    const sub = this.#board.subscribe(
      "remote",
      PHONE_FLOOR_MS,
      (payload, kind = "delta") => this.#heard(payload, kind),
      since,
    );
    this.#reader = sub;
    const open = wire(sub.snapshot);
    return { open, bytes: openBytes(open), ...this.#follow(open) };
  }

  /** The app switched away: the subscription ends, the cursors stay. */
  leave(): void {
    this.#reader?.dispose();
    this.#reader = null;
  }

  #heard(payload: unknown, kind: "delta" | "snapshot"): void {
    const read = wire(payload);
    this.tally.frames += 1;
    this.tally.bytes += frameBytes(read, kind);
    if (kind === "snapshot") {
      this.tally.resyncs += 1;
      this.cursors.clear();
      this.#follow(read as MeshBoardOpen);
      return;
    }
    const frame = read as MeshBoardFrame;
    if ("delta" in frame) {
      this.tally.upserts += frame.delta.upserts.length;
      this.tally.removed += frame.delta.removed.length;
      if (frame.delta.upserts.length === 0 && frame.delta.removed.length === 0)
        this.tally.heartbeats += 1;
      this.cursors.set(frame.device, { epoch: frame.delta.epoch, revision: frame.delta.revision });
    } else if ("snapshot" in frame) {
      this.tally.resets += 1;
      this.cursors.set(frame.device, {
        epoch: frame.snapshot.epoch,
        revision: frame.snapshot.revision,
      });
    } else {
      this.tally.states += 1;
    }
  }

  /** An open's answers, applied to the cursors as the phone's copy applies them. */
  #follow(open: MeshBoardOpen): { answers: OpenAnswers; rows: number } {
    const answers: OpenAnswers = { resumed: 0, delta: 0, whole: 0, unanswered: 0 };
    let rows = 0;
    for (const entry of open.devices) {
      if (entry.resumed !== undefined) {
        answers.resumed += 1;
        this.cursors.set(entry.device, entry.resumed);
      } else if (entry.delta !== undefined) {
        answers.delta += 1;
        rows += entry.delta.upserts.length;
        this.cursors.set(entry.device, {
          epoch: entry.delta.epoch,
          revision: entry.delta.revision,
        });
      } else if (entry.snapshot !== undefined) {
        answers.whole += 1;
        rows += entry.snapshot.rows.length;
        this.cursors.set(entry.device, {
          epoch: entry.snapshot.epoch,
          revision: entry.snapshot.revision,
        });
      } else {
        answers.unanswered += 1;
        this.cursors.delete(entry.device);
      }
    }
    return { answers, rows };
  }
}

/** The ticks in [fromMs, untilMs), each desktop's states then its fold's publish, as a daemon sees them. */
async function play(
  prepared: MeshCorpus,
  pair: HostedPair,
  ticks: readonly CorpusTick[],
  time: VirtualTime,
  fromMs: number,
  untilMs: number,
): Promise<void> {
  for (const tick of ticks) {
    if (tick.tMs < fromMs || tick.tMs >= untilMs || tick.tMs === 0) continue;
    await time.advance(prepared.baseWall + tick.tMs - time.now());
    if (tick.here !== undefined) liveTick(pair.here, tick.here);
    if (tick.peer !== undefined) liveTick(pair.peer, tick.peer);
    await time.advance(0);
  }
}

/** The phone's first open, on a warm hub: the peer's board held, as a desktop whose own windows read it. */
async function firstOpen(
  pair: HostedPair,
  time: VirtualTime,
): Promise<{ phone: Phone; open: MeshBenchResult["open"] }> {
  const warm = pair.board.open("remote", PHONE_FLOOR_MS, () => undefined);
  // the upstream's attach is async: its snapshot lands on the next turn
  await time.advance(0);
  const phone = new Phone(pair.board);
  const first = phone.open();
  warm.dispose();
  if (
    first.open.devices.length !== 2 ||
    first.open.devices.some((device) => device.snapshot === undefined)
  ) {
    throw new Error(
      `the phone's open did not hold both desktops' boards: ${JSON.stringify(first.open.devices.map((d) => [d.device, d.state, d.snapshot !== undefined]))}`,
    );
  }
  return {
    phone,
    open: { devices: first.open.devices.length, rows: first.rows, bytes: first.bytes },
  };
}

/** Come back with the cursors held, beside a whole open at the same instant; then the first floor after it,
 * which `settle` plays (the clock alone, or the swarm's ticks too). */
async function comeBack(
  pair: HostedPair,
  phone: Phone,
  name: string,
  awayMs: number,
  settle: () => Promise<void>,
): Promise<SwitchResult> {
  const back = phone.open();
  const probe = pair.board.open("remote", PHONE_FLOOR_MS, () => undefined);
  const wholeBytes = openBytes(wire(probe.open));
  probe.dispose();
  phone.tally = emptyTally();
  await settle();
  const after = {
    frames: phone.tally.frames,
    resets: phone.tally.resets,
    bytes: phone.tally.bytes,
  };
  return {
    name,
    awayMs,
    answers: back.answers,
    bytes: back.bytes,
    wholeBytes,
    rows: back.rows,
    after,
  };
}

/** STREAM: busy through the corpus, idle after it, then two app switches. */
export async function streamPass(
  prepared: MeshCorpus,
  time: VirtualTime,
): Promise<Omit<MeshBenchResult, "recipe" | "n" | "durationMs" | "floorMs">> {
  const ticks = wire(prepared.ticks);
  const pair = await hostPair(prepared, ticks, time);
  await time.advance(0);
  const { phone, open } = await firstOpen(pair, time);

  const busyStart = time.now();
  await play(prepared, pair, ticks, time, 0, Number.POSITIVE_INFINITY);
  // the trailing floor: what the last ticks' changes still owe the phone
  await time.advance(PHONE_FLOOR_MS);
  const busy = closed(phone.tally, time.now() - busyStart);

  phone.tally = emptyTally();
  await time.advance(IDLE_MS);
  const idle = closed(phone.tally, IDLE_MS);

  const switches: SwitchResult[] = [];
  phone.leave();
  await time.advance(AWAY_IDLE_MS);
  const floor = () => time.advance(PHONE_FLOOR_MS);
  switches.push(await comeBack(pair, phone, `idle ${AWAY_IDLE_MS / 1_000} s`, AWAY_IDLE_MS, floor));
  phone.leave();
  await time.advance(PAST_LINGER_MS);
  switches.push(
    await comeBack(
      pair,
      phone,
      `idle ${PAST_LINGER_MS / 1_000} s, past the hub's linger`,
      PAST_LINGER_MS,
      floor,
    ),
  );
  phone.leave();
  pair.dispose();
  return { upstreamAsk: { ...pair.upstreamAsk }, open, busy, idle, switches };
}

/** BUSY SWITCH: away for AWAY_BUSY_MS from the corpus's halfway, while the swarm works on. */
export async function busySwitchPass(
  prepared: MeshCorpus,
  time: VirtualTime,
): Promise<SwitchResult> {
  const ticks = wire(prepared.ticks);
  const pair = await hostPair(prepared, ticks, time);
  await time.advance(0);
  const { phone } = await firstOpen(pair, time);
  const half = Math.floor(prepared.durationMs / 2);
  const away = Math.min(AWAY_BUSY_MS, Math.floor(prepared.durationMs / 4));
  await play(prepared, pair, ticks, time, 0, half);
  await time.advance(prepared.baseWall + half - time.now());
  phone.leave();
  await play(prepared, pair, ticks, time, half, half + away);
  const back = half + away;
  await time.advance(prepared.baseWall + back - time.now());
  const result = await comeBack(
    pair,
    phone,
    `busy ${away / 1_000} s, from the corpus's halfway`,
    away,
    async () => {
      // the swarm works on through the comeback's first floor
      await play(prepared, pair, ticks, time, back, back + PHONE_FLOOR_MS);
      await time.advance(prepared.baseWall + back + PHONE_FLOOR_MS - time.now());
    },
  );
  phone.leave();
  pair.dispose();
  return result;
}
