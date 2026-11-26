import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LiveSurfaceBrowserSourceV1 } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProductionLiveSurfaceSupport,
  createRunPartitionClearer,
  endRunsOfGoneFieldd,
} from "../src/main/live-surfaces/authority-production";
import { browserSurfacePartition } from "../src/main/live-surfaces/browser-security";
import type { SimulatorDeviceCatalog } from "../src/main/live-surfaces/ios-simulator-producer";
import {
  SimctlService,
  SimctlUnavailableError,
  simctlCallCounts,
} from "../src/main/live-surfaces/simctl";

// PT-S3 — main's production live-surface support with NOTHING real beneath it: `node:child_process` refuses every spawn
// unless a row scripts an in-process answer to `execFile`, the native adapter's loader is a fake that counts its loads,
// and Electron is a stub. A unit here spawns nothing and loads nothing (it runs on every lane and on the mini's mint).

const fakes = vi.hoisted(() => ({
  /** each execFile asked of child_process — none ever spawned. `developerDir`: the `DEVELOPER_DIR` the call pinned, null
   * when it ran with main's own environment */
  execs: [] as { file: string; args: readonly string[]; developerDir: string | null }[],
  /** a row's in-process answer to an execFile; undefined refuses it, as every other spawn is refused */
  answer: undefined as ((file: string, args: readonly string[]) => string | undefined) | undefined,
  /** the native adapter's loads, by path */
  loads: [] as string[],
  /** what the loader answers; null: it refuses */
  adapter: null as unknown,
  /** each simulator source resolver built, with the device catalog it was handed (M3) */
  resolvers: [] as { resolver: unknown; devices: unknown }[],
  /** each legacy `ios-simulator` runtime minted, with the resolver it was handed (M3) */
  legacy: [] as { resolver: unknown }[],
  /** EY-1 (7b): each browser runtime made, with the registry it was handed, and whether it is closed */
  browsers: [] as { surfaceId: string; controlTargets: unknown; closed: boolean }[],
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const refuse = (name: string) => () => {
    throw new Error(`a unit spawns nothing (child_process.${name})`);
  };
  const execFile = (
    file: string,
    args: readonly string[],
    options: { readonly env?: NodeJS.ProcessEnv } | undefined,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const env = options?.env;
    fakes.execs.push({
      file,
      args: [...args],
      developerDir:
        env === undefined || env === process.env ? null : (env["DEVELOPER_DIR"] ?? null),
    });
    const stdout = fakes.answer?.(file, args);
    if (stdout === undefined) throw new Error("a unit spawns nothing (child_process.execFile)");
    queueMicrotask(() => callback(null, stdout, ""));
    return undefined;
  };
  const mocked = {
    exec: refuse("exec"),
    execSync: refuse("execSync"),
    execFile,
    execFileSync: refuse("execFileSync"),
    fork: refuse("fork"),
    spawn: refuse("spawn"),
    spawnSync: refuse("spawnSync"),
  };
  return { ...actual, ...mocked, default: { ...actual, ...mocked } };
});

vi.mock("../src/main/live-surfaces/macos-capture-native", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/main/live-surfaces/macos-capture-native")>();
  return {
    ...actual,
    loadMacosCaptureNativeAdapter: (path: string) => {
      fakes.loads.push(path);
      if (fakes.adapter === null) throw new Error("a unit loads no native adapter");
      return fakes.adapter as ReturnType<typeof actual.loadMacosCaptureNativeAdapter>;
    },
  };
});

// M3: the real classes, each construction recorded — which catalog a resolver reads, which resolver the legacy kind holds
vi.mock("../src/main/live-surfaces/ios-simulator-producer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/main/live-surfaces/ios-simulator-producer")>();
  class IosSimulatorSourceResolver extends actual.IosSimulatorSourceResolver {
    constructor(options: ConstructorParameters<typeof actual.IosSimulatorSourceResolver>[0]) {
      super(options);
      fakes.resolvers.push({ resolver: this, devices: options.devices });
    }
  }
  class IosSimulatorLiveSurfaceRuntime extends actual.IosSimulatorLiveSurfaceRuntime {
    constructor(options: ConstructorParameters<typeof actual.IosSimulatorLiveSurfaceRuntime>[0]) {
      super(options);
      fakes.legacy.push({ resolver: options.resolver });
    }
  }
  return { ...actual, IosSimulatorSourceResolver, IosSimulatorLiveSurfaceRuntime };
});

