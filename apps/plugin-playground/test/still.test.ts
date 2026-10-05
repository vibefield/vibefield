// THE STILL'S JUDGE, with no device (DK-11): what `plugin-playground --still` makes of a kind's pixels and its golden, on
// synthetic stills — the frame round one object, the four checks (steady, drawn, inside its reach, held), the golden file
// read, written and blessed, the PNG, what a still hears on the console (ICE core's `Tray` line named as core's), the flags,
// and the rows as a reader and an agent meet them. Dawn itself is test/still.dawn.test.ts (`pnpm still`), never `test`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli";
import { toNdjson, toTable } from "../src/report";
import {
  blessedGolden,
  CORE_TRAY_LINE,
  type GoldenRead,
  goldenText,
  hearing,
  judgeStill,
  measureStill,
  readGolden,
  STILL_GOLDEN,
  type StillFrame,
  type StillPixels,
  stillFixtures,
  stillFrame,
  stillKey,
  stillPng,
  stillSha,
} from "../src/still";
import type { RunResult, StillVerdict } from "../src/verdict";

/** ICE core's line, verbatim as strata's dev build says it at every engine (`node --conditions=development`). */
const TRAY =
  'strata: access: in phase "react", systems "trayInput", "trayLay" declare write of "Tray" in the same phase — potential order-dependence (array order is execution order; order them deliberately, split the phase, or — if the writes are row-disjoint or commutative — attest with access.orderIndependent on every co-writer).';

// A 10 × 10 world-unit object whose kind reaches 2 past it: the pad is 2 (its reach, rounded up) + 16 a side, so the view is
// 46 × 46 CSS px and the still 92 × 92 device px at dpr 2; its box is device px [36, 56), its reach [32, 60).
const FRAME = stillFrame({ w: 10, h: 10 }, 2);
const W = 92;

const mat = (): StillPixels => {
  const rgba = new Uint8Array(W * W * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([40, 90, 50, 255], i);
  return { width: W, height: W, rgba };
};
/** The mat with `px` painted white. */
const paint = (s: StillPixels, px: readonly (readonly [number, number])[]): StillPixels => {
  const rgba = s.rgba.slice();
  for (const [x, y] of px) rgba.set([255, 255, 255, 255], (y * W + x) * 4);
  return { width: s.width, height: s.height, rgba };
};
/** A square of its box drawn: device px [38, 54). */
const drawn = (): StillPixels => {
  const px: [number, number][] = [];
  for (let y = 38; y < 54; y += 1) for (let x = 38; x < 54; x += 1) px.push([x, y]);
  return paint(mat(), px);
};

const NO_GOLDEN: GoldenRead = { ok: true, golden: undefined };
const judge = (
  over: Partial<Parameters<typeof judgeStill>[0]> & { a?: StillPixels; frame?: StillFrame } = {},
) => {
  const a = over.a ?? drawn();
  return judgeStill({
    plugin: "vendor.demo",
    type: "vendor.demo.disc",
    state: "default",
    theme: "day",
    frame: FRAME,
    a,
    b: over.b ?? a,
    bare: over.bare ?? mat(),
    golden: over.golden ?? NO_GOLDEN,
    bless: over.bless ?? false,
    host: over.host ?? "Test GPU (test arch) · test-host · webgpu 0.4.0",
  });
};

const dirs: string[] = [];
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), "dk-11-still-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the still's frame — one object, its reach and a pad of bare mat each side", () => {
  it("puts the object's top-left so the still's centred camera lays it in the middle, its box and reach in device px", () => {
    expect(FRAME).toEqual({
      size: { width: 46, height: 46 },
      at: { x: -5, y: -5 },
      box: { x0: 36, y0: 36, x1: 56, y1: 56 },
      reach: { x0: 32, y0: 32, x1: 60, y1: 60 },
    });
    // a fractional reach pads by its ceiling; a negative or non-finite one is no reach
    expect(stillFrame({ w: 150, h: 150 }, 41.5).size).toEqual({
      width: 150 + 2 * 58,
      height: 150 + 2 * 58,
    });
    expect(stillFrame({ w: 10, h: 20 }, Number.NaN).reach).toEqual(
      stillFrame({ w: 10, h: 20 }, 0).box,
    );
  });
});

