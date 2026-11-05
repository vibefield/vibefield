import { EventEmitter } from "node:events";
import {
  AGENT_FIELD,
  type AgentFieldRow,
  CONTRACTS_VERSION,
  type DeviceInfo,
} from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BoardProjection,
  MeshBoard,
  type MeshBoardFrame,
  type MeshBoardOpen,
} from "../src/mesh-board";
import { RpcCallError } from "../src/native-link";

// DS-3 (DS-D4) — the mesh board's multiplexer against fakes: the roster
// (DeviceService's `list` + "changed"), the links (PeerLink's `linkState` +
// "link-changed") and the upstreams (the federated manager's `attach`). The
// two-daemon witness is `mesh-board.e2e.test.ts`; this file pins the rules one
// at a time, with the clock in hand.

const SELF = "dev-self";

const capabilities = { terminalHost: true, docHost: true, push: false };

function desktop(deviceId: string, over: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    deviceId,
    name: deviceId,
    platform: "darwin",
    self: false,
    online: true,
    lastSeenAt: Date.parse("2026-09-30T20:00:00.000Z"),
    capabilities,
    bootId: `boot-${deviceId}`,
    contractsVersion: CONTRACTS_VERSION,
    fielddVersion: "0.1.0",
    ...over,
  };
}

const selfRow: DeviceInfo = {
  deviceId: SELF,
  name: "here",
  platform: "darwin",
  self: true,
  online: true,
  lastSeenAt: 0,
  capabilities,
};

/** A phone: a self node the roster lists from the tailnet's registry, with no
 * device slice behind it — so no `docHost`, and no dial. */
const phone: DeviceInfo = {
  deviceId: "dev-phone",
  name: "phone",
  self: false,
  online: true,
  lastSeenAt: 0,
};

function row(runtimeRunId: string, device: string, revision = 1): AgentFieldRow {
  return {
    runtimeRunId,
    revision,
    kind: "claude",
    label: "Claude Code",
    tier: "managed",
    device,
    status: "working",
    statusSince: "2026-09-30T21:00:00.000Z",
    stateChangedAt: "2026-09-30T21:00:00.000Z",
    createdAt: "2026-09-30T20:00:00.000Z",
    alive: true,
    blockers: [],
  };
}

class FakeRoster extends EventEmitter {
  rows: DeviceInfo[] = [];
  list(): DeviceInfo[] {
    return this.rows;
  }
  set(rows: DeviceInfo[]): void {
    this.rows = rows;
    this.emit("changed", rows);
  }
}

class FakeLinks extends EventEmitter {
  readonly states = new Map<string, "connected" | "dialing" | "incompatible">();
  linkState(deviceId: string) {
    return this.states.get(deviceId);
  }
  pin(deviceId: string): void {
    this.states.set(deviceId, "incompatible");
    this.emit("link-changed", { deviceId, state: "incompatible" });
  }
}

interface Attach {
  device: string;
  method: string;
  params: unknown;
  emit: (payload: unknown, kind?: "delta" | "snapshot") => void;
  resolve: (value: { snapshot: unknown; dispose: () => void; start?: () => void }) => void;
  reject: (error: unknown) => void;
  disposed: boolean;
}

class FakeUpstreams {
  readonly attaches: Attach[] = [];
  attach(
    device: string,
    method: string,
    params: unknown,
    emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void; start?: () => void }> {
    return new Promise((resolve, reject) => {
      this.attaches.push({ device, method, params, emit, resolve, reject, disposed: false });
    });
  }
  /** answer an attach with the peer's snapshot; the dispose marks it closed;
   * `start` is the manager's hand-over of what followed the snapshot */
  answer(attach: Attach, snapshot: unknown, start?: () => void): void {
    attach.resolve({
      snapshot,
      dispose: () => {
        attach.disposed = true;
      },
      ...(start !== undefined ? { start } : {}),
    });
  }
  standing(): Attach[] {
    return this.attaches.filter((attach) => !attach.disposed);
  }
}