// EY-1 (7b): a browser runtime here is a record of what it was handed; no window, no page
vi.mock("../src/main/live-surfaces/browser-producer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/main/live-surfaces/browser-producer")>();
  class BrowserLiveSurfaceRuntime {
    readonly surfaceId: string;
    readonly source: LiveSurfaceBrowserSourceV1;
    readonly #record: { surfaceId: string; controlTargets: unknown; closed: boolean };
    constructor(options: {
      surfaceId: string;
      source: LiveSurfaceBrowserSourceV1;
      controlTargets?: unknown;
    }) {
      this.surfaceId = options.surfaceId;
      this.source = options.source;
      this.#record = {
        surfaceId: options.surfaceId,
        controlTargets: options.controlTargets,
        closed: false,
      };
      fakes.browsers.push(this.#record);
    }
    isClosed(): boolean {
      return this.#record.closed;
    }
  }
  return { ...actual, BrowserLiveSurfaceRuntime };
});

vi.mock("electron", () => ({ BrowserWindow: class {}, session: {} }));

const XCODE_SELECT = "/usr/bin/xcode-select";
const XCRUN = "/usr/bin/xcrun";
const PRO = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
const IOS_26_5 = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
const UDID = "AAAAAAAA-0000-4000-8000-000000000001";
const CAPTURE = { helperPath: "/nonexistent/h", adapterPath: "/nonexistent/a.node" } as const;

const LIST = JSON.stringify({
  devicetypes: [{ identifier: PRO, name: "iPhone 17 Pro" }],
  runtimes: [
    {
      identifier: IOS_26_5,
      name: "iOS 26.5",
      version: "26.5",
      isAvailable: true,
      supportedDeviceTypes: [{ identifier: PRO, name: "iPhone 17 Pro" }],
    },
  ],
  devices: {
    [IOS_26_5]: [
      {
        udid: UDID,
        name: "iPhone 17 Pro",
        state: "Booted",
        deviceTypeIdentifier: PRO,
        isAvailable: true,
      },
    ],
  },
});

/** an adapter that refuses every drive — the support only holds it */
function refusingAdapter(): unknown {
  const refuse = (name: string) => () => {
    throw new Error(`a unit drives no native adapter (${name})`);
  };
  return {
    start: refuse("start"),
    setExpectedPeerPid: refuse("setExpectedPeerPid"),
    drain: refuse("drain"),
    release: refuse("release"),
    stats: refuse("stats"),
    stop: refuse("stop"),
    resolveSimulatorViewport: refuse("resolveSimulatorViewport"),
  };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pt-s3-authority-production-"));
});

afterEach(() => {
  fakes.execs.length = 0;
  fakes.answer = undefined;
  fakes.loads.length = 0;
  fakes.adapter = null;
  fakes.resolvers.length = 0;
  fakes.legacy.length = 0;
  rmSync(root, { recursive: true, force: true });
});

/** a developer directory that holds simctl — a file on disk, never run */
function developerDir(): string {
  const dir = join(root, "Developer");
  mkdirSync(join(dir, "usr", "bin"), { recursive: true });
  writeFileSync(join(dir, "usr", "bin", "simctl"), "");
  return dir;
}

