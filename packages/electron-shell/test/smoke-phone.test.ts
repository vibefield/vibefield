/**
 * PT-S3 — the phone's live rows' pure half (testing/smoke-phone.ts), judged here with nothing spawned (node:child_process
 * throws on any use): the stage's env read and refused; THE PRESS GATE's refusals (create, another run's device, a name
 * that only begins like the run's, another type, no run id); LIVE-PROVEN red for a `streaming` face that presented nothing;
 * the face row's projection (a `retry` function never crosses a structured clone); the UUID sweep's shape; the band's
 * colours apart from the motion page's sweep and from grey; the measure the page runs equal to main's; SIM-IDLE's window
 * clear of the status bar's minute; SIM-STILL's address built from the stage's runtime, never a literal (RM4.1); the rows'
 * marks and which of them are problems; and the door's token in a header, never in an address.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const refuse = (name: string) => () => {
    throw new Error(`a unit spawns nothing (child_process.${name})`);
  };
  return {
    ...actual,
    spawn: refuse("spawn"),
    spawnSync: refuse("spawnSync"),
    exec: refuse("exec"),
    execSync: refuse("execSync"),
    execFile: refuse("execFile"),
    execFileSync: refuse("execFileSync"),
    fork: refuse("fork"),
  };
});

import {
  actScan,
  BAND_PALETTE,
  BAND_TOL,
  bandColour,
  bandNonce,
  bindingRead,
  glassRect,
  idleWait,
  isOwnDevice,
  judgeGone,
  judgeLive,
  judgeLiveProven,
  judgeNoDevice,
  judgeNone,
  judgeNoUdid,
  judgeP1,
  judgePress,
  judgeReload,
  judgeStill,
  judgeUse,
  type LiveProof,
  type Measure,
  measurePixels,
  type NoneSeen,
  PHONE,
  PHONE_FLAG,
  PHONE_MEASURE,
  PHONE_ROW_PROJECT,
  PHONE_ROWS,
  type PhoneCensus,
  type PhoneRowResult,
  type PressAsk,
  phoneDoor,
  phoneEnv,
  phoneProblems,
  rowMark,
  type StillSeen,
  stillAddress,
  type UseSeen,
  uuidHits,
} from "../src/testing/smoke-phone";

const TP = "com.apple.CoreSimulator.SimDeviceType.iPhone-16e";
const TQ = "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Plus";
const TR = "com.apple.CoreSimulator.SimDeviceType.iPhone-15";
const TN = "com.apple.CoreSimulator.SimDeviceType.iPhone-14";
/** The mini's runtime, not this Mac's 26.5: no judge holds a literal (RM4.1). */
const RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-27-1";
const ENV = {
  VF_PHONE_MODE: "devices",
  VF_PHONE_HOST: "http://127.0.0.1:53111",
  VF_PHONE_TOKEN: "0123456789abcdef0123456789abcdef",
  VF_PHONE_RUNTIME: RUNTIME,
  VF_PHONE_DEVICES: `1:${TP},2:${TQ},3:${TR},4:${TN}`,
  VF_PHONE_RUN: "l2-a",
};
const UDID = "5F1C2A3B-4D5E-6F70-8192-A3B4C5D6E7F8";

