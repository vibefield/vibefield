import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOCKETS, VITALS } from "@vibefield/contracts";
import {
  type VitalsDeltaV1,
  VitalsQueryResult,
  VitalsSnapshotV1,
  vitalsKey,
} from "@vibefield/contracts/vitals";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

// VT-1 (track VT, 2026-11-24) — fieldd's vitals recorder against a scripted floor: it names what the floor
// measured, turns counters into rates, tells the floor whom to watch, and answers the shell alone.

interface Fixture {
  root: string;
  daemon: FielddDaemon;
  native: MockMgmtServer;
  sockets: WebSocket[];
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    for (const socket of fixture.sockets) socket.close();
    await fixture.daemon.stop();
    await fixture.native.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

async function setup(prepare?: (native: MockMgmtServer) => void): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "vf-vitals-"));
  const dataDir = join(root, "data");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const native = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  prepare?.(native);
  await native.start();
  const daemon = await bootstrap({
    dataDir,
    logRoot: join(root, "logs"),
    controlPort: 0,
    dataPort: 0,
  });
  const fixture = { root, daemon, native, sockets: [] };
  fixtures.push(fixture);
  return fixture;
}

async function rpc(
  fixture: Fixture,
  token = fixture.daemon.shellToken,
  clientKind = "shell-main",
): Promise<WsRpc> {
  const socket = new WebSocket(`ws://127.0.0.1:${fixture.daemon.controlPort}`);
  fixture.sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const client = new WsRpc(socket);
  await helloAs(client, token, clientKind);
  return client;
}

const MIB = 1024 * 1024;
const FLOOR = { pid: 4102, startedAt: 1_795_478_000_123 };
const CELL = { pid: 4110, startedAt: 1_795_478_001_456 };
const T0 = 1_795_478_530_000;

function reading(
  who: { pid: number; startedAt: number },
  origin: "floor" | "child" | "watched",
  cpuUs: number,
  footprint: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    pid: who.pid,
    startedAt: who.startedAt,
    origin,
    cpuUserUs: cpuUs,
    cpuSystemUs: 0,
    residentBytes: footprint,
    footprintBytes: footprint,
    diskReadBytes: 0,
    diskWrittenBytes: 0,
    wakeups: 0,
    energyNj: null,
    ...extra,
  };
}

const sample = (seq: number, time: number, rows: unknown[]): Record<string, unknown> => ({
  seq,
  time,
  tookUs: 400,
  rows,
});

const floorRows = (cpuUs: number): unknown[] => [
  reading(FLOOR, "floor", cpuUs, 38 * MIB),
  reading(CELL, "child", cpuUs / 2, 34 * MIB, { child: "terminal-cell" }),
];

function deltas(client: WsRpc, subId: string): VitalsDeltaV1[] {
  return client.notifications
    .filter((note) => note.method === "vitals.delta" && note.params.subId === subId)
    .map((note) => note.params.payload as VitalsDeltaV1);
}

async function subscribe(client: WsRpc): Promise<{ subId: string; snapshot: VitalsSnapshotV1 }> {
  const result = (await client.call("vitals.subscribe", {})) as {
    subId: string;
    snapshot: unknown;
  };
  return { subId: result.subId, snapshot: VitalsSnapshotV1.parse(result.snapshot) };
}