describe("createProductionLiveSurfaceSupport — main's ONE simctl (PT-S3 P1)", () => {
  it("the booted-simulator kind's catalog is the shared simctl: its xcrun pinned to the vetted directory, one snapshot a tick with the attach's list (R8)", async () => {
    const vetted = developerDir();
    fakes.adapter = refusingAdapter();
    fakes.answer = (file, args) => {
      if (file === XCODE_SELECT) return `${vetted}\n`;
      if (file === XCRUN && args[1] === "list") return LIST;
      return undefined;
    };
    const support = createProductionLiveSurfaceSupport({ capture: CAPTURE });
    try {
      expect(await support.enumeration.bootedSimulators()).toEqual([
        { sourceRef: UDID, title: "iPhone 17 Pro", appName: "iOS 26.5" },
      ]);
      expect(await support.simulatorDevices.list()).toEqual([
        { deviceType: PRO, runtime: IOS_26_5, name: "iPhone 17 Pro", booted: true },
      ]);
      // the probe runs with main's own environment; the ONE list — the kind's and the attach's — under the vetted Xcode
      expect(fakes.execs).toEqual([
        { file: XCODE_SELECT, args: ["-p"], developerDir: null },
        { file: XCRUN, args: ["simctl", "list", "--json"], developerDir: vetted },
      ]);
      expect(fakes.loads).toEqual([CAPTURE.adapterPath]);
    } finally {
      await support.dispose();
    }
  });

  it("the legacy kind's RESOLVER reads the same shared simctl: minted through factories.iosSimulator, its list pinned and one with the picker's (M3)", async () => {
    const vetted = developerDir();
    fakes.adapter = refusingAdapter();
    fakes.answer = (file, args) => {
      if (file === XCODE_SELECT) return `${vetted}\n`;
      if (file === XCRUN && args[1] === "list") return LIST;
      return undefined;
    };
    const support = createProductionLiveSurfaceSupport({ capture: CAPTURE });
    try {
      support.factories.iosSimulator("ios_surface_000000000a", {
        kind: "ios-simulator",
        udid: UDID,
        crop: { mode: "auto" },
      });
      // the stack's two resolvers — the legacy kind's and the bound phones' — hold ONE catalog: main's simctl
      expect(fakes.resolvers).toHaveLength(2);
      const [legacy, phones] = fakes.resolvers;
      expect(fakes.legacy).toEqual([{ resolver: legacy?.resolver }]);
      expect(legacy?.devices).toBeInstanceOf(SimctlService);
      expect(legacy?.devices).toBe(phones?.devices);
      // driven: the legacy resolver's catalog and the picker read ONE probe and ONE list, under the vetted Xcode
      const catalog = legacy?.devices as SimulatorDeviceCatalog;
      expect(await catalog.enumerateBootedDevices()).toHaveLength(1);
      expect(await support.enumeration.bootedSimulators()).toHaveLength(1);
      expect(fakes.execs).toEqual([
        { file: XCODE_SELECT, args: ["-p"], developerDir: null },
        { file: XCRUN, args: ["simctl", "list", "--json"], developerDir: vetted },
      ]);
    } finally {
      await support.dispose();
    }
  });

  it("P2: a smoke's candidates reach the shared simctl — an empty directory is no Simulator with nothing spawned, and one that holds simctl pins the list", async () => {
    const empty = join(root, "empty");
    mkdirSync(empty);
    fakes.adapter = refusingAdapter();
    const none = createProductionLiveSurfaceSupport({
      capture: CAPTURE,
      simctlCandidates: [empty],
    });
    try {
      expect(await none.simulatorDevices.list()).toEqual([]);
      await expect(none.enumeration.bootedSimulators()).rejects.toBeInstanceOf(
        SimctlUnavailableError,
      );
      expect(fakes.execs).toEqual([]);
    } finally {
      await none.dispose();
    }

    const vetted = developerDir();
    fakes.answer = (file, args) => (file === XCRUN && args[1] === "list" ? LIST : undefined);
    const smoke = createProductionLiveSurfaceSupport({
      capture: CAPTURE,
      simctlCandidates: [vetted],
    });
    try {
      expect(await smoke.simulatorDevices.list()).toHaveLength(1);
      expect(fakes.execs).toEqual([
        { file: XCRUN, args: ["simctl", "list", "--json"], developerDir: vetted },
      ]);
    } finally {
      await smoke.dispose();
    }
  });
});

/** PT-S2: a phone bound by its device type and runtime — never a UDID */
const PHONE_SOURCE = {
  kind: "ios-simulator-device",
  binding: { deviceType: PRO, runtime: IOS_26_5 },
  crop: { mode: "auto" },
} as const;

const FRESH = {
  sessions: 0,
  sessionsMade: 0,
  captureReady: false,
  helperPresent: false,
  helper: null,
  vetted: null,
} as const;