describe("PT-S3 — the stage's word: the env", () => {
  it("reads the mode, the door, the runtime, the devices by number and the run id — any iOS runtime, never a literal", () => {
    const env = phoneEnv(ENV);
    expect(typeof env).toBe("object");
    if (typeof env === "string") return;
    expect(env.mode).toBe("devices");
    expect(env.runtime).toBe(RUNTIME);
    expect([...env.devices]).toEqual([
      [1, TP],
      [2, TQ],
      [3, TR],
      [4, TN],
    ]);
    expect(env.runId).toBe("l2-a");
    // none mode: one type, no device exists
    const none = phoneEnv({ ...ENV, VF_PHONE_MODE: "none", VF_PHONE_DEVICES: `1:${TP}` });
    expect(typeof none === "object" && none.mode).toBe("none");
    // an unsaid or malformed run id is null: nothing is pressed
    expect(
      (phoneEnv({ ...ENV, VF_PHONE_RUN: undefined }) as { runId: string | null }).runId,
    ).toBeNull();
    expect(
      (phoneEnv({ ...ENV, VF_PHONE_RUN: "L2.A" }) as { runId: string | null }).runId,
    ).toBeNull();
  });

  it("refuses, in words, a run outside the stage: no mode, another host, no token, no runtime, a device missing or a UDID", () => {
    expect(phoneEnv({ ...ENV, VF_PHONE_MODE: undefined })).toMatch(/run under the stage script/u);
    expect(phoneEnv({ ...ENV, VF_PHONE_HOST: "http://example.com:80" })).toMatch(/loopback/u);
    expect(phoneEnv({ ...ENV, VF_PHONE_TOKEN: "" })).toMatch(/TOKEN/u);
    expect(phoneEnv({ ...ENV, VF_PHONE_RUNTIME: "iOS 26.5" })).toMatch(/runtime/u);
    expect(phoneEnv({ ...ENV, VF_PHONE_DEVICES: `1:${TP},2:${TQ},3:${TR}` })).toMatch(
      /no device 4/u,
    );
    expect(phoneEnv({ ...ENV, VF_PHONE_DEVICES: `1:${UDID}` })).toMatch(/not <n>:<device type>/u);
  });

  it("names the flag and the rows: L1 two, L2 the seventeen MUST from SIM-STAGED to SIM-NO-UDID (last), L3 one", () => {
    expect(PHONE_FLAG).toBe("--phone");
    expect(PHONE.type).toBe("vibefield.simulator");
    expect(PHONE.category).toBe("devices");
    expect(PHONE.size).toEqual({ w: 188.71, h: 393.7 });
    expect(PHONE_ROWS.none.map((r) => r.name)).toEqual(["SIM-NONE", "SIM-NO-UDID"]);
    const l2 = PHONE_ROWS.devices;
    expect(l2.filter((r) => r.klass === "MUST")).toHaveLength(17);
    expect(l2[0]?.name).toBe("SIM-STAGED");
    expect(l2[l2.length - 1]?.name).toBe("SIM-NO-UDID");
    expect(PHONE_ROWS.cost.map((r) => r.name)).toEqual(["SIM-COST"]);
    // every name the door takes: ≤ 80 characters, no control characters
    for (const r of [...PHONE_ROWS.none, ...l2, ...PHONE_ROWS.cost]) {
      expect(r.name.length).toBeLessThanOrEqual(80);
      expect([...r.name].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)).toBe(
        true,
      );
    }
  });
});

describe("PT-S3 — THE PRESS GATE", () => {
  const ok: PressAsk = {
    act: "boot",
    offered: "boot",
    name: "pts3-l2-a-1",
    deviceType: TP,
    n: 1,
    type: TP,
    runId: "l2-a",
  };

  it("passes the run's own device, of the row's type, offering the act pressed", () => {
    expect(judgePress(ok)).toBeNull();
    expect(judgePress({ ...ok, act: "show", offered: "show" })).toBeNull();
    expect(judgePress({ ...ok, act: "retry", offered: "retry" })).toBeNull();
  });

  it("refuses create outright, an act the door never takes, and an act the face does not offer", () => {
    expect(judgePress({ ...ok, act: "create", offered: "create" })).toMatch(/refuses create/u);
    expect(judgePress({ ...ok, act: "attach", offered: "attach" })).toMatch(/refuses act attach/u);
    expect(judgePress({ ...ok, act: "show" })).toMatch(/offers boot, not show/u);
    expect(judgePress({ ...ok, offered: null })).toMatch(/offers no act/u);
  });

  it("refuses another run's device, a name that only begins like the run's, another of the run's, another type, no run id", () => {
    expect(judgePress({ ...ok, name: "pts3-other-1" })).toMatch(/not pts3-l2-a-1/u);
    expect(judgePress({ ...ok, name: "pts3-l2-a-1x" })).toMatch(/not pts3-l2-a-1/u);
    expect(judgePress({ ...ok, name: "pts3-l2-a-2" })).toMatch(/not pts3-l2-a-1/u);
    expect(judgePress({ ...ok, name: "James's iPhone" })).toMatch(/not pts3-l2-a-1/u);
    expect(judgePress({ ...ok, name: null })).toMatch(/not pts3-l2-a-1/u);
    expect(judgePress({ ...ok, deviceType: TQ })).toMatch(/not com\.apple/u);
    expect(judgePress({ ...ok, runId: null })).toMatch(/no VF_PHONE_RUN/u);
    // the run id taken literally: a dot is not "any character"
    expect(isOwnDevice("pts3-l2xa-1", "l2.a", 1)).toBe(false);
  });
});

