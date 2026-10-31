// DK-12 — THE TOOLS IN HAND, IN THE PRODUCT (smoke:canvas; DESIGN.md §8 "Tools in hand"; R13; ICE I20, I22). Each of the
// four specimens — ICE's notebook, whiteboard and calendar, and the example plugin's clock — is selected by a tap where the
// desk receives it and PICKED UP by the desk's own ⏎ (ICE's keymap: `ops.open`), and the rows read back off the DOM the
// chrome drew, off the desk's door (`window.__vfDesk`: the anchor, the object in hand and where the desk drew it, the bar's
// counters) and off the browser's own transition events:
//   HAND_<SPECIMEN> — the same bar under the head, its top at y 64, centred on the window; the kind's tools in their
//              declared order with the 6 gap where the run changes (pages · inks · tools), the readout's text, Done's tip;
//              the held object's READING FIT inside the layer's reserves (116 under the top, 100 over the foot — I20's
//              `hold`), centred in that band; a tool USED through the bar (`ops.useHeldTool`: a page turned, a pen chosen,
//              the eraser taken up, a month turned, an hour moved — each read back); Done puts it down — the bar hidden
//              while the object flies home and back over it, the bar over the selection again;
//   TRAVEL    — the travel's own timing, from `transitionstart`/`transitionend` on the one element: the transform over the
//              anchor's 560 ms on the island curve, the rows' cross-fade over its last 120 ms, the glass's width with them;
//              and the way back: the bar's fade-in starting 200 ms after the object landed;
//   COUNTERS  — the bar's placements ≤ the anchor's publishes through all four (never a render per frame).
// The stills: dk-12-hand-{notebook,whiteboard,calendar,clock}-{light,dark}.png — the window, each specimen in hand.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { type BarCounters, judgeCounters, POINT_IN } from "./smoke-selection-bar";

/** The numbers the canon places the tools in hand by (§8 "Tools in hand"; the layer's `hold`, I20). */
export const HAND_PLACE = {
  /** the bar's top under the head */
  top: 64,
  /** the reading fit keeps this under the view's top … */
  fitTop: 116,
  /** … and this over its foot */
  fitBand: 100,
  /** the travel (the anchor's `travelMs`) and the cross-fade at its end */
  travelMs: 560,
  swapMs: 120,
  /** back over the object this long after it lands */
  backMs: 200,
} as const;

/** One specimen: its type, its tools in declared order (`+` where the run changes), and what a tool used must do. */
export interface HandSpecimen {
  readonly name: "notebook" | "whiteboard" | "calendar" | "clock";
  readonly type: string;
  readonly tools: readonly string[];
  /** The readout, as a pattern (the clock's time, the calendar's month), or null for a kind that says none. */
  readonly readout: RegExp | null;
}

export const HAND_SPECIMENS: readonly HandSpecimen[] = [
  {
    name: "notebook",
    type: "desk.notebook",
    tools: ["turn:-1", "turn:1", "+pen:felt", "pen:ball", "pen:fountain", "pen:red", "+undo"],
    readout: /^Page \d+$/u,
  },
  {
    name: "whiteboard",
    type: "desk.board",
    tools: ["marker:black", "marker:blue", "marker:red", "marker:green", "+eraser", "undo", "redo"],
    readout: null,
  },
  {
    name: "calendar",
    type: "desk.calendar",
    tools: ["month:-1", "month:1", "+today", "pen"],
    readout:
      /^(January|February|March|April|May|June|July|August|September|October|November|December)$/u,
  },
  {
    name: "clock",
    type: "vibefield.example.desk-clock",
    tools: ["seconds", "ring24", "zone-back", "zone-ahead", "dial"],
    readout: /^\d{1,2}:\d{2}(:\d{2})?$/u,
  },
];