describe("createProductionLiveSurfaceSupport — main's simulator census (PT-S3 D1)", () => {
  it("a fresh census is zero or null, and READS: no simctl, no capture stack, nothing spawned or loaded", () => {
    const support = createProductionLiveSurfaceSupport({ capture: CAPTURE });
    expect(support.census()).toEqual(FRESH);
    expect(support.census()).toEqual(FRESH);
    expect(fakes.execs).toEqual([]);
    expect(fakes.loads).toEqual([]);
    // a shell with no capture half says the same
    expect(createProductionLiveSurfaceSupport({ capture: null }).census()).toEqual(FRESH);
  });

  it("reads what was made: the helper on disk before any stack, a phone's session, the stack once built, the vetted directory", async () => {
    const helperPath = join(root, "live-surface-capture-helper");
    writeFileSync(helperPath, "");
    const vetted = developerDir();
    fakes.adapter = refusingAdapter();
    fakes.answer = (file, args) => {
      if (file === XCODE_SELECT) return `${vetted}\n`;
      if (file === XCRUN && args[1] === "list") return LIST;
      return undefined;
    };
    const support = createProductionLiveSurfaceSupport({ capture: { ...CAPTURE, helperPath } });
    try {
      // the helper is on disk; the stack that would spawn it is not built
      expect(support.census()).toEqual({ ...FRESH, helperPresent: true });
      // a phone's session is made at mint, its ONE inner with it; it looks only under a face
      support.factories.iosSimulatorDevice("simdev_surface_000000000a", PHONE_SOURCE);
      expect(support.census()).toEqual({
        ...FRESH,
        sessions: 1,
        sessionsMade: 1,
        helperPresent: true,
      });
      expect(fakes.execs).toEqual([]);
      expect(fakes.loads).toEqual([]);
      await support.enumeration.bootedSimulators();
      expect(support.census()).toEqual({
        sessions: 1,
        sessionsMade: 1,
        captureReady: true,
        helperPresent: true,
        helper: { helperStarts: 0, helperExits: 0, activeSessions: 0, framesReceived: 0 },
        vetted: "xcode-select",
      });
    } finally {
      await support.dispose();
    }
    expect(support.census()).toEqual({ ...FRESH, helperPresent: true });
  });
});

describe("createProductionLiveSurfaceSupport — the simctl call record (PT-S3 D2)", () => {
  it("a smoke's record counts the shared simctl's calls by name into census().simctl — a copy; production keeps none", async () => {
    const empty = join(root, "empty");
    mkdirSync(empty);
    const calls = simctlCallCounts();
    const smoke = createProductionLiveSurfaceSupport({
      capture: CAPTURE,
      simctlCandidates: [empty],
      simctlCalls: calls,
    });
    try {
      expect(smoke.census().simctl).toEqual(simctlCallCounts());
      expect(await smoke.simulatorDevices.list()).toEqual([]);
      // SIM-NONE's read: a probe attempted, and no xcode-select, list, boot, create or show
      const read = smoke.census().simctl;
      expect(read).toEqual({ ...simctlCallCounts(), probe: 1 });
      expect(calls.probe).toBe(1);
      // the census hands a copy: a reader never moves main's count
      (read as Record<string, number>)["probe"] = 99;
      expect(smoke.census().simctl?.probe).toBe(1);
    } finally {
      await smoke.dispose();
    }

    // the same support without the record — production's — counts nothing and says none
    const production = createProductionLiveSurfaceSupport({
      capture: CAPTURE,
      simctlCandidates: [empty],
    });
    try {
      expect(await production.simulatorDevices.list()).toEqual([]);
      expect(production.census()).not.toHaveProperty("simctl");
    } finally {
      await production.dispose();
    }
    expect(calls.probe).toBe(1);
    expect(fakes.execs).toEqual([]);
  });
});