describe("the judge — steady, drawn, inside its reach, held to its golden", () => {
  it("passes a still drawn in its box, steady and inside its reach — a note while no golden holds it", () => {
    const m = measureStill(drawn(), drawn(), mat(), FRAME);
    expect(m).toMatchObject({ unsteady: 0, box: 400, drawn: 256, past: 0 });
    const { verdict } = judge();
    expect(verdict).toMatchObject({
      kind: "still",
      status: "note",
      code: "still-unblessed",
      width: W,
      height: W,
    });
    expect(verdict.detail).toContain("64.0 % of its box off the bare mat");
    expect(verdict.expected).toContain("--still --bless");
  });

  it("refuses a still whose two draws differ — still-unsteady", () => {
    const { verdict } = judge({ b: paint(drawn(), [[0, 0]]) });
    expect(verdict).toMatchObject({ status: "refused", code: "still-unsteady" });
    expect(verdict.detail).toContain("1 px differ");
  });

  it("refuses a kind that compiled and drew nothing in its box — still-blank", () => {
    const { verdict } = judge({ a: mat() });
    expect(verdict).toMatchObject({ status: "refused", code: "still-blank" });
  });

  it("refuses a pixel moved past its reach — still-past-reach — and lets one device px of antialiasing at its edge go", () => {
    // device px 60 lies on the reach's edge band (its centre 60.5 < 61): allowed; 62 is past it
    expect(judge({ a: paint(drawn(), [[60, 46]]) }).verdict.code).toBe("still-unblessed");
    const { verdict } = judge({ a: paint(drawn(), [[62, 46]]) });
    expect(verdict).toMatchObject({ status: "refused", code: "still-past-reach" });
    expect(verdict.detail).toContain("1 px moved past its reach");
  });

  it("holds a still to its golden — and refuses other bytes, naming the host that blessed it and this one", () => {
    const sha256 = stillSha(drawn());
    const golden = (
      sha: string,
      host = "Test GPU (test arch) · test-host · webgpu 0.4.0",
    ): GoldenRead => ({
      ok: true,
      golden: {
        host,
        stills: {
          [stillKey("vendor.demo.disc", "default", "day")]: { width: W, height: W, sha256: sha },
        },
      },
    });
    expect(judge({ golden: golden(sha256) }).verdict).toMatchObject({ status: "pass", code: "ok" });
    const other = judge({
      golden: golden("0".repeat(64), "Another GPU · other-host · webgpu 0.4.0"),
    }).verdict;
    expect(other).toMatchObject({ status: "refused", code: "still-golden-mismatch" });
    expect(other.detail).toContain(
      "blessed on Another GPU · other-host · webgpu 0.4.0; this is Test GPU",
    );
    // a golden that holds other stills but not this one: still a note
    expect(judge({ golden: { ok: true, golden: { host: "h", stills: {} } } }).verdict.code).toBe(
      "still-unblessed",
    );
    // a golden that is not one
    expect(
      judge({ golden: { ok: false, detail: "test/still.golden.json does not parse: x" } }).verdict,
    ).toMatchObject({
      status: "refused",
      code: "still-golden-invalid",
    });
  });

  it("blesses only a still that passed every other check, and hands back the row a bless writes", () => {
    const blessed = judge({ bless: true });
    expect(blessed.verdict).toMatchObject({ status: "pass", code: "ok" });
    expect(blessed.verdict.detail).toContain("BLESSED");
    expect(blessed.bless).toEqual({ width: W, height: W, sha256: stillSha(drawn()) });
    expect(judge({ bless: true, a: mat() }).bless).toBeUndefined();
  });
});

