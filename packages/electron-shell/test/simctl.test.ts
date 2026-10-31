import { SURFACE_AUTHORITY_LIMITS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  parseSimctlSnapshot,
  pickDevice,
  SIMCTL_TIMEOUTS_MS,
  SIMCTL_VERBS,
  type SimctlExec,
  type SimctlExecRequest,
  SimctlService,
  SimctlUnavailableError,
  SimctlVerbRefusedError,
  simctlArgv,
  simulatorDeviceRows,
  simulatorRuntimeIds,
} from "../src/main/live-surfaces/simctl";

// PT-S2 — main's simctl, through its ONE exec seam: nothing here spawns; every request is recorded and scripted.

const DEVELOPER_DIR = "/Applications/Xcode.app/Contents/Developer";
/** PT-S3 (P1): what xcode-select names on a Mac whose Command Line Tools are selected */
const CLT = "/Library/Developer/CommandLineTools";
const XCODE_SELECT = "/usr/bin/xcode-select";
const XCRUN = "/usr/bin/xcrun";
const PRO = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
const SE = "com.apple.CoreSimulator.SimDeviceType.iPhone-SE--2nd-generation-";
const IOS_26_5 = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
const IOS_26_1 = "com.apple.CoreSimulator.SimRuntime.iOS-26-1";
const IOS_18_6 = "com.apple.CoreSimulator.SimRuntime.iOS-18-6";
/** installed but unavailable: its devices are not this Mac's to attach */
const IOS_17_0 = "com.apple.CoreSimulator.SimRuntime.iOS-17-0";
const UDID_A = "AAAAAAAA-0000-4000-8000-000000000001";
const UDID_B = "BBBBBBBB-0000-4000-8000-000000000002";
const UDID_C = "CCCCCCCC-0000-4000-8000-000000000003";
const UDID_D = "DDDDDDDD-0000-4000-8000-000000000004";

function rawDevice(
  udid: string,
  deviceType: string,
  state: string,
  name = deviceType === PRO ? "iPhone 17 Pro" : "iPhone SE (2nd generation)",
): Record<string, unknown> {
  return { udid, name, state, deviceTypeIdentifier: deviceType, isAvailable: true };
}

function listJson(
  devices: Record<string, readonly Record<string, unknown>[]> = {},
  options: { readonly devicetypes?: boolean } = {},
): string {
  const both = [
    { identifier: PRO, name: "iPhone 17 Pro" },
    { identifier: SE, name: "iPhone SE (2nd generation)" },
  ];
  return JSON.stringify({
    ...(options.devicetypes === false ? {} : { devicetypes: both }),
    runtimes: [
      {
        identifier: IOS_18_6,
        name: "iOS 18.6",
        version: "18.6",
        isAvailable: true,
        supportedDeviceTypes: [{ identifier: SE, name: "iPhone SE (2nd generation)" }],
      },
      {
        identifier: IOS_26_1,
        name: "iOS 26.1",
        version: "26.1",
        isAvailable: true,
        supportedDeviceTypes: both,
      },
      {
        identifier: IOS_26_5,
        name: "iOS 26.5",
        version: "26.5",
        isAvailable: true,
        supportedDeviceTypes: both,
      },
      {
        identifier: IOS_17_0,
        name: "iOS 17.0",
        version: "17.0",
        isAvailable: false,
        supportedDeviceTypes: both,
      },
    ],
    devices,
  });
}

interface HarnessOptions {
  readonly list?: string;
  /** a scripted answer; `undefined` falls through to the defaults (the vetted Xcode, the listing, empty stdout) */
  readonly answer?: (request: SimctlExecRequest) => string | Promise<string> | undefined;
  readonly developerDir?: string;
  /** false: the developer directory holds no simctl (Command Line Tools alone) */
  readonly simctlInstalled?: boolean;
  /** PT-S3 (P1): the developer directories that hold simctl — default: the selected one (none when `simctlInstalled` is
   * false) */
  readonly holdsSimctl?: readonly string[];
  /** PT-S3 (P2): a smoke's developer directories, vetted in xcode-select's place */
  readonly candidates?: readonly string[];
}