describe("the simctl call record is SMOKE-ONLY — held in main's source (main/index.ts) (PT-S3 D2, M2)", () => {
  const index = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");

  it("main makes the record only in a smoke-like mode — production makes none", () => {
    expect(index).toMatch(
      /const harnessSimctlCalls: SimctlCallCounts \| null = isSmokeLike\(MODE\)\s*\?\s*simctlCallCounts\(\)\s*:\s*null;/u,
    );
  });

  it("and hands it to the production support only when it was made — never otherwise", () => {
    const start = index.indexOf("liveSurfaceSupport = createProductionLiveSurfaceSupport({");
    expect(start).toBeGreaterThanOrEqual(0);
    const call = index.slice(start, index.indexOf("\n    });", start));
    expect(call).toContain(
      "...(harnessSimctlCalls === null ? {} : { simctlCalls: harnessSimctlCalls }),",
    );
    // the ONE `simctlCalls:` main writes is that conditional spread's
    expect(index.match(/simctlCalls:/gu)).toHaveLength(1);
  });

  /** P2's call site as main's source must hold it (the grade's P-1): the variable read ONLY through the mode's gate
   * (`smokeSimctlDeveloperDir`, unit-held in modes.test.ts), and the ONE `simctlCandidates:` main writes the conditional
   * spread of what that gate answered — so a production or dev shell started with it set still asks xcode-select. */
  const p2Held = (src: string): void => {
    expect(src).toContain(
      "const SMOKE_SIMCTL_DEVELOPER_DIR = smokeSimctlDeveloperDir(MODE, process.env);",
    );
    const start = src.indexOf("liveSurfaceSupport = createProductionLiveSurfaceSupport({");
    expect(start).toBeGreaterThanOrEqual(0);
    const call = src.slice(start, src.indexOf("\n    });", start));
    expect(call).toMatch(
      /\.\.\.\(SMOKE_SIMCTL_DEVELOPER_DIR === undefined\s*\?\s*\{\}\s*:\s*\{ simctlCandidates: \[SMOKE_SIMCTL_DEVELOPER_DIR\] \}\),/u,
    );
    expect(src).not.toContain("VF_SMOKE_SIMCTL_DEVELOPER_DIR");
    expect(src.match(/simctlCandidates:/gu)).toHaveLength(1);
  };

  it("P2: main reads VF_SMOKE_SIMCTL_DEVELOPER_DIR only through the mode's gate, and hands simctlCandidates only when a smoke said one (P-1)", () => {
    p2Held(index);
  });

  it("P2: an edit that reads the variable ungated, or spreads the candidates without the gate, is caught (P-1)", () => {
    const direct = index.replace(
      "smokeSimctlDeveloperDir(MODE, process.env)",
      'process.env["VF_SMOKE_SIMCTL_DEVELOPER_DIR"]',
    );
    expect(direct).not.toBe(index);
    expect(() => p2Held(direct)).toThrow();
    const ungated = index.replace(
      /\.\.\.\(SMOKE_SIMCTL_DEVELOPER_DIR === undefined\s*\?\s*\{\}\s*:\s*\{ simctlCandidates: \[SMOKE_SIMCTL_DEVELOPER_DIR\] \}\),/u,
      '...(process.env["VF_SMOKE_SIMCTL_DEVELOPER_DIR"] === undefined ? {} : { simctlCandidates: [process.env["VF_SMOKE_SIMCTL_DEVELOPER_DIR"]] }),',
    );
    expect(ungated).not.toBe(index);
    expect(() => p2Held(ungated)).toThrow();
  });
});

