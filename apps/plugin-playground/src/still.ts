// THE STILL (DK-11; ICE petition I30, `createStill`, asked at DK-7): `plugin-playground <dir> --still` draws every object
// kind a plugin contributes ON DAWN — Node's WebGPU, the `webgpu` package, a devDependency of THIS CLI and of nothing else —
// with no window and no app. For each state the kind harness drove (`playground/states.ts`, or `default` from the declared
// props), ONE object of the kind on a bare mat, by day and by night, through `createStill` (`@vibecook/ice/desk`) on the
// object TYPE the product builds from the row and the export (field-app's `buildObjectType`), under the palette the product
// mounts its desk with (`productPalette`). It does what the harness cannot: the kind's WGSL is COMPILED on a real device (a
// WGSL error comes back as the compiler's own line, `still-failed`), and its pixels are judged —
//   - DRAWN: some of its box is off the bare mat (`still-blank` when none is: a kind that compiles and draws nothing);
//   - INSIDE ITS REACH: nothing past `kind.reach` moved (`still-past-reach` — the desk culls and pads an object by its reach);
//   - STEADY: drawn twice, the same bytes (`still-unsteady` — a look that reads a wall clock or a random);
//   - HELD to the plugin's golden, `test/still.golden.json` — each still's size and the sha-256 of its RGBA, blessed ONCE by
//     the named flag (`--still --bless`, a deliberate event said in its commit). No golden yet is a note (`still-unblessed`);
//     different bytes are a refusal (`still-golden-mismatch`). A golden is Dawn's bytes on the HOST that blessed it — its GPU,
//     its driver and OS, this CLI's Dawn — so the file records that host and another host is expected to differ: re-bless
//     there locally, and never commit a second host's golden over the first.
// Each still's PNG lands in `<dir>/.vibefield-still/` for a reader's eye (never a source; ignored in this repository).
//
// A still lends the kinds the DESK'S HAND (DK-17b; ICE I35, `createStill({ services })`): the product's text raster under
// `TEXT_RASTER` (text-raster.ts — the shipped faces on a Node canvas) — and, for a plugin that authors the faces its stills
// show (PT-2, live-stills.ts), ICE's `stillLive` over them under `LIVE` — and a kind that READS either is drawn with its desk state,
// its `local` — its writing, as the product draws it (the comment pad's comments). A kind that reads no lent service is drawn
// again without it, as a still always was — ICE's facts and pins alone (a clock shows its shop time): a desk state that reads
// the wall clock (the desk clock's) would otherwise put the hour the still was taken into its golden. The row says what a kind
// read (`lent`). No chrome. Whatever is said on the console while a still is drawn is listed under its row (`said`, each line
// counted) — under strata's DEV build (vitest; `node --conditions=development`) too, where ICE says nothing of its own since
// desk.5 (I34: core's `trayInput` and `trayLay` share their `Tray` write in a stated order, and strata's access check said
// their line at every engine a still made until then).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { WidgetType } from "@vibecook/ice";
import {
  createStill,
  service,
  stillLive,
  TEXT_RASTER,
  type TextRaster,
  type ThemeName,
} from "@vibecook/ice/desk";
import { LIVE, type LiveSources } from "@vibecook/ice/desk/kit";
import type { ObjectContribution } from "@vibefield/contracts";
import { buildObjectType } from "@vibefield/field-app/object-types";
import type { ObjectBinding } from "@vibefield/plugin-sdk";
import { defaultProps, kindOfBinding, productPalette } from "@vibefield/plugin-sdk/testing";
import type { LiveStills } from "./live-stills";
import {
  messageOf,
  type StillCode,
  type StillSaid,
  type StillTheme,
  type StillVerdict,
} from "./verdict";

/** The plugin's golden, relative to its root. */
export const STILL_GOLDEN = "test/still.golden.json";
/** Where each still's PNG is written, relative to the plugin's root. */
export const STILL_SHOTS = ".vibefield-still";
/** Device px per CSS px — ICE's own stills' ratio. */
export const STILL_DPR = 2;
/** CSS px of bare mat round an object past its reach, each side. */
export const STILL_PAD = 16;
/** A pixel MOVED when a colour channel is more than this off (ICE I29's word for a kind's pixels). */
export const STILL_MOVED = 8;
/** The two lights a still is drawn in, as the row names them and as ICE's theme does. */
export const STILL_THEMES: readonly { readonly name: StillTheme; readonly theme: ThemeName }[] = [
  { name: "day", theme: "light" },
  { name: "night", theme: "dark" },
];

