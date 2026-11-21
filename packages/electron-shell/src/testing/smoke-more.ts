// MK-6 — MORE IN PLUGINS… AND THE BOARD'S RISE, IN THE PRODUCT (smoke:canvas and smoke:market;
// DESIGN.md §8 "The pegboard", its More in Plugins… and After an install; §8 "Plugins — the
// frame's second popup"). Read back off the DOM the chrome drew and off the desk's door
// (`window.__vfDesk`: the tray's anchor, ICE's focus, the census), as DK-13's rows are
// (smoke-pegboard.ts):
//   MORE — smoke:canvas, after DK-13. The board raised by the create, the pill at its foot is
//          drawn whole: 32 tall, corners 16, centred on the filters' centre line (the drawer's),
//          its foot 100 above the window's (the reserve a held object keeps there, §10's
//          88 + 12). Tab from the board reaches it, the third stop; ↵ on it opens the Plugins
//          popup on Discover and the board folds; a press on it does the same from a chosen
//          category. With no plugin list (smoke:canvas configures none) Discover says "Nothing
//          to discover yet". It steps aside while an object is in hand: read mid-take where
//          the board still stands; when no take holds the board out, the row says so and
//          judges nothing there (not traced: whether ICE keeps the drawer drawn under a take's
//          drag before its release). Until MK-4d draws the pill, MORE is one red that names
//          the slice it waits on (MORE_WAITS) and reads no further: with no pill, Tab, ↵ and a
//          press would land on whatever else holds the focus.
//   RISE — smoke:market, after an install (MK-D8's fallback B, MK-E2). The page's Show on the
//          pegboard ("Show them on the pegboard" for a set of more) folds the popup, and the
//          board rises on the set's first category with its first object ICE's focus
//          (`anchor.focused`) and ringed, the board holding the keyboard; ↵ lays it. Over
//          Godview the frame goes to Canvas first (MK-E14).
// Words are §9's ("The plugins' words"). The pill and every act are found by their words,
// never by a class, so the rows read what a person reads. Every press is `sendInputEvent`, and
// no window is made the key window (smoke-window.test.ts).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

/** A point on screen, CSS px. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A rect on screen, CSS px. */
export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** §8 "The pegboard", More in Plugins…: the pill's own numbers. */
export const PILL = {
  /** "More in Plugins…" (§9 "The doors") */
  words: "More in Plugins…",
  height: 32,
  radius: 16,
  /** its foot above the window's foot: the line's 88 + 12 (§10; `DESK_HOLD.band`) */
  foot: 100,
} as const;

/** §9 "Installing, and after": the act after an install, for a set of one and of more. */
export const SHOW_ON_BOARD = ["Show on the pegboard", "Show them on the pegboard"] as const;

/** "Nothing to discover yet" (§9; `frame/plugins/plugins-words.ts` NO_REGISTRY.title). */
export const NOTHING_TO_DISCOVER = "Nothing to discover yet";

const near = (a: number, b: number, eps = 1.5): boolean => Math.abs(a - b) <= eps;

/** The drawer as the tray's anchor says it was drawn (smoke-pegboard.ts's `DrawerSeen`). */
export interface DrawerAt {
  readonly x: number;
  readonly w: number;
  readonly p: number;
}

/** Is the pill where §8 puts it, with its own size and corners? What is wrong, in words. */
export function judgePill(
  pill: { readonly rect: Rect; readonly radius: string } | null,
  drawer: DrawerAt | null,
  view: { readonly height: number },
): string[] {
  if (drawer === null) return ["the tray drew no drawer"];
  if (pill === null) return [`no "${PILL.words}" stood at the board's foot`];
  const problems: string[] = [];
  const { rect } = pill;
  if (!near(rect.y1 - rect.y0, PILL.height, 1))
    problems.push(`the pill is ${rect.y1 - rect.y0} tall, not ${PILL.height}`);
  const centre = drawer.x + drawer.w / 2;
  if (!near((rect.x0 + rect.x1) / 2, centre))
    problems.push(`the pill's centre is ${(rect.x0 + rect.x1) / 2}, not the drawer's ${centre}`);
  const foot = view.height - PILL.foot;
  if (!near(rect.y1, foot, 1))
    problems.push(
      `the pill's foot is at ${rect.y1}, not ${foot} (${PILL.foot} above the window's)`,
    );
  if (pill.radius !== `${PILL.radius}px`)
    problems.push(`the pill's corners are ${pill.radius}, not ${PILL.radius}px`);
  return problems;
}

