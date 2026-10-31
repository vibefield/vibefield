import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  CoreSimulatorDeviceTypeIdV1,
  CoreSimulatorRuntimeIdV1,
  type LiveSurfaceIosSimulatorBindingV1,
  LiveSurfaceSimulatorDeviceRowV1,
  SURFACE_LIMITS,
} from "@vibefield/contracts";
import type { BootedSimulatorDevice, SimulatorDeviceCatalog } from "./ios-simulator-producer";

// PT-S2 — THE SIMCTL SERVICE: everything main asks of CoreSimulator, through ONE exec seam (production spawns a fixed
// binary with `execFile`, never a shell; the units script it). Five verbs and no other:
//  - `list` — the full `simctl list --json`, ONE shared snapshot a tick across every surface (R8: never a spawn per phone
//    per second — the device runtimes' watches, the inner resolvers' 1 s revalidation and the attach's device list all
//    read the same snapshot);
//  - `boot` — a device already booted (or booting) counts as booted;
//  - `shutdown` — for completeness: no act runs it in v1 (a device is the person's, and nothing main does shuts one down);
//  - `create` — answers the new device's UDID, which stays in main;
//  - `show` — Simulator.app, the vetted Xcode's own, opened on that device (`-CurrentDeviceUDID`).
// An ALLOW-LIST refuses any other simctl verb (`ui`, `openurl`, `install`, `launch`, `privacy`, `push`… — view-only means
// nothing reaches inside iOS, PT-S §6 Q2), and each verb has its own bound.
//
// R5 — NO DIALOG: `/usr/bin/xcrun` on a Mac without Xcode can raise the "install the command line developer tools" prompt,
// so nothing runs it until `xcode-select -p` names a developer directory that HOLDS simctl (a Command Line Tools-only
// directory does not); every xcrun then runs with `DEVELOPER_DIR` set to the directory the probe vetted. A failed probe is
// `SimctlUnavailableError`: the face's `no-simulator`, never a generic failure.
// PT-S3 (P1, R5′) — the Command Line Tools selected BESIDE a full Xcode (this Mac's case: `xcode-select -p` names
// `/Library/Developer/CommandLineTools`): when the answer is a well-formed directory without simctl, the probe tries the
// default Xcode's — one fixed path, no search — and pins every xcrun to it. A failed or garbage answer has no fallback.

const XCODE_SELECT_PATH = "/usr/bin/xcode-select";
/** R5′: the default Xcode's developer directory — the ONE place the probe looks when xcode-select names one without simctl */
const XCODE_DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";
const XCRUN_PATH = "/usr/bin/xcrun";
const OPEN_PATH = "/usr/bin/open";
const MAX_SIMCTL_BYTES = 4 * 1024 * 1024;
const MAX_SIMCTL_DEVICES = 4_096;
const MAX_DEVELOPER_DIR_CHARS = 1_024;
/** The contract's UDID alphabet, and never an option: an argument main spawns never starts with a dash. */
const UDID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/u;
/** One tick: a snapshot this young is every caller's (R8). */
const SNAPSHOT_TTL_MS = 1_000;
/** A failed probe is asked again no sooner than this — Xcode is not installed by the second. */
const PROBE_RETRY_MS = 30_000;

/** Each verb's own bound (a boot waits on CoreSimulator; a list must not hold a watch up). */
export const SIMCTL_TIMEOUTS_MS = {
  probe: 5_000,
  list: 8_000,
  boot: 120_000,
  shutdown: 60_000,
  create: 30_000,
  show: 10_000,
} as const;

/** THE ALLOW-LIST — the simctl verbs main may run, and no other. */
export const SIMCTL_VERBS = ["list", "boot", "shutdown", "create"] as const;
export type SimctlVerb = (typeof SIMCTL_VERBS)[number];

/** PT-S3 (P1, P2) — which answer the probe vetted: xcode-select's own, the default Xcode's when xcode-select named a
 * directory without simctl (R5′), or a smoke's candidate (`SimctlServiceOptions.candidates`). */
export type SimctlVetted = "xcode-select" | "fallback" | "override";