describe("PT-S3 — LIVE-PROVEN", () => {
  const proof: LiveProof = {
    bound: 20_000,
    ms: 1_800,
    condition: "streaming",
    presented: 9,
    frames: 11,
    after: Array.from({ length: 10 }, () => "streaming"),
  };

  it("passes streaming with presents and the helper's frames, still streaming 2 s on", () => {
    expect(judgeLiveProven("SIM-LIVE", proof)).toEqual([]);
  });

  it("reds a STREAMING face that presented nothing: `streaming` alone is not proof (a retry or a fresh boot says it first)", () => {
    const red = judgeLiveProven("SIM-LIVE", { ...proof, presented: 0 });
    expect(red.length).toBeGreaterThan(0);
    expect(red.join(" ")).toMatch(/0 frames presented, not 3/u);
  });

  it("reds no helper frames, a fall to booting or no-window after, a proof past its bound, and never met", () => {
    expect(judgeLiveProven("R", { ...proof, frames: 2 }).join(" ")).toMatch(/helper received 2/u);
    expect(
      judgeLiveProven("R", { ...proof, after: [...proof.after.slice(0, 9), "no-window"] }).join(
        " ",
      ),
    ).toMatch(/did not stay streaming/u);
    expect(judgeLiveProven("R", { ...proof, ms: 21_000 }).join(" ")).toMatch(
      /not LIVE-PROVEN within 20000/u,
    );
    expect(
      judgeLiveProven("R", { ...proof, ms: null, condition: "booting", after: [] }).join(" "),
    ).toMatch(/not LIVE-PROVEN.*reads booting/u);
    expect(judgeLiveProven("R", null)).toEqual(["R: never read for LIVE-PROVEN"]);
  });
});