/** A7 — MORE's tag while no pill stands at the board's foot: its red names the slice it waits on,
 * as smoke:market's waiting rows name theirs (`MarketRow.needs`). */
export const MORE_WAITS = "MORE (waits on MK-4d's pill)";

/** PLACE: the pill's place, size and corners, shown and wearing its glyph, each red tagged MORE,
 * or MORE_WAITS while no pill is drawn over a drawn drawer. */
export function judgePlace(
  pill: PillSeen | null,
  drawer: DrawerAt | null,
  view: { readonly height: number },
): string[] {
  const tag = pill === null && drawer !== null ? MORE_WAITS : "MORE";
  const problems = judgePill(pill, drawer, view).map((p) => `${tag}: ${p}`);
  if (pill === null) return problems;
  if (!pill.shown) problems.push("MORE: the pill stood hidden with the board out");
  if (!pill.glyph) problems.push("MORE: the pill wears no `plugin` glyph");
  return problems;
}

/** The board as RISE reads it after Show on the pegboard. */
export interface RiseSeen {
  readonly popupOpen: boolean;
  readonly boardOpen: boolean;
  readonly category: string | null;
  readonly focused: string | null;
  readonly boardHasKeyboard: boolean;
  readonly ring: boolean;
  readonly view: string | null;
}

/** The board risen on the set's first category, its first object ICE's focus, the keyboard its. */
export function judgeRise(
  seen: RiseSeen,
  first: { readonly type: string; readonly category: string },
): string[] {
  const problems: string[] = [];
  if (seen.popupOpen) problems.push("the popup did not fold");
  if (seen.view !== null && seen.view !== "canvas")
    problems.push(`the frame stayed on ${seen.view}, not Canvas (MK-E14)`);
  if (!seen.boardOpen) return [...problems, "the board did not rise"];
  if (seen.category !== first.category)
    problems.push(`the board rose on ${JSON.stringify(seen.category)}, not ${first.category}`);
  if (seen.focused !== first.type)
    problems.push(
      `ICE's focus is ${JSON.stringify(seen.focused)}, not the set's first ${first.type}`,
    );
  if (!seen.boardHasKeyboard) problems.push("the board did not hold the keyboard");
  if (!seen.ring) problems.push("no ring stood over the focused object");
  return problems;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** The press and key helpers every MK-6 row drives with, over one window (smoke-pegboard.ts's own,
 * shared here). */
export interface WindowHands {
  js<T>(expression: string): Promise<T>;
  until(label: string, timeoutMs: number, expression: string): Promise<void>;
  press(at: Point): Promise<void>;
  /** Press the first control in `scope` whose words are one of `words`; false: none shows. */
  pressWords(scope: string, words: readonly string[]): Promise<boolean>;
  pressAt(selector: string): Promise<void>;
  key(keyCode: string, modifiers?: ("meta" | "control" | "shift")[], char?: boolean): Promise<void>;
  /** ⌘ on the Mac, Ctrl off it */
  chord(keyCode: string): Promise<void>;
  shoot(name: string): Promise<void>;
}

export function handsOver(win: BrowserWindow, shotDir: string | undefined): WindowHands {
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const press = async (at: Point): Promise<void> => {
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
  const key = async (
    keyCode: string,
    modifiers: ("meta" | "control" | "shift")[] = [],
    char = false,
  ): Promise<void> => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    if (char) win.webContents.sendInputEvent({ type: "char", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await sleep(80);
  };
  return {
    js,
    async until(label, timeoutMs, expression) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if ((await js<unknown>(expression)) === true) return;
        await sleep(80);
      }
      throw new Error(`${label} did not happen within ${timeoutMs}ms`);
    },
    press,
    async pressWords(scope, words) {
      const at = await js<Point | null>(wordsAt(scope, words));
      if (at === null) return false;
      await press(at);
      return true;
    },
    async pressAt(selector) {
      const at = await js<Point | null>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el === null) return null;
        el.scrollIntoView({ block: "nearest" });
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      if (at === null) throw new Error(`no ${selector} to press`);
      await press(at);
    },
    key,
    chord: (keyCode) => key(keyCode, [process.platform === "darwin" ? "meta" : "control"]),
    async shoot(name) {
      if (shotDir === undefined) return;
      mkdirSync(shotDir, { recursive: true });
      writeFileSync(join(shotDir, name), (await win.capturePage()).toPNG());
    },
  };
}

