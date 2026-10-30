// PT-S2 (R11) — THE DEVICES A PHONE MAY ATTACH: what VibeField lends a simulator kind under the SDK's `SIMULATOR_DEVICES`,
// beside `LIVE` (desk-layer.ts) — the phone's ATTACH reads it, and binds by what it answers.
//  - SYNCHRONOUS, from a SNAPSHOT: a menu act runs once, outside the tick, and writes in its own transaction, so `attachable`
//    answers from what the host last read of this Mac's devices — main's redacted rows (`surface.simulator.devices`, the
//    window's product connection, under `surface.capture`: `{ deviceType, runtime, name, booted }`, never a UDID). Before
//    the first read it answers undefined (the act writes nothing).
//  - READ WHILE A PHONE STANDS: the host looks every `SIMULATOR_DEVICES_LOOK_MS` whether an object that may show a Simulator
//    stands on the open board — one whose plugin is granted the Simulator's scopes (live-gate.ts `SIMULATOR_SCOPES`: the host
//    names no plugin's type, as the gate names none) — and while one does, reads the list again at most every
//    `SIMULATOR_DEVICES_READ_MS` (main's one list a tick serves it: R8). No phone, no read. A read that fails leaves the last
//    one standing. The looks are the window's timers, never the desk's loop: a desk at rest is never woken by them.
//  - THE PICK (`attachableOf`, pure): the booted device of the phone's own model; else the first booted iPhone (the phone
//    takes its model); else the phone's own model on the newest iOS runtime this Mac's devices are on — main's R3 attaches
//    the model's device on any runtime, a booted one first, and its face then says honestly that it is off, or that there is
//    none. Always a BINDING the contracts accept, never a UDID.

import {
  type CanvasEngine,
  defineQuery,
  Not,
  Position,
  PrefabId,
  Size,
  Specimen,
  type WidgetType,
} from "@vibecook/ice";
import {
  LiveSurfaceIosSimulatorBindingV1,
  type LiveSurfaceSimulatorDeviceRowV1,
  SurfaceSimulatorDevicesResultV1,
} from "@vibefield/contracts";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import type { LiveSimulatorBinding, SimulatorDevices } from "@vibefield/plugin-sdk/desk";
import { grantsOf, SIMULATOR_SCOPES } from "./live-gate";

/** How often the host looks whether a phone stands on the board (a query of the board's objects — no read). */
export const SIMULATOR_DEVICES_LOOK_MS = 2_000;
/** How often, while one stands, this Mac's devices are read again (main's list is one a tick, shared — R8). */
export const SIMULATOR_DEVICES_READ_MS = 5_000;

/** An iPhone's CoreSimulator device type — the attach's second pick (the first booted iPhone). */
const IPHONE = /^com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-/u;
/** An iOS runtime, and its version in its id (`…SimRuntime.iOS-26-1` → 26, 1) — what "the newest" orders by. */
const IOS_RUNTIME = /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-(\d+(?:-\d+)*)$/u;

/** An iOS runtime's version as numbers — undefined: not an iOS runtime (a phone runs on none other). */
function iosVersion(runtime: string): readonly number[] | undefined {
  const digits = IOS_RUNTIME.exec(runtime)?.[1];
  return digits === undefined ? undefined : digits.split("-").map(Number);
}

