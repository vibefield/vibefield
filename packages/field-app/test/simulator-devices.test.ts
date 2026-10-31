// @vitest-environment node
// PT-S2 (R11) — THE DEVICES A PHONE MAY ATTACH (surfaces/live/simulator-devices.ts): what the host lends under the SDK's
// `SIMULATOR_DEVICES`. The PICK, pure, over main's redacted rows and installed runtimes: the booted device of the phone's own
// model, else the first booted iPhone, else the model on the newest iOS runtime INSTALLED here — a binding, never a UDID.
// The SERVICE: synchronous, from the host's last read — cold, it answers undefined; it reads `surface.simulator.devices` only
// while a phone stands, at most once a read's span, one read in flight; a failed or malformed read leaves the last standing;
// its looks are the window's timers.
// And the WANT, on a REAL engine and document: an object whose plugin holds the Simulator's scopes (the phone's, since PT-S2's
// manifest) stands — a pane or a pad does not, and no document says nothing stands.
import type { LiveSurfaceSimulatorDeviceRowV1 } from "@vibefield/contracts";
import * as pane from "@vibefield/plugin-browser-pane";
import * as pad from "@vibefield/plugin-comment-pad";
import * as phone from "@vibefield/plugin-simulator";
import { describe, expect, it, vi } from "vitest";
import { buildRegistry, createFieldEngine } from "../src/field-engine";
import { objectBindingsFrom } from "../src/plugin-host/build-widget";
import {
  attachableOf,
  createSimulatorDevices,
  SIMULATOR_DEVICES_LOOK_MS,
  SIMULATOR_DEVICES_READ_MS,
  simulatorObjectsStand,
} from "../src/surfaces/live/simulator-devices";

const PRO = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
const SIXTEEN = "com.apple.CoreSimulator.SimDeviceType.iPhone-16";
const IPAD = "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-M4";
const WATCH = "com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Series-11-46mm";
const IOS_26_1 = "com.apple.CoreSimulator.SimRuntime.iOS-26-1";
const IOS_26 = "com.apple.CoreSimulator.SimRuntime.iOS-26-0";
const IOS_18_6 = "com.apple.CoreSimulator.SimRuntime.iOS-18-6";
const WATCH_OS = "com.apple.CoreSimulator.SimRuntime.watchOS-26-1";

const row = (
  deviceType: string,
  runtime: string,
  booted: boolean,
  name = "iPhone 17 Pro",
): LiveSurfaceSimulatorDeviceRowV1 => ({ deviceType, runtime, name, booted });

describe("PT-S2 (R11) — the attach's pick, over this Mac's rows", () => {
  it("1. the BOOTED device of the phone's own model — on the newest runtime where two are booted", () => {
    const rows = [
      row(SIXTEEN, IOS_26_1, true, "iPhone 16"),
      row(PRO, IOS_18_6, true),
      row(PRO, IOS_26_1, true),
      row(PRO, IOS_26, false),
    ];
    expect(attachableOf(rows, PRO)).toEqual({ deviceType: PRO, runtime: IOS_26_1 });
  });

  it("2. else the FIRST booted iPhone — its model and runtime (the phone morphs into it); a booted iPad is no iPhone", () => {
    const rows = [
      row(IPAD, IOS_26_1, true, "iPad Pro"),
      row(SIXTEEN, IOS_18_6, true, "iPhone 16"),
      row(PRO, IOS_26_1, false),
    ];
    expect(attachableOf(rows, PRO)).toEqual({ deviceType: SIXTEEN, runtime: IOS_18_6 });
  });

  it("3. else the phone's OWN model on the newest iOS runtime INSTALLED here — whether or not a device runs it yet, never a watch's", () => {
    const rows = [row(SIXTEEN, IOS_18_6, false, "iPhone 16"), row(PRO, IOS_26, false)];
    // 26.1 is installed with no device on it: the phone binds there all the same (main attaches the model's 26.0 device —
    // off, with Boot — or, with none, says no device, with Create it)
    const runtimes = [WATCH_OS, IOS_18_6, IOS_26_1, IOS_26];
    expect(attachableOf(rows, PRO, runtimes)).toEqual({ deviceType: PRO, runtime: IOS_26_1 });
    // a Mac with runtimes and NO device at all still binds the phone (its face then offers Create it)
    expect(attachableOf([], PRO, runtimes)).toEqual({ deviceType: PRO, runtime: IOS_26_1 });
    // a booted device still comes first
    expect(attachableOf([row(PRO, IOS_18_6, true)], PRO, runtimes)).toEqual({
      deviceType: PRO,
      runtime: IOS_18_6,
    });
    // installed runtimes with none on iOS bind nothing
    expect(attachableOf([], PRO, [WATCH_OS])).toBeUndefined();
  });

  it("3, with no runtimes said: the phone's OWN model on the newest iOS runtime this Mac's devices are on — never a watch's runtime", () => {
    const rows = [
      row(WATCH, WATCH_OS, true, "Apple Watch"),
      row(SIXTEEN, IOS_18_6, false, "iPhone 16"),
      row(PRO, IOS_26, false),
      row(SIXTEEN, IOS_26_1, false, "iPhone 16"),
    ];
    // the model has a device here (on 26.0): main's R3 attaches it, its face says off and boots it
    expect(attachableOf(rows, PRO)).toEqual({ deviceType: PRO, runtime: IOS_26_1 });
    // a model with no device here binds all the same: its face says no device, and creates one
    const AIR = "com.apple.CoreSimulator.SimDeviceType.iPhone-Air";
    expect(attachableOf(rows, AIR)).toEqual({ deviceType: AIR, runtime: IOS_26_1 });
  });

  it("nothing to pick from — no rows, or none on iOS — answers undefined", () => {
    expect(attachableOf([], PRO)).toBeUndefined();
    expect(attachableOf([row(WATCH, WATCH_OS, false, "Apple Watch")], PRO)).toBeUndefined();
  });

  it("a model that is no device type's id binds nothing of its own — a booted iPhone still answers", () => {
    expect(attachableOf([row(PRO, IOS_26_1, false)], "not a device type")).toBeUndefined();
    expect(attachableOf([row(PRO, IOS_26_1, true)], "not a device type")).toEqual({
      deviceType: PRO,
      runtime: IOS_26_1,
    });
  });

  it("answers a BINDING — the two ids, and nothing a row carries beside them (its name, its state)", () => {
    const answer = attachableOf([row(PRO, IOS_26_1, true)], PRO);
    expect(Object.keys(answer ?? {}).sort()).toEqual(["deviceType", "runtime"]);
  });
});