/** Where a control in `scope` whose words are one of `words` stands, scrolled into sight; null:
 * none shows. Its words are its text less any `kbd` (the ↵ printed on an act), spaces folded. */
export function wordsAt(scope: string, words: readonly string[]): string {
  return `(() => {
    const scope = document.querySelector(${JSON.stringify(scope)});
    if (scope === null) return null;
    const wanted = ${JSON.stringify(words)};
    const said = (el) => [...el.childNodes]
      .filter((n) => !(n.nodeType === 1 && n.tagName === "KBD"))
      .map((n) => n.textContent ?? "")
      .join("")
      .replace(/\\s+/gu, " ")
      .trim();
    const controls = scope.querySelectorAll(
      'button, [role="button"], [role="switch"], [role="radio"], [role="option"]',
    );
    const hit = [...controls].find((el) => wanted.includes(said(el)) && el.getClientRects().length > 0);
    if (hit === undefined) return null;
    hit.scrollIntoView({ block: "nearest" });
    const r = hit.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`;
}

/** The pill as drawn, found by its words inside the pegboard; null while none shows. */
const PILL_READ = `(() => {
  const board = document.querySelector(".vf-pegboard");
  if (board === null) return null;
  const words = ${JSON.stringify(PILL.words)};
  const pill = [...board.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").replace(/\\s+/gu, " ").trim() === words,
  );
  if (pill === undefined) return null;
  const style = getComputedStyle(pill);
  const r = pill.getBoundingClientRect();
  return {
    rect: { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom },
    radius: style.borderTopLeftRadius,
    shown: style.visibility !== "hidden" && Number(style.opacity) > 0.01 && r.height > 0,
    focused: document.activeElement === pill,
    glyph: pill.querySelector('[data-glyph="plugin"]') !== null,
  };
})()`;

export interface PillSeen {
  readonly rect: Rect;
  readonly radius: string;
  readonly shown: boolean;
  readonly focused: boolean;
  readonly glyph: boolean;
}

/** The popup as MORE reads it: open, its chosen tab, its body's words. */
const POPUP_BRIEF = `(() => {
  const pop = document.querySelector('.vf-plugins-pop[role="dialog"]');
  if (pop === null) return { open: false, tab: null, body: "" };
  const checked = pop.querySelector('.vf-plugins-seg [role="radio"][aria-checked="true"]');
  return {
    open: true,
    tab: checked?.childNodes[0]?.textContent?.trim() ?? null,
    body: (pop.querySelector(".vf-plugins-body")?.textContent ?? "").replace(/\\s+/gu, " ").trim(),
  };
})()`;

interface PopupBrief {
  readonly open: boolean;
  readonly tab: string | null;
  readonly body: string;
}

const BOARD_OPEN = "globalThis.__vfDesk.pegboard()?.anchor.open === true";
/** The board out and its slide done (the drawer whole): its filters and its pill take a press only
 * then (smoke:market's CARRY waits on it too, item 433). */
