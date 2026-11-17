// Item 327 — THE DESK'S FACTS AT A SMOKE'S RED, shared by the desk smokes' rows (testing/smoke-desk-copy.ts's HN-3 and
// testing/smoke-selection-bar.ts's DK-11): what the desk said when a wait ran out, and whether a row's press took the
// selection its bar asks next. Page reads only, said as counts, booleans and one-word data-attributes, since a red's
// line travels. No input, no window; nothing here imports a row.

/** Item 327 — what the desk said when a wait ran out: counts, booleans and data-attributes only, never an object's
 * text, since a red's line travels. Read by `DESK_FACTS`, said by `deskFactsWords`. */
export interface DeskFacts {
  readonly count: number | null;
  readonly locked: boolean | null;
  readonly gesturing: boolean | null;
  readonly editing: boolean | null;
  /** whether the anchor has a box to stand by */
  readonly box: boolean | null;
  readonly held: boolean | null;
  readonly bar: {
    readonly shown: string | null;
    readonly face: string | null;
    readonly open: boolean;
    readonly traveling: boolean;
  } | null;
  /** the desk's editor holds the focus */
  readonly writing: boolean | null;
  readonly frames: number | null;
}

/** The page read behind `DeskFacts`: the anchor (`__vfDesk.anchor()`), the hand, the bar's data-attributes, the
 * editor's focus and the desk's drawn frames. Reads only; no input, no write. */
export const DESK_FACTS = `(() => {
  const d = globalThis.__vfDesk;
  const a = d?.anchor?.() ?? null;
  const b = document.querySelector("[data-selection-bar]");
  return {
    count: a === null ? null : a.count,
    locked: a === null ? null : a.locked === true,
    gesturing: a === null ? null : a.gesturing === true,
    editing: a === null ? null : a.editing === true,
    box: a === null ? null : a.box !== null,
    held: d === undefined ? null : d.held() !== null,
    bar: b === null ? null : {
      shown: b.getAttribute("data-shown"),
      face: b.getAttribute("data-face"),
      open: b.hasAttribute("data-open"),
      traveling: b.hasAttribute("data-traveling"),
    },
    writing: document.activeElement?.hasAttribute("data-desk-editor") === true,
    frames: d === undefined ? null : d.perf().frames,
  };
})()`;

/** What a press at `at` meets after it: inside the desk, and inside the hand's cards — two booleans, no markup. */
export const UNDER = (at: { readonly x: number; readonly y: number }): string => `(() => {
  const el = document.elementFromPoint(${at.x}, ${at.y});
  const desk = document.querySelector("[data-desk]");
  return {
    desk: el !== null && desk !== null && desk.contains(el),
    cards: (el?.closest(".vf-cards") ?? null) !== null,
  };
})()`;

/** One word, as a data-attribute's value is: anything else is said `?`. */
const ONE_WORD = /^[a-z][a-z-]{0,23}$/u;

/** Item 327 — the desk's facts in words: the fixed keys in a fixed order, a data-attribute only when it is one word,
 * and nothing else it is handed. */
export function deskFactsWords(facts: Readonly<Record<string, unknown>> | null): string {
  if (facts === null) return "no desk";
  const said = (v: unknown): string => {
    if (v === null || v === undefined) return "none";
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return "?";
  };
  const attr = (v: unknown): string => {
    if (v === null || v === undefined) return "none";
    return typeof v === "string" && ONE_WORD.test(v) ? v : "?";
  };
  const raw = facts["bar"];
  const bar =
    typeof raw === "object" && raw !== null ? (raw as Readonly<Record<string, unknown>>) : null;
  return [
    `count=${said(facts["count"])}`,
    `locked=${said(facts["locked"])}`,
    `gesturing=${said(facts["gesturing"])}`,
    `editing=${said(facts["editing"])}`,
    `box=${said(facts["box"])}`,
    `held=${said(facts["held"])}`,
    bar === null
      ? "bar=none"
      : `bar.shown=${attr(bar["shown"])} bar.face=${attr(bar["face"])} ` +
        `bar.open=${said(bar["open"])} bar.traveling=${said(bar["traveling"])}`,
    `writing=${said(facts["writing"])}`,
    `frames=${said(facts["frames"])}`,
  ].join(" ");
}

/** Item 327 — `select()`'s press took the selection its row's bar asks next: `want` (1, or one more under ⇧) against
 * the anchor's count read after the press. */
export function judgeSelectionTook(type: string, want: number, got: number | null): string | null {
  if (got === want) return null;
  return `the press on ${type} took no selection: count ${got ?? "none"}, not ${want}`;
}