/** Newer first: `a` before `b` when its runtime's version is higher (equal: the list's own order stands). */
function newer(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The row of `rows` on the newest iOS runtime (a stable choice: the first of equals) — undefined: none on iOS. */
function newestOf(
  rows: readonly LiveSurfaceSimulatorDeviceRowV1[],
): LiveSurfaceSimulatorDeviceRowV1 | undefined {
  let best: { row: LiveSurfaceSimulatorDeviceRowV1; version: readonly number[] } | undefined;
  for (const row of rows) {
    const version = iosVersion(row.runtime);
    if (version === undefined) continue;
    if (best === undefined || newer(version, best.version) < 0) best = { row, version };
  }
  return best?.row;
}

/** A binding the contracts accept, or undefined (a `prefer` that is no device type's id binds nothing). */
function bindingOf(deviceType: string, runtime: string): LiveSimulatorBinding | undefined {
  const parsed = LiveSurfaceIosSimulatorBindingV1.safeParse({ deviceType, runtime });
  return parsed.success
    ? { deviceType: parsed.data.deviceType, runtime: parsed.data.runtime }
    : undefined;
}

/**
 * THE ATTACH'S PICK (R11), pure, over this Mac's device rows: the device a phone of model `prefer` binds to here.
 *  1. the BOOTED device of the phone's own model (on the newest runtime, where two are booted);
 *  2. else the first booted iPhone — its model and runtime (the phone morphs into it);
 *  3. else the phone's own model on the newest iOS runtime this Mac's devices are on (main attaches the model's device on any
 *     runtime — its face says `off`, and boots it — or says `no-device`, and creates one).
 * Undefined: no iOS row to pick from, or no binding the contracts accept (a `prefer` that is no device type's id).
 */
export function attachableOf(
  rows: readonly LiveSurfaceSimulatorDeviceRowV1[],
  prefer: string,
): LiveSimulatorBinding | undefined {
  const own = newestOf(rows.filter((row) => row.booted && row.deviceType === prefer));
  if (own !== undefined) return bindingOf(own.deviceType, own.runtime);
  const iphone = rows.find((row) => row.booted && IPHONE.test(row.deviceType));
  if (iphone !== undefined) return bindingOf(iphone.deviceType, iphone.runtime);
  const newest = newestOf(rows);
  return newest === undefined ? undefined : bindingOf(prefer, newest.runtime);
}

/** The board's objects (never a pegboard's specimen) — the desk door's own query (live-eyes.ts). */
const objectsQ = defineQuery([Position, Size, PrefabId, Not(Specimen)]);

/**
 * Whether an object that may show a Simulator stands on the open board: one whose plugin is granted the Simulator's scopes
 * (`surface.attach` + `surface.capture` — the gate's own pair, by the same grants). False with no document open.
 */
export function simulatorObjectsStand(deps: {
  readonly engine: CanvasEngine;
  readonly registry: PluginRegistry<WidgetType>;
}): () => boolean {
  return () => {
    if (deps.engine.docs.current()?.store === undefined) return false;
    const granted = new Map<string, boolean>();
    const grants = (type: string): boolean => {
      const was = granted.get(type);
      if (was !== undefined) return was;
      const id = deps.registry.ownerOf(type);
      const plugin = id === undefined ? undefined : deps.registry.plugin(id);
      const held: readonly string[] = plugin !== undefined ? grantsOf(plugin) : [];
      const yes = SIMULATOR_SCOPES.every((scope) => held.includes(scope));
      granted.set(type, yes);
      return yes;
    };
    let stands = false;
    deps.engine.world.query(objectsQ).each((batch) => {
      if (stands) return;
      for (const row of batch) {
        const type = deps.engine.world.get(batch.entity(row), PrefabId)?.id;
        if (typeof type === "string" && grants(type)) {
          stands = true;
          return;
        }
      }
    });
    return stands;
  };
}

export interface DeskSimulatorDevicesDeps {
  /** The WINDOW's product connection — the list rides it, as the desk's mint does (desk-live.ts). Null: daemon away. */
  readonly mintClient: () => { request(method: string, params?: unknown): Promise<unknown> } | null;
  /** Whether a phone stands on the board now (`simulatorObjectsStand`): no phone, no read. */
  readonly wanted: () => boolean;
  /** The clock and the timers (a test's own). */
  readonly now?: () => number;
  readonly timers?: {
    set(fn: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
}

/** What the service counts — a test's witness. */
export interface DeskSimulatorDevicesStats {
  /** Looks taken, lists read (and those that failed); the rows of the last read (null: none read yet). */
  readonly looks: number;
  readonly reads: number;
  readonly failures: number;
  readonly rows: number | null;
}

export interface DeskSimulatorDevices extends SimulatorDevices {
  /** Begin looking (the first look at once); the answer stops it. A mount calls it from its effect (a discarded memo's twin
   * never starts a timer). */
  watch(): () => void;
  /** Look now: whether a phone stands, and — when one does and the last read is old — read the list (awaited). */
  look(): Promise<void>;
  stats(): DeskSimulatorDevicesStats;
}

export function createSimulatorDevices(deps: DeskSimulatorDevicesDeps): DeskSimulatorDevices {
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? {
    set: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
    clear: (h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  /** The last read: its rows and when it landed — undefined: cold. */
  let snapshot:
    | { readonly rows: readonly LiveSurfaceSimulatorDeviceRowV1[]; readonly at: number }
    | undefined;
  let reading: Promise<void> | null = null;
  let timer: unknown = null;
  let watching = 0;
  const counts = { looks: 0, reads: 0, failures: 0 };

  const read = (): Promise<void> => {
    if (reading !== null) return reading;
    const client = deps.mintClient();
    if (client === null) return Promise.resolve();
    counts.reads += 1;
    const run = (async () => {
      try {
        const raw = await client.request("surface.simulator.devices", {});
        snapshot = { rows: SurfaceSimulatorDevicesResultV1.parse(raw).devices, at: now() };
      } catch {
        counts.failures += 1; // the last read stands: a phone attaches by type, and its face says what is true
      }
    })();
    // let go once it lands (before the look that awaits it goes on) — never before it is held, should the ask throw at once
    reading = run;
    void run.then(() => {
      if (reading === run) reading = null;
    });
    return run;
  };

  const look = async (): Promise<void> => {
    counts.looks += 1;
    let wanted = false;
    try {
      wanted = deps.wanted();
    } catch {
      wanted = false; // a board going away under the look: nothing stands
    }
    if (!wanted) return;
    if (snapshot !== undefined && now() - snapshot.at < SIMULATOR_DEVICES_READ_MS) return;
    await read();
  };

  const step = (): void => {
    timer = null;
    if (watching === 0) return;
    void look();
    timer = timers.set(step, SIMULATOR_DEVICES_LOOK_MS);
  };

  return {
    attachable: (prefer) =>
      snapshot === undefined ? undefined : attachableOf(snapshot.rows, prefer),
    watch() {
      watching += 1;
      if (watching === 1) step();
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        watching -= 1;
        if (watching === 0 && timer !== null) {
          timers.clear(timer);
          timer = null;
        }
      };
    },
    look,
    stats: () => ({ ...counts, rows: snapshot === undefined ? null : snapshot.rows.length }),
  };
}