/** Let the attach's `.then` run. */
async function tick(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

interface Harness {
  board: MeshBoard;
  /** PG-3b — each upstream that came back, by device (`onUpstreamReady`) */
  ready: string[];
  roster: FakeRoster;
  links: FakeLinks;
  upstreams: FakeUpstreams;
  local: {
    emit: ((frame: unknown, kind?: "delta" | "snapshot") => void) | null;
    opened: number;
    disposed: number;
  };
}

function harness(rows: DeviceInfo[], selfDevice: () => string = () => SELF): Harness {
  const roster = new FakeRoster();
  roster.rows = rows;
  const links = new FakeLinks();
  const upstreams = new FakeUpstreams();
  const local: Harness["local"] = { emit: null, opened: 0, disposed: 0 };
  const ready: string[] = [];
  const board = new MeshBoard({
    selfDevice,
    roster,
    links,
    upstreams,
    onUpstreamReady: (device) => ready.push(device),
    openLocal: (_projection, _floor, emit) => {
      local.emit = emit as NonNullable<Harness["local"]["emit"]>;
      local.opened += 1;
      return {
        snapshot: { epoch: "self-boot.1", revision: 1, rows: [row("run-here", SELF)] },
        dispose: () => {
          local.disposed += 1;
        },
      };
    },
  });
  return { board, ready, roster, links, upstreams, local };
}

/** A reader, and the frames it has heard. PG-9 — `since`, the cursors it names (absent: today's ask). */
function reader(
  h: Harness,
  projection: BoardProjection = "remote",
  floor = 100,
  since?: Record<string, { epoch: string; revision: number }>,
) {
  const frames: MeshBoardFrame[] = [];
  const opened = h.board.open(projection, floor, (frame) => frames.push(frame), since);
  return { ...opened, frames };
}

const peerSnapshot = (revision = 41) => ({
  epoch: "boot-dev-b.3",
  revision,
  rows: [row("run-b", "dev-b", 7)],
});

describe("the mesh board — one door for every self desktop (DS-D4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-30T21:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("lists this desktop live with its board, every desktop peer, and no phone", () => {
    const h = harness([selfRow, desktop("dev-b"), desktop("dev-c", { online: false }), phone]);
    const r = reader(h);
    expect(r.open.devices.map((entry) => [entry.device, entry.state])).toEqual([
      [SELF, "live"],
      ["dev-b", "stale"], // online, not yet heard
      ["dev-c", "asleep"],
    ]);
    expect(r.open.devices[0]?.snapshot).toEqual({
      epoch: "self-boot.1",
      revision: 1,
      rows: [row("run-here", SELF)],
    });
    // asleep is listed with nothing invented for it
    expect(r.open.devices[2]?.snapshot).toBeUndefined();
    // ONE upstream: the awake desktop, asked for its own board at the reader's
    // floor, with a heartbeat — never the asleep one, never the phone
    expect(
      h.upstreams.attaches.map((attach) => [attach.device, attach.method, attach.params]),
    ).toEqual([
      [
        "dev-b",
        "agent.subscribe",
        { projection: "remote", minIntervalMs: 100, heartbeatMs: 1_000 },
      ],
    ]);
    r.dispose();
  });

  // PG-2 (PG-L1, PG-D8 (a)) — the relay asks each OWNER for its remote cut, so
  // the owner cuts and paces its rows and the home only relays them (DS-D4).
  it("PG-2 — a window's model hub asks each peer for its remote board at the remote floor; the phone's hub asks the same at the phone's floor", () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const window = reader(h, "model", AGENT_FIELD.FULL_TICK_MS);
    const phone = reader(h, "remote", AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS);
    expect(h.upstreams.attaches.map((attach) => attach.params)).toEqual([
      {
        projection: "remote",
        minIntervalMs: AGENT_FIELD.REMOTE_MIN_INTERVAL_MS,
        heartbeatMs: AGENT_FIELD.MESH_HEARTBEAT_MS,
      },
      {
        projection: "remote",
        minIntervalMs: AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS,
        heartbeatMs: AGENT_FIELD.MESH_HEARTBEAT_MS,
      },
    ]);
    // two floors, two hubs: the phone's never slows a window's, nor a window's hurries the phone's
    expect(h.board.size).toBe(2);
    window.dispose();
    phone.dispose();
  });

  it("takes what a peer sent right behind its snapshot only AFTER applying the snapshot (the manager's start, 2026-10-01)", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    const behind = {
      epoch: "boot-dev-b.3",
      since: 41,
      revision: 42,
      upserts: [{ ...row("run-b", "dev-b", 8), status: "blocked" }],
      removed: [],
    };
    h.upstreams.answer(attach, peerSnapshot(), () => attach.emit(behind, "delta"));
    await tick();
    expect(r.frames).toEqual([
      { device: "dev-b", snapshot: peerSnapshot() },
      { device: "dev-b", state: "live", asOf: "2026-09-30T21:00:00.000Z" },
      { device: "dev-b", delta: behind },
    ]);
    r.dispose();
  });

  it("relays a peer's frames VERBATIM: its epoch, its revisions, its rows", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    expect(r.frames).toEqual([
      { device: "dev-b", snapshot: peerSnapshot() },
      { device: "dev-b", state: "live", asOf: "2026-09-30T21:00:00.000Z" },
    ]);
    const delta = {
      epoch: "boot-dev-b.3",
      since: 41,
      revision: 42,
      upserts: [{ ...row("run-b", "dev-b", 8), status: "blocked" }],
      removed: [],
    };
    attach.emit(delta, "delta");
    // nothing renumbered: the owner's since and revision, the owner's row stamp
    expect(r.frames.at(-1)).toEqual({ device: "dev-b", delta });
    // a reader who arrives now is answered from the held copy, at the owner's revision
    const late = reader(h);
    expect(late.open.devices.find((entry) => entry.device === "dev-b")).toEqual({
      device: "dev-b",
      state: "live",
      asOf: "2026-09-30T21:00:00.000Z",
      snapshot: {
        epoch: "boot-dev-b.3",
        revision: 42,
        rows: [{ ...row("run-b", "dev-b", 8), status: "blocked" }],
      },
    });
    late.dispose();
    r.dispose();
  });

  it("a heartbeat keeps a quiet desktop live and reaches no reader; silence makes it stale and keeps its board", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    const heard = r.frames.length;
    for (let beat = 0; beat < 5; beat += 1) {
      vi.advanceTimersByTime(1_000);
      attach.emit({ epoch: "boot-dev-b.3", since: 41, revision: 41, upserts: [], removed: [] });
    }
    expect(r.frames).toHaveLength(heard); // five beats, nothing for a reader to apply
    // the beats stop: three missed, and the board says so — and only so
    vi.advanceTimersByTime(3_000);
    expect(r.frames.length).toBe(heard);
    vi.advanceTimersByTime(1_000);
    expect(r.frames.slice(heard)).toEqual([
      { device: "dev-b", state: "stale", asOf: "2026-09-30T21:00:09.000Z" },
    ]);
    const late = reader(h);
    expect(late.open.devices.find((entry) => entry.device === "dev-b")).toMatchObject({
      state: "stale",
      snapshot: peerSnapshot(),
    });
    late.dispose();
    r.dispose();
  });

  it("offline in the roster is asleep: the upstream closes, the board stays, no rows are sent; awake again, it resets", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    const before = r.frames.length;
    h.roster.set([selfRow, desktop("dev-b", { online: false })]);
    expect(r.frames.slice(before)).toEqual([
      { device: "dev-b", state: "asleep", asOf: "2026-09-30T20:00:00.000Z" },
    ]);
    expect(attach.disposed).toBe(true);
    const late = reader(h);
    expect(late.open.devices.find((entry) => entry.device === "dev-b")).toMatchObject({
      state: "asleep",
      snapshot: peerSnapshot(),
    });
    late.dispose();

    h.roster.set([selfRow, desktop("dev-b")]);
    const again = h.upstreams.attaches[1];
    if (again === undefined) throw new Error("no second upstream");
    h.upstreams.answer(again, { epoch: "boot-dev-b.4", revision: 1, rows: [] });
    await tick();
    expect(r.frames.slice(-3)).toEqual([
      { device: "dev-b", state: "stale", asOf: "2026-09-30T21:00:00.000Z" },
      { device: "dev-b", snapshot: { epoch: "boot-dev-b.4", revision: 1, rows: [] } },
      { device: "dev-b", state: "live", asOf: "2026-09-30T21:00:00.000Z" },
    ]);
    r.dispose();
  });

  it("a desktop that leaves the roster keeps its last board, asleep", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    h.roster.set([selfRow]);
    expect(r.frames.at(-1)).toMatchObject({ device: "dev-b", state: "asleep" });
    expect(attach.disposed).toBe(true);
    const late = reader(h);
    expect(late.open.devices.map((entry) => entry.device)).toEqual([SELF, "dev-b"]);
    late.dispose();
    r.dispose();
  });

  it("a door that REFUSES the board reads incompatible, and is asked again only when the peer changes", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    h.upstreams.attaches[0]?.reject(
      new RpcCallError("FORBIDDEN_SCOPE", "agent.subscribe is local to its device", false),
    );
    await tick();
    expect(r.frames.at(-1)).toMatchObject({ device: "dev-b", state: "incompatible" });
    vi.advanceTimersByTime(120_000);
    h.roster.set([selfRow, desktop("dev-b")]); // the same facts: still not asked
    expect(h.upstreams.attaches).toHaveLength(1);
    h.roster.set([selfRow, desktop("dev-b", { bootId: "boot-dev-b-upgraded" })]);
    expect(h.upstreams.attaches).toHaveLength(2);
    expect(r.frames.at(-1)).toMatchObject({ device: "dev-b", state: "stale" });
    r.dispose();
  });

  it("a transport failure is retried with backoff while the desktop stays awake", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const unreachable = () =>
      new RpcCallError("UNAVAILABLE", "peer unreachable", true, {
        device: "dev-b",
        state: "unreachable",
      });
    h.upstreams.attaches[0]?.reject(unreachable());
    await tick();
    expect(r.open.devices.find((entry) => entry.device === "dev-b")?.state).toBe("stale");
    vi.advanceTimersByTime(999);
    expect(h.upstreams.attaches).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(h.upstreams.attaches).toHaveLength(2);
    h.upstreams.attaches[1]?.reject(unreachable());
    await tick();
    vi.advanceTimersByTime(1_999);
    expect(h.upstreams.attaches).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(h.upstreams.attaches).toHaveLength(3);
    r.dispose();
  });

  it("another contracts major and a pinned link are incompatible, and a pinned link's upstream closes", async () => {
    const h = harness([selfRow, desktop("dev-b"), desktop("dev-d", { contractsVersion: "9.0.0" })]);
    const r = reader(h);
    expect(r.open.devices.find((entry) => entry.device === "dev-d")?.state).toBe("incompatible");
    // DS-L9 — another major is not asked
    expect(h.upstreams.attaches.map((attach) => attach.device)).toEqual(["dev-b"]);
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    h.links.pin("dev-b");
    expect(attach.disposed).toBe(true);
    expect(r.frames.at(-1)).toMatchObject({ device: "dev-b", state: "incompatible" });
    r.dispose();
  });

  it("a gap in the owner's chain is a reset, never a repair", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    const before = r.frames.length;
    // a delta that does not start where the held copy is
    attach.emit({ epoch: "boot-dev-b.3", since: 45, revision: 46, upserts: [], removed: ["x"] });
    expect(r.frames).toHaveLength(before); // nothing a reader cannot follow is relayed
    expect(attach.disposed).toBe(true);
    vi.advanceTimersByTime(1_000);
    const again = h.upstreams.attaches[1];
    if (again === undefined) throw new Error("no re-ask");
    h.upstreams.answer(again, { epoch: "boot-dev-b.5", revision: 3, rows: [] });
    await tick();
    expect(r.frames.slice(before)).toEqual([
      { device: "dev-b", snapshot: { epoch: "boot-dev-b.5", revision: 3, rows: [] } },
    ]);
    r.dispose();
  });

  it("a board with no epoch (a fieldd older than DS-3) is incompatible: an epoch invented here would be a renumbering", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    h.upstreams.answer(attach, { revision: 4, rows: [] });
    await tick();
    expect(r.frames).toEqual([
      { device: "dev-b", state: "incompatible", asOf: "2026-09-30T21:00:00.000Z" },
    ]);
    expect(attach.disposed).toBe(true);
    r.dispose();
  });

  it("relays this desktop's own deltas on its own chain", () => {
    const h = harness([selfRow]);
    const r = reader(h);
    const delta = {
      epoch: "self-boot.1",
      since: 1,
      revision: 2,
      upserts: [],
      removed: ["run-here"],
    };
    h.local.emit?.(delta);
    expect(r.frames).toEqual([{ device: SELF, delta }]);
    r.dispose();
  });

  // PG-9a (item 135, 2026-11-01) — re-pinned: the last one out starts the hub's linger, and the close is the
  // linger's end (`AGENT_FIELD.MESH_HUB_LINGER_MS`), never the leaving itself.
  it("readers of one question share its upstreams; the last one out closes every one once the linger ends", async () => {
    const h = harness([selfRow, desktop("dev-b"), desktop("dev-c")]);
    const first = reader(h);
    const second = reader(h);
    expect(h.upstreams.attaches.map((attach) => attach.device)).toEqual(["dev-b", "dev-c"]);
    expect(h.local.opened).toBe(1);
    for (const attach of h.upstreams.attaches) h.upstreams.answer(attach, peerSnapshot());
    await tick();
    first.dispose();
    expect(h.upstreams.standing()).toHaveLength(2);
    expect(h.board.size).toBe(1);
    second.dispose();
    expect(h.upstreams.standing()).toHaveLength(2);
    expect(h.local.disposed).toBe(0);
    expect(h.board.size).toBe(1);
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS);
    expect(h.upstreams.standing()).toHaveLength(0);
    expect(h.local.disposed).toBe(1);
    expect(h.board.size).toBe(0);
    // another cadence is another question: its own hub, its own upstreams
    const slow = reader(h, "remote", 500);
    const field = reader(h, "field", 250);
    expect(h.board.size).toBe(2);
    expect(h.upstreams.standing().map((attach) => attach.params)).toEqual([
      { projection: "remote", minIntervalMs: 500, heartbeatMs: 1_000 },
      { projection: "remote", minIntervalMs: 500, heartbeatMs: 1_000 },
      { projection: "field", minIntervalMs: 250, heartbeatMs: 1_000 },
      { projection: "field", minIntervalMs: 250, heartbeatMs: 1_000 },
    ]);
    slow.dispose();
    field.dispose();
    expect(h.board.size).toBe(2);
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS);
    expect(h.board.size).toBe(0);
    // those four were still in flight when the hubs closed: each is closed the moment it answers
    for (const attach of h.upstreams.standing()) h.upstreams.answer(attach, peerSnapshot());
    await tick();
    expect(h.upstreams.standing()).toHaveLength(0);
  });

  it("a desktop's last board outlives its readers: Godview reopened while it sleeps still shows it", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const first = reader(h);
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    first.dispose(); // the last reader leaves, and once the linger ends the hub and its upstreams close
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS);
    expect(h.board.size).toBe(0);
    expect(attach.disposed).toBe(true);
    // the desktop falls asleep while nobody is watching
    h.roster.rows = [selfRow, desktop("dev-b", { online: false })];
    const later = reader(h);
    expect(later.open.devices.find((entry) => entry.device === "dev-b")).toMatchObject({
      state: "asleep",
      snapshot: peerSnapshot(),
    });
    // DS-L8: its board, greyed by its state — and nothing is asked of it asleep
    expect(h.upstreams.attaches).toHaveLength(1);
    // another projection keeps its own: a field reader never sees a remote board
    const field = reader(h, "field", 250);
    expect(field.open.devices.find((entry) => entry.device === "dev-b")?.snapshot).toBeUndefined();
    field.dispose();
    later.dispose();
  });

  // PG-9a — re-pinned: a reader's leaving starts the linger, so the attach is closed once the hub has closed
  it("an attach answered after its hub closed is closed at once", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    r.dispose();
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS);
    expect(h.board.size).toBe(0);
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    expect(attach.disposed).toBe(true);
  });

  // S6 (the landing review, 2026-10-01; the 23:25 mid-wave ruling) — the
  // roster's `state` replaces its `online` here, so one desktop never reads
  // one thing on the roster and another on the board.
  it("the roster's STATE decides, not its online: asleep and incompatible are the roster's word", async () => {
    const h = harness([
      selfRow,
      // the node is up, the roster says asleep: the roster wins
      desktop("dev-b", { online: true, state: "asleep" }),
      // the roster says incompatible (its slice's major, a door's refusal):
      // not asked, with no link pin and an even contracts version on the row
      desktop("dev-c", { online: true, state: "incompatible" }),
      desktop("dev-d", { online: true, state: "awake" }),
    ]);
    const r = reader(h);
    expect(r.open.devices.map((entry) => [entry.device, entry.state])).toEqual([
      [SELF, "live"],
      ["dev-b", "asleep"],
      ["dev-c", "incompatible"],
      ["dev-d", "stale"],
    ]);
    expect(h.upstreams.attaches.map((attach) => attach.device)).toEqual(["dev-d"]);
    // the roster's verdict moves, and the board follows it: incompatible no more
    h.roster.set([selfRow, desktop("dev-b"), desktop("dev-c", { state: "awake" })]);
    expect(h.upstreams.attaches.map((attach) => attach.device).sort()).toEqual([
      "dev-b",
      "dev-c",
      "dev-d",
    ]);
    r.dispose();
  });

  it("another major on the row reads incompatible even with no roster state (the roster's own helper)", () => {
    const [ours] = CONTRACTS_VERSION.split(".");
    const h = harness([
      selfRow,
      desktop("dev-b", { contractsVersion: `${Number(ours) + 1}.0.0` }),
      desktop("dev-c", { contractsVersion: `${ours}.7.0` }),
    ]);
    const r = reader(h);
    expect(r.open.devices.map((entry) => [entry.device, entry.state])).toEqual([
      [SELF, "live"],
      ["dev-b", "incompatible"],
      ["dev-c", "stale"],
    ]);
    expect(h.upstreams.attaches.map((attach) => attach.device)).toEqual(["dev-c"]);
    r.dispose();
  });

  it("a RESTARTING desktop is still dialled — a dial is what heals a silent door — and reads stale until it sends frames", async () => {
    const h = harness([selfRow, desktop("dev-b", { state: "restarting" })]);
    const r = reader(h);
    expect(r.open.devices.find((entry) => entry.device === "dev-b")?.state).toBe("stale");
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("a restarting desktop was not dialled");
    expect(attach.device).toBe("dev-b");
    // its door answers: frames arrive, and the board says live
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    expect(r.frames).toContainEqual({ device: "dev-b", state: "live", asOf: expect.any(String) });
    r.dispose();
  });

  it("names this desktop per answer: a hub opened before the mesh identity speaks it once it lands", () => {
    // DeviceService answers its persisted fallback id until its first sync
    let self = "local-1234";
    const h = harness([{ ...selfRow, deviceId: self }, desktop("dev-b")], () => self);
    const early = reader(h);
    expect(early.open.devices[0]).toMatchObject({ device: "local-1234", state: "live" });
    // the mesh identity lands: the roster's self row moves, and so does the hub
    self = SELF;
    h.roster.set([selfRow, desktop("dev-b")]);
    const late = reader(h); // the SAME hub (same projection and floor)
    expect(h.board.size).toBe(1);
    expect(late.open.devices.map((entry) => entry.device)).toEqual([SELF, "dev-b"]);
    // and this desktop's next delta goes out under its real name — a gap for a
    // reader that still holds the fallback, which re-opens
    h.local.emit?.({ since: 1, revision: 2, upserts: [row("run-here", SELF, 2)], removed: [] });
    expect(late.frames.at(-1)).toMatchObject({ device: SELF });
    expect(early.frames.at(-1)).toMatchObject({ device: SELF });
    early.dispose();
    late.dispose();
  });

  // the landing review's nit (2026-10-01) — the honest state names its service
  it("a stopped board refuses a reader with UNAVAILABLE {service, state: stopping}", () => {
    const h = harness([selfRow]);
    h.board.dispose();
    let refusal: unknown;
    try {
      h.board.open("remote", 100, () => {});
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(RpcCallError);
    expect(refusal).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "mesh-board", state: "stopping" },
    });
  });
});

