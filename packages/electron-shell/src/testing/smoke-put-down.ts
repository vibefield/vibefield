// PT-5a (ruling 6; ICE M24 LT3) — PUT-DOWN, IN THE PRODUCT (smoke:kind-faults): a kind struck out while its object is IN HAND
// is put down by the host — the object on the desk again, wearing the missing face — never held in the hand forever. ICE's own
// host hands the desk layer the engine's ops (`createDeskHost`: `ops: engine.ops`, `putDown` among them since
// `0.16.0-portals.3`), and VibeField mounts through it: nothing of VibeField's is wired for this — the row is the witness.
//
// The fixture is the clock that breaks IN HAND (examples/plugins/desk-clock/src/broken.ts `clockFragile`, staged for the
// fault run beside the two older ones): it stands at rest, is picked up as the clock is (⏎ on the selection), and 0.4 s on
// its record throws on every call — three strikes, its kind missing. The row lays one, picks it up, SEES it in hand, sees
// its kind named among the desk's faults, and then — pressing nothing — sees the hand empty and the clock where it lay,
// picked as its type and worded "· can't draw".

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

/** The row's numbers. */
export const PUT_DOWN = {
  /** where the clock is laid on the first board (world units), and its size — beside the fault rows' three */
  at: { x: 560, y: 960, w: 150, h: 150 },
  /** how long the strike, and then the put-down, are waited for (ms) */
  struckWithinMs: 20_000,
  downWithinMs: 8_000,
} as const;

/** What the row saw — the SMOKE_CANVAS_PUT_DOWN line, and what the judge reads. */
export interface PutDownSeen {
  /** the clock found on the desk at rest (its type picked there) */
  readonly laid: boolean;
  /** it was SEEN in hand after ⏎ */
  readonly held: boolean;
  /** its kind named among the desk's faults */
  readonly struck: boolean;
  /** from the strike seen to the hand empty (null: still in hand) */
  readonly downMs: number | null;
  /** then: what its place picks, the bar's words for its type, and how many of it are on the board */
  readonly picked: string | null;
  readonly words: string | null;
  readonly census: number;
}

