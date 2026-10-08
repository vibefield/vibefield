// DK-18 (plan (24)) — THE DESK'S LONG WAKE AFTER AN ACT, NAMED AND HELD (smoke:canvas). DK-9 saw window 1's seed board draw
// ≈ 2,370 frames (≈ 20 s at 120 Hz) after a cover lowered, every cycle, before it rested, while window 2 rested at once; DK-17b
// met its twin: after a MOVE the desk stayed awake ≈ 21.8 s, so the explorer's owed still waited that long. Both are the
// AMBIENT WIND — the canon's (DESIGN.md §6 M5; ICE design-015 §4.6, D-D9): in ICE's `idle` mode (the desk layer's default,
// which VibeField keeps) the mat's wind, grain and tilt run while the desk was TOUCHED within 20 s — a pointer move, a camera
// move or gesture, a nav, a re-dress (ICE `compose/reflector.ts`: every one calls `ambient.touch`) — then ease to still over
// 2 s; a window nobody touched rests at once. Nothing else holds the desk, and the rows hold exactly that by its own counters:
//   ACT     — an object moved by the pointer (a press, a drag, the button let go — the durable act THUMB takes): with the wind
//             STILLED (`ambient("still")`) the desk rests within `stillMs` — so nothing but the wind may keep it awake; with
//             the wind (`idle`, the product's) it rests by the canon's 20 s + 2 s and `slackMs` — and not before 20 s (the wind
//             blew; an idle mode that never touched would read as a desk that rests at once);
//   COVER   — the desk at rest and its wind long still, a cover over it and back (Godview → Canvas): it rests within `stillMs`
//             of the cover lowering — the lowering touches nothing (DK-9's 2,370 frames were a cover lowered INSIDE window 1's
//             wind, never a wake of the cover's own).
// Each rest is timed from the act's last event to the first look that finds `rest().asleep`, looks 50 ms apart, the wakes
// that grew in the wait named (`rest().wakes`), the host's load beside the numbers.

import { loadavg } from "node:os";
import type { BrowserWindow } from "electron";
import { POINT_IN } from "./smoke-selection-bar";

/** The canon's numbers (ICE `AMBIENT_DEFAULTS`: idleMs 20 000, settleMs 2 000) and the rows' budgets. */
export const REST = {
  /** the kind moved: a static one (a clock's minute turns its face) */
  type: "desk.photo",
  /** the wind's window after the last touch, then its ease to still (ICE's `idle` defaults) */
  windMs: 20_000,
  settleMs: 2_000,
  /** past the wind and its ease: a frame, the look's 50 ms, the loop's own sleep */
  slackMs: 1_500,
  /** the stilled wind's budget, and the lowered cover's: the act's own frames, a spring, the look */
  stillMs: 1_500,
} as const;

/** One rest as a row saw it. */
export interface RestSeen {
  /** from the act's last event to the first look that found the desk asleep, ms; null if it never rested in the bound */
  readonly ms: number | null;
  /** the wakes that grew while it was awake (`rest().wakes`) */
  readonly wakes: Readonly<Record<string, number>>;
}

/** ACT with the wind: rests by the canon's wind and its ease (and a slack), and not before the wind's 20 s — the wind blew. */
export function judgeWindRest(seen: RestSeen): string[] {
  if (seen.ms === null) return ["with the wind the desk never rested after the act"];
  const most = REST.windMs + REST.settleMs + REST.slackMs;
  if (seen.ms > most)
    return [
      `with the wind the desk rested ${seen.ms} ms after the act — past the wind's ${REST.windMs} + ${REST.settleMs} ms and ${REST.slackMs} of slack: something else held it (${JSON.stringify(seen.wakes)})`,
    ];
  if (seen.ms < REST.windMs)
    return [
      `with the wind the desk rested ${seen.ms} ms after the act — before the wind's ${REST.windMs} ms: the act touched no wind`,
    ];
  return [];
}

/** ACT with the wind stilled, and the cover lowered over a still wind: the desk rests at once — within `stillMs`. */
export function judgePromptRest(what: string, seen: RestSeen): string[] {
  if (seen.ms === null) return [`${what}: the desk never rested`];
  return seen.ms > REST.stillMs
    ? [
        `${what}: the desk rested ${seen.ms} ms after, over its ${REST.stillMs} — something but the wind held it (${JSON.stringify(seen.wakes)})`,
      ]
    : [];
}

