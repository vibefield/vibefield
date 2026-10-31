import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProductionLiveSurfaceSupport } from "../src/main/live-surfaces/authority-production";
import { SimctlUnavailableError } from "../src/main/live-surfaces/simctl";

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