export const BOARD_SETTLED = `(() => {
  const b = globalThis.__vfDesk.pegboard();
  return b !== null && b.anchor.open && b.anchor.drawer !== null && b.anchor.drawer.p >= 0.999;
})()`;
const BOARD_SHUT = `(() => {
  const b = globalThis.__vfDesk.pegboard();
  return b !== null && !b.anchor.open;
})()`;
const POPUP_OPEN = `document.querySelector('.vf-plugins-pop[role="dialog"]') !== null`;
const POPUP_SHUT = `document.querySelector('.vf-plugins-pop[role="dialog"]') === null`;
/** MK-6 (2026-11-21): what the board and the frame were when a board wait ran out, read once at the
 * throw: the tray's open, held and slide, whether the popup stands, and the focused element by its
 * tag and first class. Facts of the chrome only, never an object's text. */
const BOARD_FACTS = `(() => {
  const b = globalThis.__vfDesk.pegboard();
  const a = document.activeElement;
  const first = a === null ? "" : String(a.className ?? "").split(" ")[0];
  return JSON.stringify({
    board: b === null ? null : { open: b.anchor.open, held: b.anchor.held === true, p: b.anchor.drawer?.p ?? null },
    popup: document.querySelector('.vf-plugins-pop[role="dialog"]') !== null,
    focus: a === null ? null : a.tagName + (first === "" ? "" : "." + first),
  });
})()`;

/** The first specimen's centre and a drop where nothing picks, both in the window's px: the desk's
 * door says them in the desk's own, which starts at the desk element's corner (smoke-desk-rig.ts's
 * TAKE does the same sum). The drop is sought above the board's half. */
const TAKE_AT = `(() => {
  const d = globalThis.__vfDesk;
  const s = d.pegboard()?.specimens?.[0];
  const el = document.querySelector("[data-desk]");
  if (s === undefined || el === null) return null;
  const desk = el.getBoundingClientRect();
  for (let y = 140; y < desk.height / 2; y += 24) {
    for (let x = 80; x < desk.width - 80; x += 24) {
      if (d.pick({ x, y }) !== null) continue;
      const under = document.elementFromPoint(desk.left + x, desk.top + y);
      if (under === null || !el.contains(under)) continue;
      return {
        type: s.type,
        from: {
          x: Math.round(desk.left + (s.object.x0 + s.object.x1) / 2),
          y: Math.round(desk.top + (s.object.y0 + s.object.y1) / 2),
        },
        to: { x: Math.round(desk.left + x), y: Math.round(desk.top + y) },
      };
    }
  }
  return null;
})()`;

const IN_HAND = `(() => {
  const a = globalThis.__vfDesk.pegboard()?.anchor;
  return { held: a?.held === true, drawer: a?.open === true && a?.drawer != null, pill: ${PILL_READ} };
})()`;

export interface MoreRowsDriver {
  readonly win: BrowserWindow;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
}