function harness(options: HarnessOptions = {}) {
  const calls: SimctlExecRequest[] = [];
  /** every path the probe's file check was asked about */
  const checked: string[] = [];
  const clock = { now: 50_000 };
  const developerDir = options.developerDir ?? DEVELOPER_DIR;
  const holding = new Set(
    options.holdsSimctl ?? (options.simctlInstalled === false ? [] : [developerDir]),
  );
  let listing = options.list ?? listJson();
  const exec: SimctlExec = async (request) => {
    calls.push(request);
    const answered = options.answer?.(request);
    if (answered !== undefined) return await answered;
    if (request.file === XCODE_SELECT) return `${developerDir}\n`;
    if (request.file === XCRUN && request.args[1] === "list") return listing;
    return "";
  };
  const service = new SimctlService({
    exec,
    exists: (path) => {
      checked.push(path);
      return [...holding].some((dir) => path === `${dir}/usr/bin/simctl`);
    },
    now: () => clock.now,
    ...(options.candidates === undefined ? {} : { candidates: options.candidates }),
  });
  return {
    calls,
    checked,
    clock,
    service,
    setList(raw: string) {
      listing = raw;
    },
    xcrun: (verb: string) => calls.filter((call) => call.file === XCRUN && call.args[1] === verb),
    probes: () => calls.filter((call) => call.file === XCODE_SELECT),
  };
}

describe("simctl's allow-list", () => {
  it("runs list, boot, shutdown and create, and refuses every verb that reaches inside iOS", () => {
    expect(SIMCTL_VERBS).toEqual(["list", "boot", "shutdown", "create"]);
    expect(simctlArgv("list", ["--json"])).toEqual(["simctl", "list", "--json"]);
    expect(simctlArgv("boot", [UDID_A])).toEqual(["simctl", "boot", UDID_A]);
    expect(simctlArgv("shutdown", [UDID_A])).toEqual(["simctl", "shutdown", UDID_A]);
    expect(simctlArgv("create", ["iPhone 17 Pro", PRO, IOS_26_5])).toEqual([
      "simctl",
      "create",
      "iPhone 17 Pro",
      PRO,
      IOS_26_5,
    ]);
    for (const verb of [
      "ui",
      "openurl",
      "install",
      "launch",
      "privacy",
      "push",
      "spawn",
      "terminate",
      "erase",
      "delete",
      "io",
      "addmedia",
      "keychain",
      "pbcopy",
      "location",
      "status_bar",
      "get_app_container",
      "LIST",
      "",
    ]) {
      expect(() => simctlArgv(verb, [UDID_A])).toThrow(SimctlVerbRefusedError);
    }
  });
});

