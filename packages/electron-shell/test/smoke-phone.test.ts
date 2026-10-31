/**
 * PT-S3 — the phone's live rows' pure half (testing/smoke-phone.ts), judged here with nothing spawned (node:child_process
 * throws on any use): the stage's env read and refused; THE PRESS GATE's refusals (create, another run's device, a name
 * that only begins like the run's, another type, no run id); LIVE-PROVEN red for a `streaming` face that presented nothing;
 * the face row's projection (a `retry` function never crosses a structured clone); the UUID sweep's shape; the band's
 * colours apart from the motion page's sweep and from grey; the measure the page runs equal to main's; SIM-IDLE's window
 * clear of the status bar's minute; SIM-STILL's address built from the stage's runtime, never a literal (RM4.1); the rows'
 * marks and which of them are problems; and the door's token in a header, never in an address.
 */
import { readFileSync } from "node:fs";
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

import { dimmed } from "../src/testing/smoke-last-still";
import {
  actOrStop,
  actScan,
  BAND_PALETTE,
  BAND_TOL,
  bandColour,
  bandNonce,
  bindingRead,
  endVoid,
  glassRect,
  idleWait,
  isOwnDevice,
  judgeCap,
  judgeGone,
  judgeIdle,
  judgeLive,
  judgeLiveProven,
  judgeNoDevice,
  judgeNone,
  judgeNoUdid,
  judgeP1,
  judgePress,
  judgeReload,
  judgeStill,
  judgeStopped,
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
  type PhoneRowsDriver,
  type PressAsk,
  phoneDoor,
  phoneEnv,
  phoneProblems,
  phoneRows,
  pressInHand,
  quitStaging,
  readSince,
  rowLedger,
  rowMark,
  type StillSeen,
  stillAddress,
  stoppedBeforeQuit,
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
  VF_PHONE_DEVDIR_BY: "fallback",
};
const UDID = "5F1C2A3B-4D5E-6F70-8192-A3B4C5D6E7F8";

