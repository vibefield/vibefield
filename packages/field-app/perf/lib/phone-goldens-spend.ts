import { realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentView, MonitorAgentRow } from "@vibefield/puppeteer-view-sdk/model";
import {
  countingCommands,
  fixtureInput,
  fixtureModel,
  fixtureTheme,
} from "@vibefield/puppeteer-view-sdk/testing";
import { formatClock, parseCssColor } from "@vibefield/puppeteer-view-sdk/toolkit";
import { spendMonitorView } from "@vibefield/puppeteer-views";
import { act } from "react";
import type { PhoneViewGolden, PhoneViewInput, PhoneWindowStep } from "./phone-goldens";

/**
 * PG-7 — THE SPEND VIEW'S GOLDEN: what puppeteer-views' spend says over the home's window at every witness step,
 * which the phone's `Godview/Spend/` transcribes and is held to through the kit's byte-identical copy
 * (`Tests/FieldHomeTests/Fixtures/phone-spend.golden.json`, `SpendParityTests`).
 *
 * Three parts (fd's ruling of the read, 2026-11-04 01:24Z, Q1):
 *   · the SHIPPING view: `spendMonitorView` (the root's) mounted in happy-dom at the phone's frame, its DOM recorded
 *     (`view*` fields): the list's order, words, classes and places; the hero; the head; the axes. happy-dom lays out
 *     nothing and draws no canvas, so the view measures at the stage's size with its own `averageGlyph` fallback,
 *     and paints nothing (the paint is by eye, Q2);
 *   · what the DOM cannot say, from spend's own modules BY PATH (the exports map gives only `spendSet` and
 *     `spendMeters`): the meters and their readings, each line at now, the names, the order, the siblings, the scale;
 *   · fixed vectors (`at: "vectors"`): every spend word and number over the edges the witness lacks.
 * A clock word is recorded zone-free as `{{clock:<ms>}}`, the generator having checked the text it replaces is
 * `formatClock(ms)`; the kit expands it with its own `formatClock`, held to the toolkit's golden.
 */

const FIELD_APP = join(import.meta.dirname, "..", "..");

/** PG-4t lands the shared by-path loader (fd, Q1); this is its local stand-in, one function. */
async function spendModule<T>(file: string): Promise<T> {
  const views = realpathSync(join(FIELD_APP, "node_modules", "@vibefield", "puppeteer-views"));
  return (await import(pathToFileURL(join(views, "dist", "views", "spend", file)).href)) as T;
}
type Series =
  typeof import("../../node_modules/@vibefield/puppeteer-views/dist/views/spend/spend-series.js");
type Scale =
  typeof import("../../node_modules/@vibefield/puppeteer-views/dist/views/spend/spend-scale.js");
type List =
  typeof import("../../node_modules/@vibefield/puppeteer-views/dist/views/spend/spend-list.js");
type Words =
  typeof import("../../node_modules/@vibefield/puppeteer-views/dist/views/spend/spend-words.js");
type Ink =
  typeof import("../../node_modules/@vibefield/puppeteer-views/dist/views/spend/spend-ink.js");
type Params =
  typeof import("../../node_modules/@vibefield/puppeteer-views/dist/views/spend/spend-parameters.js");
type ViewFile =
  typeof import("../../node_modules/@vibefield/puppeteer-views/dist/views/spend/SpendView.js");
interface Spend {
  series: Series;
  scale: Scale;
  list: List;
  words: Words;
  ink: Ink;
  params: Params;
  view: ViewFile;
}
async function loadSpend(): Promise<Spend> {
  return {
    series: await spendModule<Series>("spend-series.js"),
    scale: await spendModule<Scale>("spend-scale.js"),
    list: await spendModule<List>("spend-list.js"),
    words: await spendModule<Words>("spend-words.js"),
    ink: await spendModule<Ink>("spend-ink.js"),
    params: await spendModule<Params>("spend-parameters.js"),
    view: await spendModule<ViewFile>("SpendView.js"),
  };
}

/** The phone's frame the view lays out in (Q8): a NAMED PLACEHOLDER until PG-4t's constants (402 × 874, less the
 * top safe area 62, the Stories row about 70 and `AppBar.band(homeInset: 34)` = 93), and one compact size (under
 * the view's 418). The kit reads both from this golden's steps, never a copy. */
export const PHONE_SPEND_STAGE_PLACEHOLDER = { width: 402, height: 649 } as const;
export const PHONE_SPEND_COMPACT_STAGE = { width: 402, height: 400 } as const;

const NOTE =
  "PG-7 — the phone's spend view golden (fd's ruling of the read, 2026-11-04 01:24Z): puppeteer-views' spend over the home's window rows (phone-fold.golden.json's drawn rows, whole) at every witness step, at nowMs. Per step, from spend's own modules BY PATH (the exports map gives spendSet and spendMeters; the rest by realpath under field-app's node_modules/@vibefield/puppeteer-views/dist/views/spend/, imported by file URL): meters (spendMeters' lines: id, bornMs, total, partial, recorded, points [t, v]) and unpriced; atNow (each line at now: its head, spent and spentPoints in the window, value, rate, state, status words, burn, figure); names (spendNames); order (listOrder by total); sib (siblingIndex); scale (moneyScale full and compact, moneyTicks, axisMoney). Then the SHIPPING view, spendMonitorView mounted in happy-dom (Date.now held at nowMs, motion off, the light fixture palette; happy-dom lays out nothing and draws no canvas, so the view measures at the stage with its own averageGlyph and paints nothing): view (the root, hero, colcap, head, the y and x axes, the chips, the more row, the empty state, the Now pill, the tag) and viewRows (each list row's id, state, classes, words, places). Extra steps: 'open · compact' (the one-line form), 'open · pointed' (a pointer on the chart near a line), 'open · moment' (a moment set by a click on empty chart two minutes back, inside the recorded buckets, the pointer gone), 'open · moment · unrecorded' (the same five minutes back, before the buckets begin: every started row says 'not recorded'), 'empty' (no rows), and 'vectors' (fixed inputs over every spend word and number, each row {in…, out}; a non-JSON input or output is a tagged string: 'NaN', 'Infinity', '-Infinity', 'undefined'). A clock word is {{clock:<ms>}}, checked against formatClock(ms) when written: zone-free. Not here: colours (the window's rows carry 'currentColor', no theme; the ink is pinned by the vectors' fixed hexes), the canvas (by eye, Q2). GENERATED by packages/field-app/perf/phone-goldens.generate.perf.ts (pnpm --filter @vibefield/field-app phone:goldens); pinned byte for byte by packages/field-app/test/phone-parity.test.ts, the kit's copy by pnpm check:ios-fixtures. A puppeteer EL8 moves it: regenerate and copy to the kit in the same commit. Never edit by hand; a regeneration is a re-bless, said in its commit, and never over a defect.";