// PG-1b (PG-L4.1) — the relay reads each peer row's KEY alone. It used to hold
// a peer's frames to the whole field row, so one row this build could not read
// refused the whole desktop (a sticky `incompatible`) or resynced it, and a desk
// row had to carry the field row beside its model row to be relayed at all.
describe("PG-1b — the relay reads each row's key alone (PG-L4.1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-30T21:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  const live = { device: "dev-b", state: "live", asOf: "2026-09-30T21:00:00.000Z" };
  /** an attached reader's upstream to dev-b */
  const attached = (h: Harness): Attach => {
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    return attach;
  };
  /** contracts' AgentDeskTerminalRow shape: a bare terminal, no label, tier or status */
  const terminalRow = {
    runtimeRunId: "term-b",
    revision: 3,
    kind: "terminal",
    device: "dev-b",
    terminal: { hosted: "local", runtimeSessionId: "pty-b", workloadClass: "shell" },
    monitorRow: { id: "t-b", kind: "terminal" },
  };

  it("relays a peer board carrying a bare terminal row, verbatim (PG-D5)", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const board = {
      epoch: "boot-dev-b.3",
      revision: 41,
      rows: [row("run-b", "dev-b", 7), terminalRow],
    };
    h.upstreams.answer(attached(h), board);
    await tick();
    expect(r.frames).toEqual([{ device: "dev-b", snapshot: board }, live]);
    r.dispose();
  });

  it("relays a slim row the owner cut, in a delta, and answers a late reader from the held copy", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const attach = attached(h);
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    // PG-2's remote row: the key, the owner's stamp, the device and the model row
    const slim = {
      runtimeRunId: "run-b",
      revision: 8,
      device: "dev-b",
      monitorRow: { id: "m-b", kind: "agent", status: "blocked" },
    };
    const delta = { epoch: "boot-dev-b.3", since: 41, revision: 42, upserts: [slim], removed: [] };
    attach.emit(delta, "delta");
    expect(r.frames.at(-1)).toEqual({ device: "dev-b", delta });
    expect(attach.disposed, "no resync: the chain held").toBe(false);
    const late = reader(h);
    expect(late.open.devices.find((entry) => entry.device === "dev-b")?.snapshot).toEqual({
      epoch: "boot-dev-b.3",
      revision: 42,
      rows: [slim],
    });
    late.dispose();
    r.dispose();
  });

  it("on the phone's field hub, a peer row with a word this build does not know still reaches the reader", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h, "field", 250);
    // a newer peer's tier: the relay is no judge of it; the reader drops what it cannot read
    const board = {
      epoch: "boot-dev-b.3",
      revision: 41,
      rows: [{ ...row("run-b", "dev-b", 7), tier: "hosted" }],
    };
    h.upstreams.answer(attached(h), board);
    await tick();
    expect(r.frames).toEqual([{ device: "dev-b", snapshot: board }, live]);
    r.dispose();
  });

  it("still refuses a board whose row has no key: no run id is incompatible", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const { runtimeRunId: _none, ...keyless } = row("run-b", "dev-b", 7);
    h.upstreams.answer(attached(h), { epoch: "boot-dev-b.3", revision: 41, rows: [keyless] });
    await tick();
    expect(r.frames.at(-1)).toMatchObject({ device: "dev-b", state: "incompatible" });
    r.dispose();
  });

  it("still refuses a row stamp that is no integer, and resyncs a delta whose row has an empty key", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    h.upstreams.answer(attached(h), {
      epoch: "boot-dev-b.3",
      revision: 41,
      rows: [{ ...row("run-b", "dev-b"), revision: 7.5 }],
    });
    await tick();
    expect(r.frames.at(-1)).toMatchObject({ device: "dev-b", state: "incompatible" });
    r.dispose();

    const h2 = harness([selfRow, desktop("dev-b")]);
    const r2 = reader(h2);
    const attach = attached(h2);
    h2.upstreams.answer(attach, peerSnapshot());
    await tick();
    attach.emit(
      {
        epoch: "boot-dev-b.3",
        since: 41,
        revision: 42,
        upserts: [row("", "dev-b", 8)],
        removed: [],
      },
      "delta",
    );
    expect(attach.disposed, "an unreadable delta resyncs").toBe(true);
    r2.dispose();
  });
});