export interface RestRowsDriver {
  readonly win: BrowserWindow;
  readonly say: (line: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** DK-18's REST rows (above). Returns the problems, each in words. */
export async function restRows(d: RestRowsDriver): Promise<string[]> {
  const { win, say } = d;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const key = async (keyCode: string, modifiers: ("meta" | "control")[] = []): Promise<void> => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await sleep(80);
  };
  /** The desk's wakes now, by reason. */
  const wakes = (): Promise<Record<string, number>> => js("globalThis.__vfDesk.rest().wakes");
  /** From now, the first look that finds the desk asleep (50 ms apart), up to `boundMs`; the wakes that grew meanwhile. */
  const restFrom = async (t0: number, boundMs: number): Promise<RestSeen> => {
    const w0 = await wakes();
    let ms: number | null = null;
    while (Date.now() - t0 < boundMs) {
      if (await js<boolean>("globalThis.__vfDesk.rest().asleep === true")) {
        ms = Date.now() - t0;
        break;
      }
      await sleep(50);
    }
    const w1 = await wakes();
    const grew: Record<string, number> = {};
    for (const [reason, n] of Object.entries(w1)) {
      const by = n - (w0[reason] ?? 0);
      if (by > 0) grew[reason] = by;
    }
    return { ms, wakes: grew };
  };
  /** The photo moved by the pointer (a press on its body, a drag, the button let go); answers the release's time. */
  const move = async (dx: number): Promise<number> => {
    const at = await js<{ x: number; y: number } | null>(POINT_IN(REST.type));
    if (at === null)
      throw new Error(`the ${REST.type} was not picked where the desk receives a press`);
    const from = { x: Math.round(at.x), y: Math.round(at.y) };
    win.webContents.sendInputEvent({ type: "mouseMove", x: from.x, y: from.y });
    await sleep(60);
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: from.x,
      y: from.y,
      button: "left",
      clickCount: 1,
    });
    await sleep(60);
    for (const k of [0.25, 0.5, 0.75, 1]) {
      win.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(from.x + dx * k),
        y: from.y,
        button: "left",
        modifiers: ["leftbuttondown"],
      });
      await sleep(40);
    }
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: from.x + dx,
      y: from.y,
      button: "left",
      clickCount: 1,
    });
    return Date.now();
  };
  const undo = async (): Promise<void> => {
    await key("z", [process.platform === "darwin" ? "meta" : "control"]);
    await sleep(300);
  };

  const problems: string[] = [];
  const ambient = await js<string>("globalThis.__vfDesk.ambient()");
  try {
    // ACT, the wind stilled: nothing but the wind may hold the desk
    await js(`globalThis.__vfDesk.ambient("still")`);
    const still = await restFrom(await move(40), 10_000);
    problems.push(...judgePromptRest("REST ACT (the wind stilled)", still));
    await undo();
    await restFrom(Date.now(), 10_000);
    // ACT, with the wind (the product's `idle`): the canon's 20 s and its 2 s ease
    await js(`globalThis.__vfDesk.ambient("idle")`);
    const wind = await restFrom(await move(40), REST.windMs + REST.settleMs + 10_000);
    problems.push(...judgeWindRest(wind).map((p) => `REST ACT: ${p}`));
    await undo();
    // the undo is no touch — no pointer, no camera — so the wind it finds is already still
    await restFrom(Date.now(), 10_000);
    // COVER: the desk at rest, its wind long still — a cover over it and back
    await js(`globalThis.vibefield.view.set("godview")`);
    await js("globalThis.__vfDesk.whenParked(10000)");
    await sleep(600);
    await js(`globalThis.vibefield.view.set("canvas")`);
    const lowered = Date.now();
    await sleep(100);
    const cover = await restFrom(lowered, 10_000);
    problems.push(...judgePromptRest("REST COVER (lowered over a still wind)", cover));
    say(
      `SMOKE_CANVAS_REST ${JSON.stringify({ still, wind, cover, budgets: REST, load: loadavg().map((v) => Number(v.toFixed(1))) })}`,
    );
  } finally {
    await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient)})`);
  }
  return problems;
}