/** The bar in hand as the DOM shows it. */
export interface HandSeen {
  readonly shown: boolean;
  readonly role: string | null;
  readonly face: string | null;
  readonly traveling: boolean;
  /** the hand's row, window CSS px */
  readonly row: { x0: number; y0: number; x1: number; y1: number } | null;
  /** the hand's cells in order: acts and tool ids (`+` where the run changes), `|` a rule, the word in quotes */
  readonly cells: readonly string[];
  readonly readout: string | null;
  readonly tips: Readonly<Record<string, string>>;
  /** each mode's aria-pressed, and the dots' `data-on` */
  readonly pressed: Readonly<Record<string, string | null>>;
  readonly on: readonly string[];
  readonly dots: readonly string[];
}

/** Where the desk drew the object in hand (`__vfDesk.held()`). */
export interface HeldFrame {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
  readonly s: number;
  readonly settled: boolean;
}

const near = (a: number, b: number, eps = 1.5): boolean => Math.abs(a - b) <= eps;

/** Is the bar where the canon puts it in hand? Its top at 64, centred on the window, 40 tall. */
export function judgeHandPlace(view: { width: number; height: number }, seen: HandSeen): string[] {
  if (seen.row === null) return ["no tools in hand were drawn"];
  const problems: string[] = [];
  const { x0, y0, x1, y1 } = seen.row;
  if (!near(y0, HAND_PLACE.top, 1)) problems.push(`the tools' top is ${y0}, not 64`);
  if (!near(y1 - y0, 40, 1)) problems.push(`the tools are ${y1 - y0} tall, not 40`);
  if (!near((x0 + x1) / 2, view.width / 2))
    problems.push(`the tools' centre is ${(x0 + x1) / 2}, not the window's ${view.width / 2}`);
  return problems;
}

/**
 * Does the reading fit honour the layer's reserves (I20)? The held object's drawn frame lies between 116 under the view's
 * top and 100 over its foot, centred in that band (ICE's `readingTarget`: the extent's centre at top + band / 2).
 */
export function judgeReadingFit(
  view: { width: number; height: number },
  frame: HeldFrame | null,
): string[] {
  if (frame === null) return ["the desk drew no object in hand"];
  const problems: string[] = [];
  const top = frame.cy - frame.hy;
  const bottom = frame.cy + frame.hy;
  const foot = view.height - HAND_PLACE.fitBand;
  if (top < HAND_PLACE.fitTop - 1)
    problems.push(`the held object's top ${top} crosses the 116 reserve`);
  if (bottom > foot + 1)
    problems.push(`the held object's foot ${bottom} crosses the 100 reserve (${foot})`);
  const middle = HAND_PLACE.fitTop + (foot - HAND_PLACE.fitTop) / 2;
  if (!near(frame.cy, middle, 1))
    problems.push(`the held object's centre ${frame.cy} is not the band's middle ${middle}`);
  return problems;
}

/** A transition the one element ran, as the browser timed it (`transitionstart` → `transitionend`). */
export interface TransitionSeen {
  readonly on: "bar" | "hand" | "selection";
  readonly property: string;
  readonly start: number;
  readonly end: number | null;
  readonly elapsed: number | null;
  /** how it ended: on its own (`transitionend`), or cut short (`transitioncancel`) */
  readonly ended: "end" | "cancel" | null;
}

/** The travel's timing, read off the browser's own transition events (ms, `performance.now()`). */
export interface TravelTiming {
  /** the transform's run: its start, its length */
  readonly travel: {
    readonly start: number;
    readonly ms: number | null;
    readonly ended: "end" | "cancel" | null;
  } | null;
  /** the hand's row fading in, from the travel's start, and how long */
  readonly crossFade: {
    readonly at: number;
    readonly ms: number | null;
    readonly ended: "end" | "cancel" | null;
  } | null;
  /** the glass's width following it, from the travel's start, and how long */
  readonly width: {
    readonly at: number;
    readonly ms: number | null;
    readonly ended: "end" | "cancel" | null;
  } | null;
  /** the transform's declared length and easing (`getAnimations`) */
  readonly declared: { readonly ms: number; readonly easing: string } | null;
}

