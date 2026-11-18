// Simulator setup reads Xcode's installed runtimes and compatible iPhone models when opened or refreshed.
// Concurrent requests share one read. Older plugins can still ask for a synchronous device snapshot, which
// starts periodic reads while a simulator-capable object is on the board. Both APIs use the same redacted RPC.

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
  type LiveSurfaceSimulatorRuntimeOptionV1,
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

/** The newest iOS runtime of `runtimes` (CoreSimulator's ids: main's installed list) — undefined: none on iOS. */
function newestIos(runtimes: readonly string[]): string | undefined {
  let best: { runtime: string; version: readonly number[] } | undefined;
  for (const runtime of runtimes) {
    const version = iosVersion(runtime);
    if (version === undefined) continue;
    if (best === undefined || newer(version, best.version) < 0) best = { runtime, version };
  }
  return best?.runtime;
}

/** A binding the contracts accept, or undefined (a `prefer` that is no device type's id binds nothing). */
function bindingOf(deviceType: string, runtime: string): LiveSimulatorBinding | undefined {
  const parsed = LiveSurfaceIosSimulatorBindingV1.safeParse({ deviceType, runtime });
  return parsed.success
    ? { deviceType: parsed.data.deviceType, runtime: parsed.data.runtime }
    : undefined;
}

/**
 * THE ATTACH'S PICK (R11), pure, over this Mac's device rows and its installed runtimes: the device a phone of model
 * `prefer` binds to here.
 *  1. the BOOTED device of the phone's own model (on the newest runtime, where two are booted);
 *  2. else the first booted iPhone — its model and runtime (the phone morphs into it);
 *  3. else the phone's own model on the newest iOS runtime INSTALLED here, whether or not a device runs it yet (main attaches
 *     the model's device on any runtime — its face says `off`, and boots it — or says `no-device`, and creates one). With
 *     no runtimes said (`runtimes` empty), the newest a device row is on.
 * Undefined: no iOS runtime to pick from, or no binding the contracts accept (a `prefer` that is no device type's id).
 */
export function attachableOf(
  rows: readonly LiveSurfaceSimulatorDeviceRowV1[],
  prefer: string,
  runtimes: readonly string[] = [],
): LiveSimulatorBinding | undefined {
  const own = newestOf(rows.filter((row) => row.booted && row.deviceType === prefer));
  if (own !== undefined) return bindingOf(own.deviceType, own.runtime);
  const iphone = rows.find((row) => row.booted && IPHONE.test(row.deviceType));
  if (iphone !== undefined) return bindingOf(iphone.deviceType, iphone.runtime);
  const runtime = newestIos(runtimes) ?? newestOf(rows)?.runtime;
  return runtime === undefined ? undefined : bindingOf(prefer, runtime);
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
  readonly setup?: SimulatorDevices["setup"];
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
  /** Scope legacy snapshot polling to this mount. A caller of attachable starts the first read. */
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
  /** The last read: its rows, the runtimes installed here, and when it landed — undefined: cold. */
  let snapshot:
    | {
        readonly configurations: readonly LiveSurfaceSimulatorRuntimeOptionV1[] | undefined;
        readonly rows: readonly LiveSurfaceSimulatorDeviceRowV1[];
        readonly runtimes: readonly string[];
        readonly at: number;
      }
    | undefined;
  let reading: Promise<void> | null = null;
  let timer: unknown = null;
  let watching = 0;
  const counts = { looks: 0, reads: 0, failures: 0 };

  const read = (): Promise<void> => {
    if (reading !== null) return reading;
    const client = deps.mintClient();
    if (client === null) return Promise.reject(new Error("Desktop connection unavailable"));
    counts.reads += 1;
    const run = (async () => {
      try {
        const raw = await client.request("surface.simulator.devices", {});
        const listed = SurfaceSimulatorDevicesResultV1.parse(raw);
        snapshot = {
          rows: listed.devices,
          runtimes: listed.runtimes ?? [],
          configurations: listed.configurations,
          at: now(),
        };
      } catch (error) {
        counts.failures += 1; // the last read stands: a phone attaches by type, and its face says what is true
        throw error;
      }
    })();
    // let go once it lands (before the look that awaits it goes on) — never before it is held, should the ask throw at once
    reading = run;
    const finished = () => {
      if (reading === run) reading = null;
    };
    void run.then(finished, finished);
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
    await read().catch(() => {});
  };

  const step = (): void => {
    timer = null;
    if (watching === 0) return;
    void look();
    timer = timers.set(step, SIMULATOR_DEVICES_LOOK_MS);
  };

  return {
    ...(deps.setup ? { setup: deps.setup } : {}),
    async configurations() {
      // A user opening or refreshing setup should see a newly installed runtime immediately.
      await read();
      if (!snapshot?.configurations) throw new Error("Simulator catalog unavailable");
      return snapshot.configurations;
    },
    attachable(prefer) {
      // Older plugins read a synchronous device snapshot. Start their polling only
      // when one actually asks. The configuration picker reads on open and refresh.
      if (watching > 0 && timer === null) step();
      return snapshot === undefined
        ? undefined
        : attachableOf(snapshot.rows, prefer, snapshot.runtimes);
    },
    watch() {
      watching += 1;
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