/** A number as the golden carries it: JSON's own, or a tag for what JSON cannot hold. */
type Tagged = number | "NaN" | "Infinity" | "-Infinity" | "undefined";
function tag(value: number | undefined): Tagged {
  if (value === undefined) return "undefined";
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  return value;
}
function untag(value: Tagged): number | undefined {
  if (value === "undefined") return undefined;
  if (value === "NaN") return Number.NaN;
  if (value === "Infinity") return Number.POSITIVE_INFINITY;
  if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
  return value;
}

/** A clock word, zone-free: the text must say `formatClock(ms)` where the token goes, or the golden is a defect. */
const clockToken = (ms: number): string => `{{clock:${ms}}}`;
function swapClock(text: string, ms: number): string {
  const said = formatClock(ms);
  if (!text.includes(said)) throw new Error(`"${text}" does not say formatClock(${ms}) = ${said}`);
  return text.replace(said, clockToken(ms));
}

const pair = (point: { t: number; v: number }): [number, number] => [point.t, point.v];

/** The agent rows spend reads (kind agent; spend skips terminals itself, so every row goes in). */
function modelStep(spend: Spend, rows: readonly AgentView[], nowMs: number) {
  const { series, scale, list, words, ink } = spend;
  const meters = series.spendMeters(rows);
  const set = series.spendAt(meters, nowMs);
  const { ta, tb } = scale.spendWindow(nowMs);
  const atNow = set.lines.map((line) => {
    const spent = series.spentAt(line, ta, tb);
    const value = series.valueAt(line, tb);
    const rate = value === undefined ? undefined : series.rateAt(line, tb);
    const state = words.spendStateAt(line, tb, nowMs);
    const unrecorded = state.key !== "before" && value === undefined;
    const status = unrecorded ? words.NOT_RECORDED : words.stateWords(state, tb, rate);
    return {
      id: line.id,
      head: pair(line.points[line.points.length - 1] ?? { t: tb, v: line.total }),
      spent: tag(spent),
      spentPoints: series.spentPoints(line, ta, tb).map(pair),
      value: tag(value),
      rate: tag(rate),
      state: {
        key: state.key,
        sinceMs: state.sinceMs,
        ...(state.glyph === undefined ? {} : { glyph: state.glyph }),
        ...(state.words === undefined ? {} : { words: state.words }),
      },
      status: {
        text: state.key === "before" ? swapClock(status.text, state.sinceMs) : status.text,
        tone: status.tone,
      },
      burn: tag(unrecorded ? undefined : words.printedBurn(state, rate)),
      figure: words.est(value, line.partial),
    };
  });
  const named = words.spendNames([
    ...meters.lines.map((line) => line.agent),
    ...meters.unpriced.map((row) => row.agent),
  ]);
  const top = Math.max(0, ...set.lines.map((line) => series.spentAt(line, ta, tb) ?? 0));
  const scaleOf = (compact: boolean) => {
    const { step, max } = scale.moneyScale(top, compact);
    const ticks = scale.moneyTicks(max, step);
    return { step, max, ticks, labels: ticks.map((value) => words.axisMoney(value, step)) };
  };
  return {
    meters: meters.lines.map((line) => ({
      id: line.id,
      bornMs: line.bornMs,
      total: line.total,
      partial: line.partial,
      recorded: line.recorded,
      points: line.points.map(pair),
    })),
    unpriced: meters.unpriced.map((row) => ({ id: row.id, bornMs: row.bornMs })),
    atNow,
    names: [...named].map(([id, name]) => ({ id, ...name })),
    order: list.listOrder(
      set.lines.map((line) => ({ id: line.id, value: line.total, bornMs: line.bornMs })),
    ),
    sib: [
      ...ink.siblingIndex(
        meters.lines.map((line) => ({
          id: line.id,
          project: line.agent.project.name,
          bornMs: line.bornMs,
        })),
      ),
    ].map(([id, n]) => ({ id, n })),
    scale: { top, full: scaleOf(false), compact: scaleOf(true) },
  };
}

// ───────────────────────────── the shipping view, mounted

const GLYPHS: ReadonlyArray<readonly [string, string]> = [
  ["M9 9.5", "question"],
  ["M12 5v9", "failure"],
  ["M8 4.5", "permission"],
  ["M20 14", "reply"],
];
function glyphOf(parent: Element | null): string | undefined {
  const d = parent?.querySelector(".vf-monitor-spend-glyph path")?.getAttribute("d") ?? "";
  return GLYPHS.find(([prefix]) => d.startsWith(prefix))?.[1];
}
const text = (element: Element | null | undefined): string | undefined =>
  element?.textContent ?? undefined;
const styleOf = (element: Element | null | undefined): CSSStyleDeclaration | undefined =>
  (element as HTMLElement | null | undefined)?.style;