/** The window's timers, by hand: what is set, and each fired in turn. */
function manualTimers() {
  const set = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    timers: {
      set: (fn: () => void, ms: number): unknown => {
        const id = next++;
        set.set(id, { fn, ms });
        return id;
      },
      clear: (h: unknown): void => {
        set.delete(h as number);
      },
    },
    pending: () => [...set.values()].map((t) => t.ms),
    fire: () => {
      const [first] = set.entries();
      if (first === undefined) throw new Error("no timer set");
      set.delete(first[0]);
      first[1].fn();
    },
  };
}

function service(over: { rows?: LiveSurfaceSimulatorDeviceRowV1[]; wanted?: boolean } = {}) {
  let rows: unknown = { devices: over.rows ?? [row(PRO, IOS_26_1, true)] };
  let wanted = over.wanted ?? true;
  let clock = 1_000;
  let fail: Error | null = null;
  const request = vi.fn(async (_method: string, _params?: unknown): Promise<unknown> => {
    if (fail !== null) throw fail;
    return rows;
  });
  let client: { request: typeof request } | null = { request };
  const manual = manualTimers();
  const devices = createSimulatorDevices({
    mintClient: () => client,
    wanted: () => wanted,
    now: () => clock,
    timers: manual.timers,
  });
  return {
    devices,
    manual,
    requests: () => request.mock.calls,
    answer: (next: unknown) => {
      rows = next;
    },
    want: (next: boolean) => {
      wanted = next;
    },
    tick: (ms: number) => {
      clock += ms;
    },
    failWith: (next: Error | null) => {
      fail = next;
    },
    away: () => {
      client = null;
    },
  };
}

