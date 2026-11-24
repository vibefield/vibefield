import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CallerContext, VITALS } from "@vibefield/contracts";
import {
  type VitalsDeltaV1,
  VitalsIncidentV1,
  type VitalsProcessV1,
  type VitalsSampleV1,
  type VitalsSnapshotV1,
} from "@vibefield/contracts/vitals";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import type { NativeLink } from "../src/native-link";
import { type IncidentRecorder, VitalsIncidents } from "../src/vitals-incidents";
import { type VitalsKept, VitalsService } from "../src/vitals-service";

// VT-4b (track VT, 2026-11-24; VT-D11 A) — the incident keeper: its folder (bounds, expiry, a broken file, 0600, whole
// writes), each source, a loop held as one episode, the doors and who may knock, and the recorder carrying the
// summaries. A real VitalsService over a scripted link where the census matters; a recorder of the test's own where
// only the folder does.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const root = mkdtempSync(join(tmpdir(), "vf-incidents-"));
  dirs.push(root);
  return join(root, "fieldd", "vitals", "incidents");
}

const T0 = 1_795_478_530_000;
const DAY = 24 * 60 * 60 * 1_000;

/** A recorder of the test's own: a ring it fills by hand. */
function fakeRecorder(on = true): IncidentRecorder & {
  ring: VitalsSampleV1[];
  processes: VitalsProcessV1[];
  said: number;
  on: boolean;
} {
  const recorder = {
    on,
    ring: [] as VitalsSampleV1[],
    processes: [] as VitalsProcessV1[],
    said: 0,
    kept(from: number, to: number): VitalsKept {
      const samples = recorder.ring.filter((sample) => sample.time >= from && sample.time <= to);
      const keys = new Set(samples.flatMap((sample) => sample.points.map((point) => point.key)));
      return {
        intervalMs: 1_000,
        memory: "footprint",
        samples,
        processes: recorder.processes.filter((process) => keys.has(process.key)),
      };
    },
    emitIncidents(): void {
      recorder.said += 1;
    },
  };
  return recorder;
}

const FIELDD: VitalsProcessV1 = {
  key: "4001:1795477990000",
  pid: 4001,
  startedAt: 1795477990000,
  group: "fieldd",
  role: "fieldd",
};
const TERMINAL: VitalsProcessV1 = {
  key: "5230:1795478200789",
  pid: 5230,
  startedAt: 1795478200789,
  group: "agents",
  role: "terminal",
  tree: true,
};

const point = (key: string, own?: { loopBusy: number }) => ({
  key,
  cpu: 0.02,
  memBytes: 1_000,
  diskReadBps: null,
  diskWriteBps: null,
  wakeupsPerSec: null,
  powerMw: null,
  ...(own !== undefined ? { own } : {}),
});

function ringOf(from: number, to: number): VitalsSampleV1[] {
  const ring: VitalsSampleV1[] = [];
  for (let time = from, seq = 1; time <= to; time += 1_000, seq += 1)
    ring.push({ seq, time, points: [point(FIELDD.key), point(TERMINAL.key)] });
  return ring;
}

function keeper(dir: string, now = () => T0 + 60_000): VitalsIncidents {
  let n = 0;
  return new VitalsIncidents({
    dir,
    logger: createNoopLogger(),
    now,
    hex8: () => (n++).toString(16).padStart(8, "0"),
  });
}

const raiseExit = (at: number, role = "rosettad") => ({
  kind: "exit" as const,
  at,
  subject: { group: "fieldd", role, pid: 5300 },
  detail: { code: 101 },
});