interface ViewClocks {
  tb: number;
  ticks: readonly number[];
  moment: number | null;
  born: ReadonlyMap<string, number>;
}

/** The view's DOM as the phone draws it: words, classes and places; clock words zone-free. */
function readView(root: HTMLElement, clocks: ViewClocks) {
  const view = root.querySelector(".vf-monitor-spend");
  if (!(view instanceof HTMLElement)) throw new Error("the spend view drew no root");
  const hero = view.querySelector(".vf-monitor-spend-hero");
  const heroRate = text(hero?.querySelector(".vf-monitor-spend-cap b")) ?? "";
  const head = view.querySelector(".vf-monitor-spend-head");
  const headSpans = [...(head?.querySelectorAll("span") ?? [])].map(
    (span) => span.textContent ?? "",
  );
  const xSpans = [...view.querySelectorAll(".vf-monitor-spend-x span")];
  const tickSpans = xSpans.filter((span) => !span.classList.contains("vf-monitor-spend-chip"));
  const chips = xSpans.filter((span) => span.classList.contains("vf-monitor-spend-chip"));
  if (tickSpans.length !== clocks.ticks.length)
    throw new Error(
      `the axis drew ${tickSpans.length} ticks where timeTicks says ${clocks.ticks.length}`,
    );
  const more = view.querySelector(".vf-monitor-spend-row.is-rest");
  const empty = view.querySelector(".vf-monitor-spend-empty");
  const back = view.querySelector(".vf-monitor-spend-back");
  const tag = view.querySelector(".vf-monitor-spend-tag");
  const moment = clocks.moment;
  const record = {
    root: {
      className: view.className,
      motion: view.dataset.motion,
      list: view.style.getPropertyValue("--mv-spend-list"),
      label: view.getAttribute("aria-label"),
    },
    hero: {
      className: hero?.className,
      left: styleOf(hero)?.left,
      big: text(hero?.querySelector(".vf-monitor-spend-big")),
      rate: moment === null ? heroRate : swapClock(heroRate, moment),
      what: text(hero?.querySelector(".vf-monitor-spend-cap i")),
    },
    colcap: {
      text: text(view.querySelector(".vf-monitor-spend-colcap")),
      left: styleOf(view.querySelector(".vf-monitor-spend-colcap"))?.left,
      top: styleOf(view.querySelector(".vf-monitor-spend-colcap"))?.top,
    },
    head: {
      className: head?.className,
      transform: styleOf(head)?.transform,
      width: styleOf(head)?.width,
      a: headSpans[0],
      b:
        moment === null || headSpans[1] === undefined
          ? headSpans[1]
          : swapClock(headSpans[1], moment),
    },
    y: [...view.querySelectorAll(".vf-monitor-spend-y span")].map((span) => ({
      text: span.textContent,
      left: styleOf(span)?.left,
      top: styleOf(span)?.top,
    })),
    x: tickSpans.map((span, index) => {
      const at = clocks.ticks[index] as number;
      return {
        clock: swapClock(span.textContent ?? "", at),
        left: styleOf(span)?.left,
        top: styleOf(span)?.top,
      };
    }),
    chips: chips.map((span) => {
      const isMoment = span.classList.contains("is-moment");
      const at = isMoment && moment !== null ? moment : clocks.tb;
      return {
        className: span.className,
        clock: swapClock(span.textContent ?? "", at),
        left: styleOf(span)?.left,
        top: styleOf(span)?.top,
      };
    }),
    ...(more
      ? {
          more: {
            transform: styleOf(more)?.transform,
            name: text(more.querySelector(".vf-monitor-spend-name")),
            v: text(more.querySelector(".vf-monitor-spend-v")),
            tone: more.querySelector(".vf-monitor-spend-v")?.getAttribute("data-tone") ?? undefined,
          },
        }
      : {}),
    ...(empty ? { empty: [...empty.children].map((child) => child.textContent) } : {}),
    ...(back
      ? {
          now: {
            title: back.getAttribute("title"),
            label: back.getAttribute("aria-label"),
            keys: back.getAttribute("aria-keyshortcuts"),
            legend: text(back.querySelector(".vf-monitor-spend-legend")),
            words: text(back.lastElementChild),
            right: styleOf(back)?.right,
            top: styleOf(back)?.top,
          },
        }
      : {}),
    ...(tag ? { tag: { text: tag.textContent, transform: styleOf(tag)?.transform } } : {}),
  };
  const rows = [...view.querySelectorAll("button.vf-monitor-spend-row")].map((button) => {
    const id = button.getAttribute("data-id") ?? "";
    const state = button.getAttribute("data-state") ?? "";
    const born = clocks.born.get(id);
    const before = (said: string | null | undefined) =>
      said === null || said === undefined || state !== "before" || born === undefined
        ? (said ?? undefined)
        : said.replace(`starts ${formatClock(born)}`, `starts ${clockToken(born)}`);
    const r1 = button.querySelector(".vf-monitor-spend-r1");
    const r2 = button.querySelector(".vf-monitor-spend-r2");
    const value = r1?.querySelector(".vf-monitor-spend-v");
    const stg = r1?.querySelector(".vf-monitor-spend-stg");
    const stateSpan = r2?.querySelector(".vf-monitor-spend-state");
    return {
      id,
      state,
      ...(button.getAttribute("data-dir") ? { dir: button.getAttribute("data-dir") } : {}),
      ...(button.hasAttribute("hidden") ? { hidden: true } : {}),
      className: button.className,
      transform: styleOf(button)?.transform,
      width: styleOf(button)?.width,
      height: styleOf(button)?.height,
      hollow: r1?.querySelector(".vf-monitor-spend-key")?.classList.contains("is-hollow") === true,
      name: text(r1?.querySelector(".vf-monitor-spend-name")),
      ...(r1?.querySelector(".vf-monitor-spend-peer")
        ? { peer: r1.querySelector(".vf-monitor-spend-peer")?.getAttribute("aria-label") }
        : {}),
      ...(stg ? { stg: { tone: stg.getAttribute("data-tone"), glyph: glyphOf(stg) } } : {}),
      figure: before(text(value)),
      ...(value?.getAttribute("data-tone") ? { figureTone: value.getAttribute("data-tone") } : {}),
      ...(r2
        ? {
            task: text(r2.querySelector(".vf-monitor-spend-task")),
            stateText: before(stateSpan?.textContent),
            stateTone: stateSpan?.getAttribute("data-tone"),
            ...(glyphOf(stateSpan ?? null) ? { glyph: glyphOf(stateSpan ?? null) } : {}),
          }
        : {}),
      title: button.getAttribute("title"),
      label: before(button.getAttribute("aria-label")),
    };
  });
  return { view: record, viewRows: rows };
}