describe("PG-1c — a reader's current open, the door's resync for a phone behind its cap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-30T21:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("is the open a reader joining now gets, at the owners' revisions, and the next frame chains from it (DS-L2)", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    attach.emit(
      {
        epoch: "boot-dev-b.3",
        since: 41,
        revision: 42,
        upserts: [{ ...row("run-b", "dev-b", 8), status: "blocked" }],
        removed: [],
      },
      "delta",
    );
    h.local.emit?.({ since: 1, revision: 2, upserts: [row("run-here", SELF, 2)], removed: [] });
    const asked = h.upstreams.attaches.length;

    const current = r.current();
    const late = reader(h);
    expect(current).toEqual(late.open);
    // each owner's own epoch and revision, nothing renumbered, no owner re-asked
    expect(
      current.devices.map((entry) => [
        entry.device,
        entry.snapshot?.epoch,
        entry.snapshot?.revision,
      ]),
    ).toEqual([
      [SELF, "self-boot.1", 2],
      ["dev-b", "boot-dev-b.3", 42],
    ]);
    expect(h.upstreams.attaches).toHaveLength(asked);

    // the owner's next frame continues from the current open's revision
    const next = {
      epoch: "boot-dev-b.3",
      since: 42,
      revision: 43,
      upserts: [row("run-b", "dev-b", 9)],
      removed: [],
    };
    attach.emit(next, "delta");
    expect(r.frames.at(-1)).toEqual({ device: "dev-b", delta: next });
    late.dispose();
    r.dispose();
  });

  it("the door's install answers the open, relays every frame as a delta, and resyncs with ONE whole-mesh snapshot", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const sent: Array<[unknown, string | undefined]> = [];
    const install = h.board.subscribe("remote", 100, (payload, kind) => sent.push([payload, kind]));
    const [attach] = h.upstreams.attaches;
    if (attach === undefined) throw new Error("no upstream");
    h.upstreams.answer(attach, peerSnapshot());
    await tick();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every(([, kind]) => kind === "delta")).toBe(true);

    const before = sent.length;
    install.resync();
    expect(sent).toHaveLength(before + 1);
    const late = reader(h);
    expect(sent.at(-1)).toEqual([late.open, "snapshot"]);
    // the open the install answered is the one a reader joining then got
    expect(install.snapshot.devices.map((entry) => entry.device)).toEqual([SELF, "dev-b"]);
    late.dispose();
    install.dispose();
    // PG-9a — the install's close is a reader's leaving: the hub lingers, then closes
    expect(h.board.size).toBe(1);
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS);
    expect(h.board.size).toBe(0);
  });
});

