import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentView,
  MonitorPalette,
  MonitorTheme,
  MonitorViewInstance,
} from "@vibefield/puppeteer-view-sdk";
import {
  DEFAULT_RAIN_PARAMETERS,
  normalizeRainParameters,
  RAIN_PARAMETER_GROUPS,
  type RainDrop,
  rainDataString,
  rainMonitorView,
  rainTailLength,
  readMonitorPalette,
  reconcileRainColumns,
} from "@vibefield/puppeteer-views";
import { act } from "react";
import type { PhoneViewGolden, PhoneViewInput, PhoneWindowStep } from "./phone-goldens";

/** The SDK's test-only entry, reached by dynamic `import()`: wall R8 forbids a static import of it from field-app's
 * production sources (perf/lib is one), and names dynamic `import()` as the sanctioned hatch. */
type SdkTesting = typeof import("@vibefield/puppeteer-view-sdk/testing");
const sdkTesting = (): Promise<SdkTesting> => import("@vibefield/puppeteer-view-sdk/testing");

/**
 * PG-8 — THE RAIN VIEW'S GOLDEN: what puppeteer-views' rain says and draws over the window's rows at every step of the
 * witness run, which the phone's rain (`apps/ios/VibeFieldKit/Sources/FieldHome/Godview/Rain/`) is held to through
 * the kit's byte-identical copy (`Tests/FieldHomeTests/Fixtures/phone-rain.golden.json`).
 *
 * Everything is the SHIPPING code, reached through puppeteer-views' ROOT exports (`index.js:21`, `:62-64`):
 * `rainDataString`, `rainTailLength`, `reconcileRainColumns`, the parameters, `readMonitorPalette` and
 * `rainMonitorView`. The view is mounted through its own `mount`, under React's `act`, in happy-dom, as puppeteer's
 * own suite mounts it (`views/rain/RainView.test.tsx:23-58` at `52d09c8e`): a recording 2D context stands in for the
 * canvas happy-dom lacks, the container measures the nominal phone frame, and `Math.random` is mulberry32(1) for the
 * mount alone, so the field it draws is the one the phone draws from the same seed.
 */

/** The phone's rows of cells a tail is measured against: 3 and 20 (a floor and a short stage), 54 (a stage that stops
 * under the Stories row) and 65 (the nominal full-bleed stage below, where an agent's fractional base still wins over
 * the data floor; read-pg8 §6). */
export const RAIN_ROWS = [3, 20, 54, 65] as const;
/** The column counts the streams are placed over, carried across the steps: the 17 Pro's portrait at 12 pt (33), one
 * stream each (16), and fewer columns than rows (8, the later rows unplaced). */
export const RAIN_COLUMNS = [33, 16, 8] as const;
/** The still frame's NOMINAL size: the iPhone 17's full-bleed flow stage, the screen's top to the band's top (PG-4t's
 * stage: 402 × (874 − 93) = 781 points), at dpr 3 — 33 × 65 cells. Fixed, so no inset re-blesses the golden. */
export const RAIN_STILL = { width: 402, height: 781, dpr: 3 } as const;
/** mulberry32's seed for every mount, and how many of its first draws the golden records for the phone's twin. */
export const RAIN_SEED = 1;
const RANDOM_SHOWN = 8;
/** The tokens the rain's palette reads (`monitor/palette.js` :86-112) and the phone's lit stream's (J-S4, DESIGN.md
 * §2.7 "The rain's palette"), as `packages/design-kit/src/tokens.css` declares them. */
export const RAIN_TOKENS = [
  "--vf-card-deep",
  "--vf-godview-rain-green",
  "--vf-godview-rain-green-focus",
  "--vf-godview-rain-waiting",
  "--vf-godview-rain-idle",
  "--vf-godview-rain-working-head",
  "--vf-godview-rain-working-tail",
  "--vf-godview-rain-waiting-head",
  "--vf-godview-rain-waiting-tail",
  "--vf-godview-rain-idle-head",
  "--vf-godview-rain-idle-tail",
  "--vf-godview-rain-hover-tail",
  "--vf-godview-dark-text-main",
] as const;

/** `normalizeRainParameters` over these (a number, or "NaN" / "Infinity" / "-Infinity" for what JSON cannot hold). */
const NORMALIZE_INPUTS: ReadonlyArray<Record<string, number | string>> = [
  {},
  { fontSize: 40, paneTint: -1, refreshRate: 61 },
  { speedMultiplier: 0.05, tailMultiplier: 3.5, scrambleWorking: 1.5 },
  { headGlow: 12.5, scramblePending: 0.25, fontSize: 8 },
  { fontSize: "NaN", refreshRate: "Infinity", headGlow: "-Infinity" },
];

