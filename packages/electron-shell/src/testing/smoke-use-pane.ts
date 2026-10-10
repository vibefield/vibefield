// PT-3 — THE PAGE IN USE IN THE PRODUCT (smoke:canvas; the PORTALS brief PT-3 §2): a browser pane laid as PT-1's rows lay it,
// pointed at the smoke's own fixture page (testing/live-fixture.ts), PICKED UP (⏎) and used as a page is used. Judged by what
// the PAGE says it saw (the fixture's report with each ask: its address, scroll, selection, field and focus), the door's props
// and face rows, the desk's own counters and the cursor the window shows — never a hash:
//   HELD-CLICK — a click on the fixture's link navigates: the page at `/next`, the face's address and the `url` prop with it —
//                and ⌘Z at rest, pressed until it has taken back the desk's last edit before (the finish), never sends the page
//                back (a page's navigation is not a desk edit — ruling 9);
//   DOUBLE     — a double-click selects a word on the page, and the pane stays in hand;
//   KEYS       — text typed into the fixture's field arrives exactly, a slip taken back by ⌫ on the way; ⏎ there submits the
//                field's form (⏎'s own char — the page's implicit submission);
//   IME        — a composition driven through CDP on the shell's editor lands, committed, in the fixture's field;
//   CURSOR     — over the link the window shows `pointer`, over the field `text`;
//   WHEEL      — the page scrolls by what the finger moved ON THE SCREEN (the wheel's travel the window saw, in the page's px as
//                the hand draws them), and the hand does not pan (after the rows that press the field: it scrolls it away);
//   TOOLS      — the held bar's ‹ goes back, ↻ reloads (each a NEW document — the page's memory token changes); ⌘L puts the
//                editor over the head's capsule holding the address, and a typed address and ⏎ go there; ⌘L then Esc returns
//                to the page, the pane still in hand;
//   EDIT       — the page's own editing chords (ruling 7: every key but the browser's is the page's): in its field ⌘A then a
//                letter replaces what was typed, and ⌘Z takes the replacing back (the clipboard's chords ride the same road —
//                the smoke never writes the Mac's clipboard; theirs are the units');
//   ESC        — one press puts the pane down;
//   IDLE       — a still page in hand: no desk frame, no GPU submit, no frame arriving over 1.2 s.
// Then the pane is deleted (⌫) and the board is as found. `--use-pane` beside `--smoke-canvas` runs these rows alone after the
// boot's (the author's loop).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_PARTS, type FixtureRect, type FixtureReport } from "./live-fixture";
import { layPane, PANE, paneHands, paneToMiddle } from "./smoke-browser-pane";
import type { LiveRowsDriver } from "./smoke-live-pane";

/** The flag beside `--smoke-canvas` that runs these rows alone after the boot's (the author's loop). */
export const USE_FLAG = "--use-pane";

/** The rows' numbers. */
export const USE_ROWS = {
  /** how long the page's word is waited for (its report rides an ask every quarter second) */
  withinMs: 10_000,
  /** the wheel's travel on the screen (CSS px, in steps), and how far the page's scroll may stray from it (a share) */
  wheelPx: 240,
  wheelSteps: 4,
  wheelSlack: 0.25,
  /** what is typed (its last letter first mistyped as `slip`, taken back by ⌫); what the IME composes, then commits */
  typed: "hello portals",
  slip: "z",
  composing: "にほ",
  composed: "日本",
  /** where the typed address goes (the fixture's own) */
  typedPath: "/next?typed=1",
  /** EDIT: what is typed, then what replaces it after ⌘A */
  editTyped: "abc",
  editReplaced: "x",
  /** IDLE watches this long */
  watchMs: 1200,
  /** the desk's last edit before the page is used (the finish), and the finish ⌘Z takes it back to (the type's default) */
  finish: "float",
  finishBefore: "low-iron",
  /** ⌘Z presses at most, looking for the finish taken back */
  undos: 4,
} as const;