describe("PG-1d — this desktop's own board, re-presented in the hub", () => {
  it("takes its own board's mid-stream snapshot: the held copy replaced, ONE per-device snapshot broadcast, later deltas on the same chain", () => {
    const h = harness([selfRow]);
    const r = reader(h);
    const opened = r.open.devices.find((entry) => entry.device === SELF)?.snapshot;
    const heard = r.frames.length;
    // the self board re-presents on its own chain, its row presented anew (a
    // stand-in for the gate's withdrawn join: the hub reads nothing but the key)
    const represented = {
      epoch: "self-boot.1",
      revision: 1,
      rows: [{ ...row("run-here", SELF), status: "idle" }],
    };
    expect(represented, "the re-present differs from the open").not.toEqual(opened);
    h.local.emit?.(represented, "snapshot");
    expect(r.frames.slice(heard)).toEqual([{ device: SELF, snapshot: represented }]);
    // the held copy is REPLACED: a reader joining now, and a PG-1c resync, are
    // answered with it, never with the open
    const late = reader(h);
    expect(late.open.devices.find((entry) => entry.device === SELF)?.snapshot).toEqual(represented);
    expect(r.current()).toEqual(late.open);
    // and a later delta still flows to its readers, on the same chain
    h.local.emit?.(
      { since: 1, revision: 2, upserts: [row("run-here", SELF, 2)], removed: [] },
      "delta",
    );
    expect(r.frames.at(-1)).toMatchObject({
      device: SELF,
      delta: { epoch: "self-boot.1", since: 1, revision: 2 },
    });
    late.dispose();
    r.dispose();
  });
});

// PG-3b (the fold check, 2026-11-01) — an owner's upstream coming back is announced, at its first attach and at the
// re-attach after a resync on the same link: the home's carried reports ride beside it and are carried again then
// (`agent-screens.ts` `linkReady`), since a resync closes the owner's remote board without any re-dial.
describe("PG-3b — the mesh board says when an owner's upstream is back", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-30T21:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("PG-3b — onUpstreamReady fires once the snapshot is applied, and again after a resync re-attaches", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    const [first] = h.upstreams.attaches;
    if (first === undefined) throw new Error("no upstream");
    expect(h.ready).toEqual([]);
    h.upstreams.answer(first, peerSnapshot());
    await tick();
    expect(h.ready).toEqual(["dev-b"]);
    // an unreadable delta breaks the chain: the hub detaches, then re-attaches on the same link
    first.emit(
      {
        epoch: "boot-dev-b.3",
        since: 41,
        revision: 42,
        upserts: [row("", "dev-b", 8)],
        removed: [],
      },
      "delta",
    );
    expect(first.disposed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    const again = h.upstreams.attaches.at(-1);
    if (again === undefined || again === first) throw new Error("no re-attach");
    h.upstreams.answer(again, peerSnapshot(50));
    await tick();
    expect(h.ready).toEqual(["dev-b", "dev-b"]);
    r.dispose();
  });
});