/** The travel's timing out of the transitions seen. */
export function travelTiming(
  seen: readonly TransitionSeen[],
  declared: TravelTiming["declared"],
): TravelTiming {
  const travel = seen.find((t) => t.on === "bar" && t.property === "transform");
  const fade = seen.find((t) => t.on === "hand" && t.property === "opacity");
  const width = seen.find((t) => t.on === "bar" && t.property === "width");
  const span = (t: TransitionSeen | undefined) =>
    t === undefined || travel === undefined
      ? null
      : { at: t.start - travel.start, ms: t.end === null ? null : t.end - t.start, ended: t.ended };
  return {
    travel:
      travel === undefined
        ? null
        : {
            start: travel.start,
            ms: travel.end === null ? null : travel.end - travel.start,
            ended: travel.ended,
          },
    crossFade: span(fade),
    width: span(width),
    declared,
  };
}

/** One frame's slack, and a little: a transition's events land on frames (120 Hz here, 60 under load). */
const SLACK_MS = 40;

/** The travel on the canon's clock: 560 on the island curve, the cross-fade its last 120, the width with it. */
export function judgeTravel(t: TravelTiming): string[] {
  const problems: string[] = [];
  if (t.declared === null) problems.push("the travel declared no transform transition");
  else {
    if (t.declared.ms !== HAND_PLACE.travelMs)
      problems.push(`the travel declared ${t.declared.ms} ms, not 560`);
    if (!/cubic-bezier\(0\.25,\s*1,\s*0\.3,\s*1\)/u.test(t.declared.easing))
      problems.push(`the travel's curve is ${t.declared.easing}, not the island's`);
  }
  if (t.travel === null || t.travel.ms === null) problems.push("the travel never ran its course");
  else {
    if (t.travel.ended !== "end") problems.push("the travel was cut short (`transitioncancel`)");
    if (!near(t.travel.ms, HAND_PLACE.travelMs, SLACK_MS))
      problems.push(`the travel took ${t.travel.ms.toFixed(0)} ms, not 560`);
  }
  if (t.crossFade === null || t.crossFade.ms === null)
    problems.push("the contents never cross-faded");
  else {
    if (!near(t.crossFade.at, HAND_PLACE.travelMs - HAND_PLACE.swapMs, SLACK_MS))
      problems.push(
        `the cross-fade began ${t.crossFade.at.toFixed(0)} ms in, not 440 (the travel's last 120)`,
      );
    if (!near(t.crossFade.ms, HAND_PLACE.swapMs, SLACK_MS))
      problems.push(`the cross-fade took ${t.crossFade.ms.toFixed(0)} ms, not 120`);
    if (t.crossFade.ended !== "end")
      problems.push("the cross-fade was cut short (`transitioncancel`)");
  }
  if (t.width === null) problems.push("the glass's width did not follow the cross-fade");
  else {
    if (!near(t.width.at, HAND_PLACE.travelMs - HAND_PLACE.swapMs, SLACK_MS))
      problems.push(`the glass's width began ${t.width.at.toFixed(0)} ms in, not 440`);
    if (
      t.width.ms === null ||
      !near(t.width.ms, HAND_PLACE.swapMs, SLACK_MS) ||
      t.width.ended !== "end"
    )
      problems.push(
        `the glass's width ran ${t.width.ms?.toFixed(0) ?? "—"} ms, ${t.width.ended ?? "never ended"} — not 120 on its own`,
      );
  }
  return problems;
}