// ---------------------------------------------------------------------------------------------------- the device

/** Dawn's device for a run's stills, and the host a golden blessed on it records. */
export interface StillGpu {
  readonly device: GPUDevice;
  /** the adapter, the platform and this CLI's Dawn — what a golden's bytes belong to */
  readonly host: string;
  destroy(): void;
}

/** This CLI's Dawn: the `webgpu` package's version, read off its manifest. */
function dawnVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const manifest = JSON.parse(readFileSync(require.resolve("webgpu/package.json"), "utf8")) as {
      readonly version?: unknown;
    };
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** Dawn's device (`webgpu`, loaded only when `--still` asks — a run without it never touches the native module). Throws when
 * this host has no adapter: the caller's harness error, never a plugin's refusal. */
export async function stillGpu(): Promise<StillGpu> {
  const { create, globals } = await import("webgpu");
  // GPUBufferUsage, GPUTextureUsage, GPUShaderStage, … — what a browser has for free and a kind's pass names
  Object.assign(globalThis, globals);
  const { acquire } = await import("@vibecook/ice/desk/engine");
  const gpu = await acquire({ gpu: create([]), label: "plugin-playground still" });
  const { description, vendor, architecture } = gpu.info;
  return {
    device: gpu.device,
    host: `${description || vendor} (${vendor} ${architecture}) · ${process.platform}-${process.arch} · webgpu ${dawnVersion()}`,
    destroy: () => gpu.device.destroy(),
  };
}

// ---------------------------------------------------------------------------------------------------- the frame

/** A rectangle of device px, x0/y0 inclusive, x1/y1 exclusive. */
export interface PxRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One object's still: the view round it, where it lies, its box and its reach in the still's device px. */
export interface StillFrame {
  /** the view, CSS px: the object, its reach and the pad each side */
  readonly size: { readonly width: number; readonly height: number };
  /** the object's TOP-LEFT, world units (the still's camera puts the world's origin at its centre, zoom 1) */
  readonly at: { readonly x: number; readonly y: number };
  /** the object's box */
  readonly box: PxRect;
  /** its box grown by its reach — nothing past it may move */
  readonly reach: PxRect;
}

/** The frame round one object of `size` (world units) whose kind reaches `reach` past its rect. */
export function stillFrame(
  size: { readonly w: number; readonly h: number },
  reach: number,
  dpr: number = STILL_DPR,
): StillFrame {
  const r = Math.max(0, Number.isFinite(reach) ? reach : 0);
  const pad = Math.ceil(r) + STILL_PAD;
  return {
    size: { width: size.w + 2 * pad, height: size.h + 2 * pad },
    at: { x: -size.w / 2, y: -size.h / 2 },
    box: { x0: pad * dpr, y0: pad * dpr, x1: (pad + size.w) * dpr, y1: (pad + size.h) * dpr },
    reach: {
      x0: (pad - r) * dpr,
      y0: (pad - r) * dpr,
      x1: (pad + size.w + r) * dpr,
      y1: (pad + size.h + r) * dpr,
    },
  };
}

// ---------------------------------------------------------------------------------------------------- the judge

/** A still's pixels: RGBA rows, top-down, tight (ICE's `Still`). */
export interface StillPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/** What the pixels say, before any golden. */
export interface StillMeasure {
  /** pixels that differ between the two draws of one state */
  readonly unsteady: number;
  /** pixels in the object's box, and how many moved off the bare mat */
  readonly box: number;
  readonly drawn: number;
  /** pixels past its reach (beyond one device px of antialiasing), and how many moved off the bare mat */
  readonly beyond: number;
  readonly past: number;
}

const channelsDiffer = (a: Uint8Array, b: Uint8Array, i: number, by: number): boolean =>
  Math.abs((a[i] as number) - (b[i] as number)) > by ||
  Math.abs((a[i + 1] as number) - (b[i + 1] as number)) > by ||
  Math.abs((a[i + 2] as number) - (b[i + 2] as number)) > by;