describe("PT-S3 — what the rows read", () => {
  it("projects a face row's state to {is, reason}: its retry function never reaches a structured clone", () => {
    const project = new Function(`return ${PHONE_ROW_PROJECT};`)() as (f: unknown) => unknown;
    const row = {
      key: "1-0",
      source: "ios-simulator",
      state: { is: "failed", reason: "The Simulator stopped", retry: () => undefined },
      simulator: { is: "stopped", act: "retry", name: "pts3-l2-a-1" },
      demand: undefined,
    };
    expect(() => structuredClone(row)).toThrow();
    const out = project(row) as { state: unknown; demand?: unknown };
    expect(out.state).toEqual({ is: "failed", reason: "The Simulator stopped" });
    expect("demand" in out).toBe(false);
    expect(structuredClone(out)).toEqual(out);
    expect(project({ key: "1-1", state: { is: "live" } })).toEqual({
      key: "1-1",
      state: { is: "live", reason: null },
    });
    expect(project(undefined)).toBeNull();
  });

  it("sweeps a UUID's shape, either case, and passes the durable keys and surface ids the rows carry", () => {
    expect(uuidHits(`PHONE_WORDS {"udid":"${UDID}"}`)).toBe(1);
    expect(uuidHits(`${UDID.toLowerCase()} and ${UDID}`)).toBe(2);
    expect(uuidHits('PHONE_WORDS {"key":"1-0","surface":"s-AbCdEf_0123456789-xyzABCD"}')).toBe(0);
    expect(uuidHits("5F1C2A3B-4D5E-6F70-8192-A3B4C5D6E7F")).toBe(0);
  });

  it("SIM-NO-UDID: a UUID shape is red; L2 is VOID unless a bound own row was seen; L1 judges the sweep alone", () => {
    const clean = ['PHONE_WORDS {"row":"SIM-LIVE"}'];
    expect(judgeNoUdid({ mode: "devices", lines: clean, ownRow: true })).toEqual({
      problems: [],
      void: null,
      hits: 0,
    });
    expect(judgeNoUdid({ mode: "devices", lines: clean, ownRow: false }).void).toMatch(
      /bound own/u,
    );
    const dirty = judgeNoUdid({
      mode: "none",
      lines: [...clean, `PHONE_WORDS ${UDID}`],
      ownRow: false,
    });
    expect(dirty.hits).toBe(1);
    expect(dirty.void).toBeNull();
    expect(dirty.problems).toHaveLength(1);
  });

  it("reads a binding as the product hands it (its cell's JSON) or as a fixture does; an empty one is none", () => {
    const b = { deviceType: TR, runtime: RUNTIME };
    expect(bindingRead(JSON.stringify(b))).toEqual(b);
    expect(bindingRead(b)).toEqual(b);
    expect(bindingRead({ deviceType: "", runtime: "" })).toBeNull();
    expect(bindingRead("{")).toBeNull();
    expect(bindingRead(undefined)).toBeNull();
  });

  it("the presser's scan starts at the held frame's middle and stays inside it; the glass lies inside the frame", () => {
    const f = { cx: 600, cy: 400, hx: 200, hy: 420 };
    const pts = actScan(f);
    expect(pts).toHaveLength(75);
    expect(pts[0]).toEqual({ x: 600, y: Math.round(400 - 12 * 0.025 * 420) });
    for (const p of pts) {
      expect(Math.abs(p.x - f.cx)).toBeLessThanOrEqual(f.hx);
      expect(Math.abs(p.y - f.cy)).toBeLessThanOrEqual(f.hy);
    }
    for (const inHand of [true, false]) {
      const g = glassRect(f, inHand);
      expect(g.x).toBeGreaterThan(f.cx - f.hx);
      expect(g.x + g.width).toBeLessThan(f.cx + f.hx);
      expect(g.y).toBeGreaterThan(f.cy - f.hy);
      expect(g.y + g.height).toBeLessThan(f.cy + f.hy);
    }
  });
});