/** The way back: the bar's fade-in began 200 ms after the object landed. */
export function judgeReturn(landedAt: number | null, backAt: number | null): string[] {
  if (landedAt === null) return ["the object never landed"];
  if (backAt === null) return ["the bar never came back over the object"];
  return near(backAt - landedAt, HAND_PLACE.backMs, SLACK_MS)
    ? []
    : [`the bar came back ${(backAt - landedAt).toFixed(0)} ms after the landing, not 200`];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The bar in hand, read whole. */
const READ_HAND = `(() => {
  const bar = document.querySelector("[data-selection-bar]");
  if (bar === null) return null;
  const row = bar.querySelector('[data-face-row="hand"]');
  const rect = (el) => { if (el === null) return null; const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; };
  const cells = row === null ? [] : [...row.children].map((el) =>
    el.classList.contains("vf-bar-rule") ? "|" : el.hasAttribute("data-readout") ? "“" + el.textContent + "”"
      : (el.hasAttribute("data-gap") ? "+" : "") + (el.getAttribute("data-tool") ?? el.getAttribute("data-act")));
  const tips = {}, pressed = {}, on = [], dots = [];
  for (const el of row?.querySelectorAll("[data-tool], [data-act]") ?? []) {
    const id = el.getAttribute("data-tool") ?? el.getAttribute("data-act");
    tips[id] = el.getAttribute("title") ?? "";
    if (el.hasAttribute("aria-pressed")) pressed[id] = el.getAttribute("aria-pressed");
    if (el.hasAttribute("data-on")) on.push(id);
    if (el.classList.contains("vf-bar-dot")) dots.push(id);
  }
  return {
    shown: bar.getAttribute("data-shown") === "true",
    role: bar.getAttribute("data-role"),
    face: bar.getAttribute("data-face"),
    traveling: bar.hasAttribute("data-traveling"),
    row: rect(row),
    cells,
    readout: row?.querySelector("[data-readout]")?.textContent ?? null,
    tips, pressed, on, dots,
  };
})()`;

/** Arm the page's recorder on the one element: every transition it and its rows run, and each frame's hand state. */
const ARM_RECORDER = `(() => {
  const bar = document.querySelector("[data-selection-bar]");
  const rec = { transitions: [], frames: [], on: true };
  globalThis.__vfDk12Rec?.stop?.();
  const where = (el) => el === bar ? "bar" : el?.getAttribute?.("data-face-row") ?? "other";
  const started = (e) => { if (e.target === bar || e.target.parentElement === bar) rec.transitions.push({ on: where(e.target), property: e.propertyName, start: e.timeStamp, end: null, elapsed: null, ended: null }); };
  const ended = (e) => {
    const t = [...rec.transitions].reverse().find((x) => x.on === where(e.target) && x.property === e.propertyName && x.end === null);
    if (t !== undefined) { t.end = e.timeStamp; t.elapsed = e.elapsedTime * 1000; t.ended = e.type === "transitionend" ? "end" : "cancel"; }
  };
  bar.addEventListener("transitionstart", started);
  bar.addEventListener("transitionend", ended);
  bar.addEventListener("transitioncancel", ended);
  const step = (t) => {
    const a = globalThis.__vfDesk?.anchor();
    rec.frames.push({ t, held: a?.held === undefined ? "none" : a.held.landing ? "landing" : "held", shown: bar.getAttribute("data-shown") === "true" });
    if (rec.on && rec.frames.length < 2400) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  rec.stop = () => { rec.on = false; bar.removeEventListener("transitionstart", started); bar.removeEventListener("transitionend", ended); bar.removeEventListener("transitioncancel", ended); };
  globalThis.__vfDk12Rec = rec;
  return true;
})()`;

const READ_RECORDER = `(() => { const r = globalThis.__vfDk12Rec; return r === undefined ? null : { transitions: r.transitions, frames: r.frames }; })()`;

/** The transform transition the one element declares now (its length and curve), if it is running one. */
const DECLARED_TRAVEL = `(() => {
  const bar = document.querySelector("[data-selection-bar]");
  const t = bar?.getAnimations().find((a) => a.transitionProperty === "transform");
  if (t === undefined) return null;
  const timing = t.effect.getTiming();
  return { ms: Number(timing.duration), easing: String(timing.easing) };
})()`;

export interface HandRowsDriver {
  readonly win: BrowserWindow;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

/** DK-12's rows (above). Returns the problems, each in words. */
export async function toolsInHandRows(d: HandRowsDriver): Promise<string[]> {
  const { win, say } = d;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const until = async (label: string, timeoutMs: number, expression: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await js<unknown>(expression)) === true) return;
      await sleep(40);
    }
    throw new Error(
      `${label} did not happen within ${timeoutMs}ms (hand ${JSON.stringify(await js(READ_HAND))}; held ${JSON.stringify(await js("globalThis.__vfDesk.held()"))})`,
    );
  };
  const hand = (): Promise<HandSeen> => js<HandSeen>(READ_HAND);
  const press = async (at: { x: number; y: number }): Promise<void> => {
    win.webContents.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
    await sleep(40);
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: at.x,
      y: at.y,
      button: "left",
      clickCount: 1,
    });
    await sleep(50);
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: at.x,
      y: at.y,
      button: "left",
      clickCount: 1,
    });
  };
  const key = async (keyCode: string): Promise<void> => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
    await sleep(60);
  };
  /** The object's own body (part "") where the desk receives a press — or null (its kind takes every tap as a part's). */
  const body = async (type: string): Promise<{ x: number; y: number } | null> => {
    const p = await js<{ x: number; y: number } | null>(POINT_IN(type));
    return p === null ? null : { x: Math.round(p.x), y: Math.round(p.y) };
  };
  /** Any point of the object where the desk receives a press, nearest its centre (a named part too). */
  const anywhere = async (type: string): Promise<{ x: number; y: number } | null> => {
    const p = await js<{ x: number; y: number } | null>(`(() => {
      const d = globalThis.__vfDesk; const el = document.querySelector("[data-desk]");
      const r = el.getBoundingClientRect(); const hits = []; let sx = 0, sy = 0;
      for (let y = 4; y < r.height; y += 8) for (let x = 4; x < r.width; x += 8) {
        const hit = d.pick({ x, y });
        if (hit === null || hit.type !== ${JSON.stringify(type)}) continue;
        const under = document.elementFromPoint(r.left + x, r.top + y);
        if (under === null || !el.contains(under)) continue;
        hits.push([x, y]); sx += x; sy += y;
      }
      if (hits.length === 0) return null;
      const cx = sx / hits.length, cy = sy / hits.length;
      hits.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
      return { x: r.left + hits[0][0], y: r.top + hits[0][1] };
    })()`);
    return p === null ? null : { x: Math.round(p.x), y: Math.round(p.y) };
  };
  /**
   * Somewhere the object takes a press — the desk FITTED to the board first (the head's zoom menu, its "fit" row, ⇧1)
   * while none of it does: at the first board's arrival fit the calendar fills the right of the window, its paper (which
   * takes no select — its taps are its days') on screen and its tape and roll off it.
   */
  const reach = async (type: string): Promise<{ x: number; y: number }> => {
    const seen = await anywhere(type);
    if (seen !== null) return seen;
    await pressAt(".vf-head-zoom");
    await until(
      "the head's zoom menu grown",
      5_000,
      `document.querySelector(".vf-head-zoom-menu") !== null`,
    );
    await pressAt('.vf-head-zoom-menu [data-act="fit"]');
    await sleep(1_200); // the camera's flight to the fit
    const at = await anywhere(type);
    if (at === null)
      throw new Error(`${type} was not picked anywhere the desk receives a press, fitted`);
    return at;
  };
  /** An element of the chrome pressed where it stands. */
  const pressAt = async (selector: string): Promise<void> => {
    const at = await js<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (at === null) throw new Error(`no ${selector} to press`);
    await press(at);
  };
  /** A cell of the tools in hand pressed where it stands. */
  const pressTool = async (id: string): Promise<void> => {
    const at = await js<{ x: number; y: number } | null>(`(() => {
      const row = document.querySelector('[data-selection-bar] [data-face-row="hand"]');
      const el = [...(row?.querySelectorAll("[data-tool], [data-act]") ?? [])].find((e) => (e.getAttribute("data-tool") ?? e.getAttribute("data-act")) === ${JSON.stringify(id)});
      if (el === undefined) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (at === null) throw new Error(`the tools in hand have no ${id}`);
    await press(at);
  };
  const theme = async (name: "light" | "dark"): Promise<void> => {
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(name)})`);
    await until(
      `the desk dressed ${name}`,
      10_000,
      `globalThis.__vfDesk.theme() === ${JSON.stringify(name)}`,
    );
    await sleep(600);
  };
  const shoot = async (name: string): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await win.capturePage()).toPNG());
  };
  const deselect = async (): Promise<void> => {
    await key("Escape");
    await key("Escape");
    await until("nothing held", 5_000, "globalThis.__vfDesk.held() === null");
    const count = await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0");
    if (count === 0) return;
    const mat = await js<{ x: number; y: number } | null>(`(() => {
      const d = globalThis.__vfDesk; const el = document.querySelector("[data-desk]");
      const r = el.getBoundingClientRect();
      for (let y = 140; y < r.height - 140; y += 24) for (let x = 80; x < r.width - 80; x += 24) {
        if (d.pick({ x, y }) !== null) continue;
        const under = document.elementFromPoint(r.left + x, r.top + y);
        if (under !== null && el.contains(under)) return { x: r.left + x, y: r.top + y };
      }
      return null;
    })()`);
    if (mat !== null) await press(mat);
    await until("nothing selected", 5_000, "(globalThis.__vfDesk.anchor()?.count ?? 0) === 0");
  };

  const problems: string[] = [];
  const counters0 = await js<BarCounters>("globalThis.__vfDesk.bar()");
  const view = await js<{ width: number; height: number }>(
    "({ width: innerWidth, height: innerHeight })",
  );
  await theme("light");
  for (const s of HAND_SPECIMENS) {
    const row = (p: string): string => `HAND_${s.name.toUpperCase()}: ${p}`;
    await deselect();
    // selected by a tap on its body where the desk receives it — or, for a kind whose every tap is a part's (the calendar
    // at rest: its paper's taps are its days', its roll's the roll's), by a RIGHT-CLICK, which selects the object under
    // the pointer first on a named part too (DK-11, R26), its grown menu then folded by Esc; a tap a text part takes is let
    // go with Esc, the object still selected — and the bar over it first
    const tap = await body(s.type);
    if (tap !== null) await press(tap);
    else {
      const at = await reach(s.type);
      win.webContents.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
      await sleep(40);
      win.webContents.sendInputEvent({
        type: "mouseDown",
        x: at.x,
        y: at.y,
        button: "right",
        clickCount: 1,
      });
      await sleep(50);
      win.webContents.sendInputEvent({
        type: "mouseUp",
        x: at.x,
        y: at.y,
        button: "right",
        clickCount: 1,
      });
      await until(
        `the ${s.name} selected by a right-click, its menu grown`,
        10_000,
        `document.querySelector("[data-selection-bar]")?.hasAttribute("data-open") === true`,
      );
      await key("Escape");
      await until(
        "the menu folded",
        5_000,
        `document.querySelector("[data-selection-bar]")?.hasAttribute("data-open") === false`,
      );
    }
    await sleep(300);
    if (await js<boolean>(`document.activeElement?.hasAttribute("data-desk-editor") === true`)) {
      await key("Escape");
      await until(
        "the writing let go",
        5_000,
        `document.activeElement?.hasAttribute("data-desk-editor") !== true`,
      );
    }
    await until(
      `the ${s.name} selected, its bar shown`,
      10_000,
      `(() => { const b = document.querySelector("[data-selection-bar]"); return (globalThis.__vfDesk.anchor()?.count ?? 0) === 1 && b?.getAttribute("data-shown") === "true" && b?.getAttribute("data-face") === "selection"; })()`,
    );
    await sleep(300); // the bar's fade in (180 ms) done: the travel starts from a bar SEEN
    // picked up by the desk's own ⏎ (ICE's keymap: ops.open), the recorder armed first
    await js(ARM_RECORDER);
    await key("Return");
    await until(`the ${s.name} in hand`, 10_000, `globalThis.__vfDesk.held() !== null`);
    const declared = await js<TravelTiming["declared"]>(DECLARED_TRAVEL);
    await until(
      `the ${s.name}'s tools in hand, the travel over`,
      10_000,
      `(() => { const h = ${READ_HAND}; const held = globalThis.__vfDesk.held(); return h !== null && h.shown && h.face === "hand" && !h.traveling && held?.frame?.settled === true; })()`,
    );
    await sleep(200);
    const seen = await hand();
    const held = await js<{ entity: number; frame: HeldFrame | null } | null>(
      "globalThis.__vfDesk.held()",
    );
    const rec = await js<{ transitions: TransitionSeen[] } | null>(READ_RECORDER);
    const timing = travelTiming(rec?.transitions ?? [], declared);
    problems.push(...judgeHandPlace(view, seen).map(row));
    problems.push(...judgeReadingFit(view, held?.frame ?? null).map(row));
    // Copy leads the bar in hand as it leads the bar at rest (HN-D3, HN-3: the desk's Send to… is Copy)
    const expected = [
      "copy",
      "|",
      ...s.tools,
      ...(s.readout === null ? [] : ["READOUT"]),
      "|",
      "done",
    ];
    const cells = seen.cells.map((c) => (c.startsWith("“") ? "READOUT" : c));
    if (JSON.stringify(cells) !== JSON.stringify(expected))
      problems.push(
        row(
          `the tools in hand were ${JSON.stringify(seen.cells)}, not ${JSON.stringify(expected)}`,
        ),
      );
    if (s.readout !== null && (seen.readout === null || !s.readout.test(seen.readout)))
      problems.push(row(`the readout read ${JSON.stringify(seen.readout)}`));
    if (seen.tips["done"] !== "Put it down  Esc")
      problems.push(row(`Done's tip read ${JSON.stringify(seen.tips["done"])}`));
    // the hand's Copy is handCells' own cell, apart from the bar at rest's (whose tip the selection bar's ONE row
    // judges), so its tip and the desk's key are judged here
    if (seen.tips["copy"] !== "Copy  ⌘C")
      problems.push(row(`Copy's tip read ${JSON.stringify(seen.tips["copy"])}`));
    problems.push(...judgeTravel(timing).map((p) => `TRAVEL (${s.name}): ${p}`));

    // the stills: the specimen in hand as it came, by day and by night (before a tool is used — no cell under the pointer)
    await shoot(`dk-12-hand-${s.name}-light.png`);
    await theme("dark");
    await until(
      `the ${s.name} still in hand by night`,
      5_000,
      `(${READ_HAND}).face === "hand" && globalThis.__vfDesk.held() !== null`,
    );
    await shoot(`dk-12-hand-${s.name}-dark.png`);
    await theme("light");

    // a tool USED through the bar (ops.useHeldTool), read back
    let used: Record<string, unknown> = {};
    if (s.name === "notebook") {
      await pressTool("turn:1");
      await until("the notebook's page turned", 5_000, `(${READ_HAND}).readout === "Page 2"`);
      await pressTool("pen:felt");
      await until("the felt pen in hand", 5_000, `(${READ_HAND}).on.includes("pen:felt")`);
      const after = await hand();
      used = { turned: after.readout, inHand: after.on, pressed: after.pressed["pen:felt"] };
      if (after.pressed["pen:fountain"] !== "false")
        problems.push(row("the fountain pen stayed pressed after the felt was taken up"));
    } else if (s.name === "whiteboard") {
      await pressTool("eraser");
      await until("the eraser in hand", 5_000, `(${READ_HAND}).pressed["eraser"] === "true"`);
      const after = await hand();
      used = { pressed: after.pressed, on: after.on };
      if (after.on.some((id) => after.dots.includes(id)))
        problems.push(
          row(`a marker kept its ring with the eraser in hand (${JSON.stringify(after.on)})`),
        );
    } else if (s.name === "calendar") {
      const before = seen.readout;
      await pressTool("month:1");
      await until(
        "the calendar's month turned",
        5_000,
        `(${READ_HAND}).readout !== ${JSON.stringify(before)}`,
      );
      const months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
      const after = (await hand()).readout;
      used = { before, after };
      if (months.indexOf(after ?? "") !== (months.indexOf(before ?? "") + 1) % 12)
        problems.push(
          row(`a month turned read ${JSON.stringify(after)} after ${JSON.stringify(before)}`),
        );
    } else {
      const hourOf = (t: string | null): number => Number((t ?? "").split(":")[0]) % 12;
      const before = (await hand()).readout;
      await pressTool("zone-ahead");
      await until(
        "the clock's hour moved",
        5_000,
        `(() => { const r = (${READ_HAND}).readout ?? ""; return Number(r.split(":")[0]) % 12 === ${(hourOf(before) + 1) % 12}; })()`,
      );
      const after = (await hand()).readout;
      used = { before, after };
      await pressTool("zone-back"); // the hour put back, the board as it was
    }
    say(
      `SMOKE_CANVAS_HAND_${s.name.toUpperCase()} ${JSON.stringify({ cells: seen.cells, readout: seen.readout, dots: seen.dots, on: seen.on, pressed: seen.pressed, tips: seen.tips, row: seen.row, frame: held?.frame ?? null, used })}`,
    );
    say(`SMOKE_CANVAS_HAND_TRAVEL ${JSON.stringify({ specimen: s.name, ...timing })}`);

    // Done: put down — hidden while it flies home, back over it 200 ms after it lands
    await js(ARM_RECORDER);
    await pressTool("done");
    await until(`the ${s.name} put down`, 10_000, "globalThis.__vfDesk.held() === null");
    await until(
      `the bar back over the ${s.name}`,
      10_000,
      `(() => { const b = document.querySelector("[data-selection-bar]"); return b?.getAttribute("data-shown") === "true" && b?.getAttribute("data-face") === "selection" && (globalThis.__vfDesk.anchor()?.held === undefined); })()`,
    );
    await sleep(250);
    const back = await js<{
      transitions: TransitionSeen[];
      frames: { t: number; held: string; shown: boolean }[];
    } | null>(READ_RECORDER);
    const frames = back?.frames ?? [];
    const flew = frames.findIndex((f) => f.held === "landing");
    const hiddenWhileFlying = frames.filter((f) => f.held === "landing").every((f) => !f.shown);
    const landed = frames.find((f, i) => i > flew && flew >= 0 && f.held === "none");
    const fadeIn = (back?.transitions ?? []).find(
      (t) =>
        t.on === "bar" &&
        t.property === "opacity" &&
        landed !== undefined &&
        t.start >= landed.t - 20,
    );
    if (flew < 0) problems.push(row("Done put it down with no flight home"));
    if (!hiddenWhileFlying) problems.push(row("the bar showed while the object flew home"));
    problems.push(...judgeReturn(landed?.t ?? null, fadeIn?.start ?? null).map(row));
    const barBack = await js<{ cells: string[] } | null>(
      `(() => { const b = document.querySelector("[data-selection-bar]"); return b === null ? null : { cells: [...b.querySelectorAll('[data-face-row="selection"] [data-act]')].map((e) => e.getAttribute("data-act")) }; })()`,
    );
    say(
      `SMOKE_CANVAS_HAND_BACK ${JSON.stringify({ specimen: s.name, hiddenWhileFlying, landedAt: landed?.t ?? null, fadeInAt: fadeIn?.start ?? null, backMs: landed !== undefined && fadeIn !== undefined ? fadeIn.start - landed.t : null, bar: barBack?.cells ?? null })}`,
    );
    await js("globalThis.__vfDk12Rec?.stop?.()");
  }
  await deselect();

  // ── COUNTERS: placements ≤ publishes through the four ─────────────────────────────────────────────────────────
  const counters1 = await js<BarCounters>("globalThis.__vfDesk.bar()");
  problems.push(...judgeCounters(counters0, counters1).map((p) => `HAND COUNTERS: ${p}`));
  say(`SMOKE_CANVAS_HAND_COUNTERS ${JSON.stringify({ before: counters0, after: counters1 })}`);
  return problems;
}