/** What the rows saw — the SMOKE_CANVAS_USE line, and what the judges read. */
export interface UseSeen {
  readonly click: {
    /** the page's path after the click; the face's address and the `url` prop then */
    readonly path: string | null;
    readonly address: string | null;
    readonly url: string | null;
    /** put down, ⌘Z pressed until the finish came back: how many presses; the finish (null: unset — the type's default);
     * where the page is then, and the url */
    readonly undone: {
      readonly undos: number;
      readonly finish: string | null;
      readonly path: string | null;
      readonly url: string | null;
    };
  };
  readonly double: { readonly sel: string | null; readonly held: boolean };
  readonly wheel: {
    /** the wheel's travel as the window saw it (its events' deltaY, summed — CSS px) */
    readonly travel: number;
    /** the page's px a screen px, as the hand drew the page */
    readonly pagePerScreen: number;
    readonly scrollY: number | null;
    readonly panned: boolean;
    readonly held: boolean;
  };
  readonly keys: {
    readonly field: string | null;
    readonly focused: string | null;
    /** the field's form's submits after ⏎ */
    readonly submitted: number;
  };
  readonly ime: { readonly field: string | null };
  readonly cursor: { readonly link: string | null; readonly field: string | null };
  readonly tools: {
    readonly back: string | null;
    /** the fixture's loads of `/page` before ↻ and after */
    readonly reload: { readonly before: number; readonly after: number };
    /** ⌘L's editor: its value, and whether it stood in the head (between the extent's top and the page's) */
    readonly editor: { readonly value: string | null; readonly overCapsule: boolean };
    readonly typed: string | null;
    readonly escHeld: boolean;
    readonly escValue: string | null;
  };
  /** the field after ⌘A and a letter, then after ⌘Z */
  readonly edit: { readonly replaced: string | null; readonly undone: string | null };
  readonly esc: { readonly down: boolean };
  readonly idle: {
    readonly ms: number;
    readonly frames: number;
    readonly submits: number;
    readonly arrivals: number;
  };
}

const ends = (s: string | null, tail: string): boolean => s?.endsWith(tail) === true;

/** HELD-CLICK: the page at `/next`, its address and url with it; ⌘Z took the finish back and left the page where it went. */
export function judgeClick(seen: UseSeen["click"]): string[] {
  const out: string[] = [];
  if (seen.path !== "/next")
    out.push(`HELD-CLICK: the page is at ${seen.path ?? "nothing it said"}, not /next`);
  if (!ends(seen.address, "/next"))
    out.push(`HELD-CLICK: the face says ${seen.address ?? "no address"}, not the page's /next`);
  if (!ends(seen.url, "/next"))
    out.push(`HELD-CLICK: the url prop is ${seen.url ?? "unset"}, not the page's /next`);
  const { undone } = seen;
  if (undone.finish !== null && undone.finish !== USE_ROWS.finishBefore)
    out.push(
      `HELD-CLICK: ${undone.undos} ⌘Z left the finish ${undone.finish}, never taking back the desk's last edit`,
    );
  if (undone.path !== "/next" || !ends(undone.url, "/next"))
    out.push(
      `HELD-CLICK: ⌘Z sent the page back (at ${undone.path ?? "?"}, url ${undone.url ?? "unset"}) — a page's navigation is not a desk edit`,
    );
  return out;
}

/** DOUBLE: the word selected on the page; the pane still in hand. */
export function judgeDouble(seen: UseSeen["double"]): string[] {
  const out: string[] = [];
  if (seen.sel?.trim() !== FIXTURE_PARTS.word)
    out.push(
      `DOUBLE: the page selected ${JSON.stringify(seen.sel)}, not ${JSON.stringify(FIXTURE_PARTS.word)}`,
    );
  if (!seen.held) out.push("DOUBLE: the double-click put the pane down");
  return out;
}

/** WHEEL: the page scrolled by the finger's travel on the screen (within the slack); the hand did not pan. */
export function judgeWheel(seen: UseSeen["wheel"]): string[] {
  const out: string[] = [];
  const want = seen.travel * seen.pagePerScreen;
  if (seen.travel <= 0) out.push("WHEEL: the window saw no wheel travel");
  else if (seen.scrollY === null) out.push("WHEEL: the page said no scroll");
  else if (Math.abs(seen.scrollY - want) > want * USE_ROWS.wheelSlack)
    out.push(
      `WHEEL: the page scrolled ${seen.scrollY} px for the finger's ${seen.travel} px, not ~${Math.round(want)} (that travel in its px)`,
    );
  if (seen.panned) out.push("WHEEL: the hand panned for a wheel over the page");
  if (!seen.held) out.push("WHEEL: the wheel put the pane down");
  return out;
}

/** KEYS: the field has the focus and holds exactly what was typed (the slip taken back); ⏎ submitted its form. */
export function judgeKeys(seen: UseSeen["keys"]): string[] {
  const out: string[] = [];
  if (seen.focused !== "field")
    out.push(`KEYS: the page's focus is ${JSON.stringify(seen.focused)}, not its field`);
  if (seen.field !== USE_ROWS.typed)
    out.push(
      `KEYS: the field holds ${JSON.stringify(seen.field)}, not ${JSON.stringify(USE_ROWS.typed)}`,
    );
  if (seen.submitted < 1) out.push("KEYS: ⏎ in the field did not submit its form");
  return out;
}