/** One spawn of a fixed binary. `developerDir` rides as `DEVELOPER_DIR` (absent only for the probe itself). */
export interface SimctlExecRequest {
  readonly file: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly developerDir?: string;
}

/** THE exec seam: stdout, or a rejection (a non-zero exit, a timeout, a binary that is not there). */
export type SimctlExec = (request: SimctlExecRequest) => Promise<string>;

/** No Simulator on this Mac: no developer directory, or one without simctl (R5). */
export class SimctlUnavailableError extends Error {
  constructor(message = "The iOS Simulator is not available on this Mac") {
    super(message);
    this.name = "SimctlUnavailableError";
  }
}

/** A simctl verb off the allow-list — a bug in main, never a person's act. */
export class SimctlVerbRefusedError extends Error {
  constructor(readonly verb: string) {
    super("simctl verb refused by main's allow-list");
    this.name = "SimctlVerbRefusedError";
  }
}

/** The argv of one allowed simctl verb (`xcrun simctl <verb> …`); any other verb throws. Pure: the units hold it. */
export function simctlArgv(verb: string, args: readonly string[] = []): readonly string[] {
  if (!(SIMCTL_VERBS as readonly string[]).includes(verb)) throw new SimctlVerbRefusedError(verb);
  return ["simctl", verb, ...args];
}

/** One device on this Mac, as main keeps it — the UDID never leaves main. */
export interface SimctlDevice {
  readonly udid: string;
  readonly name: string;
  /** CoreSimulator's word: `Shutdown`, `Booting`, `Booted`, `ShuttingDown`, `Creating`… */
  readonly state: string;
  readonly deviceType: string;
  readonly runtime: string;
}

export interface SimctlRuntime {
  readonly identifier: string;
  readonly name: string;
  /** `26.1` — what "the newest" orders by */
  readonly version: string;
  readonly supportedDeviceTypes: ReadonlySet<string>;
}

/** One `simctl list --json`, parsed: the available runtimes (the newest first), the device types' names, and the
 * available devices of those runtimes. */
export interface SimctlSnapshot {
  readonly deviceTypeNames: ReadonlyMap<string, string>;
  readonly runtimes: readonly SimctlRuntime[];
  readonly devices: readonly SimctlDevice[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function versionParts(version: string): number[] {
  return version.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isSafeInteger(value) ? value : 0;
  });
}