describe("PT-S2 (R11) — the host's devices: synchronous, from its last read, read while a phone stands", () => {
  it("COLD it answers undefined — the act writes nothing — and nothing is read before a look", () => {
    const s = service();
    expect(s.devices.attachable(PRO)).toBeUndefined();
    expect(s.requests()).toHaveLength(0);
    expect(s.devices.stats()).toEqual({ looks: 0, reads: 0, failures: 0, rows: null });
  });

  it("no phone on the board, no read — the looks are taken, the list is never asked", async () => {
    const s = service({ wanted: false });
    await s.devices.look();
    await s.devices.look();
    expect(s.requests()).toHaveLength(0);
    expect(s.devices.stats()).toMatchObject({ looks: 2, reads: 0 });
    expect(s.devices.attachable(PRO)).toBeUndefined();
  });

  it("the runtimes main says are installed ride the read: a Mac with no device yet binds the model on its newest iOS", async () => {
    const s = service();
    s.answer({ devices: [], runtimes: [IOS_18_6, IOS_26_1] });
    await s.devices.look();
    expect(s.devices.attachable(PRO)).toEqual({ deviceType: PRO, runtime: IOS_26_1 });
    expect(s.devices.stats()).toEqual({ looks: 1, reads: 1, failures: 0, rows: 0 });
  });

  it("a phone stands: main's list is read on the window's connection, and the pick answers from it", async () => {
    const s = service({ rows: [row(SIXTEEN, IOS_18_6, true, "iPhone 16")] });
    await s.devices.look();
    expect(s.requests()).toEqual([["surface.simulator.devices", {}]]);
    expect(s.devices.attachable(PRO)).toEqual({ deviceType: SIXTEEN, runtime: IOS_18_6 });
    expect(s.devices.stats()).toEqual({ looks: 1, reads: 1, failures: 0, rows: 1 });
  });

  it("read again at most once a read's span; a phone gone stops the reads, and the last read still answers", async () => {
    const s = service();
    await s.devices.look();
    s.tick(SIMULATOR_DEVICES_READ_MS - 1);
    await s.devices.look();
    expect(s.requests()).toHaveLength(1);
    s.tick(1);
    s.answer({ devices: [row(PRO, IOS_26, true)] });
    await s.devices.look();
    expect(s.requests()).toHaveLength(2);
    expect(s.devices.attachable(PRO)).toEqual({ deviceType: PRO, runtime: IOS_26 });
    s.want(false);
    s.tick(SIMULATOR_DEVICES_READ_MS * 10);
    await s.devices.look();
    expect(s.requests()).toHaveLength(2);
    expect(s.devices.attachable(PRO)).toEqual({ deviceType: PRO, runtime: IOS_26 });
  });

  it("one read in flight: two looks while it runs ask main once", async () => {
    const s = service();
    await Promise.all([s.devices.look(), s.devices.look()]);
    expect(s.requests()).toHaveLength(1);
  });

  it("a read that FAILS — or answers a row that names a UDID — leaves the last read standing, counted", async () => {
    const s = service();
    await s.devices.look();
    s.tick(SIMULATOR_DEVICES_READ_MS);
    s.failWith(new Error("UNAVAILABLE: no surface authority"));
    await s.devices.look();
    expect(s.devices.attachable(PRO)).toEqual({ deviceType: PRO, runtime: IOS_26_1 });
    s.failWith(null);
    s.answer({ devices: [{ ...row(SIXTEEN, IOS_26, true), udid: "8A3F-0000" }] });
    await s.devices.look();
    expect(s.devices.attachable(PRO)).toEqual({ deviceType: PRO, runtime: IOS_26_1 });
    expect(s.devices.stats()).toMatchObject({ reads: 3, failures: 2, rows: 1 });
  });

  it("with no connection (the daemon away) nothing is read, and it stays cold", async () => {
    const s = service();
    s.away();
    await s.devices.look();
    expect(s.devices.stats()).toMatchObject({ looks: 1, reads: 0, rows: null });
    expect(s.devices.attachable(PRO)).toBeUndefined();
  });

  it("WATCH: the first look at once, then one each look's span on the window's timers; stopped, no timer stands", async () => {
    const s = service();
    const stop = s.devices.watch();
    expect(s.devices.stats().looks).toBe(1);
    expect(s.manual.pending()).toEqual([SIMULATOR_DEVICES_LOOK_MS]);
    await vi.waitFor(() => expect(s.devices.stats().rows).toBe(1));
    s.manual.fire();
    expect(s.devices.stats().looks).toBe(2);
    expect(s.manual.pending()).toEqual([SIMULATOR_DEVICES_LOOK_MS]);
    // a second watcher shares the one timer; the looks stop with the last
    const again = s.devices.watch();
    expect(s.manual.pending()).toHaveLength(1);
    stop();
    stop();
    expect(s.manual.pending()).toHaveLength(1);
    again();
    expect(s.manual.pending()).toEqual([]);
  });
});

describe("PT-S2 — a phone STANDS: an object whose plugin holds the Simulator's scopes, on a real board", () => {
  function board() {
    const registry = buildRegistry({
      generation: -1,
      staged: [],
      bundled: [
        {
          manifest: pane.browserPaneManifest,
          mod: pane.browserPaneRenderer,
          objectBindings: objectBindingsFrom(
            pane,
            pane.browserPaneManifest.contributes?.objects ?? [],
          ),
        },
        {
          manifest: pad.commentPadManifest,
          mod: pad.commentPadRenderer,
          objectBindings: objectBindingsFrom(
            pad,
            pad.commentPadManifest.contributes?.objects ?? [],
          ),
        },
        {
          manifest: phone.simulatorManifest,
          mod: phone.simulatorRenderer,
          objectBindings: objectBindingsFrom(
            phone,
            phone.simulatorManifest.contributes?.objects ?? [],
          ),
        },
      ],
    });
    const ce = createFieldEngine(registry);
    return { ce, stands: simulatorObjectsStand({ engine: ce, registry }) };
  }

  it("a pane, a pad and a note are no phone; a phone placed is; with no document open nothing stands", () => {
    const { ce, stands } = board();
    expect(stands()).toBe(false);
    ce.docs.create();
    ce.ops.spawnWidget(pane.BROWSER_PANE_TYPE, { x: 0, y: 0, ...pane.PANE_SIZE, props: {} });
    ce.ops.spawnWidget(pad.COMMENT_PAD_TYPE, { x: 900, y: 0, w: 220, h: 280, props: {} });
    ce.ops.spawnWidget("desk.note", { x: 0, y: 700, w: 200, h: 200, props: {} });
    ce.world.sync();
    expect(stands()).toBe(false);
    ce.ops.spawnWidget(phone.SIMULATOR_TYPE, { x: 1400, y: 0, ...phone.PHONE_SIZE, props: {} });
    ce.world.sync();
    expect(stands()).toBe(true);
    ce.docs.close();
    expect(stands()).toBe(false);
    ce.dispose();
  });
});