/** IME: the composition committed into the field, after what was typed. */
export function judgeIme(seen: UseSeen["ime"]): string[] {
  const want = USE_ROWS.typed + USE_ROWS.composed;
  return seen.field === want
    ? []
    : [`IME: the field holds ${JSON.stringify(seen.field)}, not ${JSON.stringify(want)}`];
}

/** CURSOR: the page's own cursor in the window — a pointer over its link, a text cursor over its field. */
export function judgeCursor(seen: UseSeen["cursor"]): string[] {
  const out: string[] = [];
  if (seen.link !== "pointer")
    out.push(`CURSOR: over the link the window shows ${JSON.stringify(seen.link)}, not "pointer"`);
  if (seen.field !== "text")
    out.push(`CURSOR: over the field the window shows ${JSON.stringify(seen.field)}, not "text"`);
  return out;
}

/** TOOLS: ‹ back to /page; ↻ a load more; ⌘L the editor in the head with the address; typed + ⏎ there; ⌘L + Esc the page's again. */
export function judgeTools(seen: UseSeen["tools"]): string[] {
  const out: string[] = [];
  if (seen.back !== "/page")
    out.push(`TOOLS: ‹ left the page at ${seen.back ?? "nothing it said"}, not /page`);
  if (seen.reload.after <= seen.reload.before)
    out.push(
      `TOOLS: ↻ did not reload the page (${seen.reload.before} → ${seen.reload.after} loads)`,
    );
  if (!ends(seen.editor.value, "/page"))
    out.push(
      `TOOLS: ⌘L's editor holds ${JSON.stringify(seen.editor.value)}, not the page's address`,
    );
  if (!seen.editor.overCapsule)
    out.push("TOOLS: ⌘L's editor does not stand over the head's capsule");
  if (seen.typed !== USE_ROWS.typedPath)
    out.push(
      `TOOLS: the typed address took the page to ${seen.typed ?? "nothing it said"}, not ${USE_ROWS.typedPath}`,
    );
  if (!seen.escHeld)
    out.push("TOOLS: Esc in the address put the pane down — it returns to the page");
  if (seen.escValue !== "")
    out.push(
      `TOOLS: after Esc the editor holds ${JSON.stringify(seen.escValue)}, not the page's empty field`,
    );
  return out;
}

/** EDIT: ⌘A then a letter replaced the field's text; ⌘Z brought it back. */
export function judgeEdit(seen: UseSeen["edit"]): string[] {
  const out: string[] = [];
  if (seen.replaced !== USE_ROWS.editReplaced)
    out.push(
      `EDIT: ⌘A then "${USE_ROWS.editReplaced}" left the field ${JSON.stringify(seen.replaced)}, not "${USE_ROWS.editReplaced}" — the page selected nothing`,
    );
  if (seen.undone !== USE_ROWS.editTyped)
    out.push(
      `EDIT: ⌘Z left the field ${JSON.stringify(seen.undone)}, not "${USE_ROWS.editTyped}" — the page's own undo`,
    );
  return out;
}

/** ESC: one press puts the pane down. */
export const judgeEsc = (seen: UseSeen["esc"]): string[] =>
  seen.down ? [] : ["ESC: one Esc did not put the pane down"];

/** IDLE: a still page in hand — no desk frame, no GPU submit, no arrival — over the watch. */
export function judgeIdle(seen: UseSeen["idle"]): string[] {
  const out: string[] = [];
  if (seen.ms < USE_ROWS.watchMs)
    out.push(`IDLE: watched ${seen.ms} ms, under ${USE_ROWS.watchMs}`);
  if (seen.frames !== 0)
    out.push(`IDLE: the desk drew ${seen.frames} frames of a still page in hand`);
  if (seen.submits !== 0)
    out.push(`IDLE: the desk submitted ${seen.submits} times for a still page in hand`);
  if (seen.arrivals !== 0) out.push(`IDLE: ${seen.arrivals} frames arrived from a still page`);
  return out;
}

/** The held pane's frame on screen (the door's `held().frame`, desk CSS px): its open extent's centre and half extents. */
export interface HeldFrameSeen {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
  readonly s: number;
  readonly settled: boolean;
}

/**
 * A point of the PAGE (its view's CSS px) on the window, the pane in hand: the open extent is the page and the head — as wide as
 * the page, ending at its foot (the pane's law `openExtent`) — so the page stands at the extent's foot, its width the extent's.
 */