describe("parseSimctlSnapshot", () => {
  it("keeps every state of an available device on an installed runtime, the runtimes newest first", () => {
    const snapshot = parseSimctlSnapshot(
      listJson({
        [IOS_26_5]: [
          rawDevice(UDID_A, PRO, "Booted"),
          rawDevice(UDID_B, PRO, "Shutdown"),
          { ...rawDevice(UDID_C, PRO, "Shutdown"), isAvailable: false },
          rawDevice(UDID_D, "com.example.not-a-type", "Booted"),
          rawDevice("bad udid; rm -rf /", SE, "Booted"),
        ],
        [IOS_18_6]: [rawDevice("EEEEEEEE-0000-4000-8000-000000000005", SE, "Booting")],
        [IOS_17_0]: [rawDevice("FFFFFFFF-0000-4000-8000-000000000006", SE, "Booted")],
        "com.apple.CoreSimulator.SimRuntime.watchOS-11-0": [
          rawDevice("99999999-0000-4000-8000-000000000009", SE, "Booted"),
        ],
      }),
    );
    expect(snapshot.runtimes.map((runtime) => runtime.identifier)).toEqual([
      IOS_26_5,
      IOS_26_1,
      IOS_18_6,
    ]);
    expect(snapshot.devices).toEqual([
      { udid: UDID_A, name: "iPhone 17 Pro", state: "Booted", deviceType: PRO, runtime: IOS_26_5 },
      {
        udid: UDID_B,
        name: "iPhone 17 Pro",
        state: "Shutdown",
        deviceType: PRO,
        runtime: IOS_26_5,
      },
      {
        udid: "EEEEEEEE-0000-4000-8000-000000000005",
        name: "iPhone SE (2nd generation)",
        state: "Booting",
        deviceType: SE,
        runtime: IOS_18_6,
      },
    ]);
    expect(snapshot.deviceTypeNames.get(PRO)).toBe("iPhone 17 Pro");
    expect(snapshot.runtimes[0]?.supportedDeviceTypes.has(SE)).toBe(true);
    expect(snapshot.runtimes[2]?.supportedDeviceTypes.has(PRO)).toBe(false);
  });

  it("names a type from a runtime's own rows when the list has no devicetypes section", () => {
    const snapshot = parseSimctlSnapshot(listJson({}, { devicetypes: false }));
    expect(snapshot.deviceTypeNames.get(SE)).toBe("iPhone SE (2nd generation)");
    expect(snapshot.deviceTypeNames.get(PRO)).toBe("iPhone 17 Pro");
  });

  it("refuses a malformed document, an unsupported shape and a duplicated device", () => {
    expect(() => parseSimctlSnapshot("{")).toThrow("malformed JSON");
    expect(() => parseSimctlSnapshot(JSON.stringify({ devices: {} }))).toThrow("unsupported");
    expect(() =>
      parseSimctlSnapshot(
        listJson({
          [IOS_26_5]: [rawDevice(UDID_A, PRO, "Booted")],
          [IOS_26_1]: [rawDevice(UDID_A.toLowerCase(), PRO, "Shutdown")],
        }),
      ),
    ).toThrow("duplicate device");
  });
});