const sameSize = (a: StillPixels, b: StillPixels): boolean =>
  a.width === b.width && a.height === b.height && a.rgba.length === b.rgba.length;

/** Measure one state's still: `a` and `b` are its two draws, `bare` the mat alone in the same frame. */
export function measureStill(
  a: StillPixels,
  b: StillPixels,
  bare: StillPixels,
  frame: StillFrame,
): StillMeasure {
  let unsteady = 0;
  let box = 0;
  let drawn = 0;
  let beyond = 0;
  let past = 0;
  const steadyComparable = sameSize(a, b);
  const bareComparable = sameSize(a, bare);
  for (let y = 0; y < a.height; y += 1) {
    const cy = y + 0.5;
    for (let x = 0; x < a.width; x += 1) {
      const cx = x + 0.5;
      const i = (y * a.width + x) * 4;
      if (
        steadyComparable &&
        (a.rgba[i] !== b.rgba[i] ||
          a.rgba[i + 1] !== b.rgba[i + 1] ||
          a.rgba[i + 2] !== b.rgba[i + 2] ||
          a.rgba[i + 3] !== b.rgba[i + 3])
      )
        unsteady += 1;
      if (!bareComparable) continue;
      const moved = channelsDiffer(a.rgba, bare.rgba, i, STILL_MOVED);
      if (cx >= frame.box.x0 && cx < frame.box.x1 && cy >= frame.box.y0 && cy < frame.box.y1) {
        box += 1;
        if (moved) drawn += 1;
      }
      if (
        cx < frame.reach.x0 - 1 ||
        cx >= frame.reach.x1 + 1 ||
        cy < frame.reach.y0 - 1 ||
        cy >= frame.reach.y1 + 1
      ) {
        beyond += 1;
        if (moved) past += 1;
      }
    }
  }
  if (!steadyComparable) unsteady = a.width * a.height;
  return { unsteady, box, drawn, beyond, past };
}

const percent = (n: number, of: number): string =>
  of === 0 ? "0 %" : `${((100 * n) / of).toFixed(1)} %`;

/** The sha-256 of a still's RGBA — what a golden holds. */
export const stillSha = (s: StillPixels): string =>
  createHash("sha256").update(s.rgba).digest("hex");

// ---------------------------------------------------------------------------------------------------- the golden