// PG-9a (PG-L4.4's linger half, item 135, 2026-11-01) — a hub LINGERS after its last reader leaves. The phone is the
// only reader of its hub, and its app switch and its gap repair each unsubscribe, then subscribe again: an immediate
// close tore down every peer's upstream on each, and the new hub answered every other desktop `stale` on a new epoch
// until each re-attached — the grey flash. A reader back inside `AGENT_FIELD.MESH_HUB_LINGER_MS` rejoins the hub as it
// stands; past it the hub closes as it always did; the daemon stopping does not wait for it.
describe("PG-9a — a mesh hub lingers after its last reader (item 135)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-01T22:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  const cSnapshot = () => ({
    epoch: "boot-dev-c.9",
    revision: 5,
    rows: [row("run-c", "dev-c", 2)],
  });

  /** a phone's hub with both peers attached, answered and live */
  async function liveHub() {
    const h = harness([selfRow, desktop("dev-b"), desktop("dev-c")]);
    const phone = reader(h, "remote", AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS);
    const [b, c] = h.upstreams.attaches;
    if (b === undefined || c === undefined) throw new Error("no upstreams");
    h.upstreams.answer(b, peerSnapshot());
    h.upstreams.answer(c, cSnapshot());
    await tick();
    for (const device of ["dev-b", "dev-c"])
      expect(phone.frames).toContainEqual(expect.objectContaining({ device, state: "live" }));
    return { h, phone, b, c };
  }

  /** each owner's heartbeat, once a second, for `ms` */
  function beat(b: Attach, c: Attach, ms: number): void {
    for (let at = 0; at < ms; at += 1_000) {
      vi.advanceTimersByTime(1_000);
      b.emit({ epoch: "boot-dev-b.3", since: 41, revision: 41, upserts: [], removed: [] });
      c.emit({ epoch: "boot-dev-c.9", since: 5, revision: 5, upserts: [], removed: [] });
    }
  }

  it("an app switch inside the linger: the phone back is answered with every peer live on the epoch it held, and no owner is asked again", async () => {
    const { h, phone, b, c } = await liveHub();
    phone.dispose(); // FieldLink.pause: the phone's board is unsubscribed
    beat(b, c, 30_000); // away 30 s, while the owners keep beating
    const back = reader(h, "remote", AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS);
    // the open answer has no stale peer and no new epoch: the grey flash is gone
    expect(
      back.open.devices.map((entry) => [entry.device, entry.state, entry.snapshot?.epoch]),
    ).toEqual([
      [SELF, "live", "self-boot.1"],
      ["dev-b", "live", "boot-dev-b.3"],
      ["dev-c", "live", "boot-dev-c.9"],
    ]);
    // the same hub, the same upstreams and the same local board: nothing torn down, nothing re-dialled
    expect(h.board.size).toBe(1);
    expect(h.upstreams.attaches).toHaveLength(2);
    expect(h.upstreams.standing()).toEqual([b, c]);
    expect(h.local).toMatchObject({ opened: 1, disposed: 0 });
    // and the next frame continues the chain the phone holds
    const next = {
      epoch: "boot-dev-b.3",
      since: 41,
      revision: 42,
      upserts: [row("run-b", "dev-b", 8)],
      removed: [],
    };
    b.emit(next);
    expect(back.frames.at(-1)).toEqual({ device: "dev-b", delta: next });
    // the rejoin cancelled the linger: past it, the hub still stands for its reader
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS);
    expect(h.board.size).toBe(1);
    expect(h.upstreams.standing()).toEqual([b, c]);
    back.dispose();
  });

  it("a gap repair's unsubscribe-then-subscribe, in one turn: the new subscription is answered from the standing hub", async () => {
    const { h, phone, b, c } = await liveHub();
    phone.dispose(); // FieldProductClient.resnapshot: the UNSUBSCRIBE first, the subscribe right behind it
    const sent: unknown[] = [];
    const again = h.board.subscribe("remote", AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS, (payload) =>
      sent.push(payload),
    );
    expect(again.snapshot.devices.filter((entry) => entry.state !== "live")).toEqual([]);
    expect(h.upstreams.attaches).toHaveLength(2);
    expect(h.upstreams.standing()).toEqual([b, c]);
    expect(h.local.disposed).toBe(0);
    again.dispose();
  });

  it("past the linger the hub closes: its upstreams and its local board; the next reader builds a new hub", async () => {
    const { h, phone, b, c } = await liveHub();
    phone.dispose();
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS - 1);
    expect(h.board.size).toBe(1);
    expect(h.upstreams.standing()).toEqual([b, c]);
    expect(h.local.disposed).toBe(0);
    vi.advanceTimersByTime(1);
    expect(h.board.size).toBe(0);
    expect(h.upstreams.standing()).toEqual([]);
    expect(h.local.disposed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    // a reader past it: a new hub dials again, and the peers wait in their kept boards, stale (DS-L8)
    const late = reader(h, "remote", AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS);
    expect(h.local.opened).toBe(2);
    expect(h.upstreams.attaches).toHaveLength(4);
    expect(late.open.devices.map((entry) => [entry.device, entry.state])).toEqual([
      [SELF, "live"],
      ["dev-b", "stale"],
      ["dev-c", "stale"],
    ]);
    late.dispose();
  });

  it("the board stopping during a linger closes the hub at once and leaves no timer", async () => {
    const { h, phone, b, c } = await liveHub();
    phone.dispose();
    // lingering: the hub, its upstreams and its timers stand
    expect(h.board.size).toBe(1);
    expect(h.upstreams.standing()).toEqual([b, c]);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    h.board.dispose();
    expect(h.board.size).toBe(0);
    expect(h.upstreams.standing()).toEqual([]);
    expect(h.local.disposed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    // nothing fires later: a minute on, the local board closed once
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS);
    expect(h.local.disposed).toBe(1);
  });

  // the PG-9a review [2] — the rule that a join CANCELS the linger, pinned where it bites: leave, rejoin, leave
  // again before the first linger would have ended. A timer left standing from the first leave would close the hub
  // a full linger after the FIRST leave, and a phone back at 65 s would get a new hub and the flash again.
  it("leave, rejoin, leave again: the hub closes a full linger after the SECOND leave, and the rejoin leaves no linger timer", async () => {
    const { h, phone, b, c } = await liveHub();
    const joined = vi.getTimerCount(); // the hub's own, with its reader
    phone.dispose(); // t = 0
    expect(vi.getTimerCount()).toBe(joined + 1); // the linger
    vi.advanceTimersByTime(30_000);
    const back = reader(h, "remote", AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS); // t = 30 s
    expect(vi.getTimerCount()).toBe(joined); // the rejoin cleared it
    vi.advanceTimersByTime(10_000);
    back.dispose(); // t = 40 s
    vi.advanceTimersByTime(21_000); // t = 61 s: past where the first linger would have ended
    expect(h.board.size).toBe(1);
    expect(h.upstreams.standing()).toEqual([b, c]);
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS - 21_001); // t = 40 s + LINGER - 1 ms
    expect(h.board.size).toBe(1);
    vi.advanceTimersByTime(1); // t = 40 s + LINGER
    expect(h.board.size).toBe(0);
    expect(h.upstreams.standing()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  // the PG-9a review [0] — hubs are keyed by {projection, floor}, and a floor is any integer a reader asks, so a
  // reader churning distinct floors would leave a hub lingering per value. At most MESH_LINGERING_HUBS_MAX linger;
  // past it the OLDEST closes at once, and a join takes its hub out of the order.
  it("at most MESH_LINGERING_HUBS_MAX hubs linger: churning distinct floors closes the oldest at once, and a rejoin makes a hub the newest", async () => {
    const max = AGENT_FIELD.MESH_LINGERING_HUBS_MAX;
    const h = harness([selfRow, desktop("dev-b")]);
    const floorOf = (attach: Attach) => (attach.params as { minIntervalMs: number }).minIntervalMs;
    /** a reader at one floor, its upstream answered, then gone */
    const churn = async (floor: number) => {
      const r = reader(h, "field", floor);
      const attach = h.upstreams.attaches.at(-1);
      if (attach !== undefined && !attach.disposed && floorOf(attach) === floor)
        h.upstreams.answer(attach, peerSnapshot());
      await tick();
      r.dispose();
    };
    const floors = [250, 251, 252, 253, 254, 255, 256];
    for (const [n, floor] of floors.entries()) {
      await churn(floor);
      // nothing waited: past the bound the oldest went the moment the newest began to linger
      expect(h.board.size).toBe(Math.min(n + 1, max));
      expect(h.local.disposed).toBe(Math.max(0, n + 1 - max));
    }
    // the newest four linger, each with its sweeper and its linger timer; the oldest three are closed
    expect(h.upstreams.standing().map(floorOf)).toEqual([253, 254, 255, 256]);
    expect(vi.getTimerCount()).toBe(2 * max);
    // a reader back at the oldest lingering floor rejoins it (no new dial) and, leaving, makes it the newest
    const attaches = h.upstreams.attaches.length;
    await churn(253);
    expect(h.upstreams.attaches).toHaveLength(attaches);
    await churn(257);
    expect(h.upstreams.standing().map(floorOf)).toEqual([253, 255, 256, 257]);
    expect(h.board.size).toBe(max);
    expect(vi.getTimerCount()).toBe(2 * max);
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS);
    expect(h.board.size).toBe(0);
    expect(h.upstreams.standing()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("two hubs with different questions linger apart: each closes at its own linger's end, and a rejoin saves only its own", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const phone = reader(h, "remote", AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS);
    const field = reader(h, "field", 250);
    const [phoneUp, fieldUp] = h.upstreams.attaches;
    if (phoneUp === undefined || fieldUp === undefined) throw new Error("no upstreams");
    for (const attach of [phoneUp, fieldUp]) h.upstreams.answer(attach, peerSnapshot());
    await tick();
    expect(h.board.size).toBe(2);
    phone.dispose();
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS / 2);
    field.dispose();
    // the phone's hub ends its linger first; the field hub's has half to run
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS / 2);
    expect(h.board.size).toBe(1);
    expect(h.upstreams.standing()).toEqual([fieldUp]);
    // a field reader back now rejoins its own hub; the phone's stays closed
    const back = reader(h, "field", 250);
    expect(h.upstreams.attaches).toHaveLength(2);
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS);
    expect(h.board.size).toBe(1);
    expect(h.upstreams.standing()).toEqual([fieldUp]);
    back.dispose();
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS);
    expect(h.board.size).toBe(0);
    expect(h.upstreams.standing()).toEqual([]);
  });
});