type Mounted = { root: HTMLElement; unmount(): void };
/** The shipping view on a detached element (its clock is the caller's `heldClock`). */
function mountView(rows: readonly AgentView[], size: { width: number; height: number }): Mounted {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const input = fixtureInput({
    model: fixtureModel([...rows]),
    stage: {
      width: size.width,
      height: size.height,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      obstacles: [],
    },
    theme: fixtureTheme("light", { animations: false }),
  });
  let instance: { unmount(): void } | undefined;
  act(() => {
    instance = spendMonitorView.mount(root, input, countingCommands().commands);
  });
  return {
    root,
    unmount() {
      act(() => instance?.unmount());
      root.remove();
    },
  };
}

/** Runs `work` with `Date.now` held at `nowMs` and React's act environment on; both restored after. */
function heldClock<T>(nowMs: number, work: () => T): T {
  const scope = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const was = scope.IS_REACT_ACT_ENVIRONMENT;
  const now = Date.now;
  scope.IS_REACT_ACT_ENVIRONMENT = true;
  Date.now = () => nowMs;
  try {
    return work();
  } finally {
    Date.now = now;
    if (was === undefined) delete scope.IS_REACT_ACT_ENVIRONMENT;
    else scope.IS_REACT_ACT_ENVIRONMENT = was;
  }
}

function viewStep(
  spend: Spend,
  rows: readonly AgentView[],
  size: { width: number; height: number },
  nowMs: number,
  act2?: (
    root: HTMLElement,
    at: (t: number, y: "zero" | "top") => { x: number; y: number },
  ) => number | null,
) {
  const { ta, tb } = spend.scale.spendWindow(nowMs);
  const g = spend.view.geometryFor(size.width, size.height);
  const meters = spend.series.spendMeters(rows);
  const born = new Map(
    [...meters.lines, ...meters.unpriced].map((line) => [line.id, line.bornMs] as const),
  );
  const at = (t: number, y: "zero" | "top") => ({
    x: g.x0 + ((t - ta) / (tb - ta)) * (g.x1 - g.x0),
    y: y === "zero" ? g.y1 - 1 : g.y0 + 4,
  });
  return heldClock(nowMs, () => {
    const mounted = mountView(rows, size);
    try {
      const moment = act2 ? act2(mounted.root, at) : null;
      const chips = [g.x0 + ((tb - ta) / (tb - ta)) * (g.x1 - g.x0)];
      if (moment !== null) chips.push(g.x0 + ((moment - ta) / (tb - ta)) * (g.x1 - g.x0));
      const ticks = spend.scale.timeTicks(ta, tb, g.x0, g.x1, chips).map((tick) => tick.t);
      return {
        stage: size,
        ...(moment === null ? {} : { moment }),
        ...readView(mounted.root, { tb, ticks, moment, born }),
      };
    } finally {
      mounted.unmount();
    }
  });
}

/** A pointer event on the view's hit area, at view coordinates (happy-dom's rects are all zero, so client = view). */
function pointer(root: HTMLElement, type: string, point: { x: number; y: number }): void {
  const hit = root.querySelector(".vf-monitor-spend-hit");
  if (!hit) throw new Error("the spend view drew no hit area");
  act(() => {
    hit.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        button: 0,
      }),
    );
  });
}

// ───────────────────────────── the vectors

const VECTOR_NOW = 1_790_803_300_000;
const MINUTE = 60_000;
/** A whole wire row (`MonitorAgentRow`, what the kit decodes), its overrides merged; `self` is the window's join. */
function wireRow(partial: Record<string, unknown> = {}): MonitorAgentRow {
  return {
    id: "v-agent",
    kind: "agent",
    createdAt: VECTOR_NOW - 60 * MINUTE,
    status: "idle",
    statusSince: VECTOR_NOW - 10 * MINUTE,
    stale: false,
    alive: true,
    observed: true,
    detail: "idle",
    project: { name: "atlas", branch: "main" },
    provider: { id: "claude", label: "Claude Code" },
    model: "Opus 5.5",
    unread: false,
    device: { id: "dev-home", name: "Studio" },
    attachable: true,
    ...partial,
  } as MonitorAgentRow;
}
/** The row as the window hands it to a view: `device.self` joined, no attachment, not active, no colour. */
function viewOf(row: MonitorAgentRow, self = true): AgentView {
  return {
    ...row,
    device: { ...row.device, self },
    colour: "currentColor",
    active: false,
    receded: false,
  } as AgentView;
}
const vectorRow = (partial: Record<string, unknown>, self = true) => ({
  row: wireRow(partial),
  self,
});