export function pageOnWindow(
  f: Pick<HeldFrameSeen, "cx" | "cy" | "hx" | "hy">,
  view: readonly [number, number],
  deskOff: { readonly left: number; readonly top: number },
  px: number,
  py: number,
): { readonly x: number; readonly y: number } {
  const k = (2 * f.hx) / view[0];
  return {
    x: deskOff.left + f.cx - f.hx + px * k,
    y: deskOff.top + f.cy + f.hy - view[1] * k + py * k,
  };
}

const centre = (r: FixtureRect): readonly [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The rows' driver: PT-2's, and the shell window's IME as CDP drives its focused editor — a composition, then its commit. */
export interface UseRowsDriver extends LiveRowsDriver {
  compose(text: string, caret: number): Promise<void>;
  commit(text: string): Promise<void>;
}

/** A face's row by its key, off the door. */
const FACE_ROW = (key: string): string =>
  `((globalThis.__vfDesk.live()?.faces ?? []).find((f) => f.key === ${JSON.stringify(key)}) ?? null)`;

/** The wheel the window sees, summed (its events' deltaY, CSS px) — armed before the wheel, read after. */
const WHEEL_ARM = `(() => {
  const w = { dy: 0, n: 0 };
  w.on = (ev) => { if (ev.deltaMode === 0) { w.dy += ev.deltaY; w.n += 1; } };
  window.addEventListener("wheel", w.on, { capture: true, passive: true });
  globalThis.__pt3Wheel = w;
  return true;
})()`;
const WHEEL_READ = `(() => {
  const w = globalThis.__pt3Wheel;
  if (w === undefined) return null;
  window.removeEventListener("wheel", w.on, { capture: true });
  delete globalThis.__pt3Wheel;
  return { dy: w.dy, n: w.n };
})()`;

/** PT-3's rows (above). Returns the problems, each in words. */
export async function usePaneRows(d: UseRowsDriver): Promise<string[]> {
  const { say, win } = d;
  const h = paneHands(d);
  const { js, until, press, move, key, undoKey, census, rows } = h;
  const mod = process.platform === "darwin" ? "meta" : "control";
  const problems: string[] = [];
  const said: Partial<Record<keyof UseSeen, unknown>> = {};
  const ambient = await js<string>("globalThis.__vfDesk.ambient()");
  const themeWas = await js<string>("globalThis.__vfDesk.theme()");
  await h.theme("light");
  await js(`globalThis.__vfDesk.ambient("still")`);
  d.fixture.setPlaying(false);
  const before = await census();
  let pane: number | undefined;

  const report = (): FixtureReport | null => d.fixture.report();
  /** The page's word that `ok` accepts, waited for; the last one it said (logged) if none does in time. */
  const hear = async (
    label: string,
    ok: (r: FixtureReport) => boolean,
  ): Promise<FixtureReport | null> => {
    const deadline = Date.now() + USE_ROWS.withinMs;
    while (Date.now() < deadline) {
      const r = report();
      if (r !== null && ok(r)) return r;
      await sleep(100);
    }
    say(`SMOKE_CANVAS_USE_UNHEARD ${JSON.stringify({ label, last: report() })}`);
    return report();
  };
  const propsOf = async (e: number): Promise<Readonly<Record<string, unknown>> | null> =>
    (await rows()).find((r) => r.entity === e)?.props ?? null;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const held = (): Promise<number | null> =>
    js<number | null>("globalThis.__vfDesk.held()?.entity ?? null");
  const heldFrame = (): Promise<HeldFrameSeen | null> =>
    js<HeldFrameSeen | null>("globalThis.__vfDesk.held()?.frame ?? null");
  /** The camera once it holds still (a put-down flies home): two reads 250 ms apart, the same. */
  const settledCamera = async (): Promise<void> => {
    let last = "";
    for (let i = 0; i < 24; i += 1) {
      const now = JSON.stringify(await js("globalThis.__vfDesk.camera()"));
      if (now === last) return;
      last = now;
      await sleep(250);
    }
  };
  /** The pane's middle at rest on the window — its rect off the door, through the camera. */
  const middleOf = async (e: number): Promise<{ x: number; y: number } | null> => {
    const r = (await rows()).find((x) => x.entity === e)?.rect;
    if (r === undefined) return null;
    const c = await js<{ x: number; y: number; zoom: number }>("globalThis.__vfDesk.camera()");
    const at = await h.deskAt();
    return {
      x: at.left + (r.x + r.w / 2 - c.x) * c.zoom,
      y: at.top + (r.y + r.h / 2 - c.y) * c.zoom,
    };
  };
  /** A point of the page (its CSS px) on the window, the pane in hand. */
  const onPage = async (px: number, py: number): Promise<{ x: number; y: number }> => {
    const f = await heldFrame();
    const r = report();
    if (f === null || r === null) throw new Error("no page in hand to point at");
    return pageOnWindow(f, r.view, await h.deskAt(), px, py);
  };
  const part = async (name: "link" | "field" | "word"): Promise<{ x: number; y: number }> => {
    const r = report();
    if (r === null) throw new Error("the page has said nothing of its parts");
    const [px, py] = centre(r.parts[name]);
    return onPage(px, py);
  };
  /** The pane picked up: a press on it at rest (it is the pane's — the page is a part in hand only), ⏎, in hand, settled. */
  const pickUp = async (e: number): Promise<void> => {
    await settledCamera();
    const at = await middleOf(e);
    if (at === null) throw new Error("the pane left the board");
    await press(at);
    await until("the pane selected", 10_000, "(globalThis.__vfDesk.anchor()?.count ?? 0) === 1");
    await sleep(300);
    await key("Return");
    await until("the pane in hand", 10_000, `globalThis.__vfDesk.held()?.entity === ${e}`);
    await until(
      "the pick-up settled",
      10_000,
      "globalThis.__vfDesk.held()?.frame?.settled === true",
    );
    await sleep(400);
  };
  /** The held bar's Done: the pane put down by the hand's own act (the rows' put-down; ESC's row is the one Esc). */
  const done = async (): Promise<void> => {
    await h.pressSelector('[data-selection-bar] [data-act="done"]');
    await until("the pane put down by Done", 5_000, "globalThis.__vfDesk.held() === null");
    await settledCamera();
  };
  /** One Esc: true once nothing is in hand. */
  const putDown = async (): Promise<boolean> => {
    await key("Escape");
    try {
      await until("the pane put down", 5_000, "globalThis.__vfDesk.held() === null");
    } catch {
      return false;
    }
    await settledCamera();
    return true;
  };
  /** The page's scroll once it holds (a wheel's scroll is animated): two of its words 600 ms apart, the same. */
  const scrollHeld = async (): Promise<number | null> => {
    let last = report()?.scrollY ?? null;
    for (let i = 0; i < 10; i += 1) {
      await sleep(600);
      const now = report()?.scrollY ?? null;
      if (now === last) return now;
      last = now;
    }
    return last;
  };

  try {
    // ── the pane laid alone on clear ground, at actual size, brought to the middle, pointed at the fixture, live ───────
    const at = await layPane(h, before, (e) => {
      pane = e;
    });
    if (at.pane === undefined) throw new Error("no new pane on the board after the take");
    const e = at.pane;
    await paneToMiddle(h, e, at);
    await settledCamera();
    const paneKey = (await rows()).find((r) => r.entity === e)?.key;
    if (paneKey === undefined || paneKey === null)
      throw new Error("the door gives the pane no durable key");
    if (
      !(await js<boolean>(
        `globalThis.__vfDesk.writeProps(${e}, { url: ${JSON.stringify(d.fixture.url)} })`,
      ))
    )
      throw new Error("the door could not point the pane at the fixture");
    try {
      await until(
        "the page live on the face",
        30_000,
        `(() => { const f = ${FACE_ROW(paneKey)}; return f !== null && f.state.is === "live" && f.presented >= 1; })()`,
      );
    } catch (error) {
      // what the desk had instead: the live service's counts and faces, the pane's props
      say(
        `SMOKE_CANVAS_USE_FACE ${JSON.stringify({ live: await js("globalThis.__vfDesk.live()"), props: await propsOf(e) })}`,
      );
      throw error;
    }
    if ((await hear("the page's first word", (r) => r.path === "/page"))?.path !== "/page")
      throw new Error("the fixture page never spoke");
    // the desk's LAST EDIT before the page is used — the finish, its own undo step (HELD-CLICK's ⌘Z takes it back)
    if (
      !(await js<boolean>(
        `globalThis.__vfDesk.writeProps(${e}, { finish: ${JSON.stringify(USE_ROWS.finish)} })`,
      ))
    )
      throw new Error("the door could not write the finish");
    await sleep(400);

    // ── HELD-CLICK: the link pressed in hand — the page at /next, its address and url with it; ⌘Z at rest ─────────────
    await pickUp(e);
    if (d.shotDir !== undefined) {
      mkdirSync(d.shotDir, { recursive: true });
      writeFileSync(join(d.shotDir, "pt-3-pane-in-use.png"), (await win.capturePage()).toPNG());
    }
    await press(await part("link"));
    const clicked = await hear("the page at /next", (r) => r.path === "/next");
    await until(
      "the url written where the page went",
      USE_ROWS.withinMs,
      `(() => { const r = globalThis.__vfDesk.objects(${JSON.stringify(PANE.type)}).find((x) => x.entity === ${e}); return typeof r?.props.url === "string" && r.props.url.endsWith("/next"); })()`,
    ).catch(() => undefined);
    const address = await js<string | null>(`${FACE_ROW(paneKey)}?.info?.address ?? null`);
    const urlThen = str((await propsOf(e))?.url);
    await done();
    let undos = 0;
    let finish = str((await propsOf(e))?.finish);
    while (undos < USE_ROWS.undos && finish !== null && finish !== USE_ROWS.finishBefore) {
      await undoKey();
      undos += 1;
      await sleep(400);
      finish = str((await propsOf(e))?.finish);
    }
    // a url taken back would send the page there: its word given time to say so
    await sleep(2000);
    const click: UseSeen["click"] = {
      path: clicked?.path ?? null,
      address,
      url: urlThen,
      undone: {
        undos,
        finish,
        path: report()?.path ?? null,
        url: str((await propsOf(e))?.url),
      },
    };
    said.click = click;
    problems.push(...judgeClick(click));

    // ── DOUBLE: a double-click on a word of the page selects it; the pane stays in hand ──────────────────────────────
    await pickUp(e);
    const word = await part("word");
    await press(word, 1);
    await press(word, 2);
    const selected = await hear("the word selected", (r) => r.sel.trim() === FIXTURE_PARTS.word);
    const double: UseSeen["double"] = { sel: selected?.sel ?? null, held: (await held()) === e };
    said.double = double;
    problems.push(...judgeDouble(double));

    // ── KEYS: the field pressed (the page focuses it), the text typed with a slip taken back by ⌫, then ⏎ — the text arrives
    // exactly, and ⏎'s char submits the field's form (the page counts it and stays) ──────────────────────────────────────
    await press(await part("field"));
    await hear("the field focused", (r) => r.focused === "field");
    const typeChars = async (text: string): Promise<void> => {
      for (const ch of text) {
        const keyCode = ch === " " ? "Space" : ch;
        win.webContents.sendInputEvent({ type: "keyDown", keyCode });
        win.webContents.sendInputEvent({ type: "char", keyCode });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode });
        await sleep(30);
      }
    };
    await typeChars(USE_ROWS.typed.slice(0, -1) + USE_ROWS.slip);
    await hear("the slip in the field", (r) => r.field.endsWith(USE_ROWS.slip));
    await key("Backspace");
    await typeChars(USE_ROWS.typed.slice(-1));
    const typed = await hear("the text in the field", (r) => r.field === USE_ROWS.typed);
    await key("Return");
    const entered = await hear("the field's form submitted", (r) => r.submitted >= 1);
    const keys: UseSeen["keys"] = {
      field: typed?.field ?? null,
      focused: typed?.focused ?? null,
      submitted: entered?.submitted ?? 0,
    };
    said.keys = keys;
    problems.push(...judgeKeys(keys));

    // ── IME: a composition on the shell's editor (CDP), then its commit — the composed text in the field ────────────
    await d.compose(USE_ROWS.composing, USE_ROWS.composing.length);
    await sleep(300);
    await d.commit(USE_ROWS.composed);
    const composed = await hear(
      "the composed text in the field",
      (r) => r.field === USE_ROWS.typed + USE_ROWS.composed,
    );
    const ime: UseSeen["ime"] = { field: composed?.field ?? null };
    said.ime = ime;
    problems.push(...judgeIme(ime));

    // ── CURSOR: over the link the page's pointer, over the field its text cursor — the window shows the page's own ──
    const cursorOver = async (name: "link" | "field", want: string): Promise<string | null> => {
      const p = await part(name);
      move(p.x - 6, p.y);
      await sleep(80);
      move(p.x, p.y);
      const read = (): Promise<string | null> =>
        js<string | null>(
          `(() => { const el = document.elementFromPoint(${Math.round(p.x)}, ${Math.round(p.y)}); return el === null ? null : getComputedStyle(el).cursor; })()`,
        );
      const deadline = Date.now() + 5_000;
      let c = await read();
      while (c !== want && Date.now() < deadline) {
        await sleep(100);
        c = await read();
      }
      // what stood behind it: the face's word, the element at the point, the page's report, the face's inputs
      cursorSaid[name] = await js(
        `(() => { const f = ${FACE_ROW(paneKey)}; const el = document.elementFromPoint(${Math.round(p.x)}, ${Math.round(p.y)});
          return { face: f?.info?.cursor ?? null, inputs: f?.inputs ?? null, last: f?.lastInput ?? null,
            at: el === null ? null : el.tagName + "." + String(el.className).slice(0, 40), style: el?.style?.cursor ?? null }; })()`,
      );
      return c;
    };
    const cursorSaid: Record<string, unknown> = {};
    const cursor: UseSeen["cursor"] = {
      link: await cursorOver("link", "pointer"),
      field: await cursorOver("field", "text"),
    };
    said.cursor = cursor;
    say(`SMOKE_CANVAS_USE_CURSOR ${JSON.stringify({ ...cursorSaid, page: report()?.parts })}`);
    problems.push(...judgeCursor(cursor));

    // ── WHEEL: the finger's travel over the page scrolls it by as much on the screen; the hand does not pan ─────────
    const camera0 = JSON.stringify(await js("globalThis.__vfDesk.camera()"));
    const fW = await heldFrame();
    const viewW = report()?.view ?? [1280, 800];
    const pagePerScreen = fW === null ? 0 : viewW[0] / (2 * fW.hx);
    const mid = await onPage(viewW[0] / 2, viewW[1] * 0.4);
    move(mid.x, mid.y);
    await sleep(150);
    await js(WHEEL_ARM);
    for (let i = 0; i < USE_ROWS.wheelSteps; i += 1) {
      win.webContents.sendInputEvent({
        type: "mouseWheel",
        x: Math.round(mid.x),
        y: Math.round(mid.y),
        deltaX: 0,
        deltaY: -USE_ROWS.wheelPx / USE_ROWS.wheelSteps,
        canScroll: true,
      });
      await sleep(40);
    }
    await hear("the page scrolled", (r) => r.scrollY > 0);
    const scrollY = await scrollHeld();
    const travel = await js<{ dy: number; n: number } | null>(WHEEL_READ);
    const wheel: UseSeen["wheel"] = {
      travel: Math.round(travel?.dy ?? 0),
      pagePerScreen: Math.round(pagePerScreen * 1000) / 1000,
      scrollY,
      panned: JSON.stringify(await js("globalThis.__vfDesk.camera()")) !== camera0,
      held: (await held()) === e,
    };
    said.wheel = wheel;
    problems.push(...judgeWheel(wheel));

    // ── TOOLS: ‹ back; ↻ reload; ⌘L the address over the capsule, typed, ⏎; ⌘L then Esc the page's again ─────────────
    const pressTool = async (id: string): Promise<void> => {
      const p = await js<{ x: number; y: number } | null>(`(() => {
        const row = document.querySelector('[data-selection-bar] [data-face-row="hand"]');
        const el = [...(row?.querySelectorAll("[data-tool]") ?? [])].find((t) => t.getAttribute("data-tool") === ${JSON.stringify(id)});
        if (el === undefined) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      if (p === null) throw new Error(`the held bar has no ${id}`);
      await press(p);
    };
    // each a NEW document (a new memory token) — never the page already where the act would take it
    const tokenAt = report()?.token;
    await pressTool("back");
    const backed = await hear(
      "the page back at /page",
      (r) => r.path === "/page" && r.token !== tokenAt,
    );
    const tokenBack = report()?.token;
    const loadsBefore = d.fixture.served("/page");
    await pressTool("reload");
    await hear(
      "the page reloaded",
      (r) => r.path === "/page" && r.token !== tokenBack && d.fixture.served("/page") > loadsBefore,
    );
    const loadsAfter = d.fixture.served("/page");
    await sleep(400);
    await key("l", [mod]);
    await sleep(500);
    const editor = await js<{
      value: string;
      left: number;
      right: number;
      top: number;
      bottom: number;
    } | null>(`(() => {
      const el = document.querySelector("[data-desk-editor]");
      if (el === null || el.hidden || document.activeElement !== el) return null;
      const r = el.getBoundingClientRect();
      return { value: el.value, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    })()`);
    const fT = await heldFrame();
    const off = await h.deskAt();
    const pageTop = (await onPage(0, 0)).y;
    const overCapsule =
      editor !== null &&
      fT !== null &&
      editor.top >= off.top + fT.cy - fT.hy - 2 &&
      editor.bottom <= pageTop + 2 &&
      editor.left >= off.left + fT.cx - fT.hx - 2 &&
      editor.right <= off.left + fT.cx + fT.hx + 2;
    for (const ch of `${d.fixture.origin}${USE_ROWS.typedPath}`) {
      win.webContents.sendInputEvent({ type: "char", keyCode: ch });
      await sleep(8);
    }
    await sleep(200);
    await key("Return");
    const went = await hear("the page at the typed address", (r) => r.path === USE_ROWS.typedPath);
    await sleep(400);
    await key("l", [mod]);
    await sleep(400);
    await key("Escape");
    await sleep(500);
    const escHeld = (await held()) === e;
    const escValue = await js<string | null>(
      `(() => { const el = document.querySelector("[data-desk-editor]"); return el === null || el.hidden ? null : el.value; })()`,
    );
    const tools: UseSeen["tools"] = {
      back: backed?.path ?? null,
      reload: { before: loadsBefore, after: loadsAfter },
      editor: { value: editor?.value ?? null, overCapsule },
      typed: went?.path ?? null,
      escHeld,
      escValue,
    };
    said.tools = tools;
    problems.push(...judgeTools(tools));

    // ── EDIT: the page's own editing chords in its field — ⌘A then a letter replaces, ⌘Z takes it back ──────────────────
    await press(await part("field"));
    await hear("the field focused for the chords", (r) => r.focused === "field");
    await typeChars(USE_ROWS.editTyped);
    await hear("the field typed for the chords", (r) => r.field === USE_ROWS.editTyped);
    await key("a", [mod]);
    await typeChars(USE_ROWS.editReplaced);
    const replaced = await hear(
      "⌘A's selection replaced",
      (r) => r.field === USE_ROWS.editReplaced,
    );
    await key("z", [mod]);
    const undone = await hear("⌘Z's undo", (r) => r.field === USE_ROWS.editTyped);
    const edit: UseSeen["edit"] = {
      replaced: replaced?.field ?? null,
      undone: undone?.field ?? null,
    };
    said.edit = edit;
    problems.push(...judgeEdit(edit));

    // ── ESC: one press puts the pane down ─────────────────────────────────────────────────────────────────────────
    const esc: UseSeen["esc"] = { down: await putDown() };
    said.esc = esc;
    problems.push(...judgeEsc(esc));

    // ── IDLE: picked up again, a press on the page's ground (nothing there to focus or blink), the page still in hand ─
    if ((await held()) !== null) await done();
    await pickUp(e);
    const v = report()?.view ?? [1280, 800];
    await press(await onPage(v[0] * 0.85, v[1] * 0.3));
    move(4, 4);
    const counts = async (): Promise<{ frames: number; submits: number; arrivals: number }> => ({
      frames: await js<number>("globalThis.__vfDesk.perf().frames"),
      submits: await js<number>("globalThis.__vfDesk.submits()?.total ?? 0"),
      arrivals: await js<number>(`${FACE_ROW(paneKey)}?.arrivals ?? 0`),
    });
    let last = -1;
    for (let i = 0; i < 16; i += 1) {
      const now = (await counts()).frames;
      if (now === last) break;
      last = now;
      await sleep(300);
    }
    const from = await counts();
    const t0 = Date.now();
    await sleep(USE_ROWS.watchMs);
    const to = await counts();
    const idle: UseSeen["idle"] = {
      ms: Date.now() - t0,
      frames: to.frames - from.frames,
      submits: to.submits - from.submits,
      arrivals: to.arrivals - from.arrivals,
    };
    said.idle = idle;
    problems.push(...judgeIdle(idle));
    await done();
  } catch (error) {
    // a step that cannot go on ends the rows — never what the rows before it found (they are said with it)
    problems.push(`PT-3 USE: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    d.fixture.setPlaying(false);
    say(`SMOKE_CANVAS_USE ${JSON.stringify(said)}`);
    try {
      if ((await held()) !== null) await done();
      if (pane !== undefined) {
        const at = await middleOf(pane);
        if (at !== null) {
          await press(at);
          await sleep(300);
          if ((await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0")) === 1)
            await key("Backspace");
        }
      }
      await sleep(500);
    } catch {
      /* a row that cannot go on ends the rows, never what the earlier rows found */
    }
    const after = await census();
    if (after !== before)
      problems.push(
        `CLEARED: ${after} panes on the board after the use rows, not the ${before} found`,
      );
    say(`SMOKE_CANVAS_USE_CLEARED ${JSON.stringify({ before, after })}`);
    await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient)})`);
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(themeWas)})`);
  }
  return problems;
}