export interface RainRowRecord {
  id: string;
  data: string;
  tails: number[];
}
export interface RainColumnsRecord {
  columns: number;
  /** `[column, agent id, birth]` in the Map's own order, which is the order the draw paints them in */
  streams: Array<[number, string, number]>;
}
export interface RainSpokenRecord {
  label: string;
  current: boolean;
}
/** One paint: the stage's fill, or a glyph with what the context held when it was drawn. */
export type RainOp =
  | { rect: [number, number, number, number]; fill: string }
  | {
      glyph: string;
      x: number;
      y: number;
      fill: string;
      alpha: number;
      blur?: number;
      shadow?: string;
    };
export interface RainStillRecord {
  width: number;
  height: number;
  dpr: number;
  seed: number;
  /** the draws of mulberry32 the rain itself made (`RainView.js` on the stack): its drops' `y`, then `speed`, in
   * placement order — always the sequence's FIRST draws (checked), so the phone replays them from the seed */
  rainDraws: number;
  /** draws other code made during the mount, after the rain's (whose, the golden does not say): not
   * the phone's to replay */
  otherDraws: number;
  /** how many still draws the mount made, every one identical to the ops recorded */
  draws: number;
  font: string;
  textAlign: string;
}
export interface RainStep {
  at: PhoneWindowStep["at"];
  frame?: PhoneWindowStep["frame"];
  gap?: true;
  rows?: RainRowRecord[];
  columns?: RainColumnsRecord[];
  spoken?: RainSpokenRecord[];
  tokens?: Record<string, string>;
  palette?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  normalize?: Array<{ in: Record<string, number | string>; out: Record<string, number> }>;
  random?: { seed: number; first: number[] };
  still?: RainStillRecord;
  ops?: RainOp[];
}

const NOTE =
  "PG-8 — the phone's rain view golden: puppeteer-views' rain (the shipping code through its root exports) over the window's drawn rows of phone-fold.golden.json at every step. Per step: rows in window order {id, data (rainDataString), tails (rainTailLength at the rows [3, 20, 54, 65], multiplier 1)}; columns ({columns, streams: [column, agent id, birth]} for 33, 16 and 8 columns, reconcileRainColumns carried across the steps with a counter createDrop: birth = the drop's creation index, speed 0.5; the Map's order is the draw's order); spoken (the view's own accessible buttons, mounted: label and aria-current). At the open only: tokens (tokens.css's values for the rain's twelve and the dark text main, the phone's lit stream, J-S4), palette (readMonitorPalette over those tokens: rain.* and text.primary), parameters (DEFAULT_RAIN_PARAMETERS and the eight ranges) and normalize (normalizeRainParameters over a vector; NaN and ±Infinity tagged as strings), random (mulberry32's first draws from the seed), and the still frame: the view mounted with animations off at the NOMINAL full-bleed 402 x 781 at dpr 3 (33 x 65 cells; PG-4t's stage), Math.random = mulberry32(1) for the mount, its canvas a recording 2D context as puppeteer's own RainView.test mounts it; still records the size, the seed, the draws the rain made (always the sequence's first: its drops' y then speed, in placement order) and those other code made during the mount, how many still draws the mount made (all identical) and the font and alignment, and ops the last draw's paints in order (the stage's fill, then every glyph: x, y, its fill as drawn, globalAlpha, and a head's shadowBlur and shadowColor). Not here: a moving frame (random everywhere, the stills are by eye), the pane wash (the phone mounts no panes), the tooltip (the phone's is James's, unpicked). GENERATED by packages/field-app/perf/phone-goldens.generate.perf.ts (pnpm --filter @vibefield/field-app phone:goldens); pinned byte for byte by packages/field-app/test/phone-parity.test.ts; the kit's copy by pnpm check:ios-fixtures, the phone's rain held to it by FieldHomeTests' RainParityTests. A puppeteer EL8 moves it: regenerate and copy to the kit in the same commit. Never edit by hand; a regeneration is a re-bless, said in its commit, and never over a defect.";

/** mulberry32: a 32-bit seeded generator, the still's `Math.random` (its twin is `RainRandom.Mulberry32`). */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** tokens.css's own declaration of each token, its first. */
function tokenValues(): Record<string, string> {
  const css = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "design-kit", "src", "tokens.css"),
    "utf8",
  );
  const values: Record<string, string> = {};
  for (const name of RAIN_TOKENS) {
    const value = css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))?.[1]?.trim();
    if (value === undefined) throw new Error(`tokens.css declares no ${name}`);
    values[name] = value;
  }
  return values;
}