// EY-1 (1f, 2026-11-19): custody's `clearRunPartition` empties an ended run's own memory session,
// named as the producer named it, and nothing else: never a desk's page, never a person's profile.
describe("a run's own session, cleared at its end (EY-1 1f)", () => {
  it("clears the run's own memory partition, and never a desk's page or a person's profile", async () => {
    const opened: string[] = [];
    const calls: string[] = [];
    const clear = createRunPartitionClearer((partition) => {
      opened.push(partition);
      return {
        clearStorageData: async () => {
          calls.push("storage");
        },
        clearCache: async () => {
          calls.push("cache");
        },
        clearAuthCache: async () => {
          calls.push("auth");
        },
      };
    });
    const run: LiveSurfaceBrowserSourceV1 = {
      kind: "browser",
      initialUrl: "https://example.test/",
      profile: { mode: "memory", ref: "run:r1" },
      logicalViewport: { width: 320, height: 180 },
      deviceScaleFactor: 1,
    };
    await clear(run);
    expect(opened).toEqual([browserSurfacePartition(run)]);
    expect(calls).toEqual(["storage", "cache", "auth"]);
    const desk: LiveSurfaceBrowserSourceV1 = {
      ...run,
      profile: { mode: "memory", ref: "desk-page" },
    };
    const person: LiveSurfaceBrowserSourceV1 = {
      ...run,
      profile: { mode: "persistent", ref: "run:r1" },
    };
    await expect(clear(desk)).rejects.toThrow(/only a run's own memory session/);
    await expect(clear(person)).rejects.toThrow(/only a run's own memory session/);
    expect(opened).toHaveLength(1);
  });
});

// EY-1 (7b, 2026-11-19): main's ONE control-target registry, and a page's class by its profile — read of the live
// page this support made, never of a surface it did not.
describe("the control targets and a page's class (EY-1 7b)", () => {
  const browserSource = (mode: "persistent" | "memory", ref: string): LiveSurfaceBrowserSourceV1 =>
    ({
      kind: "browser",
      initialUrl: "https://example.test/",
      profile: { mode, ref },
    }) as LiveSurfaceBrowserSourceV1;

  it("makes ONE registry with the resolver it is given, hands it to every browser page, and clears it at dispose", async () => {
    fakes.browsers.length = 0;
    const contents = {
      id: 7,
      isDestroyed: () => false,
      getOrCreateDevToolsTargetId: () => "a".repeat(32),
      once: () => contents,
      off: () => contents,
    };
    const support = createProductionLiveSurfaceSupport({
      capture: null,
      controlTargetResolver: (targetId) => (targetId === "a".repeat(32) ? contents : undefined),
    });
    const registry = support.controlTargets;
    expect(registry).not.toBeNull();
    support.factories.browser("surface_one_0000000001", browserSource("memory", "run:r1"));
    support.factories.browser("surface_two_0000000002", browserSource("persistent", "desk"));
    expect(fakes.browsers.map((b) => b.controlTargets)).toEqual([registry, registry]);
    registry?.associate("surface_one_0000000001", 1, contents, {
      held: false,
      onHeld: () => () => {},
    });
    expect(registry?.lookupPrivate("surface_one_0000000001")).not.toBeNull();
    await support.dispose();
    expect(registry?.lookupPrivate("surface_one_0000000001")).toBeNull();
  });

  it("answers a page's class by its profile: persistent is signed-in, memory is own; none for an unknown surface or a closed page", () => {
    fakes.browsers.length = 0;
    const support = createProductionLiveSurfaceSupport({ capture: null });
    support.factories.browser("surface_own_0000000001", browserSource("memory", "run:r1"));
    support.factories.browser("surface_desk_000000002", browserSource("persistent", "desk"));
    expect(support.pageClass("surface_own_0000000001")).toBe("own");
    expect(support.pageClass("surface_desk_000000002")).toBe("signed-in");
    expect(support.pageClass("surface_none_000000003")).toBeNull();
    const desk = fakes.browsers.find((b) => b.surfaceId === "surface_desk_000000002");
    if (desk !== undefined) desk.closed = true;
    expect(support.pageClass("surface_desk_000000002")).toBeNull();
  });

  it("makes no registry without a resolver", () => {
    expect(createProductionLiveSurfaceSupport({ capture: null }).controlTargets).toBeNull();
  });
});

// EY-1 (C3, 2026-11-24): the rule main holds by itself. A run is of the fieldd that named it: when a fieldd with
// another boot identity attaches, main ends every run it holds. Custody ends its half at once (its pages, its
// sessions); the pages broker's half of each (its grants, its route, its engine) is ended through the plane's own door,
// the run form's close, which answers at once for a run the broker does not hold.
describe("main's own end of the runs a gone fieldd named (EY-1 C3)", () => {
  it("custody ends every run at once, then each run's broker half is closed through the plane's own door; a close that fails is said and ends nothing else", async () => {
    const order: string[] = [];
    const closes: { params: unknown; deadlineAt: number; aborted: boolean }[] = [];
    const warned: string[] = [];
    const ended = endRunsOfGoneFieldd({
      custody: {
        endEveryRun: () => {
          order.push("custody");
          return { runs: ["run-a", "run-b"], pages: 3 };
        },
      },
      control: (params, ctx) => {
        order.push(`close:${params.run}`);
        closes.push({ params, deadlineAt: ctx.deadlineAt, aborted: ctx.signal.aborted });
        return params.run === "run-a" ? Promise.reject(new Error("no")) : Promise.resolve({});
      },
      now: () => 1_000,
      warn: (event) => warned.push(event),
    });
    expect(ended).toEqual({ runs: 2, pages: 3 });
    expect(order).toEqual(["custody", "close:run-a", "close:run-b"]);
    expect(closes).toEqual([
      {
        params: { run: "run-a", window: "act", command: { action: "close" } },
        deadlineAt: 31_000,
        aborted: false,
      },
      {
        params: { run: "run-b", window: "act", command: { action: "close" } },
        deadlineAt: 31_000,
        aborted: false,
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();
    expect(warned).toEqual(["desktop.pages.gone_fieldd_close_failed"]);
  });

  it("with no run to end, the plane's door is never asked (nothing listens for a run that never was)", () => {
    const control = vi.fn(() => Promise.resolve({}));
    expect(
      endRunsOfGoneFieldd({
        custody: { endEveryRun: () => ({ runs: [], pages: 0 }) },
        control,
      }),
    ).toEqual({ runs: 0, pages: 0 });
    expect(control).not.toHaveBeenCalled();
  });
});

// Held in main's source (main/index.ts runs at its load, so no unit reaches its wiring).
describe("custody's word to the pages plane — held in main's source (main/index.ts) (EY-1 C8)", () => {
  const index = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");

  // EY-1 (C8, 2026-11-24): custody says why a made page went (`failed` for the page's own failure), and the pages
  // broker answers a waiting open by that word. A word replaced on the way (a `failed` said on as `grace`) tells the
  // run that no VibeField window is open while one is.
  it("main hands the pages plane the word custody said, and replaces none", () => {
    expect(index).toContain(
      "onMadeDisposed: (run, surfaceId, why) => pagesPlane?.madeGone(run, surfaceId, why),",
    );
    // the ONE `onMadeDisposed:` main writes is that line
    expect(index.match(/onMadeDisposed:/gu)).toHaveLength(1);
  });
});

// EY-1 (C3, 2026-11-24): the rule itself is held above on fakes; that main ASKS it, and when, is main's wiring.
describe("main's own end of a gone fieldd's runs — held in main's source (main/index.ts) (EY-1 C3)", () => {
  const index = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
  const start = index.indexOf("const stopDaemonBootFence = bundle.handles.onHandle((handle) => {");
  const handler = start < 0 ? "" : index.slice(start, index.indexOf("\n    });", start));

  it("the boot fence's handler asks it, and only past the check that fieldd's boot identity changed", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    const unchanged = handler.indexOf("if (transition === null) return;");
    const asked = handler.indexOf("endRunsOfGoneFieldd({");
    expect(unchanged).toBeGreaterThanOrEqual(0);
    expect(asked).toBeGreaterThan(unchanged);
    // the ONE place main asks it
    expect(index.match(/endRunsOfGoneFieldd\(/gu)).toHaveLength(1);
  });

  it("with main's own custody whenever it stands, and the pages plane's own control: no plane yet ends custody's half all the same", () => {
    expect(handler).toContain("const custody = liveSurfaceAuthority;");
    expect(handler).toMatch(/if \(custody !== null\) \{\s*endRunsOfGoneFieldd\(\{\s*custody,/u);
    expect(handler).toMatch(
      /plane === null \? Promise\.reject\(\{ kind: "UNAVAILABLE" \}\) : plane\.control\(params, ctx\)/u,
    );
  });

  // EY-1 (C3, 2026-11-24): a run that made no page is the broker's alone, and custody names it to nobody: the plane's
  // own door ends every run the broker holds, past the same check, after custody's half
  it("the boot fence's handler ends every run the pages broker holds too, past the identity check and after custody's half", () => {
    const unchanged = handler.indexOf("if (transition === null) return;");
    const custodyHalf = handler.indexOf("endRunsOfGoneFieldd({");
    const brokerHalf = handler.indexOf("void plane?.endEveryRun();");
    expect(brokerHalf).toBeGreaterThan(unchanged);
    expect(brokerHalf).toBeGreaterThan(custodyHalf);
    // asked whether or not custody stands: outside the custody check
    expect(handler.slice(custodyHalf, brokerHalf)).toMatch(/\}\);\s*\}\s*\/\/[^\n]*\n\s*$/u);
    expect(index.match(/\.endEveryRun\(\)/gu)).toHaveLength(1);
  });
});