describe("pickDevice (R3)", () => {
  const binding = (deviceType: string, runtime: string) => ({ deviceType, runtime });

  it("attaches the exact type on the exact runtime, a booted one before one at rest", () => {
    const snapshot = parseSimctlSnapshot(
      listJson({
        [IOS_26_5]: [rawDevice(UDID_A, PRO, "Booted")],
        [IOS_26_1]: [rawDevice(UDID_B, PRO, "Shutdown"), rawDevice(UDID_C, PRO, "Booted")],
      }),
    );
    expect(pickDevice(snapshot, binding(PRO, IOS_26_1))).toEqual({
      device: expect.objectContaining({ udid: UDID_C, runtime: IOS_26_1 }),
      typeName: "iPhone 17 Pro",
    });
    // none booted: a stable choice, by UDID
    const resting = parseSimctlSnapshot(
      listJson({
        [IOS_26_1]: [rawDevice(UDID_C, PRO, "Shutdown"), rawDevice(UDID_B, PRO, "Shutdown")],
      }),
    );
    expect(pickDevice(resting, binding(PRO, IOS_26_1)).device?.udid).toBe(UDID_B);
  });

  it("falls back to the type on any installed runtime: a booted one first, then the newest runtime", () => {
    const missing = "com.apple.CoreSimulator.SimRuntime.iOS-27-0";
    const atRest = parseSimctlSnapshot(
      listJson({
        [IOS_26_1]: [rawDevice(UDID_A, PRO, "Shutdown")],
        [IOS_26_5]: [rawDevice(UDID_B, PRO, "Shutdown")],
      }),
    );
    expect(pickDevice(atRest, binding(PRO, missing)).device).toEqual(
      expect.objectContaining({ udid: UDID_B, runtime: IOS_26_5 }),
    );
    const oneBooted = parseSimctlSnapshot(
      listJson({
        [IOS_26_1]: [rawDevice(UDID_A, PRO, "Booted")],
        [IOS_26_5]: [rawDevice(UDID_B, PRO, "Shutdown")],
      }),
    );
    // the device's own ids are what the face reports as attached: iOS 26.1, not the bound 27.0
    expect(pickDevice(oneBooted, binding(PRO, missing)).device).toEqual(
      expect.objectContaining({ udid: UDID_A, runtime: IOS_26_1 }),
    );
  });

  it("with no device of the type, plans its create on the bound runtime, else the newest that runs it, by a name no device has", () => {
    // a device the person renamed after the bound type's own name: the create never makes a second window of that title
    const snapshot = parseSimctlSnapshot(
      listJson({ [IOS_18_6]: [rawDevice(UDID_A, SE, "Shutdown", "iPhone 17 Pro")] }),
    );
    expect(pickDevice(snapshot, binding(PRO, IOS_26_1))).toEqual({
      typeName: "iPhone 17 Pro",
      create: { name: "iPhone 17 Pro (2)", deviceType: PRO, runtime: IOS_26_1 },
    });
    // the bound runtime does not run the type (18.6 runs no 17 Pro): the newest that does
    expect(pickDevice(snapshot, binding(PRO, IOS_18_6)).create?.runtime).toBe(IOS_26_5);
    // the bound runtime is not installed (17.0 is unavailable): the newest that runs it
    expect(pickDevice(snapshot, binding(PRO, IOS_17_0)).create?.runtime).toBe(IOS_26_5);
  });

  it("plans no create when no installed runtime runs the type, and names nothing it does not know", () => {
    const unknown = "com.apple.CoreSimulator.SimDeviceType.iPhone-99";
    const snapshot = parseSimctlSnapshot(listJson());
    expect(pickDevice(snapshot, binding(unknown, IOS_26_5))).toEqual({});
    const runsNothing = parseSimctlSnapshot(
      JSON.stringify({
        devicetypes: [{ identifier: PRO, name: "iPhone 17 Pro" }],
        runtimes: [
          {
            identifier: IOS_18_6,
            name: "iOS 18.6",
            version: "18.6",
            isAvailable: true,
            supportedDeviceTypes: [{ identifier: SE, name: "iPhone SE (2nd generation)" }],
          },
        ],
        devices: {},
      }),
    );
    expect(pickDevice(runsNothing, binding(PRO, IOS_18_6))).toEqual({ typeName: "iPhone 17 Pro" });
  });
});