describe("PT-S3 — the stimulus and the measure", () => {
  const hsl = (h: number): [number, number, number] => {
    const s = 0.9;
    const l = 0.55;
    const k = (n: number): number => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  };
  const within = (a: readonly number[], b: readonly number[], tol: number): boolean =>
    a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= tol);

  it("every band nonce is six hex digits, its colour round-trips, and the run's nonces differ", () => {
    const seen = new Set<string>();
    for (let k = 0; k < 48; k += 1) {
      const n = bandNonce(k);
      expect(n).toMatch(/^[0-9a-f]{6}$/u);
      expect(
        bandColour(n)
          .map((v) => v.toString(16).padStart(2, "0"))
          .join(""),
      ).toBe(n);
      seen.add(n);
    }
    expect(seen.size).toBe(48);
  });

  it("no colour of the motion page's sweep, no grey and no other palette colour is within a band's tolerance", () => {
    for (let k = 0; k < 48; k += 1) {
      const band = bandColour(bandNonce(k));
      for (let h = 0; h < 360; h += 1) expect(within(hsl(h), band, BAND_TOL)).toBe(false);
      for (let g = 0; g <= 255; g += 1) expect(within([g, g, g], band, BAND_TOL)).toBe(false);
    }
    for (const [i, a] of BAND_PALETTE.entries())
      for (const [j, b] of BAND_PALETTE.entries())
        if (i !== j) expect(within(a, b, BAND_TOL)).toBe(false);
  });

  it("the page's measure is main's: colours at 5 bits, luma range and mean, the band's pixels and the 4 × 4 grid", () => {
    const inPage = new Function(`return ${PHONE_MEASURE};`)() as typeof measurePixels;
    const w = 40;
    const h = 24;
    const px = new Uint8ClampedArray(w * h * 4);
    const band = bandColour(bandNonce(3));
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const c = y >= 10 && y < 14 ? band : hsl((x * 9) % 360);
        px[i] = c[0];
        px[i + 1] = c[1];
        px[i + 2] = c[2];
        px[i + 3] = 255;
      }
    const main = measurePixels(px, w, h, band, BAND_TOL);
    expect(inPage(px, w, h, band, BAND_TOL)).toEqual(main);
    expect(main.px).toBe(w * h);
    expect(main.band).toBe(4 * w);
    expect(main.bandMean).toEqual(band);
    expect(main.grid).toHaveLength(16);
    expect(main.colors).toBeGreaterThan(10);
    const grey = new Uint8ClampedArray(w * h * 4).fill(128);
    const flat = measurePixels(grey, w, h, band, BAND_TOL);
    expect(flat).toMatchObject({ colors: 1, lumaRange: 0, band: 0, bandMean: null });
    expect(inPage(grey, w, h, null, BAND_TOL)).toEqual(measurePixels(grey, w, h, null, BAND_TOL));
  });

  it("SIM-IDLE's window opens ≥ 5 s after a minute and closes ≥ 5 s before the next (K7: the status bar's clock)", () => {
    const at = (s: number): number => Date.UTC(2026, 9, 31, 4, 0, 0) + s * 1_000;
    expect(idleWait(at(2))).toBe(3_000);
    expect(idleWait(at(5))).toBe(0);
    expect(idleWait(at(30))).toBe(0);
    expect(idleWait(at(52))).toBe(0);
    expect(idleWait(at(53))).toBe(12_000);
    expect(idleWait(at(59.5))).toBe(5_500);
    for (let s = 0; s < 60; s += 0.25) {
      const open = (at(s) + idleWait(at(s))) % 60_000;
      expect(open).toBeGreaterThanOrEqual(5_000);
      expect(open + 3_000).toBeLessThanOrEqual(55_000);
    }
  });
});