describe("VT-4b — the incident folder", () => {
  it("writes each incident whole, 0600, beside no temporary file, and reads it back at the next boot", () => {
    const dir = folder();
    const incidents = keeper(dir);
    const recorder = fakeRecorder();
    recorder.ring = ringOf(T0 - 40_000, T0 + 40_000);
    recorder.processes = [FIELDD, TERMINAL];
    incidents.attach(recorder);
    const id = incidents.raise(raiseExit(T0));
    expect(id).not.toBeNull();
    const files = readdirSync(dir);
    expect(files).toEqual([`${id}.json`]);
    expect(statSync(join(dir, `${id}.json`)).mode & 0o777).toBe(0o600);
    const kept = VitalsIncidentV1.parse(JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")));
    // the ring already held the half minute after: it is complete at once
    expect(kept.complete).toBe(true);
    expect(kept.samples[0]?.time).toBe(T0 - VITALS.INCIDENT_SPAN_MS);
    expect(kept.samples.at(-1)?.time).toBe(T0 + VITALS.INCIDENT_SPAN_MS);
    expect(kept.processes.map((process) => process.key).sort()).toEqual(
      [FIELDD.key, TERMINAL.key].sort(),
    );

    const again = keeper(dir);
    again.load();
    expect(again.summaries().map((summary) => summary.id)).toEqual([id]);
    expect(again.get(id ?? "")?.samples).toHaveLength(61);
  });

  it("keeps the newest 50, and removes the oldest's files", () => {
    const dir = folder();
    const incidents = keeper(dir);
    incidents.attach(fakeRecorder());
    const ids: string[] = [];
    for (let index = 0; index < VITALS.INCIDENTS_MAX + 2; index += 1)
      ids.push(incidents.raise(raiseExit(T0 - 100_000 + index * 1_000)) ?? "");
    const listed = incidents.summaries().map((summary) => summary.id);
    expect(listed).toHaveLength(VITALS.INCIDENTS_MAX);
    // newest first, and the two oldest gone with their files
    expect(listed[0]).toBe(ids.at(-1));
    for (const gone of ids.slice(0, 2)) {
      expect(listed).not.toContain(gone);
      expect(existsSync(join(dir, `${gone}.json`))).toBe(false);
    }
    expect(readdirSync(dir).filter((name) => name.endsWith(".json"))).toHaveLength(
      VITALS.INCIDENTS_MAX,
    );
  });

  it("forgets an incident older than 14 days at boot, file and all", () => {
    const dir = folder();
    const then = keeper(dir, () => T0);
    then.attach(fakeRecorder());
    const old = then.raise(raiseExit(T0 - 15 * DAY));
    const recent = then.raise(raiseExit(T0 - 13 * DAY));
    const later = keeper(dir, () => T0);
    later.load();
    expect(later.summaries().map((summary) => summary.id)).toEqual([recent]);
    expect(existsSync(join(dir, `${old}.json`))).toBe(false);
  });

  it("sets a file that does not read aside by a rename, never deletes it, and lists the rest", () => {
    const dir = folder();
    const first = keeper(dir);
    first.attach(fakeRecorder());
    const good = first.raise(raiseExit(T0));
    writeFileSync(join(dir, "mwtxk4b4-deadbeef.json"), "{ not json");
    writeFileSync(join(dir, "notes.txt"), "a person's own file");
    writeFileSync(join(dir, "mwtxk4b4-0000ffff.json"), JSON.stringify({ v: 1, id: "other" }));
    const later = keeper(dir);
    later.load();
    expect(later.summaries().map((summary) => summary.id)).toEqual([good]);
    const names = readdirSync(dir);
    expect(names.filter((name) => name.endsWith(".broken"))).toHaveLength(2);
    expect(names).toContain("notes.txt");
    expect(names).not.toContain("mwtxk4b4-deadbeef.json");
  });

  it("is written at once with what the ring has, and completed when the half minute after is recorded", () => {
    const dir = folder();
    const incidents = keeper(dir);
    const recorder = fakeRecorder();
    recorder.ring = ringOf(T0 - 40_000, T0);
    recorder.processes = [FIELDD, TERMINAL];
    incidents.attach(recorder);
    incidents.recorded(recorder.ring.at(-1) as VitalsSampleV1, () => FIELDD);
    const id = incidents.raise(raiseExit(T0)) ?? "";
    const first = VitalsIncidentV1.parse(JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")));
    expect(first.complete).toBe(false);
    expect(first.samples.at(-1)?.time).toBe(T0);

    // the seconds after it arrive; the incident completes on the one at its moment and a half minute
    for (let time = T0 + 1_000; time <= T0 + VITALS.INCIDENT_SPAN_MS; time += 1_000) {
      const sample = { seq: time, time, points: [point(FIELDD.key)] };
      recorder.ring.push(sample);
      incidents.recorded(sample, () => FIELDD);
    }
    const second = VitalsIncidentV1.parse(
      JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")),
    );
    expect(second.complete).toBe(true);
    expect(second.samples.at(-1)?.time).toBe(T0 + VITALS.INCIDENT_SPAN_MS);
    expect(incidents.summaries()[0]?.complete).toBe(true);
  });

  it("writes what is still pending at stop, as all it will hold", () => {
    const dir = folder();
    const incidents = keeper(dir);
    const recorder = fakeRecorder();
    recorder.ring = ringOf(T0 - 5_000, T0);
    incidents.attach(recorder);
    incidents.recorded(recorder.ring.at(-1) as VitalsSampleV1, () => FIELDD);
    const id = incidents.raise(raiseExit(T0)) ?? "";
    incidents.stop();
    const kept = VitalsIncidentV1.parse(JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8")));
    expect(kept.complete).toBe(true);
    expect(kept.samples).toHaveLength(6);
    expect(incidents.raise(raiseExit(T0 + 1))).toBeNull();
  });
});

describe("VT-4b — what is never an incident", () => {
  it("is never about a terminal's processes, by its group or by its pid (VT-D4)", () => {
    const incidents = keeper(folder());
    const recorder = fakeRecorder();
    recorder.ring = ringOf(T0 - 5_000, T0 + 5_000);
    recorder.processes = [FIELDD, TERMINAL];
    incidents.attach(recorder);
    expect(
      incidents.raise({ kind: "exit", at: T0, subject: { group: "agents", role: "terminal" } }),
    ).toBeNull();
    // a shell report naming a pid the census holds as a terminal's
    expect(incidents.report({ kind: "exit", role: "other", pid: TERMINAL.pid, at: T0 })).toEqual({
      accepted: false,
    });
    expect(incidents.summaries()).toEqual([]);
  });

  it("keeps nothing new while the recorder is off, and what was kept stays", () => {
    const incidents = keeper(folder());
    const recorder = fakeRecorder();
    incidents.attach(recorder);
    const kept = incidents.raise(raiseExit(T0));
    recorder.on = false;
    expect(incidents.raise(raiseExit(T0 + 1_000))).toBeNull();
    expect(incidents.summaries().map((summary) => summary.id)).toEqual([kept]);
  });

  it("holds what comes before the recorder, and keeps none of it when the recorder is off by then", () => {
    const note = {
      v: 1 as const,
      at: T0 - 10_000,
      pid: 3999,
      bootId: "b0",
      origin: "uncaughtException",
      name: "TypeError",
      message: `x is not a function${" and more".repeat(60)}`,
      stack: "TypeError: x is not a function\n    at /a/path/to/fieldd.js:1:1",
    };
    const on = keeper(folder());
    expect(on.previousCrash(note)).toBeNull(); // held: nothing to attach to yet
    on.attach(fakeRecorder());
    const [crash] = on.summaries();
    expect(crash).toMatchObject({ kind: "crash", subject: { group: "fieldd", pid: 3999 } });
    expect(crash?.detail?.errorName).toBe("TypeError");
    expect(crash?.detail?.message?.length).toBeLessThanOrEqual(VITALS.INCIDENT_MESSAGE_MAX);
    // the stack is never kept: it can name a folder
    expect(JSON.stringify(crash)).not.toContain("/a/path");

    const off = keeper(folder());
    off.previousCrash(note);
    off.attach(fakeRecorder(false));
    expect(off.summaries()).toEqual([]);
  });

  it("says a floor's exit when it failed or a signal fieldd did not send ended it, and no other", () => {
    const incidents = keeper(folder());
    incidents.attach(fakeRecorder());
    expect(incidents.floorExited({ pid: 10, code: 0, signal: null, at: T0 })).toBeNull();
    incidents.noteSignalled(11);
    expect(incidents.floorExited({ pid: 11, code: null, signal: "SIGKILL", at: T0 })).toBeNull();
    incidents.floorExited({ pid: 12, code: 3, signal: null, at: T0 + 1 });
    incidents.floorExited({ pid: 13, code: null, signal: "SIGSEGV", at: T0 + 2 });
    expect(incidents.summaries().map((summary) => [summary.subject.role, summary.detail])).toEqual([
      ["field-native", { signal: "SIGSEGV" }],
      ["field-native", { code: 3 }],
    ]);
  });

  it("says a supervised child that died on its own while ready, and not a stop or a restart asked for", () => {
    const incidents = keeper(folder());
    incidents.attach(fakeRecorder());
    const child = Object.assign(new EventEmitter(), {
      health: () => ({ phase: "ready", pid: 700 }),
    });
    const unfollow = incidents.followChild(child, "rosettad");
    // a person's restart: the phase moves first, the pid after
    child.emit("transition", { phase: "restarting", pid: 700 });
    child.emit("transition", { phase: "restarting", pid: null });
    child.emit("transition", { phase: "ready", pid: 701 });
    expect(incidents.summaries()).toEqual([]);
    // its own death: ready, then restarting with no pid, in one step
    child.emit("transition", { phase: "restarting", pid: null });
    expect(incidents.summaries()).toMatchObject([
      { kind: "exit", subject: { group: "fieldd", role: "rosettad", pid: 701 } },
    ]);
    child.emit("transition", { phase: "ready", pid: 702 });
    child.emit("transition", { phase: "stopped", pid: null });
    unfollow();
    child.emit("transition", { phase: "ready", pid: 703 });
    child.emit("transition", { phase: "restarting", pid: null });
    expect(incidents.summaries()).toHaveLength(1);
  });
});

describe("VT-4b — Electron main's reports", () => {
  it("takes the shell's own roles alone, and says the Vitals window's under Vitals' own group", () => {
    const incidents = keeper(folder());
    incidents.attach(fakeRecorder());
    expect(() => incidents.report({ kind: "exit", role: "fieldd", at: T0 })).toThrow(/shell's/);
    expect(() => incidents.report({ kind: "crash", role: "window", at: T0 })).toThrow();
    incidents.report({
      kind: "exit",
      role: "vitals-window",
      pid: 4410,
      at: T0,
      detail: { reason: "crashed", code: 11 },
    });
    expect(incidents.summaries()[0]?.subject).toEqual({
      group: "observer",
      role: "vitals-window",
      pid: 4410,
    });
  });

  it("opens one incident for a page that stopped responding, and ends it when it answers", () => {
    const incidents = keeper(folder());
    incidents.attach(fakeRecorder());
    const first = incidents.report({ kind: "unresponsive", role: "window", pid: 4133, at: T0 });
    expect(first.accepted).toBe(true);
    // said again before it answers: the same incident
    expect(
      incidents.report({ kind: "unresponsive", role: "window", pid: 4133, at: T0 + 500 }),
    ).toEqual({ accepted: false, id: first.id });
    expect(
      incidents.report({ kind: "responsive", role: "window", pid: 4133, at: T0 + 4_200 }),
    ).toEqual({ accepted: true, id: first.id });
    expect(incidents.summaries()).toMatchObject([{ kind: "unresponsive", endedAt: T0 + 4_200 }]);
    // nothing stands open now
    expect(
      incidents.report({ kind: "responsive", role: "window", pid: 4133, at: T0 + 5_000 }),
    ).toEqual({ accepted: false });
  });
});

describe("VT-4b — the doors, and who may knock", () => {
  type Handler = (ctx: CallerContext, params: unknown) => unknown;
  const ctx = (kind: string, transport = "ws-loopback") =>
    ({ principal: { kind }, transport }) as unknown as CallerContext;

  function doors(): {
    incidents: VitalsIncidents;
    call: (m: string, c: CallerContext, p: unknown) => unknown;
  } {
    const handlers = new Map<string, Handler>();
    const incidents = keeper(folder());
    incidents.attach(fakeRecorder());
    incidents.register({
      register: (method: string, handler: Handler) => handlers.set(method, handler),
    } as never);
    return {
      incidents,
      call: (method, caller, params) => {
        const handler = handlers.get(method);
        if (handler === undefined) throw new Error(`no ${method}`);
        return handler(caller, params);
      },
    };
  }

  it("reads one whole for the shell, and says NOT_FOUND for one not kept", () => {
    const { incidents, call } = doors();
    const id = incidents.raise(raiseExit(T0)) ?? "";
    for (const kind of ["shell-main", "local-token"])
      expect(VitalsIncidentV1.parse(call("vitals.incidents.get", ctx(kind), { id })).id).toBe(id);
    expect(() =>
      call("vitals.incidents.get", ctx("shell-main"), { id: "mwtxk4b4-ffffffff" }),
    ).toThrow(expect.objectContaining({ kind: "NOT_FOUND" }));
    expect(() => call("vitals.incidents.get", ctx("shell-main"), { id: "../x" })).toThrow(
      expect.objectContaining({ kind: "PRECONDITION_FAILED" }),
    );
  });

  it("refuses a page, a plugin, a peer and a non-loopback caller; takes a report from main alone", () => {
    const { incidents, call } = doors();
    const id = incidents.raise(raiseExit(T0)) ?? "";
    for (const caller of [
      ctx("renderer"),
      ctx("plugin"),
      ctx("peer"),
      ctx("shell-main", "tailnet"),
    ])
      expect(() => call("vitals.incidents.get", caller, { id })).toThrow(
        expect.objectContaining({ kind: "FORBIDDEN_SCOPE" }),
      );
    const report = { kind: "exit", role: "gpu", at: T0 };
    expect(() => call("vitals.incident.report", ctx("local-token"), report)).toThrow(
      expect.objectContaining({ kind: "FORBIDDEN_SCOPE" }),
    );
    expect(call("vitals.incident.report", ctx("shell-main"), report)).toMatchObject({
      accepted: true,
    });
  });
});

describe("VT-4b — beside the real recorder", () => {
  /** A link that hands the recorder the floor's samples the test pushes. */
  function scripted(): { link: NativeLink; push: (sample: unknown) => void } {
    let frame: ((payload: unknown, kind: string) => void) | null = null;
    const link = {
      on: () => undefined,
      off: () => undefined,
      subscribe: async (_method: string, _params: unknown, onFrame: typeof frame) => {
        frame = onFrame;
        return {
          snapshot: {
            v: 1,
            bootId: "floor-1",
            state: "running",
            intervalMs: 1_000,
            oldestSeq: 0,
            samples: [],
          },
          dispose: () => undefined,
        };
      },
      request: async () => ({ watching: 2, recording: true }),
    };
    return { link: link as unknown as NativeLink, push: (sample) => frame?.(sample, "delta") };
  }

  const reading = (pid: number, startedAt: number, cpuUs: number) => ({
    pid,
    startedAt,
    origin: "watched",
    cpuUserUs: cpuUs,
    cpuSystemUs: 0,
    residentBytes: 1_000,
    footprintBytes: 1_000,
    diskReadBytes: null,
    diskWrittenBytes: null,
    wakeups: null,
    energyNj: null,
  });

  async function pair(loop: () => number) {
    const dir = folder();
    mkdirSync(dir, { recursive: true });
    const { link, push } = scripted();
    const service = new VitalsService({
      native: link,
      logger: createNoopLogger(),
      sources: [
        () => [
          { pid: 4001, group: "fieldd", role: "fieldd" },
          { pid: 5230, group: "agents", role: "terminal", tree: true },
        ],
      ],
      own: { fold: () => ({ loopBusy: loop() }), dispose: () => undefined },
    });
    const incidents = keeper(dir);
    service.useIncidents(incidents);
    incidents.attach(service);
    await service.start();
    const emitted: VitalsDeltaV1[] = [];
    let snapshot: VitalsSnapshotV1 | null = null;
    service.register({
      registerSubscription: (
        _method: string,
        handler: (
          ctx: CallerContext,
          params: unknown,
          emit: (payload: unknown) => void,
        ) => Promise<{
          snapshot: VitalsSnapshotV1;
        }>,
      ) => {
        void handler(ctx("shell-main"), {}, (payload) =>
          emitted.push(payload as VitalsDeltaV1),
        ).then((opened) => {
          snapshot = opened.snapshot;
        });
      },
      register: () => undefined,
    } as never);
    let seq = 0;
    const second = (time: number): void => {
      seq += 1;
      push({
        seq,
        time,
        tookUs: 300,
        rows: [
          reading(4001, T0 - 90_000, seq * 900_000),
          reading(5230, T0 - 60_000, seq * 990_000),
        ],
      });
    };
    await Promise.resolve();
    return { service, incidents, second, emitted, snapshot: () => snapshot };
  }
  const ctx = (kind: string) =>
    ({ principal: { kind }, transport: "ws-loopback" }) as unknown as CallerContext;

  it("keeps one incident a held episode: its start, its end and its peak, and none for a terminal", async () => {
    const shares = [0.1, 0.97, 0.99, 0.96, 0.98, 0.95, 0.99, 0.2, 0.97, 0.97, 0.1];
    let index = 0;
    const { incidents, second } = await pair(() => shares[index] ?? 0);
    for (; index < shares.length; index += 1) second(T0 + index * 1_000);
    const held = incidents.summaries();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      kind: "loop-held",
      // the first held reading covers the second before it
      at: T0,
      endedAt: T0 + 6_000,
      subject: { group: "fieldd", role: "fieldd", pid: 4001, key: `4001:${T0 - 90_000}` },
      detail: { peak: 0.99 },
    });
  });

  it("carries the summaries in the snapshot and again in a delta whenever one is kept", async () => {
    const { incidents, second, emitted, snapshot } = await pair(() => 0.1);
    second(T0);
    expect(snapshot()?.incidents).toEqual([]);
    const id = incidents.raise(raiseExit(T0));
    const said = emitted.filter((delta) => delta.incidents !== undefined).at(-1);
    expect(said?.incidents?.map((summary) => summary.id)).toEqual([id]);
  });
});