/** The palette the desktop's host hands the rain: the SHIPPING reader over the document's tokens, set for the read. */
function paletteOver(tokens: Record<string, string>): MonitorPalette {
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(tokens)) style.setProperty(name, value);
  try {
    return readMonitorPalette();
  } finally {
    for (const name of Object.keys(tokens)) style.removeProperty(name);
  }
}

function untag(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

/** A 2D context that records, as puppeteer's own rain test does; each still draw starts at the stage's fill. */
function recorder(draws: RainOp[][], seen: { font: Set<string>; align: Set<string> }) {
  const state: Record<string, unknown> = {
    fillStyle: "",
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: "",
    font: "",
    textAlign: "",
  };
  return new Proxy(state, {
    get(target, key) {
      if (key === "fillRect")
        return (x: number, y: number, w: number, h: number) => {
          // a draw starts at the stage's fill, the whole frame (RainView.js:116-117)
          if (x === 0 && y === 0 && w === RAIN_STILL.width && h === RAIN_STILL.height)
            draws.push([]);
          draws.at(-1)?.push({ rect: [x, y, w, h], fill: String(target.fillStyle) });
        };
      if (key === "fillText")
        return (glyph: string, x: number, y: number) => {
          seen.font.add(String(target.font));
          seen.align.add(String(target.textAlign));
          const blur = Number(target.shadowBlur);
          const op: RainOp = {
            glyph,
            x,
            y,
            fill: String(target.fillStyle),
            alpha: Number(target.globalAlpha),
            ...(blur > 0 ? { blur, shadow: String(target.shadowColor) } : {}),
          };
          draws.at(-1)?.push(op);
        };
      if (key === "setTransform") return () => undefined;
      return target[key as string];
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** The descriptor a property has on the first prototype that owns it. */
function ownerOf(start: object, key: string): { owner: object; descriptor: PropertyDescriptor } {
  let owner: object | null = start;
  while (owner !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) return { owner, descriptor };
    owner = Object.getPrototypeOf(owner);
  }
  throw new Error(`no ${key} on the prototype chain`);
}

interface Mounted {
  spoken: RainSpokenRecord[];
  still?: { ops: RainOp[]; record: RainStillRecord };
}

/** The view mounted over one step's rows, read, then unmounted. With `draw`, the canvas records and the container
 * measures the nominal frame; Math.random is mulberry32(RAIN_SEED) either way, for the mount's span. */
async function mounted(
  rows: readonly AgentView[],
  palette: MonitorPalette,
  draw: boolean,
): Promise<Mounted> {
  const { countingCommands, fixtureInput, parameterDefaults } = await sdkTesting();
  const host = document.createElement("div");
  document.body.append(host);
  const theme: MonitorTheme = {
    scheme: "dark",
    tokens: palette,
    reducedMotion: false,
    animations: false,
  };
  const draws: RainOp[][] = [];
  const seen = { font: new Set<string>(), align: new Set<string>() };
  const restores: Array<() => void> = [];
  const random = mulberry32(RAIN_SEED);
  const byRain: boolean[] = [];
  const realRandom = Math.random;
  Math.random = () => {
    byRain.push(new Error().stack?.includes("views/rain/RainView") ?? false);
    return random();
  };
  restores.push(() => {
    Math.random = realRandom;
  });
  if (draw) {
    const canvasProto = HTMLCanvasElement.prototype;
    const realGetContext = canvasProto.getContext;
    const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
    canvasProto.getContext = function getContext(this: HTMLCanvasElement) {
      let context = contexts.get(this);
      if (!context) {
        context = recorder(draws, seen);
        contexts.set(this, context);
      }
      return context;
    } as unknown as typeof canvasProto.getContext;
    restores.push(() => {
      canvasProto.getContext = realGetContext;
    });
    for (const [key, value] of [
      ["clientWidth", RAIN_STILL.width],
      ["clientHeight", RAIN_STILL.height],
    ] as const) {
      const { descriptor } = ownerOf(HTMLElement.prototype, key);
      const owned = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
      Object.defineProperty(HTMLElement.prototype, key, {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains("vf-monitor-rain")
            ? value
            : (descriptor.get?.call(this) ?? descriptor.value);
        },
      });
      restores.push(() => {
        if (owned) Object.defineProperty(HTMLElement.prototype, key, owned);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
      });
    }
    const ownedRatio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: RAIN_STILL.dpr,
    });
    restores.push(() => {
      if (ownedRatio) Object.defineProperty(window, "devicePixelRatio", ownedRatio);
      else delete (window as unknown as Record<string, unknown>).devicePixelRatio;
    });
  }
  const commands = countingCommands();
  let instance: MonitorViewInstance | undefined;
  try {
    await act(async () => {
      instance = rainMonitorView.mount(
        host,
        fixtureInput({
          agents: rows,
          parameters: parameterDefaults(rainMonitorView.manifest),
          theme,
        }),
        commands.commands,
      );
    });
    const spoken = [
      ...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-rain-agents button"),
    ].map((button) => ({
      label: button.textContent ?? "",
      current: button.getAttribute("aria-current") === "true",
    }));
    if (!draw) return { spoken };
    const last = draws.at(-1);
    if (last === undefined || last.length === 0) throw new Error("the rain drew no still frame");
    const lastJson = JSON.stringify(last);
    for (const [index, each] of draws.entries())
      if (JSON.stringify(each) !== lastJson)
        throw new Error(`still draw ${index + 1} of ${draws.length} differs from the last`);
    const rainDraws = byRain.filter(Boolean).length;
    if (byRain.slice(0, rainDraws).some((rain) => !rain))
      throw new Error(
        "another draw of Math.random came before the rain's: the phone could not replay its drops",
      );
    if (seen.font.size !== 1 || seen.align.size !== 1)
      throw new Error(`the glyphs changed font or alignment: ${[...seen.font]} ${[...seen.align]}`);
    return {
      spoken,
      still: {
        ops: last,
        record: {
          ...RAIN_STILL,
          seed: RAIN_SEED,
          rainDraws,
          otherDraws: byRain.length - rainDraws,
          draws: draws.length,
          font: [...seen.font][0] ?? "",
          textAlign: [...seen.align][0] ?? "",
        },
      },
    };
  } finally {
    await act(async () => instance?.unmount());
    host.remove();
    for (const restore of restores.reverse()) restore();
  }
}

/** The steps: one per window step, the gap's recorded as a gap. React's act environment is set for this span alone. */
export async function rainSteps(input: PhoneViewInput): Promise<RainStep[]> {
  const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const was = scope.IS_REACT_ACT_ENVIRONMENT;
  scope.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    const tokens = tokenValues();
    const palette = paletteOver(tokens);
    const steps: RainStep[] = [];
    const births = new Map<number, number>(RAIN_COLUMNS.map((columns) => [columns, 0]));
    const previous = new Map<number, ReadonlyMap<number, RainDrop>>(
      RAIN_COLUMNS.map((columns) => [columns, new Map()]),
    );
    for (const step of input.steps) {
      const head = { at: step.at, ...(step.frame === undefined ? {} : { frame: step.frame }) };
      if (step.gap === true) {
        steps.push({ ...head, gap: true });
        continue;
      }
      const rows = step.rows ?? [];
      const ids = rows.map((row) => row.id);
      const columns = RAIN_COLUMNS.map((count) => {
        const next = reconcileRainColumns({
          agents: ids,
          columns: count,
          previous: previous.get(count) ?? new Map(),
          createDrop: (agentId) => {
            const birth = births.get(count) ?? 0;
            births.set(count, birth + 1);
            return { agentId, y: birth, speed: 0.5 };
          },
        });
        previous.set(count, next);
        return {
          columns: count,
          streams: [...next].map(([column, drop]): [number, string, number] => [
            column,
            drop.agentId,
            drop.y,
          ]),
        };
      });
      const open = step.at === "open";
      const view = await mounted(rows, palette, open);
      const record: RainStep = {
        ...head,
        rows: rows.map((row) => {
          const data = rainDataString(row);
          return {
            id: row.id,
            data,
            tails: RAIN_ROWS.map((r) => rainTailLength(row, r, 1, data.length)),
          };
        }),
        columns,
        spoken: view.spoken,
      };
      if (open) {
        const random = mulberry32(RAIN_SEED);
        record.tokens = tokens;
        record.palette = { rain: palette.rain, textPrimary: palette.text.primary };
        record.parameters = {
          defaults: { ...DEFAULT_RAIN_PARAMETERS },
          groups: RAIN_PARAMETER_GROUPS.map((group) => ({
            title: group.title,
            controls: group.controls.map((control) => ({ ...control })),
          })),
        };
        record.normalize = NORMALIZE_INPUTS.map((entry) => ({
          in: entry,
          out: {
            ...normalizeRainParameters(
              Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, untag(value)])),
            ),
          },
        }));
        record.random = {
          seed: RAIN_SEED,
          first: Array.from({ length: RANDOM_SHOWN }, () => random()),
        };
        if (view.still !== undefined) {
          record.still = view.still.record;
          record.ops = view.still.ops;
        }
      }
      steps.push(record);
    }
    return steps;
  } finally {
    if (was === undefined) delete scope.IS_REACT_ACT_ENVIRONMENT;
    else scope.IS_REACT_ACT_ENVIRONMENT = was;
  }
}

export const golden: PhoneViewGolden = { note: NOTE, compute: rainSteps };