describe("PT-S3 — the rows' judges", () => {
  const census = (over: Partial<PhoneCensus> = {}): PhoneCensus => ({
    sessions: 0,
    sessionsMade: 0,
    captureReady: true,
    helperPresent: true,
    helper: { helperStarts: 0, helperExits: 0, activeSessions: 0, framesReceived: 0 },
    vetted: null,
    simctl: { probe: 1, "xcode-select": 0, list: 0, boot: 0, shutdown: 0, create: 0, show: 0 },
    ...over,
  });

  it("SIM-NONE: no-simulator, no act, nothing run — and red when the adapter or the helper is missing (finding 4)", () => {
    const seen: NoneSeen = {
      is: "no-simulator",
      act: null,
      name: null,
      lines: 1,
      census: census(),
      opens: [],
    };
    expect(judgeNone(seen)).toEqual([]);
    expect(judgeNone({ ...seen, census: census({ captureReady: false }) }).join(" ")).toMatch(
      /adapter/u,
    );
    expect(judgeNone({ ...seen, census: census({ helperPresent: false }) }).join(" ")).toMatch(
      /wrong reason/u,
    );
    expect(
      judgeNone({
        ...seen,
        census: census({
          simctl: { probe: 1, "xcode-select": 0, list: 1, boot: 0, create: 0, show: 0 },
        }),
      }).join(" "),
    ).toMatch(/ran list 1/u);
    expect(judgeNone({ ...seen, census: census({ simctl: { probe: 0 } }) }).join(" ")).toMatch(
      /never probed/u,
    );
    expect(judgeNone({ ...seen, act: "create" }).join(" ")).toMatch(/offers create/u);
    expect(judgeNone({ ...seen, census: census({ vetted: "override" }) }).join(" ")).toMatch(
      /vetted override/u,
    );
    expect(judgeNone({ ...seen, lines: null }).join(" ")).toMatch(/no words/u);
  });

  it("SIM-NO-DEVICE: the model named in the words, Create it offered and never run", () => {
    const seen = {
      is: "no-device",
      act: "create",
      name: "iPhone 14",
      device: "iPhone 14",
      lines: 2,
      create: { before: 0, after: 0 },
    };
    expect(judgeNoDevice(seen)).toEqual([]);
    expect(judgeNoDevice({ ...seen, device: "iPhone 17 Pro" }).join(" ")).toMatch(/not the model/u);
    expect(judgeNoDevice({ ...seen, create: { before: 0, after: 1 } }).join(" ")).toMatch(
      /ran create/u,
    );
  });

  it("SIM-P1: VOID on a host whose xcode-select names Xcode; on a CLT host the fallback, with no DEVELOPER_DIR", () => {
    expect(judgeP1({ vetted: "xcode-select", offBoot: true, developerDir: undefined })).toEqual({
      problems: [],
      void: "not a CLT-selected host",
    });
    expect(
      judgeP1({ vetted: "fallback", offBoot: true, developerDir: undefined }).problems,
    ).toEqual([]);
    expect(
      judgeP1({
        vetted: "fallback",
        offBoot: true,
        developerDir: "/Applications/Xcode.app/Contents/Developer",
      }).problems.join(" "),
    ).toMatch(/DEVELOPER_DIR/u);
    expect(
      judgeP1({ vetted: "fallback", offBoot: false, developerDir: undefined }).problems.join(" "),
    ).toMatch(/OFF-BOOT/u);
  });

  const measure = (over: Partial<Measure> = {}): Measure => ({
    px: 10_000,
    colors: 400,
    lumaRange: 200,
    lumaMean: 120,
    band: 900,
    bandMean: [150, 30, 90],
    grid: new Array<number>(16).fill(100),
    ...over,
  });
  const proof: LiveProof = {
    bound: 20_000,
    ms: 900,
    condition: "streaming",
    presented: 6,
    frames: 6,
    after: Array.from({ length: 10 }, () => "streaming"),
  };

  it("SIM-LIVE: a words face cannot pass the off face's floor, and a still cannot pass two reads 500 ms apart", () => {
    const seen = {
      proof,
      off: { colors: 40 },
      glass: { colors: 400, lumaRange: 200 },
      band: measure(),
      shot: measure({ colors: 900, lumaRange: 230 }),
      again: { differ: true, presented: 3, frames: 3 },
    };
    expect(judgeLive(seen)).toEqual([]);
    expect(judgeLive({ ...seen, glass: { colors: 100, lumaRange: 200 } }).join(" ")).toMatch(
      /3 × the words face/u,
    );
    expect(
      judgeLive({ ...seen, again: { differ: false, presented: 0, frames: 0 } }).join(" "),
    ).toMatch(/a still/u);
    expect(judgeLive({ ...seen, band: measure({ band: 10 }) }).join(" ")).toMatch(
      /not this device's page/u,
    );
    expect(judgeLive({ ...seen, off: null }).join(" ")).toMatch(/floor is missing/u);
  });

  it("SIM-USE: live at 60, interactive at 80 and at the device's native raster; View only and the name; nothing told iOS", () => {
    const seen: UseSeen = {
      held: true,
      wire: {
        mode: "live",
        targetFps: 60,
        priority: 80,
        interactive: true,
        targetRasterSize: { width: 1179, height: 2556 },
      },
      native: [1179, 2556],
      bar: { text: "View only pts3-l2-a-1", readout: "pts3-l2-a-1" },
      name: "pts3-l2-a-1",
      loaded: 1,
      inputs: { before: 0, after: 0 },
      acts: { before: 2, after: 2 },
      calls: { before: { boot: 1 }, after: { boot: 1 } },
      rowInputs: 0,
      down: true,
    };
    expect(judgeUse(seen)).toEqual({ problems: [], void: null });
    expect(judgeUse({ ...seen, native: [603, 1278] }).problems.join(" ")).toMatch(
      /not the device's 603 × 1278/u,
    );
    expect(judgeUse({ ...seen, inputs: { before: 0, after: 1 } }).problems.join(" ")).toMatch(
      /view-only/u,
    );
    expect(judgeUse({ ...seen, loaded: 0 }).void).toMatch(/\/loaded/u);
  });

  it("SIM-STILL: the address is the binding on the STAGE's runtime — another runtime's literal reads red (RM4.1)", () => {
    const want = stillAddress(TP, RUNTIME);
    expect(want).toBe(`ios-simulator:${TP}/${RUNTIME}`);
    const seen: StillSeen = {
      taken: { before: 0, after: 1 },
      address: want,
      want,
      extraStill: false,
      live: measure(),
      reloaded: true,
      rested: { still: 1_700_000_000_000, rested: true },
      seen: measure({ colors: 300 }),
      predicted: [128, 22, 76],
      handover: proof,
    };
    expect(judgeStill(seen)).toEqual([]);
    const literal = `ios-simulator:${TP}/com.apple.CoreSimulator.SimRuntime.iOS-26-5`;
    expect(judgeStill({ ...seen, address: literal }).join(" ")).toMatch(/filed under/u);
    expect(judgeStill({ ...seen, seen: measure({ colors: 100 }) }).join(" ")).toMatch(
      /under half/u,
    );
    expect(judgeStill({ ...seen, extraStill: true }).join(" ")).toMatch(/R14/u);
    expect(judgeStill({ ...seen, taken: { before: 0, after: 2 } }).join(" ")).toMatch(/2 stills/u);
  });

  it("SIM-RELOAD: a session MADE is red even when the face looks right; SIM-GONE: each count one fewer, the device still booted", () => {
    const before = { runtimes: 2, census: census({ sessions: 1, sessionsMade: 3 }) };
    const reload = { before, after: before, origins: [1, 2] as const, proof };
    expect(judgeReload(reload)).toEqual([]);
    expect(
      judgeReload({
        ...reload,
        after: { runtimes: 2, census: census({ sessions: 1, sessionsMade: 4 }) },
      }).join(" "),
    ).toMatch(/MADE/u);
    expect(judgeReload({ ...reload, origins: [1, 1] }).join(" ")).toMatch(/no reload/u);
    const gone = {
      proof,
      closedMs: 80,
      before: { runtimes: 2, sessions: 2, active: 2 },
      after: { runtimes: 1, sessions: 1, active: 1 },
      state: "Booted",
    };
    expect(judgeGone(gone)).toEqual([]);
    expect(judgeGone({ ...gone, state: "Shutdown" }).join(" ")).toMatch(/the person's/u);
    expect(judgeGone({ ...gone, after: { ...gone.after, sessions: 2 } }).join(" ")).toMatch(
      /sessions 2 → 2/u,
    );
  });
});

describe("PT-S3 — the rows' marks, and which are problems", () => {
  const r = (over: Partial<PhoneRowResult>): PhoneRowResult => ({
    name: "SIM-LIVE",
    klass: "MUST",
    mark: "green",
    problems: [],
    why: null,
    ...over,
  });

  it("marks STAGING NOT MET and VOID with their why, RECORDED whatever a recorded row read", () => {
    expect(rowMark([], {})).toEqual({ mark: "green", why: null });
    expect(rowMark(["x"], {})).toEqual({ mark: "red", why: null });
    expect(rowMark([], { staging: "Safari covered it" })).toEqual({
      mark: "STAGING NOT MET",
      why: "Safari covered it",
    });
    expect(rowMark([], { void: "HID: a hand" })).toEqual({ mark: "VOID", why: "HID: a hand" });
    expect(
      rowMark([], { recorded: true, staging: "Simulator.app showed every booted device" }),
    ).toEqual({
      mark: "RECORDED",
      why: "Simulator.app showed every booted device",
    });
    expect(rowMark(["x"], { recorded: true })).toEqual({ mark: "RECORDED", why: "a finding" });
  });

  it("hands smoke:canvas a MUST red, VOID or unstaged — never SIM-P1 on an Xcode host, a RECORDED row, NICE or OBSERVATION", () => {
    const out = phoneProblems([
      r({ mark: "red", problems: ["SIM-LIVE: a still"] }),
      r({ name: "SIM-USE", mark: "VOID", why: "HID: a hand" }),
      r({ name: "SIM-UNSEEN", mark: "STAGING NOT MET", why: "no arrivals" }),
      r({ name: "SIM-P1", mark: "VOID", why: "not a CLT-selected host" }),
      r({ name: "SIM-SHOW-RUNNING", mark: "RECORDED", problems: ["a finding"], why: "a finding" }),
      r({ name: "SIM-SHARE", klass: "NICE", mark: "red", problems: ["x"] }),
      r({ name: "SIM-RATE", klass: "OBSERVATION", mark: "VOID", why: "still" }),
    ]);
    expect(out).toEqual([
      "SIM-LIVE: a still",
      "SIM-USE: VOID — HID: a hand",
      "SIM-UNSEEN: STAGING NOT MET — no arrivals",
    ]);
  });
});

describe("PT-S3 — the host door", () => {
  const env = phoneEnv(ENV);
  if (typeof env === "string") throw new Error(env);

  it("carries the token in its header — never in an address — and reads a go, a VOID end and a stop", async () => {
    const asked: { url: string; init: RequestInit | undefined }[] = [];
    const answers: [number, unknown][] = [
      [200, { go: true }],
      [200, { go: true, void: "END idle 3 s < the row's 9 s" }],
      [409, { stop: true, why: "a hand at the Mac" }],
      [200, { n: 1, state: "Booted" }],
      [200, { n: 1, state: 4 }],
    ];
    const fetcher = (async (url: string, init?: RequestInit) => {
      asked.push({ url, init });
      const [status, body] = answers.shift() ?? [500, {}];
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    const door = phoneDoor(env, fetcher);
    expect(await door.row("SIM-LIVE", "begin")).toEqual({ go: true, void: null, stop: null });
    expect(await door.row("SIM-LIVE", "end")).toEqual({
      go: true,
      void: "END idle 3 s < the row's 9 s",
      stop: null,
    });
    expect(await door.row("SIM-USE", "press", { act: "boot", device: "pts3-l2-a-1" })).toEqual({
      go: false,
      void: null,
      stop: "a hand at the Mac",
    });
    expect(await door.act("state", 1)).toEqual({ state: "Booted", why: null });
    expect(await door.count("/input", "961e5a")).toBe(4);
    expect(door.page("/motion", "961e5a")).toBe("http://127.0.0.1:53111/motion?n=961e5a");
    for (const a of asked) {
      expect(a.url).not.toContain(env.token);
      expect(new Headers(a.init?.headers).get("x-phone-token")).toBe(env.token);
    }
    expect(JSON.parse(String(asked[2]?.init?.body))).toEqual({
      name: "SIM-USE",
      phase: "press",
      act: "boot",
      device: "pts3-l2-a-1",
    });
  });

  it("says the run's first input as a phase of the open row (RM4.5 is read at that row's END), and reads a stop on it", async () => {
    const asked: unknown[] = [];
    const answers: [number, unknown][] = [
      [200, { go: true }],
      [409, { stop: true, why: "the door is closing: the run is ending" }],
    ];
    const fetcher = (async (_url: string, init?: RequestInit) => {
      asked.push(JSON.parse(String(init?.body)));
      const [status, body] = answers.shift() ?? [500, {}];
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    const door = phoneDoor(env, fetcher);
    expect(await door.row("SIM-STAGED", "input")).toEqual({ go: true, void: null, stop: null });
    expect((await door.row("SIM-STAGED", "input")).stop).toMatch(/closing/u);
    expect(asked[0]).toEqual({ name: "SIM-STAGED", phase: "input" });
  });

  it("says a door that never answered as a stop, never a go", async () => {
    const door = phoneDoor(env, (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    const row = await door.row("SIM-LIVE", "begin");
    expect(row.go).toBe(false);
    expect(row.stop).toMatch(/did not answer/u);
    expect((await door.act("state", 1)).state).toBe("unanswered");
  });
});