describe("the golden file", () => {
  it("reads absent as no golden yet, and says what is wrong with one that is not a golden", () => {
    const root = tempDir();
    expect(readGolden(root)).toEqual({ ok: true, golden: undefined });
    mkdirSync(join(root, "test"));
    const file = join(root, STILL_GOLDEN);
    writeFileSync(file, "{");
    expect(readGolden(root)).toMatchObject({ ok: false });
    writeFileSync(file, JSON.stringify({ stills: {} }));
    expect(readGolden(root)).toEqual({
      ok: false,
      detail: `${STILL_GOLDEN} names no "host" (the host that blessed it)`,
    });
    writeFileSync(
      file,
      JSON.stringify({ host: "h", stills: { a: { width: 1, height: 1, sha256: "nope" } } }),
    );
    expect(readGolden(root)).toMatchObject({
      ok: false,
      detail: expect.stringContaining("› a is not"),
    });
    const golden = {
      host: "h",
      stills: { "t:s:day": { width: 2, height: 3, sha256: "a".repeat(64) } },
    };
    writeFileSync(file, goldenText(golden));
    expect(readGolden(root)).toEqual({ ok: true, golden });
  });

  it("writes its stills sorted, so a re-bless diffs as the stills that moved", () => {
    const row = { width: 1, height: 1, sha256: "b".repeat(64) };
    const text = goldenText({
      host: "h",
      stills: { "z:s:day": row, "a:s:night": row, "a:s:day": row },
    });
    expect(Object.keys((JSON.parse(text) as { stills: object }).stills)).toEqual([
      "a:s:day",
      "a:s:night",
      "z:s:day",
    ]);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("blesses a whole run as exactly what it drew; a --state run merges into this host's golden only", () => {
    const row = (c: string) => ({ width: 1, height: 1, sha256: c.repeat(64) });
    const previous: GoldenRead = {
      ok: true,
      golden: { host: "here", stills: { "t:a:day": row("1"), "t:b:day": row("2") } },
    };
    expect(blessedGolden(previous, "here", { "t:a:day": row("3") }, false)).toEqual({
      host: "here",
      stills: { "t:a:day": row("3") },
    });
    expect(blessedGolden(previous, "here", { "t:a:day": row("3") }, true)).toEqual({
      host: "here",
      stills: { "t:a:day": row("3"), "t:b:day": row("2") },
    });
    // another host's golden is never merged into: a golden is one host's bytes
    expect(blessedGolden(previous, "there", { "t:a:day": row("3") }, true)).toEqual({
      host: "there",
      stills: { "t:a:day": row("3") },
    });
  });

  it("draws the harness's fixtures: an authored state's props, the declared defaults for the synthesized default", () => {
    const row = {
      type: "vendor.demo.disc",
      props: { color: { kind: "string", default: "#e4c46a" } },
    } as unknown as Parameters<typeof stillFixtures>[0];
    expect(stillFixtures(row, ["default"], undefined)).toEqual({ default: { color: "#e4c46a" } });
    expect(stillFixtures(row, ["coral"], { coral: { color: "#e8765c" }, other: {} })).toEqual({
      coral: { color: "#e8765c" },
    });
  });
});

describe("the PNG and what a still hears", () => {
  it("writes an 8-bit RGBA PNG whose rows are the still's", () => {
    const s = paint(mat(), [[3, 4]]);
    const png = stillPng(s);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([W, W]);
    const idatAt = png.indexOf(Buffer.from("IDAT", "latin1"));
    const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + png.readUInt32BE(idatAt - 4)));
    const stride = W * 4 + 1;
    expect([...raw.subarray(4 * stride + 1 + 3 * 4, 4 * stride + 1 + 4 * 4)]).toEqual([
      255, 255, 255, 255,
    ]);
  });

  it("names ICE core's Tray line as core's, counts each line, keeps what else is said — and gives the console back", async () => {
    expect(CORE_TRAY_LINE.test(TRAY)).toBe(true);
    const warn = console.warn;
    const heard = await hearing(async () => {
      console.warn(TRAY);
      console.warn(TRAY);
      console.error("a kind's own complaint");
      return 7;
    });
    expect(heard).toEqual({
      value: 7,
      said: [
        { by: "ice-core", line: TRAY, times: 2 },
        { by: "unattributed", line: "a kind's own complaint", times: 1 },
      ],
    });
    expect(console.warn).toBe(warn);
    const threw = await hearing(async () => {
      console.warn(TRAY);
      throw new Error("createStill: the kind was refused");
    });
    expect(threw).toMatchObject({ error: expect.any(Error), said: [{ by: "ice-core", times: 1 }] });
    expect(console.warn).toBe(warn);
  });
});

describe("the flags and the rows", () => {
  it("takes --still and --bless, and refuses --bless alone: a golden is written only from stills drawn in that run", () => {
    expect(parseArgs(["p", "--still"])).toMatchObject({
      pluginDir: "p",
      still: true,
      bless: false,
    });
    expect(parseArgs(["p", "--still", "--bless"])).toMatchObject({ still: true, bless: true });
    expect(parseArgs(["p", "--bless"]).error).toBe(
      "--bless writes the still's golden: add --still",
    );
  });

  it("says a still's row with its state and light, its PNG and core's line named beneath it; the summary counts the stills", () => {
    const still: StillVerdict = {
      kind: "still",
      plugin: "vendor.demo",
      type: "vendor.demo.disc",
      state: "coral",
      theme: "night",
      status: "pass",
      code: "ok",
      detail: "drawn on Dawn, its WGSL compiled — held to its golden",
      width: W,
      height: W,
      sha256: "c".repeat(64),
      png: "/tmp/p/.vibefield-still/vendor.demo.disc--coral--night.png",
      said: [{ by: "ice-core", line: TRAY, times: 3 }],
    };
    const result: RunResult = {
      verdicts: [still],
      summary: {
        kind: "summary",
        plugin: "vendor.demo",
        objects: 1,
        states: 0,
        passed: 1,
        skipped: 0,
        refused: 0,
        stills: 1,
        exit: 0,
      },
    };
    const table = toTable(result);
    expect(table).toContain("STILL  disc    coral · night  drawn on Dawn");
    expect(table).toContain("still: /tmp/p/.vibefield-still/vendor.demo.disc--coral--night.png");
    expect(table).toContain("said ×3 by ICE CORE, not this kind");
    expect(table).toContain("(0 states, 1 object, 1 still)");
    const lines = toNdjson(result)
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { kind: string });
    expect(lines.map((l) => l.kind)).toEqual(["still", "summary"]);
    expect(lines[0]).toEqual(still);
  });
});