/** MORE (above), over smoke:canvas's first board after DK-13's rows. The problems, in words. */
export async function moreRows(d: MoreRowsDriver): Promise<string[]> {
  const hands = handsOver(d.win, d.shotDir);
  const { js, until, key } = hands;
  const problems: string[] = [];
  // MK-6 (2026-11-21): the part running now, said in a wait's words when it runs out, so a red names
  // which of the four board openings it was (PLACE, TAB, PRESS, IN HAND)
  let part = "PLACE";
  const pill = (): Promise<PillSeen | null> => js<PillSeen | null>(PILL_READ);
  const settled = async (): Promise<void> => {
    try {
      await until(`the board out (${part})`, 5_000, BOARD_OPEN);
      await until(`the board's slide done (${part})`, 5_000, BOARD_SETTLED);
    } catch (error) {
      const facts = await js<string>(BOARD_FACTS).catch(() => "unread");
      throw new Error(`${error instanceof Error ? error.message : String(error)} (board ${facts})`);
    }
    await sleep(350); // the filters' fade, the thumb's 300 ms
  };
  const theme = async (name: "light" | "dark"): Promise<void> => {
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(name)})`);
    await until(
      `the desk dressed ${name}`,
      10_000,
      `globalThis.__vfDesk.theme() === ${JSON.stringify(name)}`,
    );
  };
  /** Plugins opened from the pill: open on Discover, the board folded, its words for no list */
  const opened = async (how: string): Promise<PopupBrief> => {
    let seen: PopupBrief = { open: false, tab: null, body: "" };
    try {
      await until(`Plugins open from the pill's ${how}`, 5_000, POPUP_OPEN);
      seen = await js<PopupBrief>(POPUP_BRIEF);
    } catch (error) {
      problems.push(`MORE: ${error instanceof Error ? error.message : String(error)}`);
      // a popup that never opened leaves the board out, and the next part's create press would fold
      // it: the popup (were it late) and the board are shut first, so the next part starts where it
      // would have (item 649, 2026-11-21)
      if (await js<boolean>(POPUP_OPEN)) {
        await key("Escape");
        await until("the popup folded", 5_000, POPUP_SHUT);
      }
      if (!(await js<boolean>(BOARD_SHUT))) {
        await key("Escape");
        await until("the board shut", 5_000, BOARD_SHUT);
      }
      return seen;
    }
    if (seen.tab !== "Discover")
      problems.push(`MORE: the pill's ${how} opened Plugins on ${seen.tab}, not Discover`);
    if (!(await js<boolean>(BOARD_SHUT)))
      problems.push(`MORE: the board did not fold as the pill's ${how} opened Plugins`);
    if (!seen.body.includes(NOTHING_TO_DISCOVER))
      problems.push(`MORE: with no plugin list Discover said "${seen.body.slice(0, 120)}"`);
    await key("Escape");
    await until("the popup folded", 5_000, POPUP_SHUT);
    return seen;
  };

  // A wait run out in a part keeps the problems the parts before it found (MK-6, 2026-11-21)
  try {
    // ── PLACE: the board raised by the create, the pill read whole at its foot ───────────────────
    await hands.pressAt(".vf-line-create");
    await settled();
    const drawn = await pill();
    const anchor = await js<{ drawer: DrawerAt | null }>("globalThis.__vfDesk.pegboard().anchor");
    const view = await js<{ width: number; height: number }>(
      "({ width: innerWidth, height: innerHeight })",
    );
    problems.push(...judgePlace(drawn, anchor.drawer, view));
    d.say(
      `SMOKE_CANVAS_MORE_PLACE ${JSON.stringify({ pill: drawn, drawer: anchor.drawer, view })}`,
    );
    if (drawn === null) {
      // A7 — no pill until MK-4d draws it: Tab, ↵ and a press would land on whatever else holds
      // the focus, so MORE stops at its one red, which names the slice it waits on
      d.say(
        "SMOKE_CANVAS_MORE_WAITS MK-4d: no pill at the board's foot, so Tab, ↵, the press and the step aside were not read",
      );
      await key("Escape");
      await until("the board shut", 5_000, BOARD_SHUT);
      return problems;
    }
    await hands.shoot("mk-6-more-light.png");
    await theme("dark");
    await hands.shoot("mk-6-more-dark.png");
    await theme("light");
    await key("Escape");
    await until("the board shut", 5_000, BOARD_SHUT);

    // ── TAB + ↵: B raises the board with the keyboard; Tab reaches the pill, the third stop ───────
    part = "TAB";
    await key("B", [], true);
    await settled();
    await until(
      "the board focused",
      5_000,
      `document.activeElement?.classList.contains("vf-pegboard-board") === true`,
    );
    await key("Tab");
    const tabbed = await pill();
    if (tabbed?.focused !== true) problems.push("MORE: Tab from the board did not reach the pill");
    // ↵ as a person's Enter reaches a focused button: its key down, its character and its key up. A
    // key down alone is no press to a button (the browser clicks one on the character), so the pill
    // took none and Plugins never opened (item 649, 2026-11-21)
    d.win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    d.win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    d.win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await sleep(80);
    const keyed = await opened("↵");

    // ── PRESS from a chosen category: the board on Surfaces, the pill pressed ───────────────────
    part = "PRESS";
    await hands.pressAt(".vf-line-create");
    await settled();
    await hands.pressAt('.vf-pegboard-track button[data-id="surfaces"]');
    await until(
      "the board showing Surfaces",
      5_000,
      `globalThis.__vfDesk.pegboard()?.anchor.category === "surfaces"`,
    );
    let clicked: PopupBrief | null = null;
    if (await hands.pressWords(".vf-pegboard", [PILL.words])) clicked = await opened("press");
    else problems.push("MORE: no pill to press on Surfaces");

    // ── IN HAND: mid-take, where the board still stands, the pill steps aside ───────────────────
    part = "IN HAND";
    // A specimen pressed where the desk draws it and dragged up; read before the release, then
    // dropped where nothing picks and taken back by ⌘Z.
    await hands.pressAt(".vf-line-create");
    await settled();
    const take = await js<{ type: string; from: Point; to: Point } | null>(TAKE_AT);
    let inHand: { held: boolean; drawer: boolean; pill: PillSeen | null } | null = null;
    if (take === null)
      problems.push("MORE: the board hung no specimen to take, or the desk no place to drop it");
    else {
      const census0 = await js<Record<string, number>>("globalThis.__vfDesk.census()");
      const move = (x: number, y: number): void =>
        d.win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(x), y: Math.round(y) });
      move(take.from.x, take.from.y);
      await sleep(40);
      d.win.webContents.sendInputEvent({
        type: "mouseDown",
        x: take.from.x,
        y: take.from.y,
        button: "left",
        clickCount: 1,
      });
      // up off the board, a third of the way, then read: the board may still stand with it in hand
      for (let step = 1; step <= 6; step += 1) {
        await sleep(16);
        move(take.from.x, take.from.y - ((take.from.y - take.to.y) * step) / 18);
      }
      inHand = await js<{ held: boolean; drawer: boolean; pill: PillSeen | null }>(IN_HAND);
      for (let step = 1; step <= 12; step += 1) {
        await sleep(16);
        move(
          take.from.x + ((take.to.x - take.from.x) * step) / 12,
          take.from.y + ((take.to.y - take.from.y) * step) / 12,
        );
      }
      d.win.webContents.sendInputEvent({
        type: "mouseUp",
        x: take.to.x,
        y: take.to.y,
        button: "left",
        clickCount: 1,
      });
      await sleep(400);
      const census1 = await js<Record<string, number>>("globalThis.__vfDesk.census()");
      if ((census1[take.type] ?? 0) > (census0[take.type] ?? 0)) await hands.chord("z");
      if (inHand.held && inHand.drawer && inHand.pill?.shown === true)
        problems.push("MORE: the pill stood while an object was in hand");
      if (!inHand.held || !inHand.drawer)
        d.say(
          `SMOKE_CANVAS_MORE_SKIP in hand: no take held the board out to read (held ${inHand.held}, drawer ${inHand.drawer}); the step-aside is MK-4d's unit row's`,
        );
      await key("Escape");
      await key("Escape");
    }
    d.say(
      `SMOKE_CANVAS_MORE ${JSON.stringify({ tabbed: tabbed?.focused ?? null, keyed, clicked, inHand })}`,
    );
  } catch (error) {
    problems.push(`MORE (${part}): ${error instanceof Error ? error.message : String(error)}`);
  }
  return problems;
}