describe("simulatorDeviceRows (R11)", () => {
  it("redacts each device to a binding's ids, the booted first, then the newest runtime — never a UDID", () => {
    const rows = simulatorDeviceRows(
      parseSimctlSnapshot(
        listJson({
          [IOS_26_5]: [rawDevice(UDID_A, PRO, "Shutdown"), rawDevice(UDID_B, SE, "Booted")],
          [IOS_26_1]: [
            rawDevice(UDID_C, PRO, "Booted"),
            rawDevice(UDID_D, SE, "Shutdown", "iPhone\u0007SE"),
          ],
        }),
      ),
    );
    expect(rows).toEqual([
      { deviceType: SE, runtime: IOS_26_5, name: "iPhone SE (2nd generation)", booted: true },
      { deviceType: PRO, runtime: IOS_26_1, name: "iPhone 17 Pro", booted: true },
      { deviceType: PRO, runtime: IOS_26_5, name: "iPhone 17 Pro", booted: false },
    ]);
    for (const row of rows)
      expect(Object.keys(row).sort()).toEqual(["booted", "deviceType", "name", "runtime"]);
    const said = JSON.stringify(rows);
    for (const udid of [UDID_A, UDID_B, UDID_C, UDID_D]) expect(said).not.toContain(udid);
  });

  it("holds the list's bound, dropping devices at rest before a booted one", () => {
    const many = Array.from({ length: 300 }, (_, index) =>
      rawDevice(
        `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
        PRO,
        index === 299 ? "Booted" : "Shutdown",
      ),
    );
    const rows = simulatorDeviceRows(parseSimctlSnapshot(listJson({ [IOS_26_5]: many })));
    expect(rows).toHaveLength(256);
    expect(rows[0]?.booted).toBe(true);
  });
});

describe("simulatorRuntimeIds (R11)", () => {
  it("names every installed runtime, the newest first — with no device on any of them, and never an unavailable one", () => {
    expect(simulatorRuntimeIds(parseSimctlSnapshot(listJson()))).toEqual([
      IOS_26_5,
      IOS_26_1,
      IOS_18_6,
    ]);
  });

  it("holds the list's bound, dropping the oldest", () => {
    const runtimes = Array.from({ length: 70 }, (_, index) => ({
      identifier: `com.apple.CoreSimulator.SimRuntime.iOS-${index + 1}-0`,
      name: `iOS ${index + 1}.0`,
      version: `${index + 1}.0`,
      isAvailable: true,
      supportedDeviceTypes: [],
    }));
    const ids = simulatorRuntimeIds(parseSimctlSnapshot(JSON.stringify({ runtimes, devices: {} })));
    expect(ids).toHaveLength(64);
    expect(ids[0]).toBe("com.apple.CoreSimulator.SimRuntime.iOS-70-0");
    expect(ids.at(-1)).toBe("com.apple.CoreSimulator.SimRuntime.iOS-7-0");
  });
});

describe("SimctlService", () => {
  it("answers the attach's device list inside fieldd's deadline for it: the probe and the list together, on a cold service", () => {
    expect(SIMCTL_TIMEOUTS_MS.probe + SIMCTL_TIMEOUTS_MS.list).toBeLessThan(
      SURFACE_AUTHORITY_LIMITS.SIMULATOR_DEVICES_DEADLINE_MS,
    );
  });

  it("probes xcode-select and the simctl binary before any xcrun, and runs xcrun under the vetted directory", async () => {
    const { calls, service } = harness();
    expect(service.vetted()).toBeNull();
    await service.list();
    expect(service.vetted()).toBe("xcode-select");
    expect(calls[0]).toEqual({
      file: XCODE_SELECT,
      args: ["-p"],
      timeoutMs: SIMCTL_TIMEOUTS_MS.probe,
    });
    expect(calls[1]).toEqual({
      file: XCRUN,
      args: ["simctl", "list", "--json"],
      timeoutMs: SIMCTL_TIMEOUTS_MS.list,
      developerDir: DEVELOPER_DIR,
    });
  });

  it("never runs xcrun when the probe fails, says no Simulator, and asks again only after its retry window", async () => {
    const { calls, clock, service, probes } = harness({
      answer: (request) =>
        request.file === XCODE_SELECT
          ? Promise.reject(
              new Error("xcode-select: error: unable to get active developer directory"),
            )
          : undefined,
    });
    await expect(service.list()).rejects.toBeInstanceOf(SimctlUnavailableError);
    await expect(service.boot(UDID_A)).rejects.toBeInstanceOf(SimctlUnavailableError);
    await expect(service.show(UDID_A)).rejects.toBeInstanceOf(SimctlUnavailableError);
    expect(await service.deviceRows()).toEqual([]);
    expect(await service.runtimeIds()).toEqual([]);
    expect(probes()).toHaveLength(1);
    clock.now += 30_000;
    await expect(service.list()).rejects.toBeInstanceOf(SimctlUnavailableError);
    expect(probes()).toHaveLength(2);
    expect(calls.every((call) => call.file === XCODE_SELECT)).toBe(true);
  });

  it("treats a developer directory without simctl (Command Line Tools alone — and no simctl in the default Xcode either) as no Simulator, and runs no xcrun", async () => {
    const { calls, checked, service } = harness({
      developerDir: CLT,
      simctlInstalled: false,
    });
    await expect(service.enumerateBootedDevices()).rejects.toBeInstanceOf(SimctlUnavailableError);
    expect(calls.map((call) => call.file)).toEqual([XCODE_SELECT]);
    // R5′: the fallback was asked, and answered no
    expect(checked).toEqual([`${CLT}/usr/bin/simctl`, `${DEVELOPER_DIR}/usr/bin/simctl`]);
    expect(service.vetted()).toBeNull();
  });

  it("R5′: with the Command Line Tools selected beside the default Xcode, vets Xcode's directory — `fallback` — and pins every xcrun and Show it to it", async () => {
    const created = "11111111-2222-4333-8444-555555555555";
    const { calls, service, probes } = harness({
      developerDir: CLT,
      holdsSimctl: [DEVELOPER_DIR],
      answer: (request) => (request.args[1] === "create" ? `${created}\n` : undefined),
    });
    await service.list();
    expect(service.vetted()).toBe("fallback");
    await service.boot(UDID_A);
    await service.shutdown(UDID_A);
    await service.create("iPhone 17 Pro", PRO, IOS_26_5);
    await service.show(UDID_A);
    expect(probes()).toEqual([
      { file: XCODE_SELECT, args: ["-p"], timeoutMs: SIMCTL_TIMEOUTS_MS.probe },
    ]);
    const xcruns = calls.filter((call) => call.file === XCRUN);
    expect(xcruns.map((call) => call.args[1])).toEqual(["list", "boot", "shutdown", "create"]);
    expect(xcruns.every((call) => call.developerDir === DEVELOPER_DIR)).toBe(true);
    expect(calls.at(-1)?.args).toEqual([
      "-a",
      `${DEVELOPER_DIR}/Applications/Simulator.app`,
      "--args",
      "-CurrentDeviceUDID",
      UDID_A,
    ]);
    expect(calls.some((call) => JSON.stringify(call).includes(CLT))).toBe(false);
  });

  it("R5′: never falls back on a garbage answer or a failed xcode-select — no Simulator, with Xcode right there", async () => {
    for (const answer of [
      () => "\n",
      () => "Applications/Xcode.app/Contents/Developer\n",
      () => `/${"a".repeat(1_024)}\n`,
      () => "/Library/Developer/Command\u0007LineTools\n",
      () =>
        Promise.reject(new Error("xcode-select: error: unable to get active developer directory")),
    ]) {
      const { calls, checked, service } = harness({
        holdsSimctl: [DEVELOPER_DIR],
        answer: (request) => (request.file === XCODE_SELECT ? answer() : undefined),
      });
      await expect(service.list()).rejects.toBeInstanceOf(SimctlUnavailableError);
      expect(calls.map((call) => call.file)).toEqual([XCODE_SELECT]);
      expect(checked).toEqual([]);
      expect(service.vetted()).toBeNull();
    }
  });

  it("P2: a smoke's candidates — xcode-select is never asked; the first that holds simctl is vetted `override`, and pins every xcrun and Show it", async () => {
    const { calls, checked, service, probes, xcrun } = harness({
      developerDir: CLT,
      holdsSimctl: [CLT, DEVELOPER_DIR],
      candidates: ["/var/empty", "relative/Developer", DEVELOPER_DIR],
    });
    await service.list();
    await service.show(UDID_A);
    expect(service.vetted()).toBe("override");
    expect(probes()).toEqual([]);
    // the relative one is refused before any file check, as a garbage xcode-select answer is
    expect(checked).toEqual(["/var/empty/usr/bin/simctl", `${DEVELOPER_DIR}/usr/bin/simctl`]);
    expect(xcrun("list")[0]?.developerDir).toBe(DEVELOPER_DIR);
    expect(calls.at(-1)?.args[1]).toBe(`${DEVELOPER_DIR}/Applications/Simulator.app`);
  });

  it("P2: an empty candidate directory is no Simulator — `vetted` null, nothing spawned at all, though xcode-select would name an Xcode that holds simctl", async () => {
    const { calls, checked, clock, service } = harness({ candidates: ["/var/empty"] });
    await expect(service.list()).rejects.toBeInstanceOf(SimctlUnavailableError);
    await expect(service.show(UDID_A)).rejects.toBeInstanceOf(SimctlUnavailableError);
    expect(await service.deviceRows()).toEqual([]);
    expect(service.vetted()).toBeNull();
    // asked again after the retry window, the same candidates — never xcode-select, never the default Xcode
    clock.now += 30_000;
    await expect(service.list()).rejects.toBeInstanceOf(SimctlUnavailableError);
    expect(checked).toEqual(["/var/empty/usr/bin/simctl", "/var/empty/usr/bin/simctl"]);
    expect(calls).toEqual([]);
  });

  it("re-probes after a list fails (Xcode moved), and keeps the probe while lists succeed", async () => {
    let failing = true;
    const { service, probes, xcrun } = harness({
      answer: (request) =>
        request.file === XCRUN && failing ? Promise.reject(new Error("xcrun: error")) : undefined,
    });
    await expect(service.list()).rejects.toThrow("xcrun: error");
    expect(service.vetted()).toBeNull();
    failing = false;
    await service.list();
    expect(service.vetted()).toBe("xcode-select");
    expect(probes()).toHaveLength(2);
    expect(xcrun("list")).toHaveLength(2);
  });

  it("shares ONE list a tick across every reader, joins one in flight, and reads afresh after the tick (R8)", async () => {
    const { clock, service, probes, xcrun } = harness({
      list: listJson({
        [IOS_26_5]: [rawDevice(UDID_A, PRO, "Booted"), rawDevice(UDID_B, SE, "Shutdown")],
      }),
    });
    const [snapshot, booted, rows, , runtimes] = await Promise.all([
      service.list(),
      service.enumerateBootedDevices(),
      service.deviceRows(),
      service.list(),
      service.runtimeIds(),
    ]);
    expect(runtimes).toEqual([IOS_26_5, IOS_26_1, IOS_18_6]);
    expect(snapshot.devices).toHaveLength(2);
    expect(booted).toEqual([
      {
        udid: UDID_A,
        name: "iPhone 17 Pro",
        runtimeIdentifier: IOS_26_5,
        runtimeName: "iOS 26.5",
        deviceTypeIdentifier: PRO,
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(xcrun("list")).toHaveLength(1);
    clock.now += 999;
    await service.list();
    expect(xcrun("list")).toHaveLength(1);
    clock.now += 1;
    await service.list();
    expect(xcrun("list")).toHaveLength(2);
    // a clock that stepped backwards never makes a held snapshot fresh forever
    clock.now -= 10_000;
    await service.list();
    expect(xcrun("list")).toHaveLength(3);
    expect(probes()).toHaveLength(1);
  });

  it("reads CoreSimulator afresh after every change main makes, inside the tick", async () => {
    const { service, xcrun } = harness({
      answer: (request) =>
        request.args[1] === "create" ? "11111111-2222-4333-8444-555555555555\n" : undefined,
    });
    await service.list();
    await service.boot(UDID_A);
    await service.list();
    expect(xcrun("list")).toHaveLength(2);
    await service.create("iPhone 17 Pro", PRO, IOS_26_5);
    await service.list();
    expect(xcrun("list")).toHaveLength(3);
    service.invalidate();
    await service.list();
    expect(xcrun("list")).toHaveLength(4);
  });

  it("boots by UDID under its own bound, and counts a device already booted (or booting) as booted", async () => {
    const refusal = new Error("Unable to boot device in current state: Booted");
    const { service, setList, xcrun } = harness({
      answer: (request) => (request.args[1] === "boot" ? Promise.reject(refusal) : undefined),
    });
    setList(listJson({ [IOS_26_5]: [rawDevice(UDID_A, PRO, "Booted")] }));
    await expect(service.boot(UDID_A)).resolves.toBeUndefined();
    expect(xcrun("boot")[0]).toEqual({
      file: XCRUN,
      args: ["simctl", "boot", UDID_A],
      timeoutMs: SIMCTL_TIMEOUTS_MS.boot,
      developerDir: DEVELOPER_DIR,
    });
    setList(listJson({ [IOS_26_5]: [rawDevice(UDID_A, PRO, "Booting")] }));
    await expect(service.boot(UDID_A)).resolves.toBeUndefined();
    setList(listJson({ [IOS_26_5]: [rawDevice(UDID_A, PRO, "Shutdown")] }));
    await expect(service.boot(UDID_A)).rejects.toBe(refusal);
  });

  it("shuts down by UDID, a device already shut down counting as shut down", async () => {
    const { service, setList, xcrun } = harness({
      answer: (request) =>
        request.args[1] === "shutdown"
          ? Promise.reject(new Error("Unable to shutdown device in current state: Shutdown"))
          : undefined,
    });
    setList(listJson({ [IOS_26_5]: [rawDevice(UDID_A, PRO, "Shutdown")] }));
    await expect(service.shutdown(UDID_A)).resolves.toBeUndefined();
    expect(xcrun("shutdown")[0]?.args).toEqual(["simctl", "shutdown", UDID_A]);
    expect(xcrun("shutdown")[0]?.timeoutMs).toBe(SIMCTL_TIMEOUTS_MS.shutdown);
  });

  it("creates a device by name, type and runtime, and answers its UDID", async () => {
    const created = "11111111-2222-4333-8444-555555555555";
    const { service, xcrun } = harness({
      answer: (request) => (request.args[1] === "create" ? `${created}\n` : undefined),
    });
    await expect(service.create("iPhone 17 Pro (2)", PRO, IOS_26_5)).resolves.toBe(created);
    expect(xcrun("create")[0]).toEqual({
      file: XCRUN,
      args: ["simctl", "create", "iPhone 17 Pro (2)", PRO, IOS_26_5],
      timeoutMs: SIMCTL_TIMEOUTS_MS.create,
      developerDir: DEVELOPER_DIR,
    });
  });

  it("refuses a create whose answer is not a UDID", async () => {
    const { service } = harness({
      answer: (request) =>
        request.args[1] === "create" ? "An error was encountered\n" : undefined,
    });
    await expect(service.create("iPhone 17 Pro", PRO, IOS_26_5)).rejects.toThrow("malformed");
  });

  it("shows the device in the vetted Xcode's own Simulator.app", async () => {
    const { calls, service } = harness();
    await service.show(UDID_A);
    expect(calls.at(-1)).toEqual({
      file: "/usr/bin/open",
      args: [
        "-a",
        `${DEVELOPER_DIR}/Applications/Simulator.app`,
        "--args",
        "-CurrentDeviceUDID",
        UDID_A,
      ],
      timeoutMs: SIMCTL_TIMEOUTS_MS.show,
    });
    expect(calls.some((call) => call.file === XCRUN)).toBe(false);
  });

  it("never spawns anything for a malformed UDID or create specification", async () => {
    const { calls, service } = harness();
    for (const udid of [
      "--help",
      "--set=/tmp/devices",
      "all",
      "; rm -rf /",
      "../../Simulator",
      "",
    ]) {
      await expect(service.boot(udid)).rejects.toThrow();
      await expect(service.shutdown(udid)).rejects.toThrow();
      await expect(service.show(udid)).rejects.toThrow();
    }
    for (const [name, deviceType, runtime] of [
      ["-o", PRO, IOS_26_5],
      ["", PRO, IOS_26_5],
      ["iPhone\n17", PRO, IOS_26_5],
      ["x".repeat(129), PRO, IOS_26_5],
      ["iPhone 17 Pro", "iPhone-17-Pro", IOS_26_5],
      ["iPhone 17 Pro", PRO, "iOS-26-5"],
    ] as const) {
      await expect(service.create(name, deviceType, runtime)).rejects.toThrow("invalid device");
    }
    expect(calls).toEqual([]);
  });

  it("answers nothing once disposed", async () => {
    const { calls, service } = harness();
    service.dispose();
    await expect(service.list()).rejects.toBeInstanceOf(SimctlUnavailableError);
    expect(await service.deviceRows()).toEqual([]);
    expect(await service.runtimeIds()).toEqual([]);
    expect(calls).toEqual([]);
  });
});