/** Newer first: `26.1` before `26.0` before `18.6`. */
function compareVersionsDescending(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The whole of `simctl list --json`, bounded as the booted-device parser is (`ios-simulator-producer.ts`), but keeping
 * EVERY state and the catalogue a binding resolves against. Tolerant of one odd row: a device whose ids are not
 * CoreSimulator's (or whose UDID is malformed) is left out rather than failing every phone on this Mac; a malformed
 * document, an overflow or a duplicated UDID still throws.
 */
export function parseSimctlSnapshot(rawJson: string): SimctlSnapshot {
  if (Buffer.byteLength(rawJson) > MAX_SIMCTL_BYTES) {
    throw new Error("simctl metadata exceeded its fixed bound");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("simctl returned malformed JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["runtimes"]) || !isRecord(parsed["devices"])) {
    throw new Error("simctl returned an unsupported metadata shape");
  }

  const deviceTypeNames = new Map<string, string>();
  const rawDeviceTypes = parsed["devicetypes"];
  if (Array.isArray(rawDeviceTypes)) {
    for (const rawType of rawDeviceTypes) {
      if (!isRecord(rawType)) continue;
      const identifier = rawType["identifier"];
      const name = rawType["name"];
      if (!CoreSimulatorDeviceTypeIdV1.safeParse(identifier).success || !boundedString(name)) {
        continue;
      }
      deviceTypeNames.set(identifier as string, name);
    }
  }

  const runtimes: SimctlRuntime[] = [];
  const runtimeIds = new Set<string>();
  for (const rawRuntime of parsed["runtimes"]) {
    if (!isRecord(rawRuntime)) throw new Error("simctl returned invalid runtime metadata");
    const identifier = rawRuntime["identifier"];
    const name = rawRuntime["name"];
    if (!boundedString(identifier) || !boundedString(name)) {
      throw new Error("simctl returned invalid runtime identity");
    }
    if (rawRuntime["isAvailable"] === false) continue;
    if (!CoreSimulatorRuntimeIdV1.safeParse(identifier).success) continue;
    if (runtimeIds.has(identifier)) throw new Error("simctl returned duplicate runtime identity");
    runtimeIds.add(identifier);
    const supported = new Set<string>();
    const rawSupported = rawRuntime["supportedDeviceTypes"];
    if (Array.isArray(rawSupported)) {
      for (const rawType of rawSupported) {
        if (!isRecord(rawType)) continue;
        const typeId = rawType["identifier"];
        if (!CoreSimulatorDeviceTypeIdV1.safeParse(typeId).success) continue;
        supported.add(typeId as string);
        // a runtime's own row names the type too: the name a device of it is created with, when the list has no
        // devicetypes section
        const typeName = rawType["name"];
        if (!deviceTypeNames.has(typeId as string) && boundedString(typeName)) {
          deviceTypeNames.set(typeId as string, typeName);
        }
      }
    }
    const version = rawRuntime["version"];
    runtimes.push({
      identifier,
      name,
      version: boundedString(version, 64) ? version : "0",
      supportedDeviceTypes: supported,
    });
  }
  runtimes.sort(
    (left, right) =>
      compareVersionsDescending(left.version, right.version) ||
      (left.identifier < right.identifier ? -1 : left.identifier > right.identifier ? 1 : 0),
  );

  const devices: SimctlDevice[] = [];
  const udids = new Set<string>();
  let observed = 0;
  for (const [runtime, rawDevices] of Object.entries(parsed["devices"])) {
    if (!Array.isArray(rawDevices)) throw new Error("simctl returned invalid device metadata");
    const installed = runtimeIds.has(runtime);
    for (const rawDevice of rawDevices) {
      observed += 1;
      if (observed > MAX_SIMCTL_DEVICES) {
        throw new Error("simctl device metadata exceeded its fixed bound");
      }
      if (!installed || !isRecord(rawDevice) || rawDevice["isAvailable"] !== true) continue;
      const udid = rawDevice["udid"];
      const name = rawDevice["name"];
      const state = rawDevice["state"];
      const deviceType = rawDevice["deviceTypeIdentifier"];
      if (
        !boundedString(udid, 128) ||
        !UDID_PATTERN.test(udid) ||
        !boundedString(name) ||
        !boundedString(state, 64) ||
        !CoreSimulatorDeviceTypeIdV1.safeParse(deviceType).success
      ) {
        continue;
      }
      const normalized = udid.toUpperCase();
      if (udids.has(normalized)) throw new Error("simctl returned duplicate device identity");
      udids.add(normalized);
      devices.push({ udid, name, state, deviceType: deviceType as string, runtime });
    }
  }
  return { deviceTypeNames, runtimes, devices };
}

/** What a binding resolves to on THIS Mac (R3). */
export interface SimctlDevicePick {
  /** the device attached — absent: none of the bound type on this Mac */
  readonly device?: SimctlDevice;
  /** with no device: what "Create it" makes — absent: no installed runtime runs the type */
  readonly create?: {
    readonly name: string;
    readonly deviceType: string;
    readonly runtime: string;
  };
  /** the bound type's own name (`iPhone 17 Pro`), what a face says when there is no device — absent: unknown here */
  readonly typeName?: string;
}

/** Booted first, then on its way up, then the rest. */
function stateRank(state: string): number {
  if (state === "Booted") return 0;
  if (state === "Booting" || state === "Creating") return 1;
  return 2;
}

function byUdid(left: SimctlDevice, right: SimctlDevice): number {
  const a = left.udid.toUpperCase();
  const b = right.udid.toUpperCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A name for a new device no device on this Mac already has (R6: two windows of one name are told apart only by
 * Accessibility, which the face may not have) — the type's own name, then `… (2)`, `… (3)`. */
function uniqueDeviceName(snapshot: SimctlSnapshot, base: string): string {
  const taken = new Set(snapshot.devices.map((device) => device.name));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1_000; suffix += 1) {
    const candidate = `${base} (${suffix})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (VibeField)`;
}

/**
 * PT-S2 (R3) — THE BINDING → THIS MAC'S DEVICE. Pure.
 *  1. the exact type on the exact runtime (a booted one first, then one booting, then by UDID — a stable choice);
 *  2. else the same type on any installed runtime: a booted one first, then the newest runtime;
 *  3. else no device — and "Create it" makes one of the type on the binding's runtime when it is installed and runs the
 *     type, else on the newest installed runtime that does (none: no create).
 * The device's own ids are what the summary reports as attached, so a face says honestly when this Mac lacks the bound
 * runtime.
 */
export function pickDevice(
  snapshot: SimctlSnapshot,
  binding: LiveSurfaceIosSimulatorBindingV1,
): SimctlDevicePick {
  const typeName = snapshot.deviceTypeNames.get(binding.deviceType);
  const named = typeName === undefined ? {} : { typeName };
  const ofType = snapshot.devices.filter((device) => device.deviceType === binding.deviceType);
  const exact = ofType
    .filter((device) => device.runtime === binding.runtime)
    .sort((left, right) => stateRank(left.state) - stateRank(right.state) || byUdid(left, right));
  if (exact[0] !== undefined) return { device: exact[0], ...named };
  const order = new Map(snapshot.runtimes.map((runtime, index) => [runtime.identifier, index]));
  const fallback = [...ofType].sort(
    (left, right) =>
      stateRank(left.state) - stateRank(right.state) ||
      (order.get(left.runtime) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.runtime) ?? Number.MAX_SAFE_INTEGER) ||
      byUdid(left, right),
  );
  if (fallback[0] !== undefined) return { device: fallback[0], ...named };
  const runs = (runtime: SimctlRuntime) => runtime.supportedDeviceTypes.has(binding.deviceType);
  const runtime =
    snapshot.runtimes.find(
      (candidate) => candidate.identifier === binding.runtime && runs(candidate),
    ) ?? snapshot.runtimes.find(runs);
  if (runtime === undefined || typeName === undefined) return named;
  return {
    ...named,
    create: {
      name: uniqueDeviceName(snapshot, typeName),
      deviceType: binding.deviceType,
      runtime: runtime.identifier,
    },
  };
}

/**
 * PT-S2 (R11) — THE ATTACH'S DEVICE ROWS: every available device of an installed runtime, REDACTED to the ids a binding is
 * made of (each row is the contract's own parse: a name it would refuse leaves the row out, and a UDID is never on one),
 * the booted first — then by the newest runtime — so the list's bound drops only devices at rest.
 */
export function simulatorDeviceRows(
  snapshot: SimctlSnapshot,
): readonly LiveSurfaceSimulatorDeviceRowV1[] {
  const order = new Map(snapshot.runtimes.map((runtime, index) => [runtime.identifier, index]));
  const sorted = [...snapshot.devices].sort(
    (left, right) =>
      Number(right.state === "Booted") - Number(left.state === "Booted") ||
      (order.get(left.runtime) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.runtime) ?? Number.MAX_SAFE_INTEGER) ||
      byUdid(left, right),
  );
  const rows: LiveSurfaceSimulatorDeviceRowV1[] = [];
  for (const device of sorted) {
    if (rows.length >= SURFACE_LIMITS.MAX_SIMULATOR_DEVICES) break;
    const row = LiveSurfaceSimulatorDeviceRowV1.safeParse({
      deviceType: device.deviceType,
      runtime: device.runtime,
      name: device.name,
      booted: device.state === "Booted",
    });
    if (row.success) rows.push(row.data);
  }
  return rows;
}

/**
 * PT-S2 (R11) — THE ATTACH'S RUNTIMES: every installed (available) runtime's id, the newest first, bounded — what the
 * attach's third pick binds a phone's model to (the newest installed iOS, whether or not a device runs it yet: its face
 * then says "no device", and "Create it" makes one there). Ids only: a runtime names no device.
 */
export function simulatorRuntimeIds(snapshot: SimctlSnapshot): readonly string[] {
  const ids: string[] = [];
  for (const runtime of snapshot.runtimes) {
    if (ids.length >= SURFACE_LIMITS.MAX_SIMULATOR_RUNTIMES) break;
    if (CoreSimulatorRuntimeIdV1.safeParse(runtime.identifier).success)
      ids.push(runtime.identifier);
  }
  return ids;
}

function defaultExec(request: SimctlExecRequest): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      request.file,
      [...request.args],
      {
        encoding: "utf8",
        maxBuffer: MAX_SIMCTL_BYTES,
        timeout: request.timeoutMs,
        env:
          request.developerDir === undefined
            ? process.env
            : { ...process.env, DEVELOPER_DIR: request.developerDir },
      },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolve(stdout);
      },
    );
  });
}