const WORD_ROWS = [
  vectorRow({ id: "w-reply", reply: { text: "  Fixed the bug.\nAnd more." } }),
  vectorRow({ id: "w-crlf", reply: { text: "line one\r\nline two" } }),
  vectorRow({ id: "w-punct", reply: { text: "—> «done» ok" } }),
  vectorRow({ id: "w-tick", reply: { text: " ✓ Done, 3 files" } }),
  vectorRow({ id: "w-tilde", reply: { text: "~/src is clean" } }),
  vectorRow({ id: "w-dot", reply: { text: ".env loaded" } }),
  vectorRow({ id: "w-digits", reply: { text: "123 tests pass" } }),
  vectorRow({ id: "w-circled", reply: { text: "①② ready" } }),
  vectorRow({ id: "w-kana", reply: { text: "テストが通った" } }),
  vectorRow({ id: "w-project", reply: { text: "atlas" } }),
  vectorRow({ id: "w-status", detail: "idle" }),
  vectorRow({
    id: "w-permission",
    status: "blocked",
    wait: { kind: "permission", since: VECTOR_NOW - MINUTE, tool: "Bash" },
  }),
  vectorRow({ id: "w-pending", pending: true }),
  vectorRow({ id: "w-starting", observed: false }),
  vectorRow(
    {
      id: "w-peer-ask",
      status: "blocked",
      wait: { kind: "question", since: VECTOR_NOW - MINUTE, question: "  Keep the order? " },
      device: { id: "dev-loft", name: "Loft" },
    },
    false,
  ),
  vectorRow(
    { id: "w-peer-reply", reply: { text: "Pushed." }, device: { id: "dev-loft", name: "Loft" } },
    false,
  ),
  vectorRow({ id: "w-model-empty", model: "", project: { name: "atlas", branch: null } }),
  vectorRow({ id: "w-model-absent", model: undefined, project: { name: "atlas" } }),
  vectorRow({
    id: "w-no-provider",
    model: undefined,
    provider: undefined,
    project: { name: "", branch: "" },
  }),
];

/** Groups of siblings for `spendNames`: same project and provider, another provider, none, and a lone run. */
const NAME_GROUPS: ReadonlyArray<ReadonlyArray<{ row: MonitorAgentRow; self: boolean }>> = [
  [
    vectorRow({ id: "n-a", reply: { text: "Tracing the host line" } }),
    vectorRow({ id: "n-b", reply: { text: "Writing the golden file" } }),
    vectorRow({ id: "n-c", provider: { id: "codex", label: "Codex" }, model: "GPT-5.5" }),
    vectorRow({ id: "n-d", provider: undefined, model: undefined }),
    vectorRow({ id: "n-lone", project: { name: "rosetta", branch: "main" } }),
  ],
  [vectorRow({ id: "n-e" }), vectorRow({ id: "n-f" })],
  [
    vectorRow({ id: "n-g", provider: { id: "codex", label: "Codex" }, reply: { text: "one" } }),
    vectorRow({ id: "n-h", reply: { text: "two" } }),
  ],
];

/** `spendStateAt` × `stateWords` × `printedBurn`: rows × moments × rates. */
const STATE_ROWS = [
  vectorRow({ id: "s-working", status: "working", statusSince: VECTOR_NOW - 2 * MINUTE }),
  vectorRow({ id: "s-unseen", status: "idle", unread: true, statusSince: VECTOR_NOW - 3 * MINUTE }),
  vectorRow({ id: "s-idle", status: "idle", statusSince: VECTOR_NOW - 4 * MINUTE }),
  ...["question", "failure", "permission", "elicitation"].map((kind) =>
    vectorRow({
      id: `s-blocked-${kind}`,
      status: "blocked",
      statusSince: VECTOR_NOW - 90_000,
      wait: { kind, since: VECTOR_NOW - 90_000, detail: `waits on ${kind}` },
    }),
  ),
  vectorRow({ id: "s-blocked-bare", status: "blocked", statusSince: VECTOR_NOW - 90_000 }),
  vectorRow({ id: "s-skew", status: "working", statusSince: VECTOR_NOW + 5 * MINUTE }),
  vectorRow({
    id: "s-young",
    status: "working",
    createdAt: VECTOR_NOW - 30_000,
    statusSince: VECTOR_NOW - 30_000,
  }),
];
const STATE_MOMENTS = [
  VECTOR_NOW - 120 * MINUTE,
  VECTOR_NOW - 5 * MINUTE,
  VECTOR_NOW - 100_000,
  VECTOR_NOW - 60_000,
  VECTOR_NOW - 1_000,
  VECTOR_NOW - 500,
  VECTOR_NOW,
];
const STATE_RATES: readonly Tagged[] = ["undefined", 0.0004, 0.0005, 0.0006, 0.2];

/** Synthetic lines: a birth inside the window, a birth after now (another clock), no steps, a negative step, an open
 * coverage word, no price, a negative total, a peer with a series, a terminal with a cost, buckets all before the
 * window. */