describe("fieldd's vitals recorder (VT-1)", () => {
  it("waits before the floor's first reading, and draws nothing as zero", async () => {
    const fixture = await setup();
    const client = await rpc(fixture);
    const { snapshot } = await subscribe(client);
    expect(snapshot).toMatchObject({ state: "waiting", processes: [], samples: [] });
    expect(snapshot.detail).toBeDefined();
    expect(snapshot.observer.meterCpu).toBe(0);
  });

  it("tells the floor to watch fieldd itself, then the shell's processes once main names them", async () => {
    const fixture = await setup();
    await until(() => fixture.native.vitalsWatchSets.length > 0, 4000, "the first watch list");
    expect(fixture.native.vitalsWatchSets[0]).toContainEqual({ pid: process.pid, tree: false });

    const client = await rpc(fixture);
    const accepted = await client.call("vitals.roster.set", {
      processes: [
        { pid: 3900, role: "main" },
        { pid: 3911, role: "window", label: "Desk" },
        { pid: 3950, role: "vitals-window" },
      ],
    });
    expect(accepted).toEqual({ accepted: 3 });
    await until(() => fixture.native.vitalsWatchSets.length > 1, 4000, "the list with the roster");
    const latest = fixture.native.vitalsWatchSets.at(-1) ?? [];
    for (const pid of [process.pid, 3900, 3911, 3950])
      expect(latest).toContainEqual({ pid, tree: false });

    // an unchanged roster sends nothing again
    const sets = fixture.native.vitalsWatchSets.length;
    await client.call("vitals.roster.set", {
      processes: [
        { pid: 3900, role: "main" },
        { pid: 3911, role: "window", label: "Desk" },
        { pid: 3950, role: "vitals-window" },
      ],
    });
    fixture.native.pushDelta("vitals.subscribe", sample(1, T0, floorRows(1_000)));
    const { snapshot } = await subscribe(client);
    expect(snapshot.samples).toHaveLength(1);
    expect(fixture.native.vitalsWatchSets.length).toBe(sets);
  });

  it("names the floor's rows, makes rates of its counters, and says a first reading has no rate", async () => {
    const fixture = await setup();
    const client = await rpc(fixture);
    await client.call("vitals.roster.set", {
      processes: [
        { pid: 3911, role: "window", label: "Desk" },
        { pid: 3950, role: "vitals-window" },
      ],
    });
    const { subId } = await subscribe(client);
    const desk = { pid: 3911, startedAt: T0 - 60_000 };
    const viewer = { pid: 3950, startedAt: T0 - 30_000 };
    const self = { pid: process.pid, startedAt: T0 - 90_000 };
    const rows = (cpuUs: number, joules: number | null): unknown[] => [
      ...floorRows(cpuUs),
      reading(self, "watched", cpuUs * 4, 240 * MIB),
      reading(desk, "watched", cpuUs * 8, 600 * MIB, {
        diskWrittenBytes: cpuUs,
        wakeups: cpuUs / 10,
        energyNj: joules,
      }),
      reading(viewer, "watched", 0, 96 * MIB),
      // asked for once, named by nobody now: never drawn
      reading({ pid: 7777, startedAt: T0 }, "watched", 1, MIB),
    ];

    fixture.native.pushDelta("vitals.subscribe", sample(1, T0, rows(100_000, 5_000_000_000)));
    fixture.native.pushDelta(
      "vitals.subscribe",
      sample(2, T0 + 1_000, rows(150_000, 5_250_000_000)),
    );
    await until(
      () => deltas(client, subId).filter((d) => d.sample).length === 2,
      4000,
      "two samples",
    );
    const [first, second] = deltas(client, subId).filter((d) => d.sample);

    // the first reading introduces everyone, with memory and no rate
    expect(first?.state).toBe("recording");
    const named = Object.fromEntries((first?.processes ?? []).map((p) => [p.key, p]));
    expect(named[vitalsKey(FLOOR.pid, FLOOR.startedAt)]).toMatchObject({
      group: "floor",
      role: "field-native",
    });
    expect(named[vitalsKey(CELL.pid, CELL.startedAt)]).toMatchObject({
      group: "floor",
      role: "terminal-cell",
    });
    expect(named[vitalsKey(self.pid, self.startedAt)]).toMatchObject({
      group: "fieldd",
      role: "fieldd",
    });
    expect(named[vitalsKey(desk.pid, desk.startedAt)]).toMatchObject({
      group: "shell",
      role: "window",
      label: "Desk",
    });
    // what Vitals itself costs is its own group
    expect(named[vitalsKey(viewer.pid, viewer.startedAt)]).toMatchObject({
      group: "observer",
      role: "vitals-window",
    });
    expect(Object.keys(named)).toHaveLength(5);
    for (const point of first?.sample?.points ?? []) expect(point.cpu, point.key).toBeNull();
    expect(
      first?.sample?.points.find((p) => p.key === vitalsKey(desk.pid, desk.startedAt))?.memBytes,
    ).toBe(600 * MIB);

    // the second is rates: 50 ms of CPU in one second is 5% of a core, and so on for each counter
    expect(second?.state).toBeUndefined();
    expect(second?.processes).toBeUndefined();
    const at = (who: { pid: number; startedAt: number }) =>
      second?.sample?.points.find((p) => p.key === vitalsKey(who.pid, who.startedAt));
    expect(at(FLOOR)?.cpu).toBe(0.05);
    expect(at(CELL)?.cpu).toBe(0.025);
    expect(at(self)?.cpu).toBe(0.2);
    expect(at(desk)).toMatchObject({
      cpu: 0.4,
      memBytes: 600 * MIB,
      diskReadBps: 0,
      diskWriteBps: 50_000,
      wakeupsPerSec: 5_000,
      // 0.25 J in one second is 250 mW
      powerMw: 250,
    });
    // the platform gave no energy figure for the floor: null, never 0
    expect(at(FLOOR)?.powerMw).toBeNull();
  });

  it("carries what fieldd says of itself on fieldd's own row, and on no other (VT-3)", async () => {
    const fixture = await setup();
    const client = await rpc(fixture);
    const { subId } = await subscribe(client);
    const self = { pid: process.pid, startedAt: T0 - 90_000 };
    const rows = (cpuUs: number): unknown[] => [
      ...floorRows(cpuUs),
      reading(self, "watched", cpuUs * 4, 240 * MIB),
    ];
    fixture.native.pushDelta("vitals.subscribe", sample(1, T0, rows(100_000)));
    // a request between two readings: the recorder's next sample names the slowest of them
    await client.call("vitals.query", { from: T0 - 1_000, to: T0 });
    fixture.native.pushDelta("vitals.subscribe", sample(2, T0 + 1_000, rows(150_000)));
    await until(() => deltas(client, subId).filter((delta) => delta.sample).length === 2);

    const last = deltas(client, subId).at(-1)?.sample;
    const point = (who: { pid: number; startedAt: number }) =>
      last?.points.find((candidate) => candidate.key === vitalsKey(who.pid, who.startedAt));
    const own = point(self)?.own;
    expect(own?.loopBusy).toBeGreaterThanOrEqual(0);
    expect(own?.loopBusy).toBeLessThanOrEqual(1);
    expect(own?.gcMs).toBeGreaterThanOrEqual(0);
    // the query finished inside the interval; the subscribe before it may have too, and either is a method's name
    expect(["vitals.query", "vitals.subscribe"]).toContain(own?.slow?.method);
    expect(own?.slow?.ms).toBeGreaterThanOrEqual(0);
    // the floor's rows are measured from outside alone
    expect(point(FLOOR)).toBeDefined();
    expect("own" in (point(FLOOR) ?? {})).toBe(false);
    expect("own" in (point(CELL) ?? {})).toBe(false);
  });

  it("folds a terminal's tree into its row, says who left, and keeps a reused pid apart", async () => {
    const fixture = await setup();
    // a terminal fieldd observed is watched with its tree; here the roster stands in for that source
    const client = await rpc(fixture);
    const { subId } = await subscribe(client);
    await client.call("vitals.roster.set", { processes: [{ pid: 5230, role: "utility" }] });
    const shell = { pid: 5230, startedAt: T0 - 10_000 };
    const tree = (cpuUs: number) => ({
      tree: { processes: 7, cpuUs, footprintBytes: 1_200 * MIB },
    });

    fixture.native.pushDelta(
      "vitals.subscribe",
      sample(1, T0, [...floorRows(0), reading(shell, "watched", 10_000, 8 * MIB, tree(0))]),
    );
    fixture.native.pushDelta(
      "vitals.subscribe",
      sample(2, T0 + 1_000, [
        ...floorRows(0),
        reading(shell, "watched", 20_000, 8 * MIB, tree(870_000)),
      ]),
    );
    // the shell is gone, and its pid belongs to another process now
    const reused = { pid: 5230, startedAt: T0 + 1_500 };
    fixture.native.pushDelta(
      "vitals.subscribe",
      sample(3, T0 + 2_000, [...floorRows(0), reading(reused, "watched", 5, MIB)]),
    );
    await until(
      () => deltas(client, subId).filter((d) => d.sample).length === 3,
      4000,
      "three samples",
    );
    const [, second, third] = deltas(client, subId).filter((d) => d.sample);

    const point = second?.sample?.points.find(
      (p) => p.key === vitalsKey(shell.pid, shell.startedAt),
    );
    // the root's 10 ms and its tree's 870 ms in one second; its 8 MiB and its tree's 1,200
    expect(point).toMatchObject({ cpu: 0.88, memBytes: 1_208 * MIB, processes: 8 });

    expect(third?.gone).toEqual([vitalsKey(shell.pid, shell.startedAt)]);
    expect(third?.processes?.map((p) => p.key)).toEqual([vitalsKey(reused.pid, reused.startedAt)]);
    const fresh = third?.sample?.points.find(
      (p) => p.key === vitalsKey(reused.pid, reused.startedAt),
    );
    expect(fresh?.cpu).toBeNull();

    // a snapshot keeps the process that ended, for the samples that name it
    const { snapshot } = await subscribe(client);
    const keys = snapshot.processes.map((p) => p.key);
    expect(keys).toContain(vitalsKey(shell.pid, shell.startedAt));
    expect(keys).toContain(vitalsKey(reused.pid, reused.startedAt));
    expect(snapshot.observer.meterCpu).toBe(0.0004);
  });

  it("reads what the floor kept while no fieldd listened, and drops a replay's overlap", async () => {
    const kept = [1, 2, 3].map((seq) => sample(seq, T0 + seq * 1_000, floorRows(seq * 10_000)));
    const fixture = await setup((native) => {
      native.vitalsSnapshot = {
        v: 1,
        bootId: "mock-native-boot",
        state: "running",
        intervalMs: 1_000,
        oldestSeq: 1,
        samples: kept,
      };
    });
    const client = await rpc(fixture);
    const { subId, snapshot } = await subscribe(client);
    expect(snapshot.state).toBe("recording");
    expect(snapshot.samples.map((s) => s.time)).toEqual([T0 + 1_000, T0 + 2_000, T0 + 3_000]);
    expect(snapshot.samples[1]?.points[0]?.cpu).toBe(0.01);

    // the floor sends an old sample again, then a new one: only the new one is recorded
    fixture.native.pushDelta("vitals.subscribe", kept[2]);
    fixture.native.pushDelta("vitals.subscribe", sample(4, T0 + 4_000, floorRows(40_000)));
    await until(() => deltas(client, subId).some((d) => d.sample), 4000, "the new sample");
    const recorded = deltas(client, subId).filter((d) => d.sample);
    expect(recorded.map((d) => d.sample?.time)).toEqual([T0 + 4_000]);
    expect(recorded[0]?.sample?.seq).toBe(4);
  });

  it("says an unavailable meter in the floor's own words", async () => {
    const fixture = await setup((native) => {
      native.vitalsSnapshot = {
        v: 1,
        bootId: "mock-native-boot",
        state: "unavailable",
        detail: "this platform has no per-process reading the floor trusts",
        intervalMs: 1_000,
        oldestSeq: 0,
        samples: [],
      };
    });
    const { snapshot } = await subscribe(await rpc(fixture));
    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.detail).toMatch(/platform/);
  });

  it("boots beside a floor that predates the meter, and waits", async () => {
    const fixture = await setup((native) => {
      native.vitalsAbsent = true;
    });
    const { snapshot } = await subscribe(await rpc(fixture));
    expect(snapshot.state).toBe("waiting");
    expect(fixture.native.vitalsWatchSets).toHaveLength(0);
  });

  it("drops a reading that does not parse, and keeps recording", async () => {
    const fixture = await setup();
    const client = await rpc(fixture);
    const { subId } = await subscribe(client);
    fixture.native.pushDelta("vitals.subscribe", { seq: 1, time: "now", rows: [] });
    fixture.native.pushDelta("vitals.subscribe", sample(2, T0, floorRows(2)));
    await until(() => deltas(client, subId).some((d) => d.sample), 4000, "the good sample");
    expect(deltas(client, subId).filter((d) => d.sample)).toHaveLength(1);
  });

  it("answers a query in steps that keep the peak", async () => {
    const fixture = await setup();
    const client = await rpc(fixture);
    const { subId } = await subscribe(client);
    // ten seconds: 1% of a core, with one second at 90%
    let cpuUs = 0;
    for (let second = 0; second <= 10; second++) {
      cpuUs += second === 6 ? 900_000 : 10_000;
      fixture.native.pushDelta(
        "vitals.subscribe",
        sample(second + 1, T0 + second * 1_000, [
          reading(FLOOR, "floor", cpuUs, (38 + second) * MIB),
        ]),
      );
    }
    await until(() => deltas(client, subId).filter((d) => d.sample).length === 11, 4000, "eleven");

    const whole = VitalsQueryResult.parse(
      await client.call("vitals.query", { from: T0, to: T0 + 11_000 }),
    );
    expect(whole.stepMs).toBe(1_000);
    expect(whole.times).toHaveLength(11);
    const series = whole.series[0];
    expect(series?.cpuMean[0]).toBeNull(); // the first reading has no rate
    expect(series?.cpuMean[6]).toBe(0.9);
    expect(series?.memPeak[10]).toBe(48 * MIB);
    expect(whole.processes[0]?.role).toBe("field-native");

    // a span the ring does not hold answers its steps with nobody in them
    const before = VitalsQueryResult.parse(
      await client.call("vitals.query", { from: T0 - 60_000, to: T0 - 50_000 }),
    );
    expect(before.series).toEqual([]);

    // a wide span folds: the bound holds, and the spike survives as a peak over a lower mean
    const wide = VitalsQueryResult.parse(
      await client.call("vitals.query", { from: T0, to: T0 + VITALS.QUERY_MAX_POINTS * 5_000 }),
    );
    expect(wide.times.length).toBeLessThanOrEqual(VITALS.QUERY_MAX_POINTS);
    expect(wide.stepMs).toBe(5_000);
    expect(wide.series[0]?.cpuPeak[1]).toBe(0.9);
    expect(wide.series[0]?.cpuMean[1]).toBeLessThan(0.9);

    const refused = await client.callErr("vitals.query", { from: T0, to: T0 - 1 });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
  });

  it("answers the shell alone, and takes the roster from main alone", async () => {
    const fixture = await setup();

    const narrow = fixture.daemon.tokens.mint(["workspace.read"], "no-vitals");
    const outsider = await rpc(fixture, narrow.token, "renderer");
    expect((await outsider.callErr("vitals.subscribe", {})).data?.kind).toBe("FORBIDDEN_SCOPE");

    // a window's token may read, and may not name the shell's processes even holding the scope
    const windowGrant = fixture.daemon.tokens.mint(
      ["vitals.read", "vitals.report"],
      "vitals-window",
    );
    const window = await rpc(fixture, windowGrant.token, "renderer");
    expect((await subscribe(window)).snapshot.state).toBe("waiting");
    const fromWindow = await window.callErr("vitals.roster.set", { processes: [] });
    expect(fromWindow.data?.kind).toBe("FORBIDDEN_SCOPE");

    // a plugin never, whatever it was granted
    const pluginGrant = fixture.daemon.tokens.mint(["vitals.read"], "hostile-plugin", {
      pluginId: "vibefield.test.plugin",
    });
    const plugin = await rpc(fixture, pluginGrant.token, "renderer");
    expect((await plugin.callErr("vitals.subscribe", {})).data?.kind).toBe("FORBIDDEN_SCOPE");

    const main = await rpc(fixture);
    const unknownRole = await main.callErr("vitals.roster.set", {
      processes: [{ pid: 12, role: "helper" }],
    });
    expect(unknownRole.data?.kind).toBe("PRECONDITION_FAILED");
  });

  it("carries what Electron main says of itself on Main's row, once, and takes it from main alone (VT-3b)", async () => {
    const fixture = await setup();
    const client = await rpc(fixture);
    const mainProcess = { pid: 3900, startedAt: T0 - 120_000 };
    const desk = { pid: 3911, startedAt: T0 - 60_000 };
    await client.call("vitals.roster.set", {
      processes: [
        { pid: mainProcess.pid, role: "main" },
        { pid: desk.pid, role: "window" },
      ],
    });
    // before the first reading nobody listens: said so, never kept for a later sample
    expect(await client.call("vitals.own.report", { own: { loopBusy: 0.9 } })).toEqual({
      accepted: false,
    });

    const { subId } = await subscribe(client);
    const rows = (cpuUs: number): unknown[] => [
      ...floorRows(cpuUs),
      reading(mainProcess, "watched", cpuUs, 150 * MIB),
      reading(desk, "watched", cpuUs * 2, 400 * MIB),
    ];
    const pointOf = (index: number, who: { pid: number; startedAt: number }) =>
      deltas(client, subId)
        .filter((delta) => delta.sample)
        [index]?.sample?.points.find(
          (candidate) => candidate.key === vitalsKey(who.pid, who.startedAt),
        );
    const samples = (): number => deltas(client, subId).filter((delta) => delta.sample).length;

    fixture.native.pushDelta("vitals.subscribe", sample(1, T0, rows(100_000)));
    await until(() => samples() === 1);
    // two reports inside one interval fold: the newest share, the pauses summed, the longest and slowest kept
    expect(
      await client.call("vitals.own.report", {
        own: { loopBusy: 0.2, gcMs: 4, gcMaxMs: 3, slow: { method: "doc.list", ms: 80 } },
      }),
    ).toEqual({ accepted: true });
    await client.call("vitals.own.report", {
      own: { loopBusy: 0.31, gcMs: 1.5, gcMaxMs: 1.5, slow: { method: "doc.open", ms: 12 } },
    });
    fixture.native.pushDelta("vitals.subscribe", sample(2, T0 + 1_000, rows(150_000)));
    fixture.native.pushDelta("vitals.subscribe", sample(3, T0 + 2_000, rows(200_000)));
    await until(() => samples() === 3);

    expect(pointOf(0, mainProcess) !== undefined && "own" in (pointOf(0, mainProcess) ?? {})).toBe(
      false,
    );
    expect(pointOf(1, mainProcess)?.own).toEqual({
      loopBusy: 0.31,
      gcMs: 5.5,
      gcMaxMs: 3,
      slow: { method: "doc.list", ms: 80 },
    });
    // said once: the next second, with no report, says nothing of Main's own
    expect("own" in (pointOf(2, mainProcess) ?? {})).toBe(false);
    // and never on another row
    expect("own" in (pointOf(1, desk) ?? {})).toBe(false);

    // a window may not report, even holding the scope; a malformed report is refused
    const windowGrant = fixture.daemon.tokens.mint(["vitals.report"], "desk-window");
    const window = await rpc(fixture, windowGrant.token, "renderer");
    expect((await window.callErr("vitals.own.report", { own: {} })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    expect((await client.callErr("vitals.own.report", { own: { loopBusy: 7 } })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
  });
});