function assertUdid(udid: string): void {
  if (!UDID_PATTERN.test(udid)) throw new Error("simctl device identity is malformed");
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** A developer directory as an answer may name one: absolute, bounded, printable — a garbage answer is none. */
function wellFormedDeveloperDir(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_DEVELOPER_DIR_CHARS &&
    isAbsolute(value) &&
    !hasControlCharacters(value)
  );
}

export interface SimctlServiceOptions {
  /** THE exec seam; production spawns with `execFile` */
  readonly exec?: SimctlExec;
  /** the probe's file check (simctl inside the developer directory) */
  readonly exists?: (path: string) => boolean;
  readonly now?: () => number;
  /** PT-S3 (P2) — a SMOKE's developer directories (`modes.ts` `smokeSimctlDeveloperDir`): given, the probe asks
   * xcode-select nothing and vets only these, in order, under the same checks (`override`); none passing is no Simulator.
   * Production passes none. */
  readonly candidates?: readonly string[];
}

/** PT-S2 — main's ONE simctl, shared by every bound phone, the inner resolvers and the attach's list. */
export class SimctlService implements SimulatorDeviceCatalog {
  readonly #exec: SimctlExec;
  readonly #exists: (path: string) => boolean;
  readonly #now: () => number;
  readonly #candidates: readonly string[] | null;
  #developerDir: string | null = null;
  /** which answer vetted `#developerDir` (P1) — meaningful only while it is held */
  #vettedBy: SimctlVetted | null = null;
  #probeFailedAt: number | null = null;
  #probing: Promise<string> | null = null;
  #snapshot: { readonly at: number; readonly value: SimctlSnapshot } | null = null;
  #listing: Promise<SimctlSnapshot> | null = null;
  /** bumped by every change main makes (and by `invalidate`): a list begun before it is never kept as fresh */
  #generation = 0;
  #disposed = false;