/** PUT-DOWN: seen in hand, struck there, put down with nothing pressed, on the desk as its missing face. */
export function judgePutDown(seen: PutDownSeen, type: string, title: string): string[] {
  if (!seen.laid)
    return [
      "PUT-DOWN: the clock that breaks in hand was not found on the desk — the row proved nothing",
    ];
  if (!seen.held) return ["PUT-DOWN: the clock was never seen in hand — the row proved nothing"];
  const out: string[] = [];
  if (!seen.struck)
    out.push(
      "PUT-DOWN: the clock's kind was not struck out while it was held — the row proved nothing",
    );
  if (seen.downMs === null)
    out.push(
      "PUT-DOWN: the struck kind's object is STILL IN THE HAND — the host did not put it down (ICE's `ops.putDown` is not handed to the desk's layer)",
    );
  if (seen.census !== 1)
    out.push(
      `PUT-DOWN: ${seen.census} of the clock on the board after the put-down, not the one laid`,
    );
  if (seen.picked !== type)
    out.push(
      `PUT-DOWN: where the clock lay the desk picks ${JSON.stringify(seen.picked)}, not the clock (${type})`,
    );
  if (seen.words !== `${title} · can't draw`)
    out.push(
      `PUT-DOWN: the bar's words for the clock are ${JSON.stringify(seen.words)}, not "${title} · can't draw" — it does not wear the missing face`,
    );
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface PutDownDriver {
  readonly win: BrowserWindow;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
  /** the fixture's type, and its title as the bar words it */
  readonly type: string;
  readonly title: string;
}

/** The middle of the desk's picks of `type`, in the window's CSS px (null: none in view). */
const MIDDLE_OF = (type: string): string => `(() => {
  const d = globalThis.__vfDesk; const el = document.querySelector("[data-desk]");
  if (d === undefined || el === null) return null;
  const r = el.getBoundingClientRect();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (let y = 4; y < r.height; y += 8) for (let x = 4; x < r.width; x += 8) {
    if (d.pick({ x, y })?.type !== ${JSON.stringify(type)}) continue;
    n += 1; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return n === 0 ? null : { x: r.left + (x0 + x1) / 2, y: r.top + (y0 + y1) / 2, desk: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } };
})()`;

/** The row (above). Returns the problems, each in words. */
export async function putDownRow(d: PutDownDriver): Promise<string[]> {
  const { win, say, type, title } = d;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const struckNow = (): Promise<boolean> =>
    js<boolean>(
      `(globalThis.__vfDesk.status().faults ?? []).some((f) => f.kind === ${JSON.stringify(type)})`,
    );
  const heldNow = (): Promise<number | null> =>
    js<number | null>("globalThis.__vfDesk.held()?.entity ?? null");
  let seen: PutDownSeen = {
    laid: false,
    held: false,
    struck: false,
    downMs: null,
    picked: null,
    words: null,
    census: 0,
  };
  try {
    await js(
      `globalThis.__vfFieldSmoke.spawnWidget(${JSON.stringify(type)}, { x: ${PUT_DOWN.at.x}, y: ${PUT_DOWN.at.y}, w: ${PUT_DOWN.at.w}, h: ${PUT_DOWN.at.h}, props: { seconds: true } })`,
    );
    await sleep(900);
    const at = await js<{ x: number; y: number; desk: { x: number; y: number } } | null>(
      MIDDLE_OF(type),
    );
    if (at !== null) {
      seen = { ...seen, laid: true };
      // selected by a press on it, picked up by ⏎ — as a person picks a clock up
      const mouse = {
        x: Math.round(at.x),
        y: Math.round(at.y),
        button: "left",
        clickCount: 1,
      } as const;
      win.webContents.sendInputEvent({ type: "mouseMove", x: mouse.x, y: mouse.y });
      await sleep(60);
      win.webContents.sendInputEvent({ type: "mouseDown", ...mouse });
      await sleep(50);
      win.webContents.sendInputEvent({ type: "mouseUp", ...mouse });
      const selected = Date.now() + 6_000;
      while (
        Date.now() < selected &&
        (await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0")) !== 1
      )
        await sleep(60);
      await sleep(250);
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
      // SEEN in hand (it breaks 0.4 s on: read at once and often)
      const pickup = Date.now() + 3_000;
      let held = false;
      while (!held && Date.now() < pickup) {
        held = (await heldNow()) !== null;
        if (!held) await sleep(20);
      }
      // struck out while held
      const strike = Date.now() + PUT_DOWN.struckWithinMs;
      let struck = await struckNow();
      while (!struck && Date.now() < strike) {
        await sleep(50);
        struck = await struckNow();
      }
      // …and put down, with nothing pressed
      const struckAt = Date.now();
      let downMs: number | null = null;
      while (Date.now() - struckAt < PUT_DOWN.downWithinMs) {
        if ((await heldNow()) === null) {
          downMs = Date.now() - struckAt;
          break;
        }
        await sleep(40);
      }
      await sleep(1_200);
      if (d.shotDir !== undefined) {
        mkdirSync(d.shotDir, { recursive: true });
        writeFileSync(join(d.shotDir, "pt-5a-put-down.png"), (await win.capturePage()).toPNG());
      }
      seen = {
        laid: true,
        held,
        struck,
        downMs,
        picked: await js<string | null>(
          `globalThis.__vfDesk.pick(${JSON.stringify(at.desk)})?.type ?? null`,
        ),
        words: await js<string | null>(
          `globalThis.__vfDesk.words(${JSON.stringify(type)})?.label ?? null`,
        ),
        census: await js<number>(`globalThis.__vfDesk.census()[${JSON.stringify(type)}] ?? 0`),
      };
    }
  } catch (error) {
    say(`SMOKE_CANVAS_PUT_DOWN ${JSON.stringify(seen)}`);
    return [`PT-5a PUT-DOWN: ${error instanceof Error ? error.message : String(error)}`];
  }
  say(`SMOKE_CANVAS_PUT_DOWN ${JSON.stringify(seen)}`);
  return judgePutDown(seen, type, title);
}
