import { EventEmitter } from "node:events";
import {
  type AgentFieldDelta,
  type AgentFieldRow,
  CONTRACTS_VERSION,
  type DeviceInfo,
} from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeshBoard, type MeshBoardFrame } from "../src/mesh-board";
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
  roster: FakeRoster;
  links: FakeLinks;
  upstreams: FakeUpstreams;
  local: { emit: ((delta: AgentFieldDelta) => void) | null; opened: number; disposed: number };
}

function harness(rows: DeviceInfo[], selfDevice: () => string = () => SELF): Harness {
  const roster = new FakeRoster();
  roster.rows = rows;
  const links = new FakeLinks();
  const upstreams = new FakeUpstreams();
  const local: Harness["local"] = { emit: null, opened: 0, disposed: 0 };
  const board = new MeshBoard({
    selfDevice,
    roster,
    links,
    upstreams,
    openLocal: (_projection, _floor, emit) => {
      local.emit = emit;
      local.opened += 1;
      return {
        snapshot: { epoch: "self-boot.1", revision: 1, rows: [row("run-here", SELF)] },
        dispose: () => {
          local.disposed += 1;
        },
      };
    },
  });
  return { board, roster, links, upstreams, local };
}

/** A reader, and the frames it has heard. */
function reader(h: Harness, projection: "field" | "desk" = "desk", floor = 100) {
  const frames: MeshBoardFrame[] = [];
  const opened = h.board.open(projection, floor, (frame) => frames.push(frame));
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
      ["dev-b", "agent.subscribe", { projection: "desk", minIntervalMs: 100, heartbeatMs: 1_000 }],
    ]);
    r.dispose();
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

  it("readers of one question share its upstreams; the last one out closes every one", async () => {
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
    expect(h.upstreams.standing()).toHaveLength(0);
    expect(h.local.disposed).toBe(1);
    expect(h.board.size).toBe(0);
    // another cadence is another question: its own hub, its own upstreams
    const slow = reader(h, "desk", 500);
    const field = reader(h, "field", 250);
    expect(h.board.size).toBe(2);
    expect(h.upstreams.standing().map((attach) => attach.params)).toEqual([
      { projection: "desk", minIntervalMs: 500, heartbeatMs: 1_000 },
      { projection: "desk", minIntervalMs: 500, heartbeatMs: 1_000 },
      { projection: "field", minIntervalMs: 250, heartbeatMs: 1_000 },
      { projection: "field", minIntervalMs: 250, heartbeatMs: 1_000 },
    ]);
    slow.dispose();
    field.dispose();
    expect(h.board.size).toBe(0);
    // those four were still in flight: each is closed the moment it answers
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
    first.dispose(); // the last reader leaves: the hub and its upstreams close
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
    // another projection keeps its own: a field reader never sees a desk board
    const field = reader(h, "field", 250);
    expect(field.open.devices.find((entry) => entry.device === "dev-b")?.snapshot).toBeUndefined();
    field.dispose();
    later.dispose();
  });

  it("an attach answered after its reader left is closed at once", async () => {
    const h = harness([selfRow, desktop("dev-b")]);
    const r = reader(h);
    r.dispose();
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
      h.board.open("desk", 100, () => {});
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
    const install = h.board.subscribe("desk", 100, (payload, kind) => sent.push([payload, kind]));
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
    expect(h.board.size).toBe(0);
  });
});