const series = (lastStepAt: number, steps: number[]) => ({ stepMs: 30_000, steps, lastStepAt });
const SERIES_ROWS = [
  vectorRow({
    id: "l-born-inside",
    createdAt: VECTOR_NOW - 200_000,
    status: "working",
    statusSince: VECTOR_NOW - 200_000,
    cost: {
      usd: 0.42,
      coverage: "complete",
      series: series(VECTOR_NOW - 10_000, [0, 0, 0, 0.01, 0.05, 0.06, 0.1, 0.08, 0.07, 0.05]),
    },
  }),
  vectorRow({
    id: "l-born-later",
    createdAt: VECTOR_NOW + 90_000,
    status: "working",
    statusSince: VECTOR_NOW + 90_000,
    cost: {
      usd: 0.2,
      coverage: "partial",
      series: series(VECTOR_NOW + 120_000, [0.05, 0.05, 0.1]),
    },
  }),
  vectorRow({
    id: "l-no-steps",
    cost: { usd: 1.5, coverage: "complete", series: series(VECTOR_NOW, []) },
  }),
  vectorRow({
    id: "l-negative-step",
    createdAt: VECTOR_NOW - 30 * MINUTE,
    cost: {
      usd: 2,
      coverage: "complete",
      series: series(VECTOR_NOW - 5_000, [0.2, -0.3, 0.4, 0.1]),
    },
  }),
  vectorRow({
    id: "l-open-word",
    cost: { usd: 0.3, coverage: "estimated", series: series(VECTOR_NOW - 5_000, [0.1, 0.1]) },
  }),
  vectorRow({ id: "l-unavailable", cost: { usd: 0, coverage: "unavailable" } }),
  vectorRow({ id: "l-negative-total", cost: { usd: -1, coverage: "complete" } }),
  vectorRow(
    {
      id: "l-peer",
      cost: { usd: 0.9, coverage: "complete", series: series(VECTOR_NOW - 5_000, [0.3, 0.3]) },
    },
    false,
  ),
  vectorRow({ id: "l-terminal", kind: "terminal", cost: { usd: 0.5, coverage: "complete" } }),
  vectorRow({
    id: "l-old-buckets",
    createdAt: VECTOR_NOW - 120 * MINUTE,
    cost: {
      usd: 0.8,
      coverage: "complete",
      series: series(VECTOR_NOW - 40 * MINUTE, [0.1, 0.2, 0.3]),
    },
  }),
];
const SERIES_MOMENTS = [
  VECTOR_NOW - 15 * MINUTE,
  VECTOR_NOW - 9 * MINUTE,
  VECTOR_NOW - 200_000,
  VECTOR_NOW - 130_000,
  VECTOR_NOW - 95_000,
  VECTOR_NOW - 40_000,
  VECTOR_NOW,
  VECTOR_NOW + 60_000,
];

const INK_HEXES = [
  "#4a90d9",
  "#ff9f0a",
  "#4ade80",
  "#888888",
  "#000000",
  "#ffffff",
  "#c46bff",
  "#2bb7a3",
];

const PHONE_SIZES: ReadonlyArray<readonly [number, number]> = [
  [402, 649],
  [393, 640],
  [402, 400],
  [430, 700],
  [320, 417],
  [640, 800],
  [960, 600],
  [1280, 320],
];