  constructor(options: SimctlServiceOptions = {}) {
    this.#exec = options.exec ?? defaultExec;
    this.#exists = options.exists ?? existsSync;
    this.#now = options.now ?? Date.now;
    this.#candidates = options.candidates === undefined ? null : [...options.candidates];
  }

  /** R5: the developer directory that holds simctl, or `SimctlUnavailableError` — before ANY xcrun. */
  async developerDir(): Promise<string> {
    if (this.#disposed) throw new SimctlUnavailableError();
    if (this.#developerDir !== null) return this.#developerDir;
    const failedAt = this.#probeFailedAt;
    if (failedAt !== null) {
      const age = this.#now() - failedAt;
      if (age >= 0 && age < PROBE_RETRY_MS) throw new SimctlUnavailableError();
    }
    if (this.#probing === null) {
      const probing = this.probe().finally(() => {
        if (this.#probing === probing) this.#probing = null;
      });
      this.#probing = probing;
    }
    return await this.#probing;
  }

  /** PT-S3 (P1) — which answer the held developer directory came from (the census's word); null: none probed yet, the
   * probe failed, or the directory was since lost (a list that failed re-probes). Reads; never probes. */
  vetted(): SimctlVetted | null {
    return this.#disposed || this.#developerDir === null ? null : this.#vettedBy;
  }

  /** The shared snapshot: one within a tick is every caller's; one list in flight is joined, never doubled (R8). */
  async list(): Promise<SimctlSnapshot> {
    const held = this.#snapshot;
    if (held !== null) {
      const age = this.#now() - held.at;
      if (age >= 0 && age < SNAPSHOT_TTL_MS) return held.value;
    }
    if (this.#listing === null) {
      const generation = this.#generation;
      const listing = this.readList()
        .then((value) => {
          if (this.#generation === generation) this.#snapshot = { at: this.#now(), value };
          return value;
        })
        .finally(() => {
          if (this.#listing === listing) this.#listing = null;
        });
      this.#listing = listing;
    }
    return await this.#listing;
  }

  /** The next `list` reads CoreSimulator afresh (a change main made, or one a face is waiting to see). */
  invalidate(): void {
    this.#generation += 1;
    this.#snapshot = null;
    this.#listing = null;
  }

  /** `simctl boot`: a device already booted, or on its way, counts as booted. */
  async boot(udid: string): Promise<void> {
    assertUdid(udid);
    try {
      await this.simctl("boot", [udid], SIMCTL_TIMEOUTS_MS.boot);
    } catch (error) {
      if (error instanceof SimctlUnavailableError) throw error;
      // "Unable to boot device in current state: Booted" is a non-zero exit; the device's own state says whether it
      // was that (main never parses simctl's prose)
      this.invalidate();
      const device = (await this.list()).devices.find(
        (candidate) => candidate.udid.toUpperCase() === udid.toUpperCase(),
      );
      if (device?.state === "Booted" || device?.state === "Booting") return;
      throw error;
    } finally {
      this.invalidate();
    }
  }

  /** `simctl shutdown`: a device already shut down counts as shut down. No v1 act runs it (a device is the person's). */
  async shutdown(udid: string): Promise<void> {
    assertUdid(udid);
    try {
      await this.simctl("shutdown", [udid], SIMCTL_TIMEOUTS_MS.shutdown);
    } catch (error) {
      if (error instanceof SimctlUnavailableError) throw error;
      this.invalidate();
      const device = (await this.list()).devices.find(
        (candidate) => candidate.udid.toUpperCase() === udid.toUpperCase(),
      );
      if (device?.state === "Shutdown") return;
      throw error;
    } finally {
      this.invalidate();
    }
  }

  /** `simctl create <name> <type> <runtime>` → the new device's UDID (which stays in main). Every argument is checked
   * before it becomes one: the ids are CoreSimulator's, and the name (main's own, from simctl's catalogue) is bounded,
   * printable and never an option. */
  async create(name: string, deviceType: string, runtime: string): Promise<string> {
    if (
      name.length === 0 ||
      name.length > 128 ||
      name.startsWith("-") ||
      hasControlCharacters(name) ||
      !CoreSimulatorDeviceTypeIdV1.safeParse(deviceType).success ||
      !CoreSimulatorRuntimeIdV1.safeParse(runtime).success
    ) {
      throw new Error("simctl create refused an invalid device specification");
    }
    try {
      const udid = (
        await this.simctl("create", [name, deviceType, runtime], SIMCTL_TIMEOUTS_MS.create)
      ).trim();
      assertUdid(udid);
      return udid;
    } finally {
      this.invalidate();
    }
  }

  /** Simulator.app — the vetted Xcode's, never whichever `open -a Simulator` finds first — opened on the device. */
  async show(udid: string): Promise<void> {
    assertUdid(udid);
    const developerDir = await this.developerDir();
    await this.#exec({
      file: OPEN_PATH,
      args: [
        "-a",
        join(developerDir, "Applications", "Simulator.app"),
        "--args",
        "-CurrentDeviceUDID",
        udid,
      ],
      timeoutMs: SIMCTL_TIMEOUTS_MS.show,
    });
  }

  /** The inner resolvers' catalogue (`IosSimulatorSourceResolver`): this tick's booted devices, from the shared list. */
  async enumerateBootedDevices(): Promise<readonly BootedSimulatorDevice[]> {
    const snapshot = await this.list();
    const runtimeNames = new Map(
      snapshot.runtimes.map((runtime) => [runtime.identifier, runtime.name]),
    );
    const booted: BootedSimulatorDevice[] = [];
    for (const device of snapshot.devices) {
      const runtimeName = runtimeNames.get(device.runtime);
      if (device.state !== "Booted" || runtimeName === undefined) continue;
      booted.push({
        udid: device.udid,
        name: device.name,
        runtimeIdentifier: device.runtime,
        runtimeName,
        deviceTypeIdentifier: device.deviceType,
      });
    }
    return booted;
  }

  /** R11: the attach's rows — none when this Mac has no Simulator. */
  async deviceRows(): Promise<readonly LiveSurfaceSimulatorDeviceRowV1[]> {
    try {
      return simulatorDeviceRows(await this.list());
    } catch (error) {
      if (error instanceof SimctlUnavailableError) return [];
      throw error;
    }
  }

  /** R11: the attach's runtimes, the newest first, from the same shared list — none when this Mac has no Simulator. */
  async runtimeIds(): Promise<readonly string[]> {
    try {
      return simulatorRuntimeIds(await this.list());
    } catch (error) {
      if (error instanceof SimctlUnavailableError) return [];
      throw error;
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.invalidate();
  }

  private async probe(): Promise<string> {
    const vetted = await this.selected();
    if (vetted === null) {
      this.#probeFailedAt = this.#now();
      throw new SimctlUnavailableError();
    }
    this.#probeFailedAt = null;
    this.#developerDir = vetted.developerDir;
    this.#vettedBy = vetted.by;
    return vetted.developerDir;
  }

  /** R5′: xcode-select's answer when it holds simctl; when it is a well-formed directory WITHOUT simctl, the default
   * Xcode's when THAT holds simctl; else none. A failed spawn or a garbage answer is none — never the fallback. P2: a
   * smoke's candidates instead, when given — the first that passes the same checks, and xcode-select never asked. */
  private async selected(): Promise<{
    readonly developerDir: string;
    readonly by: SimctlVetted;
  } | null> {
    if (this.#candidates !== null) {
      const found = this.#candidates.find(
        (candidate) => wellFormedDeveloperDir(candidate) && this.holdsSimctl(candidate),
      );
      return found === undefined ? null : { developerDir: found, by: "override" };
    }
    let answer: string;
    try {
      answer = (
        await this.#exec({
          file: XCODE_SELECT_PATH,
          args: ["-p"],
          timeoutMs: SIMCTL_TIMEOUTS_MS.probe,
        })
      ).trim();
    } catch {
      return null;
    }
    if (!wellFormedDeveloperDir(answer)) return null;
    if (this.holdsSimctl(answer)) return { developerDir: answer, by: "xcode-select" };
    // Command Line Tools alone (`/Library/Developer/CommandLineTools`) have no simctl — the default Xcode beside them may
    if (this.holdsSimctl(XCODE_DEVELOPER_DIR)) {
      return { developerDir: XCODE_DEVELOPER_DIR, by: "fallback" };
    }
    // neither: no Simulator, no xcrun
    return null;
  }

  private holdsSimctl(developerDir: string): boolean {
    return this.#exists(join(developerDir, "usr", "bin", "simctl"));
  }

  private async readList(): Promise<SimctlSnapshot> {
    let raw: string;
    try {
      raw = await this.simctl("list", ["--json"], SIMCTL_TIMEOUTS_MS.list);
    } catch (error) {
      // a developer directory that no longer holds simctl (Xcode moved or removed) is probed again next time
      if (!(error instanceof SimctlUnavailableError)) {
        this.#developerDir = null;
        this.#vettedBy = null;
      }
      throw error;
    }
    return parseSimctlSnapshot(raw);
  }

  private async simctl(verb: SimctlVerb, args: readonly string[], timeoutMs: number) {
    const argv = simctlArgv(verb, args);
    const developerDir = await this.developerDir();
    return await this.#exec({ file: XCRUN_PATH, args: argv, timeoutMs, developerDir });
  }
}