/** One still in a golden: its size, device px, and the sha-256 of its RGBA. */
export interface GoldenRow {
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

/** A plugin's golden: the host that blessed it, and its stills by key (`<type>:<state>:<day|night>`). */
export interface StillGolden {
  readonly host: string;
  readonly stills: Readonly<Record<string, GoldenRow>>;
}

/** A still's key in the golden. */
export const stillKey = (type: string, state: string, theme: StillTheme): string =>
  `${type}:${state}:${theme}`;

export type GoldenRead =
  | { readonly ok: true; readonly golden: StillGolden | undefined }
  | { readonly ok: false; readonly detail: string };

const isRow = (v: unknown): v is GoldenRow =>
  typeof v === "object" &&
  v !== null &&
  Number.isInteger((v as GoldenRow).width) &&
  (v as GoldenRow).width > 0 &&
  Number.isInteger((v as GoldenRow).height) &&
  (v as GoldenRow).height > 0 &&
  typeof (v as GoldenRow).sha256 === "string" &&
  /^[0-9a-f]{64}$/.test((v as GoldenRow).sha256);

/** Read `<root>/test/still.golden.json`: absent is no golden yet; a file that is not one says why. */
export function readGolden(root: string): GoldenRead {
  const file = join(root, STILL_GOLDEN);
  if (!existsSync(file)) return { ok: true, golden: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { ok: false, detail: `${STILL_GOLDEN} does not parse: ${messageOf(error)}` };
  }
  const shape = parsed as { readonly host?: unknown; readonly stills?: unknown };
  if (typeof parsed !== "object" || parsed === null || typeof shape.host !== "string")
    return { ok: false, detail: `${STILL_GOLDEN} names no "host" (the host that blessed it)` };
  if (typeof shape.stills !== "object" || shape.stills === null || Array.isArray(shape.stills))
    return { ok: false, detail: `${STILL_GOLDEN} holds no "stills" record` };
  for (const [key, row] of Object.entries(shape.stills))
    if (!isRow(row))
      return {
        ok: false,
        detail: `${STILL_GOLDEN} › ${key} is not { width, height, sha256 } (positive integers and a sha-256 in hex)`,
      };
  return {
    ok: true,
    golden: { host: shape.host, stills: shape.stills as Record<string, GoldenRow> },
  };
}

/** A golden as its file holds it: keys sorted, two-space JSON, one newline — so a re-bless diffs as the stills that moved. */
export function goldenText(golden: StillGolden): string {
  const stills = Object.fromEntries(
    Object.keys(golden.stills)
      .sort()
      .map((key) => [key, golden.stills[key] as GoldenRow]),
  );
  return `${JSON.stringify({ host: golden.host, stills }, null, 2)}\n`;
}

/**
 * The golden a bless writes: this run's stills under this run's host. A `--state` run (`filtered`) MERGES — the rows it drew
 * replaced, the rest kept — but only into a golden THIS host blessed (a golden is one host's bytes); a whole run writes
 * exactly the stills it drew and passed, so a state or a kind that is gone leaves the golden with it.
 */
export function blessedGolden(
  previous: GoldenRead,
  host: string,
  drawn: Readonly<Record<string, GoldenRow>>,
  filtered: boolean,
): StillGolden {
  const kept =
    filtered && previous.ok && previous.golden?.host === host ? previous.golden.stills : {};
  return { host, stills: { ...kept, ...drawn } };
}

// ---------------------------------------------------------------------------------------------------- the verdict

/** Everything one state's still is judged on. */
export interface StillJudged {
  readonly plugin: string;
  readonly type: string;
  readonly state: string;
  readonly theme: StillTheme;
  /** the host services the kind READ, drawn with its desk state (ICE I35) — none: drawn with its facts and pins alone */
  readonly lent?: readonly string[] | undefined;
  readonly frame: StillFrame;
  readonly a: StillPixels;
  readonly b: StillPixels;
  readonly bare: StillPixels;
  readonly golden: GoldenRead;
  readonly bless: boolean;
  /** the host this run draws on (`StillGpu.host`) */
  readonly host: string;
  readonly png?: string | undefined;
  readonly said?: readonly StillSaid[] | undefined;
}

const BLESS_EXPECTED =
  "the golden's bytes — look at the still's PNG; a deliberate change re-blesses with `--still --bless`, said in its commit. A golden is Dawn's bytes on the host that blessed it: on another host re-bless locally and never commit it over the first";

/** One state's still, judged: its verdict, and the row a bless writes (a still that passed every other check). */
export function judgeStill(input: StillJudged): {
  readonly verdict: StillVerdict;
  readonly bless?: GoldenRow;
} {
  const { a, frame } = input;
  const m = measureStill(a, input.b, input.bare, frame);
  const sha256 = stillSha(a);
  const row: GoldenRow = { width: a.width, height: a.height, sha256 };
  const base = {
    kind: "still" as const,
    plugin: input.plugin,
    type: input.type,
    state: input.state,
    theme: input.theme,
    width: a.width,
    height: a.height,
    sha256,
    ...(input.lent !== undefined && input.lent.length > 0 ? { lent: input.lent } : {}),
    ...(input.png !== undefined ? { png: input.png } : {}),
    ...(input.said !== undefined && input.said.length > 0 ? { said: input.said } : {}),
  };
  const refused = (
    code: StillCode,
    detail: string,
    expected: string,
  ): { verdict: StillVerdict } => ({
    verdict: { ...base, status: "refused", code, detail, expected },
  });
  const pixels = `${percent(m.drawn, m.box)} of its box off the bare mat`;
  if (m.unsteady > 0)
    return refused(
      "still-unsteady",
      `drawn twice, ${m.unsteady} px differ (${percent(m.unsteady, a.width * a.height)} of the still)`,
      "the same bytes every time — a still pins its facts: read the time and anything random from `ctx` (an asset the host pins), never from the wall clock",
    );
  if (m.drawn === 0)
    return refused(
      "still-blank",
      `nothing of it was drawn: its box (${m.box} px) is the bare mat's, its WGSL compiled`,
      "some of its box drawn — check its pass's draw call, its vertex positions (the slot's view block: `u.cam`, `u.view`, `mat_zoom`) and its fragment's alpha",
    );
  if (m.past > 0)
    return refused(
      "still-past-reach",
      `${m.past} px moved past its reach (${pixels}) — the desk culls and pads it by its reach, so what lies past it is cut at a view's edge`,
      "every pixel it draws within its rect grown by its `reach` (world units) — draw less, or declare the reach it needs",
    );
  const drawnDetail = `drawn on Dawn, its WGSL compiled: ${a.width} × ${a.height} px, ${pixels}, nothing past its reach, the same bytes twice`;
  if (input.bless) {
    return {
      verdict: {
        ...base,
        status: "pass",
        code: "ok",
        detail: `${drawnDetail} — BLESSED into ${STILL_GOLDEN}`,
      },
      bless: row,
    };
  }
  if (!input.golden.ok)
    return refused(
      "still-golden-invalid",
      input.golden.detail,
      `a golden written by \`--still --bless\``,
    );
  const golden = input.golden.golden;
  const held = golden?.stills[stillKey(input.type, input.state, input.theme)];
  if (golden === undefined || held === undefined)
    return {
      verdict: {
        ...base,
        status: "note",
        code: "still-unblessed",
        detail: `${drawnDetail} — no golden yet${golden === undefined ? ` (${STILL_GOLDEN} is absent)` : ""}`,
        expected:
          "a golden blessed ONCE on your machine: `plugin-playground <dir> --still --bless` writes test/still.golden.json (a golden is Dawn's bytes on the host that blessed it)",
      },
    };
  if (held.sha256 !== sha256 || held.width !== a.width || held.height !== a.height)
    return refused(
      "still-golden-mismatch",
      `its bytes are not its golden's: ${sha256.slice(0, 12)}… (${a.width} × ${a.height}), the golden's ${held.sha256.slice(0, 12)}… (${held.width} × ${held.height}) — blessed on ${golden.host}${golden.host === input.host ? "" : `; this is ${input.host}`}`,
      BLESS_EXPECTED,
    );
  return {
    verdict: { ...base, status: "pass", code: "ok", detail: `${drawnDetail} — held to its golden` },
  };
}

// ---------------------------------------------------------------------------------------------------- the PNG

/** A still as a PNG (8-bit RGBA, rows unfiltered, Node's own zlib and CRC-32) — for a reader's eye. */
export function stillPng(s: StillPixels): Buffer {
  const stride = s.width * 4 + 1;
  const raw = Buffer.alloc(stride * s.height);
  for (let y = 0; y < s.height; y += 1)
    raw.set(s.rgba.subarray(y * s.width * 4, (y + 1) * s.width * 4), y * stride + 1);
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s.width, 0);
  ihdr.writeUInt32BE(s.height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A file name's part from a type or a state: what a path may carry, nothing else. */
const fileSafe = (s: string): string => s.replaceAll(/[^A-Za-z0-9._-]+/g, "_");

// ---------------------------------------------------------------------------------------------------- what is said

/** Run `work` hearing what it says on the console's warn and error lines, each line counted. The playground draws one still
 * at a time, so nothing else speaks meanwhile. */
export async function hearing<T>(
  work: () => Promise<T>,
): Promise<{ readonly said: StillSaid[] } & ({ readonly value: T } | { readonly error: unknown })> {
  const heard = new Map<string, number>();
  const levels = ["warn", "error"] as const;
  const kept = levels.map((level) => console[level]);
  for (const level of levels)
    console[level] = (...args: unknown[]) => {
      const line = args.map((x) => (x instanceof Error ? x.message : String(x))).join(" ");
      heard.set(line, (heard.get(line) ?? 0) + 1);
    };
  const said = (): StillSaid[] => [...heard].map(([line, times]) => ({ line, times }));
  try {
    const value = await work();
    return { said: said(), value };
  } catch (error) {
    return { said: said(), error };
  } finally {
    levels.forEach((level, i) => {
      console[level] = kept[i] as (typeof console)[typeof level];
    });
  }
}

// ---------------------------------------------------------------------------------------------------- the hand, lent

/** A lent text raster that counts what is asked of it — whether a kind READ the desk's hand while a still was drawn. */
export interface CountedRaster {
  readonly raster: TextRaster;
  /** asks since the last reset: a face's metrics, the version, a raster */
  count(): number;
  reset(): void;
}

export function countReads(raster: TextRaster): CountedRaster {
  let asked = 0;
  return {
    raster: {
      metrics(face) {
        asked += 1;
        return raster.metrics(face);
      },
      version() {
        asked += 1;
        return raster.version();
      },
      raster(layout, face, box, band, bleed) {
        asked += 1;
        return raster.raster(layout, face, box, band, bleed);
      },
    },
    count: () => asked,
    reset() {
      asked = 0;
    },
  };
}

/**
 * THE HAND LENT WHERE IT IS READ (ICE I35): a still drawn with the services lent (`draw(true)`) — and, when its kind read
 * none of them, disposed and drawn again without (`draw(false)`), as a still always was. Answers the still kept and whether
 * it was drawn with its desk state.
 */
export async function drawWhereRead<S extends { dispose(): void }>(
  draw: (lent: boolean) => Promise<S>,
  reads: Pick<CountedRaster, "count" | "reset">,
): Promise<{ readonly still: S; readonly lent: boolean }> {
  reads.reset();
  const withHand = await draw(true);
  if (reads.count() > 0) return { still: withHand, lent: true };
  withHand.dispose();
  return { still: await draw(false), lent: false };
}

// ---------------------------------------------------------------------------------------------------- the run

export interface StillRunOptions {
  /** write the golden from this run's stills (`--bless`) */
  readonly bless: boolean;
  readonly gpu: StillGpu;
  /** the desk's hand, lent to the kinds as the product's desk lends it (`TEXT_RASTER`; text-raster.ts) */
  readonly text: TextRaster;
  /** PT-2 — the faces this plugin's stills show (its `playground/live.ts`): lent as `stillLive` under `LIVE` */
  readonly live?: LiveStills;
}

/** `stillLive` over a plugin's faces, counting the faces a kind opens — whether it READ the `LIVE` lent. */
export function countOpens(sources: LiveSources, opened: () => void): LiveSources {
  return {
    open(key, spec, arrived) {
      opened();
      return sources.open(key, spec, arrived);
    },
  };
}

/** One object kind, as the run hands it over after the kind harness judged it. */
export interface StillKindInput {
  readonly row: ObjectContribution;
  /** the export the row's `binding.kind` names */
  readonly binding: unknown;
  /** the fixtures the harness drove, by name — each one's props */
  readonly fixtures: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** the harness's first refusal of the kind, or null — a refused kind is not drawn */
  readonly refusal: string | null;
}

export interface StillRun {
  /** One kind's stills — every fixture by day and by night — or the one row that says why none were drawn. */
  kind(input: StillKindInput): Promise<StillVerdict[]>;
  /** End the run: when blessing, write the golden and say where; otherwise nothing. */
  close(): string | undefined;
}

/** The fixtures a kind's stills are drawn for: what the harness drove, each with its props (an authored state's, or the
 * declared defaults for the synthesized `default`). */
export function stillFixtures(
  row: ObjectContribution,
  driven: readonly string[],
  authored: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
): Record<string, Readonly<Record<string, unknown>>> {
  return Object.fromEntries(
    driven.map((name) => [name, authored?.[name] ?? (name === "default" ? defaultProps(row) : {})]),
  );
}

/** Open a run's stills over the plugin at `root`; `filtered` is a `--state` run (its bless merges: `blessedGolden`). */
export function openStills(
  root: string,
  plugin: string,
  options: StillRunOptions,
  filtered: boolean,
): StillRun {
  const golden = readGolden(root);
  const blessed: Record<string, GoldenRow> = {};
  const shots = join(root, STILL_SHOTS);
  const { gpu } = options;
  /** the desk's hand, lent to every still and counted: a kind that reads it keeps its desk state */
  const hand = countReads(options.text);
  /** the faces a kind opened on the lent `LIVE` since the last reset — a read of the hand as much as a raster asked */
  let opens = 0;
  const reads = {
    count: () => hand.count() + opens,
    reset() {
      hand.reset();
      opens = 0;
    },
  };
  /** what the kind READ of what was lent, by name — asked right after the lent draw, before another adds to the counts */
  const readNames = (): string[] => [
    ...(hand.count() > 0 ? [TEXT_RASTER.name] : []),
    ...(opens > 0 ? [LIVE.name] : []),
  ];

  const notDrawn = (
    type: string,
    code: StillCode,
    detail: string,
    expected: string,
  ): StillVerdict => ({
    kind: "still",
    plugin,
    type,
    state: "—",
    status: code === "still-not-drawn" ? "note" : "refused",
    code,
    detail,
    expected,
  });

  return {
    async kind({ row, binding, fixtures, refusal }) {
      if (refusal !== null)
        return [
          notDrawn(
            row.type,
            "still-not-drawn",
            `its stills are not drawn: the kind harness refused it (${refusal})`,
            "a kind the harness passes — its rows above say what to fix",
          ),
        ];
      const kind = kindOfBinding(binding);
      let type: WidgetType;
      try {
        // the product's own build (§12.8): the durable half from the row, the kind from the export. A still draws the kind,
        // so its behavior riders (sealed code a running host binds) are not attached here.
        type = buildObjectType({ ...row, behaviors: [] }, binding as ObjectBinding);
      } catch (error) {
        return [
          notDrawn(
            row.type,
            "still-failed",
            `its object type could not be built as the host builds it: ${messageOf(error)}`,
            "a row and an export the host builds into an object type (`vibefield-plugin check` says why not)",
          ),
        ];
      }
      const frame = stillFrame(row.size, kind?.reach ?? 0);
      const draw = (
        props: Readonly<Record<string, unknown>> | undefined,
        theme: ThemeName,
        lent: boolean,
      ) =>
        createStill({
          device: gpu.device,
          format: "rgba8unorm",
          size: frame.size,
          dpr: STILL_DPR,
          objects: [type],
          theme,
          palette: productPalette[theme],
          ...(lent
            ? {
                services: [
                  service(TEXT_RASTER, hand.raster),
                  // a fresh source per still: a face opened by one still is never another's
                  ...(options.live === undefined
                    ? []
                    : [
                        service(
                          LIVE,
                          countOpens(stillLive(gpu.device, options.live), () => {
                            opens += 1;
                          }),
                        ),
                      ]),
                ],
              }
            : {}),
          stage: ({ engine }) => {
            if (props === undefined) return; // the bare mat
            engine.ops.spawnWidget(row.type, {
              x: frame.at.x,
              y: frame.at.y,
              w: row.size.w,
              h: row.size.h,
              props: { ...props },
              undoable: false,
            });
          },
        });
      const rows: StillVerdict[] = [];
      for (const { name: themeName, theme } of STILL_THEMES) {
        for (const [state, props] of Object.entries(fixtures)) {
          const heard = await hearing(async () => {
            const { still: a, lent } = await drawWhereRead((l) => draw(props, theme, l), reads);
            const read = lent ? readNames() : [];
            const b = await draw(props, theme, lent);
            const bare = await draw(undefined, theme, lent);
            return { a, b, bare, lent, read };
          });
          if ("error" in heard) {
            rows.push({
              kind: "still",
              plugin,
              type: row.type,
              state,
              theme: themeName,
              status: "refused",
              code: "still-failed",
              detail: `createStill refused it: ${messageOf(heard.error)}`,
              expected:
                "a kind ICE makes on a real device and draws — a WGSL error is the compiler's own line above; a throw is its world half's",
              ...(heard.said.length > 0 ? { said: heard.said } : {}),
            });
            continue;
          }
          const { a, b, bare, read } = heard.value;
          mkdirSync(shots, { recursive: true });
          const png = join(shots, `${fileSafe(row.type)}--${fileSafe(state)}--${themeName}.png`);
          writeFileSync(png, stillPng(a));
          const judged = judgeStill({
            plugin,
            type: row.type,
            state,
            theme: themeName,
            lent: read,
            frame,
            a,
            b,
            bare,
            golden,
            bless: options.bless,
            host: gpu.host,
            png,
            said: heard.said,
          });
          a.dispose();
          b.dispose();
          bare.dispose();
          rows.push(judged.verdict);
          if (judged.bless !== undefined)
            blessed[stillKey(row.type, state, themeName)] = judged.bless;
        }
      }
      return rows;
    },
    close() {
      if (!options.bless) return undefined;
      const file = join(root, STILL_GOLDEN);
      mkdirSync(join(root, "test"), { recursive: true });
      writeFileSync(file, goldenText(blessedGolden(golden, gpu.host, blessed, filtered)));
      return file;
    },
  };
}