function vectors(spend: Spend) {
  const { series: s, scale, list, words, ink, params, view } = spend;
  const nowMs = VECTOR_NOW;
  const { ta, tb } = scale.spendWindow(nowMs);
  const MONEY: readonly Tagged[] = [
    "undefined",
    "NaN",
    "Infinity",
    0,
    0.0004,
    0.001,
    0.0045,
    0.0099,
    0.01,
    0.125,
    0.995,
    1.005,
    2.675,
    999.994,
    999.995,
    1000,
    1000.5,
    1234.5,
    2500.49,
    99_999.5,
    1e9,
  ];
  const PER_MINUTE: readonly Tagged[] = [
    "undefined",
    "NaN",
    -1,
    0,
    1e-7,
    1e-5,
    0.0001,
    1 / 600,
    0.01,
    1 / 60,
    0.0375,
    0.1,
    1 / 6,
    0.5,
    10,
    1e15,
  ];
  const AXIS: ReadonlyArray<readonly [number, number]> = [
    [0, 1],
    [0.25, 0.25],
    [0.5, 0.25],
    [0.75, 0.25],
    [0.1, 0.1],
    [0.30000000000000004, 0.1],
    [1.5, 0.5],
    [0.05, 0.05],
    [0.15, 0.05],
    [0.025, 0.025],
    [0.005, 0.005],
    [0.0025, 0.0025],
    [1500, 500],
    [2500, 2500],
    [12_345, 5000],
  ];
  const FIXED: ReadonlyArray<readonly [number, number]> = [
    [0.5, 0],
    [1.5, 0],
    [2.5, 0],
    [0.125, 2],
    [0.375, 2],
    [1.005, 2],
    [2.25, 1],
    [0.25, 1],
    [0.35, 1],
    [0.45, 1],
    [0.7000000000000001, 6],
    [0.30000000000000004, 6],
    [2.0000000000000004, 6],
    [0.0025, 3],
    [0.0045, 3],
    [1234.5678, 2],
    [1e20, 2],
  ];
  const fitCases: ReadonlyArray<{
    n: number;
    cap: number;
    offset: number;
    waiting: ReadonlyArray<readonly [number, number]>;
    dock?: boolean;
  }> = [
    { n: 3, cap: 5, offset: 0, waiting: [] },
    { n: 8, cap: 5, offset: 0, waiting: [] },
    { n: 8, cap: 5, offset: 2, waiting: [] },
    { n: 8, cap: 5, offset: 9, waiting: [] },
    {
      n: 8,
      cap: 5,
      offset: 0,
      waiting: [
        [6, 100],
        [7, 50],
      ],
    },
    { n: 8, cap: 8, offset: 0, waiting: [[7, 10]] },
    {
      n: 12,
      cap: 7,
      offset: 3,
      waiting: [
        [0, 30],
        [1, 20],
        [11, 10],
        [10, 40],
      ],
    },
    {
      n: 12,
      cap: 7,
      offset: 3,
      waiting: [
        [0, 30],
        [11, 10],
      ],
      dock: false,
    },
    { n: 6, cap: 1, offset: 0, waiting: [[5, 1]] },
    {
      n: 6,
      cap: 2,
      offset: 0,
      waiting: [
        [4, 2],
        [5, 1],
      ],
    },
    {
      n: 6,
      cap: 4,
      offset: 2,
      waiting: [
        [0, 5],
        [5, 1],
      ],
    },
  ];
  const ids = (n: number) => Array.from({ length: n }, (_, index) => `r${index}`);
  const orderEntries = [
    { id: "a", value: 2, bornMs: 3 },
    { id: "b", value: 5, bornMs: 9 },
    { id: "c", value: 2, bornMs: 1 },
    { id: "d", value: 0, bornMs: 20 },
    { id: "e", value: 7, bornMs: 15 },
  ];
  const scrubValues = new Map([
    ["a", 1],
    ["b", 0.5],
    ["c", 2],
    ["e", 0.1],
  ]);
  const stateRows = STATE_ROWS.map(({ row, self }) => ({
    bornMs: row.createdAt,
    agent: viewOf(row, self),
  }));
  const seriesSet = s.spendMeters(SERIES_ROWS.map(({ row, self }) => viewOf(row, self)));
  return {
    at: "vectors",
    nowMs,
    window: { ta, tb },
    constants: {
      RATE_WINDOW_MS: s.RATE_WINDOW_MS,
      SPEND_STEP_MS: scale.SPEND_STEP_MS,
      SPEND_STEP_COUNT: scale.SPEND_STEP_COUNT,
      SPEND_WINDOW_MS: scale.SPEND_WINDOW_MS,
      TIME_TICK_MS: scale.TIME_TICK_MS,
      NOT_RECORDED: words.NOT_RECORDED,
      DEFAULT_SPEND_PARAMETERS: params.DEFAULT_SPEND_PARAMETERS,
    },
    money: MONEY.map((value) => ({ in: value, out: words.money(untag(value)) })),
    est: MONEY.flatMap((value) =>
      [false, true].map((partial) => ({
        in: value,
        partial,
        out: words.est(untag(value), partial),
      })),
    ),
    perHour: PER_MINUTE.map((value) => ({ in: value, out: words.perHour(untag(value)) })),
    axisMoney: AXIS.map(([value, step]) => ({
      in: value,
      step,
      out: words.axisMoney(value, step),
    })),
    toFixed: FIXED.map(([value, places]) => ({ in: value, places, out: value.toFixed(places) })),
    niceStep: [
      [0, 7],
      [1e-7, 7],
      [0.5, 7],
      [0.53, 7],
      [0.6572, 7],
      [0.6572, 3],
      [1, 7],
      [7, 7],
      [7.0001, 7],
      [17.5, 7],
      [35, 7],
      [100, 3],
      [1e6, 7],
    ].map(([max, count]) => ({ max, count, out: scale.niceStep(max as number, count as number) })),
    moneyScale: (
      [
        [0, false],
        [0.1, false],
        [0.5, false],
        [0.62, false],
        [0.62, true],
        [1, false],
        [4.7, false],
        [4.7, true],
        [100, false],
        [1234, true],
      ] as const
    ).map(([top, compact]) => {
      const out = scale.moneyScale(top, compact);
      const ticks = scale.moneyTicks(out.max, out.step);
      return {
        top,
        compact,
        ...out,
        ticks,
        labels: ticks.map((value) => words.axisMoney(value, out.step)),
      };
    }),
    easeTop: (
      [
        [null, 1],
        [0.5, 1],
        [0.99, 1],
        [0.998, 1],
        [1, 1],
        [2, 1],
        [0, 0.7000000000000001],
      ] as const
    ).map(([shown, target]) => ({ shown, target, out: scale.easeTop(shown, target) })),
    moments: [ta - 1, ta, tb - 1000, tb, tb + 1].map((t) => ({
      t,
      momentIn: scale.momentIn(t, { ta, tb }),
      heldIn: scale.heldIn(t, { ta, tb }),
    })),
    timeTicks: PHONE_SIZES.flatMap(([width, height]) => {
      const g = view.geometryFor(width, height);
      const nowX = g.x1;
      return [[nowX], [nowX, g.x0 + (g.x1 - g.x0) / 2], [nowX, g.x0 + 30]].map((chips) => ({
        x0: g.x0,
        x1: g.x1,
        chips,
        out: scale.timeTicks(ta, tb, g.x0, g.x1, chips),
      }));
    }),
    geometry: PHONE_SIZES.map(([width, height]) => view.geometryFor(width, height)),
    listOrder: [
      { options: {}, out: list.listOrder(orderEntries) },
      {
        options: { held: ["d", "a", "z"] },
        out: list.listOrder(orderEntries, { held: ["d", "a", "z"] }),
      },
      ...(["hold", "sink", "rank"] as const).map((order) => ({
        options: { scrub: { t: 10, order, values: Object.fromEntries(scrubValues) } },
        out: list.listOrder(orderEntries, {
          scrub: { t: 10, order, valueAt: (id: string) => scrubValues.get(id) },
        }),
      })),
    ],
    orderEntries,
    fitList: fitCases.map((entry) => {
      const order = ids(entry.n);
      const waiting = new Map(entry.waiting.map(([index, since]) => [`r${index}`, since] as const));
      const fit = list.fitList(order, entry.cap, entry.offset, waiting, entry.dock ?? true);
      return {
        ...entry,
        out: fit,
        ...(fit.more ? { moreWords: list.moreWords(fit) } : {}),
      };
    }),
    fitWords: [
      ["", 100],
      ["short", 0],
      ["short", 100],
      ["Each desktop keeps its place in the order now", 100],
      ["Each desktop keeps its place in the order now", 32],
      ["Supercalifragilistic words", 40],
      ["one two", 44.8],
      ["one two", 44.7],
    ].map(([said, max]) => ({
      in: said,
      max,
      out: words.fitWords(said as string, max as number, (line) => line.length * 6.4),
    })),
    words: WORD_ROWS.map(({ row, self }) => ({
      row,
      self,
      taskOf: words.taskOf(viewOf(row, self)),
      modelOf: words.modelOf(viewOf(row, self)),
    })),
    names: NAME_GROUPS.map((group) => ({
      rows: group.map(({ row }) => row.id),
      out: [...words.spendNames(group.map(({ row, self }) => viewOf(row, self)))].map(
        ([id, name]) => ({
          id,
          ...name,
        }),
      ),
    })),
    nameRows: NAME_GROUPS.flat(),
    stateRows: STATE_ROWS,
    states: stateRows.flatMap((row) =>
      STATE_MOMENTS.flatMap((t) => {
        const state = words.spendStateAt(row, t, nowMs);
        // a rate is read only by a working row's words and an unknown one's (spend-words.js:132-136)
        const rates: readonly Tagged[] =
          state.key === "working" || state.key === "unknown" ? STATE_RATES : ["undefined", 0.2];
        return rates.map((rate) => {
          const said = words.stateWords(state, t, untag(rate));
          return {
            id: row.agent.id,
            t,
            rate,
            state: {
              key: state.key,
              sinceMs: state.sinceMs,
              ...(state.glyph === undefined ? {} : { glyph: state.glyph }),
              ...(state.words === undefined ? {} : { words: state.words }),
            },
            waits: words.waits(state),
            burn: tag(words.printedBurn(state, untag(rate))),
            text: state.key === "before" ? swapClock(said.text, state.sinceMs) : said.text,
            tone: said.tone,
          };
        });
      }),
    ),
    ink: INK_HEXES.map((hex) => {
      const colour = parseCssColor(hex);
      if (colour === undefined) throw new Error(`${hex} does not parse`);
      const oklch = ink.rgbToOklch(colour);
      return {
        hex,
        oklch,
        tone: [false, true].map((dark) => ({
          dark,
          sibs: [0, 1, 2, 3].map((sib) => [...ink.siblingTone(colour, sib, dark)]),
        })),
        fill: [0, 1, 2, 3].map((sib) => ink.liftedFill(colour, sib)),
      };
    }),
    siblingIndex: (() => {
      const rows = [
        { id: "b", project: "atlas", bornMs: 10 },
        { id: "a", project: "atlas", bornMs: 10 },
        { id: "c", project: "atlas", bornMs: 5 },
        { id: "d", project: "atlas", bornMs: 30 },
        { id: "e", project: "rosetta", bornMs: 1 },
        { id: "B", project: "rosetta", bornMs: 1 },
      ];
      return { rows, out: [...ink.siblingIndex(rows)].map(([id, n]) => ({ id, n })) };
    })(),
    seriesRows: SERIES_ROWS,
    seriesMeters: seriesSet.lines.map((line) => ({
      id: line.id,
      bornMs: line.bornMs,
      total: line.total,
      partial: line.partial,
      recorded: line.recorded,
      points: line.points.map(pair),
    })),
    seriesUnpriced: seriesSet.unpriced.map((row) => ({ id: row.id, bornMs: row.bornMs })),
    seriesAt: seriesSet.lines.map((meter) => {
      const line = s.lineAt(meter, nowMs);
      return {
        id: line.id,
        bornMs: line.bornMs,
        points: line.points.map(pair),
        at: SERIES_MOMENTS.map((t) => ({
          t,
          value: tag(s.valueAt(line, t)),
          rate: tag(s.rateAt(line, t)),
          spent: tag(s.spentAt(line, ta, t)),
        })),
        windowPoints: s.windowPoints(line, ta, tb).map(pair),
        spentPoints: s.spentPoints(line, ta, tb).map(pair),
      };
    }),
    parameters: [
      undefined,
      null,
      { weight: 9, wash: -1 },
      { weight: 2.1, wash: "x" },
      { weight: 1.5 },
    ].map((value) => ({
      in: value === undefined ? "undefined" : value,
      out: params.normalizeSpendParameters(value),
    })),
  };
}