// PG-9 (PG-L4.4's cursor half; VF-PM's P1 (b), 2026-11-05) — a reader back at its hub names, per device, the last
// `{epoch, revision}` it applied, and the open answers each device ONE way: `resumed` (its copy is the head), a
// `delta` from its cursor to the head on the same chain, or a `snapshot` (anything the hub cannot vouch for: a new
// epoch, a cursor below what the hub held or above its head, a removal it has forgotten, a same-epoch re-present).
// A reader that names no cursor is answered today's open. The hub never passes a cursor to an owner.
describe("PG-9 — a reader resumes from its cursors (PG-L4.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-05T02:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  const PHONE = AGENT_FIELD.REMOTE_PHONE_MIN_INTERVAL_MS;
  type Cursor = { epoch: string; revision: number };
  type Board = { epoch: string; revision: number; rows: Map<string, unknown> };
  type Copy = Map<string, Board>;
  type Answer = {
    device: string;
    snapshot?: { epoch: string; revision: number; rows: Array<{ runtimeRunId: string }> };
    resumed?: Cursor;
    delta?: {
      epoch: string;
      since: number;
      revision: number;
      upserts: Array<{ runtimeRunId: string }>;
      removed: string[];
    };
  };

  const boardOf = (snapshot: NonNullable<Answer["snapshot"]>): Board => ({
    epoch: snapshot.epoch,
    revision: snapshot.revision,
    rows: new Map(snapshot.rows.map((entry) => [entry.runtimeRunId, entry])),
  });

  /** What a reader holds after its open and its frames: per device, its chain and its rows. */
  function copyOf(open: MeshBoardOpen, frames: MeshBoardFrame[] = []): Copy {
    const copy: Copy = new Map();
    for (const entry of open.devices as Answer[])
      if (entry.snapshot !== undefined) copy.set(entry.device, boardOf(entry.snapshot));
    for (const frame of frames) {
      if ("snapshot" in frame) copy.set(frame.device, boardOf(frame.snapshot));
      if (!("delta" in frame)) continue;
      const board = copy.get(frame.device);
      if (
        board === undefined ||
        board.epoch !== frame.delta.epoch ||
        board.revision !== frame.delta.since
      )
        throw new Error(`a gap on ${frame.device}`);
      for (const upsert of frame.delta.upserts) board.rows.set(upsert.runtimeRunId, upsert);
      for (const id of frame.delta.removed) board.rows.delete(id);
      board.revision = frame.delta.revision;
    }
    return copy;
  }

  const sinceOf = (copy: Copy): Record<string, Cursor> =>
    Object.fromEntries(
      [...copy].map(([device, board]) => [
        device,
        { epoch: board.epoch, revision: board.revision },
      ]),
    );

  /** The reader's copy after a resumed open: each device by its ONE answer, applied to what it held. */
  function resumedCopy(before: Copy, open: MeshBoardOpen): Copy {
    const after: Copy = new Map();
    for (const entry of open.devices as Answer[]) {
      const answers = [entry.snapshot, entry.resumed, entry.delta].filter((a) => a !== undefined);
      if (answers.length > 1) throw new Error(`${entry.device} answered more than one way`);
      const held = before.get(entry.device);
      if (entry.snapshot !== undefined) after.set(entry.device, boardOf(entry.snapshot));
      if (entry.resumed !== undefined) {
        if (held === undefined) throw new Error(`${entry.device} resumed with no copy`);
        expect(entry.resumed, entry.device).toEqual({ epoch: held.epoch, revision: held.revision });
        after.set(entry.device, { ...held, rows: new Map(held.rows) });
      }
      if (entry.delta !== undefined) {
        if (held === undefined) throw new Error(`${entry.device} answered a delta with no copy`);
        expect([entry.delta.epoch, entry.delta.since], entry.device).toEqual([
          held.epoch,
          held.revision,
        ]);
        const rows = new Map(held.rows);
        for (const upsert of entry.delta.upserts) rows.set(upsert.runtimeRunId, upsert);
        for (const id of entry.delta.removed) rows.delete(id);
        after.set(entry.device, { epoch: held.epoch, revision: entry.delta.revision, rows });
      }
    }
    return after;
  }

  const answerKinds = (open: MeshBoardOpen): Array<[string, string]> =>
    (open.devices as Answer[]).map((entry) => [
      entry.device,
      entry.resumed !== undefined
        ? "resumed"
        : entry.delta !== undefined
          ? "delta"
          : entry.snapshot !== undefined
            ? "snapshot"
            : "none",
    ]);

  const cSnapshot = () => ({
    epoch: "boot-dev-c.9",
    revision: 5,
    rows: [row("run-c", "dev-c", 2)],
  });

  /** a phone's hub with both peers attached and answered */
  async function liveHub() {
    const h = harness([selfRow, desktop("dev-b"), desktop("dev-c")]);
    const phone = reader(h, "remote", PHONE);
    const [b, c] = h.upstreams.attaches;
    if (b === undefined || c === undefined) throw new Error("no upstreams");
    h.upstreams.answer(b, peerSnapshot());
    h.upstreams.answer(c, cSnapshot());
    await tick();
    return { h, phone, b, c };
  }

  it("PG-9 S1 — an app switch with nothing moved: every device answered `resumed` at the cursor the phone holds, no row sent again", async () => {
    const { h, phone, b } = await liveHub();
    const held = copyOf(phone.open, phone.frames);
    phone.dispose(); // FieldLink.pause
    vi.advanceTimersByTime(2_000);
    const back = reader(h, "remote", PHONE, sinceOf(held));
    expect(answerKinds(back.open)).toEqual([
      [SELF, "resumed"],
      ["dev-b", "resumed"],
      ["dev-c", "resumed"],
    ]);
    for (const entry of back.open.devices as Answer[]) {
      expect(entry.resumed, entry.device).toEqual(sinceOf(held)[entry.device]);
      expect(entry, entry.device).not.toHaveProperty("snapshot");
    }
    expect(resumedCopy(held, back.open)).toEqual(copyOf(reader(h, "remote", PHONE).open));
    // and the chain goes on from the cursor
    const next = {
      epoch: "boot-dev-b.3",
      since: 41,
      revision: 42,
      upserts: [row("run-b", "dev-b", 8)],
      removed: [],
    };
    b.emit(next);
    expect(back.frames.at(-1)).toEqual({ device: "dev-b", delta: next });
  });

  it("PG-9 S2 — what moved while away is ONE delta per device from its cursor to the head, and the copy it builds is the head's board", async () => {
    const { h, phone, b, c } = await liveHub();
    const held = copyOf(phone.open, phone.frames);
    phone.dispose();
    // this desktop's own row moves
    h.local.emit?.({ since: 1, revision: 2, upserts: [row("run-here", SELF, 2)], removed: [] });
    // a row born and gone while away never reaches the reader; a changed one does
    b.emit({
      epoch: "boot-dev-b.3",
      since: 41,
      revision: 42,
      upserts: [row("run-b2", "dev-b", 1)],
      removed: [],
    });
    const blocked = { ...row("run-b", "dev-b", 8), status: "blocked" };
    b.emit({ epoch: "boot-dev-b.3", since: 42, revision: 43, upserts: [blocked], removed: [] });
    b.emit({ epoch: "boot-dev-b.3", since: 43, revision: 44, upserts: [], removed: ["run-b2"] });
    // a row the reader held is removed, and another arrives
    c.emit({
      epoch: "boot-dev-c.9",
      since: 5,
      revision: 6,
      upserts: [row("run-c2", "dev-c", 1)],
      removed: ["run-c"],
    });

    const back = reader(h, "remote", PHONE, sinceOf(held));
    expect(answerKinds(back.open)).toEqual([
      [SELF, "delta"],
      ["dev-b", "delta"],
      ["dev-c", "delta"],
    ]);
    const [self, onB, onC] = back.open.devices as Answer[];
    expect(self?.delta).toEqual({
      epoch: "self-boot.1",
      since: 1,
      revision: 2,
      upserts: [row("run-here", SELF, 2)],
      removed: [],
    });
    expect(onB?.delta).toEqual({
      epoch: "boot-dev-b.3",
      since: 41,
      revision: 44,
      upserts: [blocked],
      removed: [],
    });
    expect(onC?.delta).toEqual({
      epoch: "boot-dev-c.9",
      since: 5,
      revision: 6,
      upserts: [row("run-c2", "dev-c", 1)],
      removed: ["run-c"],
    });
    expect(resumedCopy(held, back.open)).toEqual(copyOf(reader(h, "remote", PHONE).open));
  });

  it("PG-9 S3 — what the hub cannot vouch for is a snapshot: an owner's new epoch, a cursor below the hub's first revision, a cursor past its head", async () => {
    const { h, phone, b } = await liveHub();
    phone.dispose();
    // B's chain breaks while the phone is away: the hub asks it again, and B answers on a new epoch
    b.emit({ epoch: "boot-dev-b.3", since: 50, revision: 51, upserts: [], removed: [] });
    expect(b.disposed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    const again = h.upstreams.attaches.at(-1);
    if (again === undefined || again === b) throw new Error("no re-attach");
    h.upstreams.answer(again, {
      epoch: "boot-dev-b.4",
      revision: 3,
      rows: [row("run-b", "dev-b", 9)],
    });
    await tick();

    const back = reader(h, "remote", PHONE, {
      [SELF]: { epoch: "self-boot.1", revision: 9 }, // past the head
      "dev-b": { epoch: "boot-dev-b.3", revision: 41 }, // the old chain
      "dev-c": { epoch: "boot-dev-c.9", revision: 4 }, // below the revision the hub first held
    });
    expect(answerKinds(back.open)).toEqual([
      [SELF, "snapshot"],
      ["dev-b", "snapshot"],
      ["dev-c", "snapshot"],
    ]);
    const [, onB] = back.open.devices as Answer[];
    expect(onB?.snapshot).toMatchObject({ epoch: "boot-dev-b.4", revision: 3 });
    expect(copyOf(back.open)).toEqual(copyOf(reader(h, "remote", PHONE).open));
  });

  it("PG-9 S4 — no `since` is today's open, every device whole; a device the cursors do not name is whole; one the hub does not list is not invented; the PG-1c resync stays whole", async () => {
    const { h, phone } = await liveHub();
    const held = copyOf(phone.open, phone.frames);
    phone.dispose();
    const today = reader(h, "remote", PHONE);
    expect(answerKinds(today.open)).toEqual([
      [SELF, "snapshot"],
      ["dev-b", "snapshot"],
      ["dev-c", "snapshot"],
    ]);
    const { "dev-c": _c, ...partial } = sinceOf(held);
    const sent: Array<[unknown, string | undefined]> = [];
    const install = h.board.subscribe(
      "remote",
      PHONE,
      (payload, kind) => sent.push([payload, kind]),
      { ...partial, "dev-gone": { epoch: "boot-dev-gone.1", revision: 3 } },
    );
    expect(answerKinds(install.snapshot)).toEqual([
      [SELF, "resumed"],
      ["dev-b", "resumed"],
      ["dev-c", "snapshot"],
    ]);
    // PG-1c — the door's resync is the whole mesh as it stands, whatever the reader once named
    install.resync();
    const [resync, kind] = sent.at(-1) ?? [];
    expect(kind).toBe("snapshot");
    expect(answerKinds(resync as MeshBoardOpen)).toEqual([
      [SELF, "snapshot"],
      ["dev-b", "snapshot"],
      ["dev-c", "snapshot"],
    ]);
    install.dispose();
    today.dispose();
  });

  it("PG-9 S5 — the hub remembers MESH_RESUME_TOMBSTONES removals a device: at the bound a cursor is answered its delta; one past it, a snapshot, never a delta short of a removal", async () => {
    const bound = AGENT_FIELD.MESH_RESUME_TOMBSTONES;
    const h = harness([selfRow, desktop("dev-b")]);
    const phone = reader(h, "remote", PHONE);
    const [b] = h.upstreams.attaches;
    if (b === undefined) throw new Error("no upstream");
    const ids = Array.from({ length: bound + 1 }, (_, i) => `run-${i}`);
    h.upstreams.answer(b, {
      epoch: "boot-dev-b.3",
      revision: 10,
      rows: ids.map((id) => row(id, "dev-b")),
    });
    await tick();
    const at10 = copyOf(phone.open, phone.frames);
    phone.dispose();

    // `bound` removals: still answerable from revision 10
    b.emit({
      epoch: "boot-dev-b.3",
      since: 10,
      revision: 11,
      upserts: [],
      removed: ids.slice(0, bound),
    });
    const atBound = reader(h, "remote", PHONE, sinceOf(at10));
    expect(answerKinds(atBound.open)).toEqual([
      [SELF, "resumed"],
      ["dev-b", "delta"],
    ]);
    expect((atBound.open.devices[1] as Answer).delta?.removed).toHaveLength(bound);
    const at11 = resumedCopy(at10, atBound.open);
    expect(at11).toEqual(copyOf(reader(h, "remote", PHONE).open));
    atBound.dispose();

    // one more: the oldest removal is forgotten, so revision 10 can no longer be answered as a delta
    b.emit({
      epoch: "boot-dev-b.3",
      since: 11,
      revision: 12,
      upserts: [],
      removed: [ids[bound] as string],
    });
    const past = reader(h, "remote", PHONE, sinceOf(at10));
    expect(answerKinds(past.open)).toEqual([
      [SELF, "resumed"],
      ["dev-b", "snapshot"],
    ]);
    expect((past.open.devices[1] as Answer).snapshot).toMatchObject({ revision: 12, rows: [] });
    // a reader that applied revision 11 had already removed it: its delta stands
    const after11 = reader(h, "remote", PHONE, sinceOf(at11));
    expect((after11.open.devices[1] as Answer).delta).toEqual({
      epoch: "boot-dev-b.3",
      since: 11,
      revision: 12,
      upserts: [],
      removed: [ids[bound]],
    });
  });

  it("PG-9 S6 — a re-present on the SAME epoch is a new board: a cursor at its revision is answered a snapshot, never `resumed`; one past it resumes", () => {
    const h = harness([selfRow]);
    const phone = reader(h, "remote", PHONE);
    const held = copyOf(phone.open, phone.frames);
    phone.dispose();
    // PG-1d — the gate flips while the phone is away: the same revision, other rows
    const represented = {
      epoch: "self-boot.1",
      revision: 1,
      rows: [{ ...row("run-here", SELF), status: "idle" }],
    };
    h.local.emit?.(represented, "snapshot");
    const back = reader(h, "remote", PHONE, sinceOf(held));
    expect(answerKinds(back.open)).toEqual([[SELF, "snapshot"]]);
    expect((back.open.devices[0] as Answer).snapshot).toEqual(represented);
    // the next delta: a reader that holds it resumes
    h.local.emit?.({ since: 1, revision: 2, upserts: [row("run-here", SELF, 2)], removed: [] });
    const at2 = copyOf(back.open, back.frames);
    back.dispose();
    const again = reader(h, "remote", PHONE, sinceOf(at2));
    expect(answerKinds(again.open)).toEqual([[SELF, "resumed"]]);
  });

  it("PG-9 S7 — the hub never passes a reader's `since` upstream: every owner is asked {projection, minIntervalMs, heartbeatMs} alone, and a new hub's kept boards answer the cursor until the owner answers afresh", async () => {
    const { h, phone } = await liveHub();
    const held = copyOf(phone.open, phone.frames);
    phone.dispose();
    vi.advanceTimersByTime(AGENT_FIELD.MESH_HUB_LINGER_MS);
    expect(h.board.size).toBe(0);
    const back = reader(h, "remote", PHONE, sinceOf(held));
    expect(h.upstreams.attaches).toHaveLength(4);
    for (const attach of h.upstreams.attaches)
      expect(Object.keys(attach.params as object).sort(), attach.device).toEqual([
        "heartbeatMs",
        "minIntervalMs",
        "projection",
      ]);
    // the peers' last boards, kept past the hub (DS-L8), are what the phone holds: resumed, then replaced
    expect(answerKinds(back.open).slice(1)).toEqual([
      ["dev-b", "resumed"],
      ["dev-c", "resumed"],
    ]);
    const [, , freshB] = h.upstreams.attaches;
    if (freshB === undefined) throw new Error("no fresh upstream");
    h.upstreams.answer(freshB, {
      epoch: "boot-dev-b.5",
      revision: 1,
      rows: [row("run-b", "dev-b", 9)],
    });
    await tick();
    expect(back.frames).toContainEqual(
      expect.objectContaining({
        device: "dev-b",
        snapshot: expect.objectContaining({ epoch: "boot-dev-b.5" }),
      }),
    );
  });

  it("PG-9 S8 — the bytes of an app switch: an idle n20 board's resumed open is under 1 KiB; its whole open is many times that", async () => {
    const h = harness([selfRow, desktop("dev-b"), desktop("dev-c")]);
    const phone = reader(h, "remote", PHONE);
    const [b, c] = h.upstreams.attaches;
    if (b === undefined || c === undefined) throw new Error("no upstreams");
    const twenty = (device: string) =>
      Array.from({ length: 20 }, (_, i) => ({
        ...row(`run-${device}-${i}`, device, i + 1),
        status: "working",
      }));
    h.upstreams.answer(b, { epoch: "boot-dev-b.3", revision: 41, rows: twenty("dev-b") });
    h.upstreams.answer(c, { epoch: "boot-dev-c.9", revision: 5, rows: twenty("dev-c") });
    await tick();
    const held = copyOf(phone.open, phone.frames);
    phone.dispose();
    const back = reader(h, "remote", PHONE, sinceOf(held));
    const whole = reader(h, "remote", PHONE);
    const resumedBytes = JSON.stringify(back.open).length;
    const wholeBytes = JSON.stringify(whole.open).length;
    expect(resumedBytes).toBeLessThan(1_024);
    expect(wholeBytes).toBeGreaterThan(10 * resumedBytes);
  });
});