/** The runner's own source: the rows' bodies are closures over the window, so what they call is held here as source. */
const SOURCE = readFileSync(new URL("../src/testing/smoke-phone.ts", import.meta.url), "utf8");
/** Each `await row("NAME", "KLASS", …)` the runner calls, in source order, its body up to the next one. */
const rowBodies = (src: string): { name: string; klass: string; body: string }[] => {
  const at = [...src.matchAll(/await row\("([^"]+)", "([A-Z]+)"/gu)];
  return at.map((m, i) => ({
    name: m[1] ?? "",
    klass: m[2] ?? "",
    body: src.slice(m.index ?? 0, at[i + 1]?.index ?? src.length),
  }));
};

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
    // the driver's own `xcode-select -p` reading, a label (never a path): SIM-P1's VOID is decided by it (M1/R13)
    expect(env.selected).toBe("fallback");
    for (const [said, read] of [
      ["xcode-select", "xcode-select"],
      [undefined, null],
      ["/Applications/Xcode.app/Contents/Developer", null],
    ] as const)
      expect(
        (phoneEnv({ ...ENV, VF_PHONE_DEVDIR_BY: said }) as { selected: unknown }).selected,
      ).toBe(read);
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

  it("names the flag and the rows: L1 two; L2 twenty — the seventeen MUST from SIM-STAGED to SIM-NO-UDID (last), an OBSERVATION and two NICE; L3 one", () => {
    expect(PHONE_FLAG).toBe("--phone");
    expect(PHONE.type).toBe("vibefield.simulator");
    expect(PHONE.category).toBe("devices");
    expect(PHONE.size).toEqual({ w: 188.71, h: 393.7 });
    expect(PHONE_ROWS.none.map((r) => r.name)).toEqual(["SIM-NONE", "SIM-NO-UDID"]);
    const l2 = PHONE_ROWS.devices;
    expect(l2.filter((r) => r.klass === "MUST")).toHaveLength(17);
    // each mode's count, exact: the stage's MODE_ROWS reds any other `PHONE_ROWS_END n=` (R16)
    expect({
      none: PHONE_ROWS.none.length,
      devices: l2.length,
      cost: PHONE_ROWS.cost.length,
    }).toEqual({ none: 2, devices: 20, cost: 1 });
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

describe("PT-S3 — the rows that run are the table's (R-6)", () => {
  it("the ledger takes each mode's rows in order and is run out; it refuses a row out of turn, reclassed or past the table", () => {
    for (const mode of ["none", "devices", "cost"] as const) {
      const l = rowLedger(mode);
      expect(l.rest()).toMatch(
        new RegExp(`^${PHONE_ROWS[mode].length} of the ${mode} table's`, "u"),
      );
      for (const r of PHONE_ROWS[mode]) expect(l.take(r.name, r.klass)).toBeNull();
      expect(l.rest()).toBeNull();
      expect(l.take("SIM-EXTRA", "MUST")).toBe(
        `SIM-EXTRA (MUST) runs past the ${mode} table's ${PHONE_ROWS[mode].length} rows`,
      );
    }
    const l2 = rowLedger("devices");
    expect(l2.take("SIM-STAGED", "MUST")).toBeNull();
    expect(l2.take("SIM-SHOW-FRESH", "MUST")).toBe(
      "SIM-SHOW-FRESH (MUST) runs where the devices table's row 2 is SIM-NO-DEVICE (MUST)",
    );
    expect(l2.take("SIM-NO-DEVICE", "NICE")).toBe(
      "SIM-NO-DEVICE (NICE) runs where the devices table's row 2 is SIM-NO-DEVICE (MUST)",
    );
    // a refusal takes nothing: the table's next row still stands
    expect(l2.take("SIM-NO-DEVICE", "MUST")).toBeNull();
    expect(l2.rest()).toMatch(
      /^18 of the devices table's 20 rows never ran \(SIM-SHOW-FRESH, SIM-OFF-BOOT, /u,
    );
  });

  it("the runner's own row calls, mode by mode, are PHONE_ROWS in order; row() takes each from the ledger before the door's begin; the table is run out before PHONE_ROWS_END", () => {
    const span = (from: string, to: string | null): string => {
      const at = SOURCE.indexOf(from);
      expect(at).toBeGreaterThanOrEqual(0);
      return SOURCE.slice(at, to === null ? SOURCE.length : SOURCE.indexOf(to, at));
    };
    const calls = (src: string) =>
      [...src.matchAll(/\brow\("([^"]+)", "([A-Z]+)"|await noUdidRow\(\)/gu)].map((m) =>
        m[1] === undefined
          ? { name: "SIM-NO-UDID", klass: "MUST" }
          : { name: m[1], klass: m[2] ?? "" },
      );
    expect(calls(span("async function noneRows()", "async function noUdidRow()"))).toEqual(
      PHONE_ROWS.none,
    );
    expect(calls(span("async function noUdidRow()", "async function deviceRows()"))).toEqual([
      { name: "SIM-NO-UDID", klass: "MUST" },
    ]);
    expect(calls(span("async function deviceRows()", "async function costRows()"))).toEqual(
      PHONE_ROWS.devices,
    );
    expect(calls(span("async function costRows()", null))).toEqual(PHONE_ROWS.cost);
    const runner = span("const row = async (", "// ── the rows, by mode");
    const take = runner.indexOf("ledger.take(name, klass)");
    expect(take).toBeGreaterThanOrEqual(0);
    expect(take).toBeLessThan(runner.indexOf('door.row(name, "begin")'));
    const finale = span("} finally {", "const problems = phoneProblems(results);");
    expect(finale.indexOf("ledger.rest()")).toBeGreaterThanOrEqual(0);
    expect(finale.indexOf("ledger.rest()")).toBeLessThan(finale.indexOf("PHONE_ROWS_END n="));
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

describe("PT-S3 — THE PRESS in hand: our gate, the capsule, our gate AGAIN on a face read after the scan, the door's", () => {
  const own = (act: string | null, name = "pts3-l2-a-3") => ({
    is: "no-window",
    act,
    condition: null,
    acting: null,
    degraded: false,
    name,
    deviceType: TR,
    runtime: RUNTIME,
  });
  /** A held phone whose capsule is the scan's `hitAt`-th point; the face's reads in turn (the last one repeats). */
  const hands = (reads: ReturnType<typeof own>[], hitAt = 3, stop: string | null = null) => {
    const said = { reads: 0, probes: 0, door: [] as [string, string][], pressed: [] as unknown[] };
    return {
      said,
      hands: {
        sim: async () => reads[Math.min(said.reads++, reads.length - 1)] ?? null,
        frame: async () => ({ cx: 600, cy: 400, hx: 200, hy: 420 }),
        offset: async () => ({ left: 10, top: 20 }),
        cursorAt: async () => (++said.probes === hitAt ? "pointer" : "auto"),
        door: async (act: string, device: string) => {
          said.door.push([act, device]);
          return { go: stop === null, void: null, stop };
        },
        press: async (at: { x: number; y: number }) => {
          said.pressed.push(at);
        },
      },
    };
  };
  const ask = { n: 3, act: "show", type: TR, runId: "l2-a" } as const;

  it("presses the capsule the cursor found, the door told the act and the run's own device", async () => {
    const h = hands([own("show")]);
    await pressInHand("SIM-SHOW-FRESH", ask, h.hands);
    expect(h.said.door).toEqual([["show", "pts3-l2-a-3"]]);
    expect(h.said.pressed).toHaveLength(1);
    expect(h.said.probes).toBe(3);
  });

  it("a face whose act changed during the scan STOPs before the door is asked or anything pressed (R-3)", async () => {
    const h = hands([own("show"), own("retry")]);
    const stop = await pressInHand("SIM-SHOW-FRESH", ask, h.hands).catch((e: unknown) => e);
    expect((stop as Error).constructor.name).toBe("PhoneStop");
    expect((stop as Error).message).toMatch(
      /SIM-SHOW-FRESH: the press gate after the scan: the face offers retry, not show/u,
    );
    expect(h.said.door).toEqual([]);
    expect(h.said.pressed).toEqual([]);
    // so does a face gone to another device's, or to no act
    for (const after of [own("show", "pts3-other-3"), own(null)]) {
      const g = hands([own("show"), after]);
      await expect(pressInHand("SIM-SHOW-FRESH", ask, g.hands)).rejects.toThrow(/after the scan/u);
      expect(g.said.door).toEqual([]);
      expect(g.said.pressed).toEqual([]);
    }
  });

  it("a gate refused before the scan probes nothing; a door's stop presses nothing", async () => {
    const refused = hands([own("boot")]);
    await expect(pressInHand("SIM-SHOW-FRESH", ask, refused.hands)).rejects.toThrow(
      /the press gate: the face offers boot, not show/u,
    );
    expect(refused.said.probes).toBe(0);
    const h = hands([own("show")], 3, "a hand at the Mac");
    await expect(pressInHand("SIM-SHOW-FRESH", ask, h.hands)).rejects.toThrow(
      /the door's press gate: a hand at the Mac/u,
    );
    expect(h.said.pressed).toEqual([]);
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

  it("SIM-P1: VOID only on the DRIVER's word that xcode-select names Xcode; any DEVELOPER_DIR red; on a CLT host the fallback (M1/R13)", () => {
    const XCODE = "/Applications/Xcode.app/Contents/Developer";
    const clt = {
      selected: "fallback",
      vetted: "fallback",
      offBoot: true,
      developerDir: undefined,
    } as const;
    expect(judgeP1(clt)).toEqual({ problems: [], void: null });
    expect(judgeP1({ ...clt, selected: "xcode-select", vetted: "xcode-select" })).toEqual({
      problems: [],
      void: "not a CLT-selected host",
    });
    // THE case it exists for: DEVELOPER_DIR leaked into Electron on a CLT host, so main vetted xcode-select — red
    const leaked = judgeP1({ ...clt, vetted: "xcode-select", developerDir: XCODE });
    expect(leaked.void).toBeNull();
    expect(leaked.problems.join(" ")).toMatch(/DEVELOPER_DIR/u);
    expect(leaked.problems.join(" ")).toMatch(/main vetted xcode-select, not the fallback/u);
    // any DEVELOPER_DIR is red, whatever the host
    const anyHost = judgeP1({
      ...clt,
      selected: "xcode-select",
      vetted: "xcode-select",
      developerDir: XCODE,
    });
    expect(anyHost.void).toBeNull();
    expect(anyHost.problems.join(" ")).toMatch(/DEVELOPER_DIR/u);
    // the product's own word never VOIDs it: a CLT host where main says xcode-select is red
    expect(judgeP1({ ...clt, vetted: "xcode-select" }).problems.join(" ")).toMatch(
      /not the fallback/u,
    );
    // the stage never said: red, never VOID
    const unsaid = judgeP1({ ...clt, selected: null, vetted: "xcode-select" });
    expect(unsaid.void).toBeNull();
    expect(unsaid.problems.join(" ")).toMatch(/VF_PHONE_DEVDIR_BY/u);
    expect(judgeP1({ ...clt, offBoot: false }).problems.join(" ")).toMatch(/OFF-BOOT/u);
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
      proof,
    };
    expect(judgeUse(seen)).toEqual({ problems: [], void: null });
    // §4's nine states: SIM-USE witnesses `live` — LIVE-PROVEN in hand, on /motion, before the input half (R-7)
    const dead = { ...proof, ms: null, presented: 0, frames: 0, after: [] };
    expect(judgeUse({ ...seen, proof: dead }).problems.join(" ")).toMatch(
      /SIM-USE \(in hand\): 0 frames presented, not 3/u,
    );
    expect(judgeUse({ ...seen, proof: null }).problems).toEqual([
      "SIM-USE (in hand): never read for LIVE-PROVEN",
    ]);
    // a dead stream in hand is red, never VOIDed by the input half's missing beacon
    expect(judgeUse({ ...seen, proof: dead, loaded: 0 }).void).toBeNull();
    expect(judgeUse({ ...seen, proof: dead, loaded: 0 }).problems.length).toBeGreaterThan(0);
    const body = rowBodies(SOURCE).find((r) => r.name === "SIM-USE")?.body ?? "";
    const motion = body.indexOf('openUrl(1, "/motion"');
    expect(motion).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("liveProven(p)")).toBeGreaterThan(motion);
    expect(body.indexOf('openUrl(1, "/still"')).toBeGreaterThan(body.indexOf("liveProven(p)"));
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
      seen: measure({ colors: 300, bandMean: [128, 22, 76] }),
      predicted: [128, 22, 76],
      handover: proof,
    };
    expect(judgeStill(seen)).toEqual([]);
    // R2: the law's 0.7 dim moves a band less than BAND_TOL, so an UNDIMMED live band still counts as band pixels —
    // the still is told from a live face by which it is nearer: the law's dim, or the live band
    for (let k = 0; k < 48; k += 1) {
      const band = bandColour(bandNonce(k));
      const dim = dimmed(band, band, PHONE.still).map(Math.round);
      expect(Math.max(...dim.map((v, i) => Math.abs(v - (band[i] ?? 0))))).toBeLessThanOrEqual(
        BAND_TOL,
      );
    }
    const live = judgeStill({ ...seen, seen: measure({ colors: 300 }) });
    expect(live.join(" ")).toMatch(/nearer the live band .* a live face, not its still/u);
    expect(
      judgeStill({ ...seen, seen: measure({ colors: 300, bandMean: [134, 25, 80] }) }),
    ).toEqual([]);
    const literal = `ios-simulator:${TP}/com.apple.CoreSimulator.SimRuntime.iOS-26-5`;
    expect(judgeStill({ ...seen, address: literal }).join(" ")).toMatch(/filed under/u);
    expect(judgeStill({ ...seen, seen: measure({ colors: 100 }) }).join(" ")).toMatch(
      /under half/u,
    );
    expect(judgeStill({ ...seen, extraStill: true }).join(" ")).toMatch(/R14/u);
    expect(judgeStill({ ...seen, taken: { before: 0, after: 2 } }).join(" ")).toMatch(/2 stills/u);
  });

  it("SIM-CAP: waiting at rest on its still DIMMED, the pane put to rest (rests +1), the held surface unchanged 1 s on (R17)", () => {
    const cap = {
      proof0: proof,
      cap: 1,
      rests: [2, 3],
      paneAlive: true,
      waiting: { rested: true, still: 1_700_000_000_000 },
      live: measure(),
      seen: measure({ bandMean: [128, 22, 76] }),
      predicted: [128, 22, 76],
      proof,
      held: { alive: true, wire: "live" },
      paneRested: true,
      surfaces: ["s-9", "s-9"],
    } as const;
    expect(judgeCap(cap)).toEqual([]);
    // the waiting phone's glass is the LIVE band, not its still at the law's dim
    expect(judgeCap({ ...cap, seen: measure() }).join(" ")).toMatch(
      /SIM-CAP: .*a live face, not its still/u,
    );
    expect(judgeCap({ ...cap, seen: measure({ band: 0 }) }).join(" ")).toMatch(
      /SIM-CAP: the band at the law's dim/u,
    );
    // the pane put to rest under the held phone: its face, and the count
    expect(judgeCap({ ...cap, rests: [2, 2] }).join(" ")).toMatch(/not put to rest .*rests 2 → 2/u);
    expect(judgeCap({ ...cap, paneRested: false }).join(" ")).toMatch(/not put to rest/u);
    // HELD-NEVER: the surface read after LIVE-PROVEN in hand, and again a second on
    expect(judgeCap({ ...cap, surfaces: ["s-9", "s-10"] }).join(" ")).toMatch(/surface changed/u);
    expect(judgeCap({ ...cap, surfaces: [null, null] }).join(" ")).toMatch(/surface changed/u);
    expect(judgeCap({ ...cap, cap: 6 }).join(" ")).toMatch(/not 1/u);
  });

  it("SIM-IDLE: asleep over a static screen; the wake's baseline only once the desk slept again after the camera move (R18)", () => {
    const idle = {
      proof,
      asleep: [true, true, true, true, true, true],
      steps: 0,
      presented: 0,
      rearmed: true,
      wake: { presented: 3, arrivals: 4 },
    };
    expect(judgeIdle(idle)).toEqual([]);
    // the far ask's move re-asks the wire: a reconfiguration frame inside the window is not motion
    expect(judgeIdle({ ...idle, rearmed: false }).join(" ")).toMatch(/never slept again/u);
    expect(judgeIdle({ ...idle, wake: { presented: 0, arrivals: 0 } }).join(" ")).toMatch(
      /motion did not wake it/u,
    );
    expect(judgeIdle({ ...idle, steps: 2 }).join(" ")).toMatch(/stepped 2 times/u);
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

describe("PT-S3 — a row staged on Simulator.app NOT running (R7)", () => {
  it("goes on only after quit-app read `quit` or `not-running`; any other word is STAGING NOT MET, said", () => {
    expect(quitStaging("quit")).toBeNull();
    expect(quitStaging("not-running")).toBeNull();
    for (const word of ["failed", "refused", "stop", "unanswered"])
      expect(quitStaging(word)).toBe(`quit-app read ${word}: Simulator.app may be running`);
    expect(rowMark([], { staging: quitStaging("failed") }).mark).toBe("STAGING NOT MET");
  });

  it("every row that quits Simulator.app to stage holds the quit's word to quitStaging at once — SIM-SHOW-RUNNING too, its quit in every seen (R-2)", () => {
    const quitting = rowBodies(SOURCE).filter((r) => r.body.includes("quitApp()"));
    expect(quitting.map((r) => r.name)).toEqual([
      "SIM-SHOW-FRESH",
      "SIM-OFF-BOOT",
      "SIM-SHOW-RUNNING",
      "SIM-STOPPED",
      "SIM-GONE",
    ]);
    for (const r of quitting) {
      expect(r.body.match(/quitApp\(\)/gu)).toHaveLength(1);
      // SIM-STOPPED's quit is its STIMULUS (the quit mid-stream), its word judged by judgeStopped — not a staging
      if (r.name === "SIM-STOPPED") {
        expect(r.body).toMatch(/quit,\s/u);
        expect(r.body).toContain("judgeStopped(");
        continue;
      }
      expect(r.body).toMatch(
        /const quit = await quitApp\(\);\s*const running = quitStaging\(quit\);\s*if \(running !== null\) return \{ problems: \[\], staging: running, seen: \{ quit \} \};|const running = quitStaging\(await quitApp\(\)\);\s*if \(running !== null\) return \{ problems: \[\], staging: running \};/u,
      );
    }
    // a quit that did not happen is STAGING NOT MET, never "Simulator.app showed every booted device" (risk 1): the
    // quit's word rides every return of SIM-SHOW-RUNNING
    const running = quitting.find((r) => r.name === "SIM-SHOW-RUNNING")?.body ?? "";
    const returns = running.split("return {").slice(1);
    expect(returns.length).toBeGreaterThanOrEqual(5);
    for (const ret of returns) expect(ret.slice(0, ret.indexOf("};"))).toMatch(/seen: \{ quit\b/u);
  });
});

describe("PT-S3 — SIM-STOPPED's word (P8 amended)", () => {
  const proven: LiveProof = {
    bound: 20_000,
    ms: 900,
    condition: "streaming",
    presented: 6,
    frames: 6,
    after: Array.from({ length: 10 }, () => "streaming"),
  };
  const seen = {
    proof0: proven,
    quit: "quit",
    word: "stopped",
    stateP: "Booted",
    wakes: [3, 4],
    paneAlive: true,
    retry: proven,
    shot: true,
  } as const;
  const mark = (s: Parameters<typeof judgeStopped>[0]) => {
    const j = judgeStopped(s);
    return rowMark(j.problems, { staging: j.staging, recorded: j.recorded }).mark;
  };
  /** φP held the cap slot `streaming` with no frames: a fresh retry or boot answers it before any window (the grade's R-1) */
  const unproven: LiveProof = {
    bound: 20_000,
    ms: null,
    condition: "streaming",
    presented: 0,
    frames: 0,
    after: [],
  };

  it("φP LIVE-PROVEN before the quit is judged in every branch: `stopped` with Try again live is still red over an unproven stream (R-1)", () => {
    expect(judgeStopped({ ...seen, proof0: unproven }).problems.join(" ")).toMatch(
      /SIM-STOPPED \(before the quit\): 0 frames presented, not 3/u,
    );
    expect(mark({ ...seen, proof0: unproven })).toBe("red");
    // the word's record never takes a red proof away
    expect(mark({ ...seen, proof0: unproven, word: "off", stateP: "Shutdown", retry: null })).toBe(
      "red",
    );
    expect(mark({ ...seen, proof0: null })).toBe("red");
  });

  it("before the quit: a red proof0 is RED, never STAGING NOT MET, and no quit is spent; the cap's staging after it (R-1)", () => {
    const before = (s: Parameters<typeof stoppedBeforeQuit>[0]) => {
      const b = stoppedBeforeQuit(s);
      return b === null ? null : rowMark(b.problems, { staging: b.staging }).mark;
    };
    expect(before({ proof0: proven, paneRested: true, phoneAlive: true })).toBeNull();
    expect(before({ proof0: unproven, paneRested: true, phoneAlive: true })).toBe("red");
    // red even when the cap's staging missed too: the stream is the row's precondition, judged first
    expect(before({ proof0: unproven, paneRested: false, phoneAlive: true })).toBe("red");
    expect(stoppedBeforeQuit({ proof0: unproven, paneRested: true, phoneAlive: true })).toEqual({
      problems: judgeLiveProven("SIM-STOPPED (before the quit)", unproven),
      staging: null,
    });
    expect(before({ proof0: proven, paneRested: false, phoneAlive: true })).toBe("STAGING NOT MET");
    expect(stoppedBeforeQuit({ proof0: proven, paneRested: true, phoneAlive: false })).toEqual({
      problems: [],
      staging: "under the cap the phone alive false, the pane rested true",
    });
  });

  it("`stopped`: the give-back and Try again's leg judged — green only when both hold", () => {
    expect(mark(seen)).toBe("green");
    expect(judgeStopped({ ...seen, retry: null }).problems.join(" ")).toMatch(/Try again/u);
    expect(mark({ ...seen, retry: null })).toBe("red");
  });

  it("any other word is RECORDED as a finding, never green — `off` with P Shutdown, another word, or none (R1)", () => {
    const off = judgeStopped({ ...seen, word: "off", stateP: "Shutdown", retry: null });
    expect(off.recorded).toBe(true);
    expect(off.staging).toBe("the quit reads off (device Shutdown) — the stopped face unwitnessed");
    expect(mark({ ...seen, word: "off", stateP: "Shutdown", retry: null })).toBe("RECORDED");
    for (const word of ["no-window", "at-rest", null])
      expect(mark({ ...seen, word, retry: null })).toBe("RECORDED");
  });

  it("the cap's give-back stays red in every branch — over the word's record too", () => {
    const asleep = {
      ...seen,
      word: "off",
      stateP: "Shutdown",
      wakes: [3, 3],
      retry: null,
    } as const;
    expect(judgeStopped(asleep).problems.join(" ")).toMatch(/did not wake/u);
    expect(mark(asleep)).toBe("red");
    expect(mark({ ...seen, quit: "failed" })).toBe("red");
    expect(mark({ ...seen, word: "no-window", paneAlive: false, retry: null })).toBe("red");
  });

  it("the desk screenshot is a read: without VF_SMOKE_SHOT_DIR the row FAILS, never skips (R15)", () => {
    expect(judgeStopped({ ...seen, shot: false }).problems).toEqual([
      "SIM-STOPPED: no VF_SMOKE_SHOT_DIR — the desk screenshot was not stored",
    ]);
    expect(mark({ ...seen, word: "off", stateP: "Shutdown", retry: null, shot: false })).toBe(
      "red",
    );
  });
});

describe("PT-S3 — SIM-ATTACH's poll: an answer from a read taken after R's boot (R-4, RM6)", () => {
  // `reads` counts a read as it BEGINS (one may be in flight, and they never overlap); a failed one leaves the last
  // snapshot standing — so the answer is a post-boot read's only once one begun after the baseline has LANDED, not failed
  const base = { reads: 4, failures: 1, rows: 3 };
  it("waits past a read begun but maybe in flight, and past one that may have failed", () => {
    expect(readSince(base, base)).toBe(false);
    expect(readSince(base, { ...base, reads: 5 })).toBe(false);
    expect(readSince(base, { ...base, reads: 6 })).toBe(true);
    expect(readSince(base, { ...base, reads: 6, failures: 2 })).toBe(false);
    expect(readSince(base, { ...base, reads: 7, failures: 2 })).toBe(true);
    expect(readSince(base, { reads: 9, failures: 1, rows: null })).toBe(false);
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
    // a VOID wins over RECORDED: SIM-RATE's numbers do not stand unless its shots differ, nor any read under a hand (R8)
    const still = "two device screenshots 250 ms apart do not differ";
    expect(rowMark([], { recorded: true, void: still })).toEqual({ mark: "VOID", why: still });
    expect(rowMark(["x"], { recorded: true, void: "HID: a hand" })).toEqual({
      mark: "VOID",
      why: "HID: a hand",
    });
  });

  it("a row's void: its body's, else the door END's — an HID void, or a stop at END (RM4.5, a run stopped mid-row) (R9)", () => {
    const go = { go: true, void: null, stop: null };
    expect(endVoid(undefined, go)).toBeNull();
    expect(endVoid(null, go)).toBeNull();
    expect(endVoid("STOPPED: the fence", { ...go, stop: "x" })).toBe("STOPPED: the fence");
    expect(endVoid(null, { ...go, void: "a hand at the Mac mid-row" })).toBe(
      "HID: a hand at the Mac mid-row",
    );
    expect(
      endVoid(null, { go: false, void: null, stop: "HID moved by the run's own input — RM4.5" }),
    ).toBe("STOPPED at END: HID moved by the run's own input — RM4.5");
    // so the row cannot read green
    expect(rowMark([], { void: endVoid(null, { go: false, void: null, stop: "x" }) }).mark).toBe(
      "VOID",
    );
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

  it("every act the rows ask goes through one wrapper that turns a stop answer into the run's STOP (R14)", async () => {
    const asked: string[] = [];
    const act = actOrStop({
      act: async (verb) => {
        asked.push(verb);
        return verb === "state"
          ? { state: "stop", why: "a hand at the Mac before SIM-LIVE" }
          : verb === "boot"
            ? { state: "stop", why: null }
            : { state: "Booted", why: null };
      },
    });
    await expect(act("shutdown", 1)).resolves.toEqual({ state: "Booted", why: null });
    const stop = await act("state", 1).catch((error: unknown) => error);
    expect(stop).toBeInstanceOf(Error);
    expect((stop as Error).constructor.name).toBe("PhoneStop");
    expect((stop as Error).message).toBe("a hand at the Mac before SIM-LIVE");
    await expect(act("boot", 1)).rejects.toThrow("the door stopped the run");
    expect(asked).toEqual(["shutdown", "state", "boot"]);
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

describe("PT-S3 — the board as found, whatever throws before a row (R10, R-5)", () => {
  it("a focus that throws still restores the wind (set still first) and says PHONE_ROWS_END — the cause a problem", async () => {
    const asked: string[] = [];
    const lines: string[] = [];
    const win = {
      webContents: {
        executeJavaScript: async (expression: string): Promise<unknown> => {
          asked.push(expression);
          if (expression === "globalThis.__vfDesk.ambient()") return "breeze";
          if (expression === "globalThis.__vfDesk.liveCap()") return 4;
          if (expression.startsWith("globalThis.__vfDesk.objects(")) return [];
          if (expression === "globalThis.__vfDesk.held() !== null") return false;
          return undefined;
        },
        sendInputEvent: () => {
          throw new Error("no input before a row");
        },
      },
    };
    const driver = {
      win,
      shotDir: undefined,
      say: (line: string) => lines.push(line),
      env: { ...ENV, VF_PHONE_MODE: "none", VF_PHONE_DEVICES: `1:${TP}` },
      fixture: { url: "http://127.0.0.1:1/", setPlaying: () => undefined },
      custody: () => null,
      shellOpens: undefined,
      reload: async () => true,
      plugin: async () => null,
      focused: async () => {
        throw new Error("the debugger is held by another client");
      },
      pngPixels: () => null,
      metrics: () => ({ mb: 0, cpu: 0, processes: 0 }),
      fetch: (async () => {
        throw new Error("no row was begun");
      }) as unknown as typeof fetch,
    } as unknown as PhoneRowsDriver;
    const problems = await phoneRows(driver);
    expect(lines[0]).toBe("PHONE_ROWS_BEGIN mode=none");
    expect(lines.at(-1)).toBe("PHONE_ROWS_END n=0");
    expect(problems).toContain("PT-S3 PHONE: the debugger is held by another client");
    const still = asked.indexOf('globalThis.__vfDesk.ambient("still")');
    expect(still).toBeGreaterThanOrEqual(0);
    expect(asked.indexOf('globalThis.__vfDesk.ambient("breeze")')).toBeGreaterThan(still);
    expect(asked).toContain("globalThis.__vfDesk.liveCap(4)");
  });
});