// ───────────────────────────── the compute

async function compute(input: PhoneViewInput): Promise<unknown[]> {
  const spend = await loadSpend();
  const { nowMs } = input;
  const stage = PHONE_SPEND_STAGE_PLACEHOLDER;
  const steps: unknown[] = [];
  let open: readonly AgentView[] | undefined;
  for (const step of input.steps as readonly PhoneWindowStep[]) {
    const label = { at: step.at, ...(step.frame === undefined ? {} : { frame: step.frame }) };
    if (step.gap || step.rows === undefined) {
      steps.push({ ...label, gap: true });
      continue;
    }
    if (step.at === "open") open = step.rows;
    steps.push({
      ...label,
      ...modelStep(spend, step.rows, nowMs),
      ...viewStep(spend, step.rows, stage, nowMs),
    });
  }
  if (open === undefined) throw new Error("the witness run has no open step");
  const rows = open;
  steps.push({ at: "open · compact", ...viewStep(spend, rows, PHONE_SPEND_COMPACT_STAGE, nowMs) });
  // a pointer on the chart, at the zero line two hundred seconds back: the line nearest it is pointed (its tag)
  steps.push({
    at: "open · pointed",
    ...viewStep(spend, rows, stage, nowMs, (root, at) => {
      const t = nowMs - 200_000;
      pointer(root, "pointermove", at(t, "zero"));
      return t;
    }),
  });
  // a click on empty chart sets the moment, and the pointer then leaves (fd 01:44Z, 2): two minutes back, inside
  // what the buckets recorded, the rows read real money then; five minutes back, before the witness's buckets
  // begin, every started row honestly says "not recorded"
  for (const [at, back] of [
    ["open · moment", 120_000],
    ["open · moment · unrecorded", 300_000],
  ] as const) {
    steps.push({
      at,
      ...viewStep(spend, rows, stage, nowMs, (root, place) => {
        const t = nowMs - back;
        const point = place(t, "top");
        pointer(root, "pointermove", point);
        pointer(root, "pointerdown", point);
        pointer(root, "pointerup", point);
        pointer(root, "pointerout", point);
        // the click must have set the moment, never opened a line in reach: the Now pill says it is held
        if (!root.querySelector(".vf-monitor-spend-back"))
          throw new Error(`${at}: the click at ${t} set no moment`);
        return t;
      }),
    });
  }
  steps.push({ at: "empty", ...viewStep(spend, [], stage, nowMs) });
  steps.push(vectors(spend));
  return steps;
}

export const golden: PhoneViewGolden = { note: NOTE, compute };