/** In the open popup: Installed, then the row whose title is `title`, pressed, and its page
 * awaited (MK-4c's rows: `.vf-plugins-item`, its press `.vf-plugins-row`, its title
 * `.vf-plugins-title`). */
export async function openInstalledPage(hands: WindowHands, title: string): Promise<void> {
  if (!(await hands.pressWords('.vf-plugins-pop[role="dialog"]', ["Installed"])))
    throw new Error("no Installed in the popup's switch");
  const row = `[...document.querySelectorAll(".vf-plugins-item")]
    .find((i) => i.querySelector(".vf-plugins-title")?.textContent === ${JSON.stringify(title)})
    ?.querySelector(".vf-plugins-row") ?? null`;
  await hands.until(`${title}'s row in Installed`, 10_000, `(${row}) !== null`);
  const at = await hands.js<Point | null>(`(() => {
    const row = ${row};
    if (row === null) return null;
    row.scrollIntoView({ block: "nearest" });
    const r = row.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (at === null) throw new Error(`${title}'s row did not show`);
  await hands.press(at);
  await hands.until(
    `${title}'s page`,
    5_000,
    `document.querySelector(".vf-plugins-page") !== null`,
  );
}

export interface RiseRowsDriver {
  readonly win: BrowserWindow;
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
  /** the installed set's first object, in the board's order: its type and its category */
  readonly first: { readonly type: string; readonly category: string };
  /** the installed plugin's title, as its row in Installed says it */
  readonly title: string;
  /** opens Plugins from where the window stands (the palette's Plugins…), its read awaited */
  readonly openPlugins: () => Promise<void>;
}

/** The rise read back: the popup, the board, ICE's focus, the keyboard, the ring, the view. */
const RISE_READ = `(() => {
  const b = globalThis.__vfDesk.pegboard();
  return {
    popupOpen: document.querySelector('.vf-plugins-pop[role="dialog"]') !== null,
    boardOpen: b?.anchor.open === true,
    category: b?.anchor.category ?? null,
    focused: b?.anchor.focused?.id ?? null,
    boardHasKeyboard: document.activeElement?.classList.contains("vf-pegboard-board") === true,
    ring: document.querySelector(".vf-pegboard-ring")?.hasAttribute("data-shown") === true,
    view: document.querySelector(".vf-line")?.getAttribute("data-view") ?? null,
  };
})()`;

/** RISE (above), from the installed plugin's page. The problems, in words. It leaves one laid
 * object on the desk, for REMOVE's question to name. */
export async function riseRows(d: RiseRowsDriver): Promise<string[]> {
  const hands = handsOver(d.win, d.shotDir);
  const { js, until, key } = hands;
  const problems: string[] = [];
  const show = async (label: string): Promise<void> => {
    await d.openPlugins();
    await openInstalledPage(hands, d.title);
    if (!(await hands.pressWords('.vf-plugins-pop[role="dialog"]', SHOW_ON_BOARD)))
      throw new Error(`${label}: the page offered no ${SHOW_ON_BOARD.join(" / ")}`);
    await until(`${label}: the board risen`, 10_000, BOARD_SETTLED);
    await sleep(400); // ICE's focus is asked again once the board hangs the set (I37)
  };

  // ── on Canvas: the page's act, the board on the set's first category, its first object focused
  await show("RISE");
  const risen = await js<RiseSeen>(RISE_READ);
  problems.push(...judgeRise(risen, d.first).map((p) => `RISE: ${p}`));
  await hands.shoot("mk-6-rise.png");
  // ↵ lays it: one object more, and it stays on the desk for REMOVE
  const before = await js<Record<string, number>>("globalThis.__vfDesk.census()");
  await key("Return");
  await until("the board folded after ↵", 5_000, BOARD_SHUT);
  await sleep(400);
  const after = await js<Record<string, number>>("globalThis.__vfDesk.census()");
  const laid = (after[d.first.type] ?? 0) - (before[d.first.type] ?? 0);
  if (laid !== 1) problems.push(`RISE: ↵ laid ${laid} ${d.first.type}, not 1`);
  d.say(`SMOKE_MARKET_RISE ${JSON.stringify({ risen, laid })}`);
  await key("Escape");

  // ── over Godview (MK-E14): the frame goes to Canvas first, where the board is ───────────────
  await hands.chord("2");
  await until(
    "Godview's cover",
    10_000,
    `document.querySelector(".vf-line")?.getAttribute("data-view") === "godview"`,
  );
  await show("RISE COVERED");
  const covered = await js<RiseSeen>(RISE_READ);
  problems.push(...judgeRise(covered, d.first).map((p) => `RISE COVERED: ${p}`));
  d.say(`SMOKE_MARKET_RISE_COVERED ${JSON.stringify(covered)}`);
  await key("Escape");
  await until("the board shut", 5_000, BOARD_SHUT);
  return problems;
}
