// HN-D3 — THE DESK'S COPY, IN THE PRODUCT (smoke:canvas; DESIGN.md §8 "The desk's Copy", "The missing face"; R25, DK-D26;
// plan addendum (50)). Where Send to… stood, Copy deals the selection into the hand as ONE card — pressed on the bar, in
// the bar grown into its menu, on the tools in hand, or by ⌘C over the desk. Each row presses the real chrome where it
// stands (or the real key) and reads back off a page-side recorder (the bar's `data-shown` and the selection's count,
// every frame from the press) and off the desk's door (`__vfDesk.copied()` — the act's record: the objects, the words
// the system clipboard was given and whether its door took them, the capture's rect and the still's size, the selection
// observed standing, the card dealt or why none was):
//   NOTE    — a line written on the note, the note copied from the BAR: a TEXT card of its words, its first sentence its
//             title; the words given the system clipboard's door, and taken; the selection NEVER changing, frame by
//             frame, from the press on; the bar never stepping aside (nothing waits on the line any more);
//   KEY     — ⌘C over the note, nothing focused: the same act from the key; ⌘C while the note's writing holds the
//             keyboard: the desk's editor keeps it, and no card is dealt;
//   CLOCK   — any other kind: a PICTURE card titled by its name ("Clock"), its still the anchor's box less the brackets'
//             6 at the view's device px, drawn WITHOUT the selection's marks by ICE's capture (`marks: false`, I40);
//   TWO     — the clock and the note, copied from the bar grown into its MENU: ONE picture card, "2 objects", the union's
//             10 off; the note's words on the system clipboard, beside the picture in its one write (LC-19);
//   HAND    — the notebook IN HAND, copied from the tools in hand: a picture card "Notebook" of where the desk DRAWS it
//             (`__vfDesk.held()`), the object staying in hand and the tools under the head;
//   MISSING — the clock's plugin off, its missing face copied: a picture card titled by its type's name ("Clock");
//             and each picture row's PNG handed to main's picture door, and taken, before its card was dealt (HN-5);
//   COUNTERS — the bar's placements ≤ the anchor's publishes through all of it;
//   DROP    — a card let go on the desk's clear ground is placed THERE as a note of its words (HN-D7; LC-17): dealt and
//             played through the hand's lab door (`__vfCards.deal`, `playAt` — the place a drop finds at a point, as
//             the drag finds it; page calls only, no pointer of the system's), the note under the point after, said
//             "Placed as a note" on the line, then let go of (a play leaves it selected);
//   EMPTIED — the hand emptied through its lab door (`__vfCards.clear()`, field-app frame/cards/cards-lab.ts): the rows
//             after these predate any chrome at the window's foot, and a pointer in the reach band lifts a card.
// These rows hold the act; the hand's own DOM is smoke:godview's (⇧⌘V raising it over a focused pane, `chordHand`, and
// 11h's card played into a pane). NOTE and KEY hand the note's words to main's copy door; CLOCK, TWO, HAND and MISSING
// their picture to main's picture door, TWO with the note's words beside it (HN-5, LC-19). A marked run KEEPS each
// instead of writing it (R-T 4 — the pasteboard is the person's; main/index.ts) and answers as it would: the door's
// answer (`wrote`) is the act's witness, and main's records (`copies` the words, `pictures` a PNG's size) say what
// arrived. The picture door asks no focus (LC-18), so the shown-inactive window's copies run the product's own road.
// The still: hn-3-copy.png (the window, the note's card dealt).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { type BarCounters, judgeCounters, POINT_IN } from "./smoke-selection-bar";

/** The canon's numbers for Copy's still (§8: the anchor's box less the brackets' outset). */
export const COPY = { brackets: 6 } as const;

/** The line the NOTE row writes, and the title its text card must carry: its first sentence. */
export const NOTE_LINE = "Ship the desk by Friday. Then the covers and presence.";
export const NOTE_TITLE = "Ship the desk by Friday.";

const CLOCK = "vibefield.example.desk-clock";

/** A box on screen, CSS px. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The act's record (`__vfDesk.copied()`), as the rows read it. */
export interface CopiedSeen {
  readonly seq: number;
  readonly from: string;
  readonly objects: readonly { readonly type: string; readonly name: string }[];
  readonly fromBox: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly rect: Box | null;
  readonly words: string | null;
  readonly wrote: boolean | null;
  /** the marks the capture door was handed for the still — `false`, without them (ICE I40); null: never asked */
  readonly marks: boolean | null;
  /** the selection observed standing as at the press while the still was taken (null: not yet) */
  readonly kept: boolean | null;
  readonly still: {
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
  } | null;
  readonly card: {
    readonly id: string;
    readonly kind: "text" | "pict";
    readonly title: string;
  } | null;
  readonly refused: string | null;
  readonly at: { readonly pressed: number; readonly captured?: number; readonly dealt?: number };
}

/** What the page-side recorder saw from its arming (just before a press) on. */
export interface CopyRecorded {
  readonly t0: number;
  readonly bar: readonly { readonly t: number; readonly shown: string | null }[];
  /** the selection's count (`__vfDesk.anchor().count`) as it stood when armed, and each frame it changed after */
  readonly selection: readonly { readonly t: number; readonly count: number | null }[];
}

const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;

/** The card the act dealt: its kind and its title — or, with none, the reason the line was told. */
export function judgeCard(
  copied: CopiedSeen | null,
  want: { readonly kind: "text" | "pict"; readonly title: string },
): string[] {
  if (copied === null) return ["no Copy was recorded"];
  if (copied.card === null)
    return [`no card was dealt (${copied.refused ?? "and no reason was said"})`];
  const problems: string[] = [];
  if (copied.card.kind !== want.kind)
    problems.push(`the card is a ${copied.card.kind} card, not a ${want.kind} card`);
  if (copied.card.title !== want.title)
    problems.push(
      `the card is titled ${JSON.stringify(copied.card.title)}, not ${JSON.stringify(want.title)}`,
    );
  return problems;
}

/**
 * A picture card's still (DK-D26): taken, the rect the anchor's box less the brackets' outset, its size that rect at the
 * view's device px, its PNG's bytes kept; asked WITHOUT the selection's marks (ICE I40, `marks: false`) and the
 * selection observed standing as at the press (DK-17b). `box` is the anchor's box as published before the press (null
 * in hand: the drawn box is the rect).
 */
export function judgeStill(
  copied: CopiedSeen | null,
  box: Box | null,
  dpr: number,
  inHand = false,
): string[] {
  if (copied === null) return ["no Copy was recorded"];
  const problems: string[] = [];
  if (copied.rect === null) problems.push("the act had no rect to capture");
  if (copied.still === null) problems.push("no still was taken for the card");
  if (box !== null && copied.rect !== null) {
    const want = {
      x0: box.x0 + COPY.brackets,
      y0: box.y0 + COPY.brackets,
      x1: box.x1 - COPY.brackets,
      y1: box.y1 - COPY.brackets,
    };
    if (
      !near(copied.rect.x0, Math.max(0, want.x0), 1) ||
      !near(copied.rect.y0, Math.max(0, want.y0), 1) ||
      !near(copied.rect.x1, want.x1, 1) ||
      !near(copied.rect.y1, want.y1, 1)
    )
      problems.push(
        `the still's rect ${JSON.stringify(copied.rect)} is not the anchor's box less the brackets' 6 ${JSON.stringify(want)}`,
      );
  }
  if (copied.rect !== null && copied.still !== null) {
    const w = (copied.rect.x1 - copied.rect.x0) * dpr;
    const h = (copied.rect.y1 - copied.rect.y0) * dpr;
    if (!near(copied.still.width, w, 2) || !near(copied.still.height, h, 2))
      problems.push(
        `the still is ${copied.still.width} × ${copied.still.height}, not its rect at the device's ${w.toFixed(0)} × ${h.toFixed(0)}`,
      );
    if (copied.still.bytes <= 0) problems.push("the still carries no bytes");
  }
  // the act records the option as the capture door was handed it (copy-to-hand.ts), so a still
  // asked with the brackets — or never asked at all — reads as what it was
  if (copied.marks === null) problems.push("the capture door was never asked for the still");
  else if (copied.marks)
    problems.push("the still was asked WITH the selection's marks (the door was handed true)");
  if (copied.kept !== true)
    problems.push(
      `the selection did not stand as at the press while the still was taken (kept ${JSON.stringify(copied.kept)}${inHand ? ", in hand" : ""})`,
    );
  return problems;
}

/**
 * NO BLINK (ICE I40): the selection never changes during Copy — every frame the recorder saw from its arming (before
 * the press) on holds the count it stood at then: no clear, no put-back, nothing a peer could see blink.
 */
export function judgeSelectionKept(rec: CopyRecorded): string[] {
  const first = rec.selection[0];
  if (first === undefined) return ["the recorder saw no selection"];
  // the recorder writes a sample only when the count moved: every one after the first is a change (a put-back included)
  const changed = rec.selection.slice(1);
  return changed.length === 0
    ? []
    : [
        `the selection changed during Copy — ${first.count} at the press, then ${changed.map((s) => `${s.count} at +${(s.t - rec.t0).toFixed(0)} ms`).join(", ")} (a blink a peer would see)`,
      ];
}

/** The bar over the selection STAYS through a Copy: nothing waits on the line, so it never steps aside (HN-D3). */
export function judgeBarStayed(rec: CopyRecorded, pressedAt: number): string[] {
  const away = rec.bar.filter((b) => b.t >= pressedAt && b.shown !== "true");
  return away.length === 0
    ? []
    : [
        `the bar stepped aside for Copy (${away.map((b) => `${b.shown} at +${(b.t - pressedAt).toFixed(0)} ms`).join(", ")})`,
      ];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The recorder, armed just before a press: the bar's `data-shown` and the selection's count, each frame they change. */
const ARM = `(() => {
  const rec = { t0: performance.now(), bar: [], selection: [] };
  globalThis.__hn3rec = rec;
  let lastShown;
  let lastCount;
  const step = () => {
    const now = performance.now();
    const shown = document.querySelector("[data-selection-bar]")?.getAttribute("data-shown") ?? null;
    if (shown !== lastShown) { rec.bar.push({ t: now, shown }); lastShown = shown; }
    const count = globalThis.__vfDesk?.anchor?.()?.count ?? null;
    if (count !== lastCount) { rec.selection.push({ t: now, count }); lastCount = count; }
    if (now - rec.t0 < 3000) requestAnimationFrame(step);
  };
  step();
  return rec.t0;
})()`;

export interface CopyRowsDriver {
  readonly win: BrowserWindow;
  /** fieldd's plugins door. */
  readonly plugins: {
    disable(id: string): Promise<unknown>;
    enable(id: string): Promise<unknown>;
  };
  readonly shotDir: string | undefined;
  readonly say: (line: string) => void;
  /** The words main's copy door kept in place of the system clipboard — a marked run's (R-T 4); absent in an unmarked
   * run, whose door writes the real one and leaves nothing to read back. */
  readonly copies?: readonly string[];
  /** HN-5 — the PNG sizes main's picture door kept in place of the system clipboard, a marked run's; absent unmarked. */
  readonly pictures?: readonly number[];
}

/** Whether main's copy door received `words` since its record held `from` entries — null with no record to read. */
export function copiedToMain(
  copies: readonly string[] | undefined,
  from: number,
  words: string,
): boolean | null {
  return copies === undefined ? null : copies.slice(from).includes(words);
}

/** What a play through the hand's lab door came to (field-app's `CardsLabPlay`), as it crosses back. */
interface LabPlaySeen {
  readonly at: { readonly x: number; readonly y: number } | null;
  readonly target: string | null;
  readonly answer: { readonly ok: boolean; readonly label: string } | null;
  readonly played: { readonly ok: boolean; readonly note: string } | null;
  readonly refused: string | null;
}

/** A clear point of the desk: the window's, and the desk's own (what `pick` reads). */
interface GroundSeen {
  readonly x: number;
  readonly y: number;
  readonly local: { readonly x: number; readonly y: number };
}

/** The words of DROP's card — its note must carry exactly these. */
export const DROP_WORDS = "Dropped on the desk: a card's words, placed as a note.";

/** HN-5 — whether main's picture door received a PNG of `bytes` since its record held `from` entries — null with no
 * record to read, or no still to measure. */
export function picturedToMain(
  pictures: readonly number[] | undefined,
  from: number,
  bytes: number | undefined,
): boolean | null {
  return pictures === undefined || bytes === undefined
    ? null
    : pictures.slice(from).includes(bytes);
}

/** HN-5 — a picture card's PNG reached main's picture door, which took it, before the card was dealt: the door's answer
 * (`wrote`) and, in a marked run, main's record of the still's size since `from`. */
export function judgePictured(
  copied: CopiedSeen | null,
  pictures: readonly number[] | undefined,
  from: number,
): string[] {
  if (copied === null) return ["no Copy was recorded"];
  const problems: string[] = [];
  if (copied.wrote !== true)
    problems.push(
      `the picture door did not take the picture (${copied.refused ?? "and no reason was said"})`,
    );
  if (picturedToMain(pictures, from, copied.still?.bytes) === false)
    problems.push("main's picture door never received the picture");
  return problems;
}

/** HN-3's rows (above). Returns the problems, each in words. */
export async function deskCopyRows(d: CopyRowsDriver): Promise<string[]> {
  const { win, say } = d;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const copied = (): Promise<CopiedSeen | null> =>
    js<CopiedSeen | null>("globalThis.__vfDesk.copied()");
  const until = async (label: string, timeoutMs: number, expression: string): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await js<unknown>(expression)) === true) return;
      await sleep(60);
    }
    throw new Error(
      `${label} did not happen within ${timeoutMs}ms (copied ${JSON.stringify(await copied())})`,
    );
  };
  const press = async (at: { x: number; y: number }, modifiers: "shift"[] = []): Promise<void> => {
    win.webContents.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
    await sleep(40);
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: at.x,
      y: at.y,
      button: "left",
      clickCount: 1,
      modifiers,
    });
    await sleep(50);
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: at.x,
      y: at.y,
      button: "left",
      clickCount: 1,
      modifiers,
    });
  };
  const key = async (keyCode: string): Promise<void> => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
    await sleep(80);
  };
  const command = process.platform === "darwin" ? "meta" : "control";
  /** ⌘C (Ctrl+C off the Mac) as a keyboard presses it: down and up, no character. */
  const copyKey = async (): Promise<void> => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "c", modifiers: [command] });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "c", modifiers: [command] });
    await sleep(80);
  };
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
  const point = async (type: string): Promise<{ x: number; y: number }> => {
    const p = await js<{ x: number; y: number } | null>(POINT_IN(type));
    if (p === null) throw new Error(`${type} was not picked where the desk receives a press`);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };
  const writing = `document.activeElement?.hasAttribute("data-desk-editor") === true`;
  const letWritingGo = async (): Promise<void> => {
    if (await js<boolean>(writing)) {
      await key("Escape");
      await until("the writing let go", 5_000, `!(${writing})`);
    }
  };
  const select = async (type: string, modifiers: "shift"[] = []): Promise<void> => {
    await press(await point(type), modifiers);
    await sleep(300);
    await letWritingGo();
  };
  const barShown = async (label: string, extra = "true"): Promise<void> => {
    await until(
      label,
      10_000,
      `(() => { const b = document.querySelector("[data-selection-bar]"); return b?.getAttribute("data-shown") === "true" && (${extra}); })()`,
    );
    await sleep(300); // the bar's fade in (180 ms), whole
  };
  const shoot = async (name: string): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await win.capturePage()).toPNG());
  };
  const deselect = async (): Promise<void> => {
    await js(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
    await key("Escape");
    await key("Escape");
    if ((await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0")) === 0) return;
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
  const recorded = (): Promise<CopyRecorded> => js<CopyRecorded>("globalThis.__hn3rec");
  /** The last record's seq — a press's copy is the record after it. */
  const seqNow = async (): Promise<number> => (await copied())?.seq ?? 0;
  /** The copy after `seq` has come to its end: a card dealt or a reason said, and the clipboard's door answered. */
  const dealt = async (label: string, seq: number): Promise<CopiedSeen> => {
    await until(
      label,
      10_000,
      `(() => { const c = globalThis.__vfDesk.copied(); return c !== null && c.seq > ${seq} && (c.card !== null || c.refused !== null) && (c.words === null || c.wrote !== null); })()`,
    );
    const record = await copied();
    if (record === null) throw new Error(`${label}: the record went away`);
    return record;
  };
  /** Press a Copy door where it stands, the recorder armed first. */
  const pressCopy = async (selector: string): Promise<void> => {
    await js(ARM);
    await pressAt(selector);
  };
  const dpr = await js<number>("devicePixelRatio");
  const BAR_COPY = '[data-selection-bar] .vf-bar-row [data-act="copy"]';

  const problems: string[] = [];
  const counters0 = await js<BarCounters>("globalThis.__vfDesk.bar()");
  await deselect();

  // ── NOTE: a line written on the note, the note copied from the BAR — a text card of its words ───────────────
  {
    const row = (p: string): string => `NOTE: ${p}`;
    await press(await point("desk.note"));
    await until("the desk's editor lent to the note", 10_000, writing);
    for (const ch of NOTE_LINE) {
      win.webContents.sendInputEvent({ type: "char", keyCode: ch });
      await sleep(12);
    }
    await until(
      "the note's line in its ink cell",
      15_000,
      `globalThis.__vfDesk.objects("desk.note")[0]?.props.text === ${JSON.stringify(NOTE_LINE)}`,
    );
    await letWritingGo();
    await barShown("the bar over the note", `globalThis.__vfDesk.anchor()?.count === 1`);
    const seq = await seqNow();
    const handed = d.copies?.length ?? 0;
    await pressCopy(BAR_COPY);
    const record = await dealt("the note's card dealt", seq);
    await sleep(700); // the deal's flight, and the recorder a while past it
    const rec = await recorded();
    problems.push(
      ...judgeCard(record, { kind: "text", title: NOTE_TITLE }).map(row),
      ...judgeSelectionKept(rec).map(row),
      ...judgeBarStayed(rec, record.at.pressed).map(row),
    );
    if (record.from !== "bar")
      problems.push(row(`the act was recorded from ${record.from}, not the bar`));
    if (record.words !== NOTE_LINE || record.wrote !== true)
      problems.push(
        row(`the copy door was not given the note's words (${JSON.stringify(record)})`),
      );
    if (copiedToMain(d.copies, handed, NOTE_LINE) === false)
      problems.push(row("main's copy door never received the note's words"));
    if (record.still !== null) problems.push(row("a still was taken for a note's words"));
    say(`SMOKE_CANVAS_COPY_NOTE ${JSON.stringify({ copied: record, bar: rec.bar.length })}`);
    await shoot("hn-3-copy.png");
  }

  // ── KEY: ⌘C over the note — the same act; ⌘C while its writing holds the keyboard — the editor's own ─────────
  {
    const row = (p: string): string => `KEY: ${p}`;
    await js(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
    const seq = await seqNow();
    const handed = d.copies?.length ?? 0;
    await copyKey();
    const record = await dealt("⌘C's card dealt", seq);
    problems.push(...judgeCard(record, { kind: "text", title: NOTE_TITLE }).map(row));
    if (record.from !== "key")
      problems.push(row(`the act was recorded from ${record.from}, not the key`));
    if (copiedToMain(d.copies, handed, NOTE_LINE) === false)
      problems.push(row("main's copy door never received the note's words"));
    // the note's writing takes the keyboard: ⌘C is its own, and no card is dealt
    await press(await point("desk.note"));
    await until("the desk's editor lent to the note again", 10_000, writing);
    const writingSeq = await seqNow();
    await copyKey();
    await sleep(600);
    if ((await seqNow()) !== writingSeq)
      problems.push(row("⌘C in the note's writing dealt a card — the editor's copy was taken"));
    await letWritingGo();
    say(`SMOKE_CANVAS_COPY_KEY ${JSON.stringify({ copied: record, writingSeq })}`);
    await deselect();
  }

  // ── CLOCK: any other kind — a picture card titled by its name ───────────────────────────────────────────────
  {
    const row = (p: string): string => `CLOCK: ${p}`;
    await select(CLOCK);
    await barShown("the bar over the clock", `globalThis.__vfDesk.anchor()?.count === 1`);
    const box = await js<Box | null>("globalThis.__vfDesk.anchor()?.box ?? null");
    const seq = await seqNow();
    const handedPictures = d.pictures?.length ?? 0;
    await pressCopy(BAR_COPY);
    const record = await dealt("the clock's card dealt", seq);
    await sleep(400);
    const rec = await recorded();
    problems.push(
      ...judgeCard(record, { kind: "pict", title: "Clock" }).map(row),
      ...judgeStill(record, box, dpr).map(row),
      ...judgeSelectionKept(rec).map(row),
      ...judgeBarStayed(rec, record.at.pressed).map(row),
      ...judgePictured(record, d.pictures, handedPictures).map(row),
    );
    say(`SMOKE_CANVAS_COPY_CLOCK ${JSON.stringify({ copied: record, box })}`);
  }

  // ── TWO: the clock and the note, copied from the bar grown into its MENU — ONE card, "2 objects" ─────────────
  {
    const row = (p: string): string => `TWO: ${p}`;
    await select("desk.note", ["shift"]);
    await barShown("the bar over two", `globalThis.__vfDesk.anchor()?.count === 2`);
    const box = await js<Box | null>("globalThis.__vfDesk.anchor()?.box ?? null");
    await pressAt('[data-selection-bar] .vf-bar-row [data-act="more"]');
    await until(
      "the menu grown",
      5_000,
      `document.querySelector('[data-selection-bar] .vf-bar-list [data-row="copy"]') !== null && document.querySelector("[data-selection-bar]")?.hasAttribute("data-open") === true`,
    );
    await sleep(700); // the grow and the rows' stagger
    const seq = await seqNow();
    const handed = d.copies?.length ?? 0;
    const handedPictures = d.pictures?.length ?? 0;
    await pressCopy('[data-selection-bar] .vf-bar-list [data-row="copy"]');
    const record = await dealt("the two's card dealt", seq);
    // the union's 10 out, where the judge takes the one's 6
    const union =
      box === null ? null : { x0: box.x0 + 4, y0: box.y0 + 4, x1: box.x1 - 4, y1: box.y1 - 4 };
    problems.push(
      ...judgeCard(record, { kind: "pict", title: "2 objects" }).map(row),
      ...judgeStill(record, union, dpr).map(row),
      ...judgeSelectionKept(await recorded()).map(row),
      ...judgePictured(record, d.pictures, handedPictures).map(row),
    );
    if (record.from !== "menu")
      problems.push(row(`the act was recorded from ${record.from}, not the menu`));
    const types = record.objects.map((o) => o.type).sort();
    if (JSON.stringify(types) !== JSON.stringify(["desk.note", CLOCK].sort()))
      problems.push(row(`the copy carried ${JSON.stringify(types)}, not the note and the clock`));
    // the note's words beside the picture, in its one write (LC-19): main's record keeps them as the copy door's does
    if (record.words !== NOTE_LINE)
      problems.push(row(`the words given the clipboard were ${JSON.stringify(record.words)}`));
    if (copiedToMain(d.copies, handed, NOTE_LINE) === false)
      problems.push(row("main's picture door never received the note's words"));
    const count = await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0");
    if (count !== 2)
      problems.push(row(`the two did not stand selected after the still (${count})`));
    say(`SMOKE_CANVAS_COPY_TWO ${JSON.stringify({ copied: record })}`);
    await deselect();
  }

  // ── HAND: the notebook in hand, copied from the tools in hand — it stays in hand ─────────────────────────────
  {
    const row = (p: string): string => `HAND: ${p}`;
    await select("desk.notebook");
    await barShown("the bar over the notebook", `globalThis.__vfDesk.anchor()?.count === 1`);
    await key("Return");
    await until(
      "the notebook in hand, its tools under the head",
      10_000,
      `(() => { const h = globalThis.__vfDesk.held(); const b = document.querySelector("[data-selection-bar]"); return h !== null && h.frame?.settled === true && b?.getAttribute("data-face") === "hand" && b?.getAttribute("data-shown") === "true" && !b.hasAttribute("data-traveling"); })()`,
    );
    await sleep(300);
    const held = await js<{
      entity: number;
      frame: { cx: number; cy: number; hx: number; hy: number } | null;
    } | null>("globalThis.__vfDesk.held()");
    const seq = await seqNow();
    const handedPictures = d.pictures?.length ?? 0;
    await pressCopy('[data-selection-bar] [data-face-row="hand"] [data-act="copy"]');
    const record = await dealt("the notebook's card dealt", seq);
    problems.push(
      ...judgeCard(record, { kind: "pict", title: "Notebook" }).map(row),
      ...judgeStill(record, null, dpr, true).map(row),
      ...judgePictured(record, d.pictures, handedPictures).map(row),
    );
    const f = held?.frame ?? null;
    if (f !== null && record.rect !== null) {
      const drawn = { x0: f.cx - f.hx, y0: f.cy - f.hy, x1: f.cx + f.hx, y1: f.cy + f.hy };
      if (
        !near(record.rect.x0, Math.max(0, drawn.x0), 1) ||
        !near(record.rect.y0, Math.max(0, drawn.y0), 1)
      )
        problems.push(
          row(`the still is not the drawn box (${JSON.stringify({ drawn, rect: record.rect })})`),
        );
    }
    if (record.from !== "hand")
      problems.push(row(`the act was recorded from ${record.from}, not the hand`));
    const after = await js<{
      held: boolean;
      face: string | null;
      shown: string | null;
      top: number | null;
    }>(`(() => {
      const b = document.querySelector("[data-selection-bar]");
      const r = b?.querySelector('[data-face-row="hand"]')?.getBoundingClientRect();
      return { held: globalThis.__vfDesk.held() !== null, face: b?.getAttribute("data-face") ?? null, shown: b?.getAttribute("data-shown") ?? null, top: r === undefined ? null : r.top };
    })()`);
    if (!after.held) problems.push(row("Copy put the notebook down"));
    if (
      after.face !== "hand" ||
      after.shown !== "true" ||
      after.top === null ||
      !near(after.top, 64, 1)
    )
      problems.push(
        row(`the tools in hand did not stay under the head (${JSON.stringify(after)})`),
      );
    say(`SMOKE_CANVAS_COPY_HAND ${JSON.stringify({ copied: record, held, after })}`);
    await pressAt('[data-selection-bar] [data-face-row="hand"] [data-act="done"]');
    await until("the notebook put down", 10_000, "globalThis.__vfDesk.held() === null");
    await sleep(800);
    await deselect();
  }

  // ── MISSING: the clock's plugin off — its missing face copied is titled by its type's name ───────────────────
  {
    const row = (p: string): string => `MISSING: ${p}`;
    const mount0 = await js<number>("globalThis.__vfDesk.mount");
    await d.plugins.disable(CLOCK);
    await until(
      "the desk remounted without the clock's kind",
      30_000,
      `(globalThis.__vfDesk?.mount ?? -1) > ${mount0} && globalThis.__vfDesk.words(${JSON.stringify(CLOCK)}).state === "plugin off" && globalThis.__vfDesk.status().state === "ready" && globalThis.__vfDesk.perf().frames >= 1`,
    );
    await select(CLOCK);
    await barShown(
      "the bar naming the missing face",
      `document.querySelector("[data-selection-bar] [data-bar-words]")?.textContent === "Clock · plugin off"`,
    );
    const box = await js<Box | null>("globalThis.__vfDesk.anchor()?.box ?? null");
    const seq = await seqNow();
    const handedPictures = d.pictures?.length ?? 0;
    await pressCopy(BAR_COPY);
    const record = await dealt("the missing face's card dealt", seq);
    problems.push(
      ...judgeCard(record, { kind: "pict", title: "Clock" }).map(row),
      ...judgeStill(record, box, dpr).map(row),
      ...judgeSelectionKept(await recorded()).map(row),
      ...judgePictured(record, d.pictures, handedPictures).map(row),
    );
    say(`SMOKE_CANVAS_COPY_MISSING ${JSON.stringify({ copied: record })}`);
    await deselect();
    const mount1 = await js<number>("globalThis.__vfDesk.mount");
    await d.plugins.enable(CLOCK);
    await until(
      "the clock drawn again",
      30_000,
      `(globalThis.__vfDesk?.mount ?? -1) > ${mount1} && globalThis.__vfDesk.words(${JSON.stringify(CLOCK)}).state === null && globalThis.__vfDesk.status().state === "ready" && globalThis.__vfDesk.perf().frames >= 1 && (${POINT_IN(CLOCK)}) !== null`,
    );
  }

  // ── COUNTERS: placements ≤ publishes ──────────────────────────────────────────────────────────────────────────
  const counters1 = await js<BarCounters>("globalThis.__vfDesk.bar()");
  problems.push(...judgeCounters(counters0, counters1).map((p) => `COUNTERS: ${p}`));
  say(`SMOKE_CANVAS_COPY_COUNTERS ${JSON.stringify({ before: counters0, after: counters1 })}`);

  // ── DROP: a card let go on the desk's clear ground, placed there as a note (HN-D7, LC-17) ───────────────────────
  {
    const row = (p: string): string => `DROP: ${p}`;
    const dealt = await js<string | null>(
      `globalThis.__vfCards?.deal(${JSON.stringify(DROP_WORDS)}) ?? null`,
    );
    // clear ground, found as `deselect` finds the mat, clear of the head above and of the line and
    // the hand below; `local` is the desk's own point, which its pick reads
    const ground = await js<GroundSeen | null>(`(() => {
      const d = globalThis.__vfDesk; const el = document.querySelector("[data-desk]");
      if (d === undefined || el === null) return null;
      const r = el.getBoundingClientRect();
      for (let y = 160; y < r.height - 260; y += 24) for (let x = 120; x < r.width - 120; x += 24) {
        if (d.pick({ x, y }) !== null) continue;
        const under = document.elementFromPoint(r.left + x, r.top + y);
        if (under !== null && el.contains(under)) return { x: r.left + x, y: r.top + y, local: { x, y } };
      }
      return null;
    })()`);
    if (dealt === null) {
      problems.push(row("no lab door (window.__vfCards) dealt the card"));
    } else if (ground === null) {
      problems.push(row("no clear ground on the desk to let the card go on"));
    } else {
      const notes = `globalThis.__vfDesk.objects("desk.note")`;
      const before = await js<number>(`${notes}.length`);
      const play = await js<LabPlaySeen>(`globalThis.__vfCards.playAt(${ground.x}, ${ground.y})`);
      if (play.target !== "desk" || play.played?.ok !== true) {
        problems.push(row(`the desk did not take the card there (${JSON.stringify(play)})`));
      } else {
        if (play.played.note !== "Placed as a note") {
          problems.push(
            row(`the line said ${JSON.stringify(play.played.note)}, not "Placed as a note"`),
          );
        }
        await until("the card's note placed", 5_000, `${notes}.length === ${before + 1}`);
        const note = await js<{ entity: number } | null>(
          `${notes}.find((o) => o.props.text === ${JSON.stringify(DROP_WORDS)}) ?? null`,
        );
        const under = await js<{ entity: number; type: string } | null>(
          `globalThis.__vfDesk.pick(${JSON.stringify(ground.local)})`,
        );
        if (note === null) problems.push(row("no note carries the card's words"));
        else if (under?.entity !== note.entity) {
          problems.push(
            row(`the note is not where the card was let go (${JSON.stringify(under)})`),
          );
        }
      }
      say(`SMOKE_CANVAS_CARD_DROP ${JSON.stringify({ at: ground, play })}`);
      await deselect();
    }
  }

  // ── EMPTIED: the hand emptied, so no card at the foot lifts into the rows after these ───────────────────────────
  const emptied = await js<number | null>("globalThis.__vfCards?.clear() ?? null");
  if (emptied === null) {
    problems.push(
      "EMPTIED: no lab door (window.__vfCards) — the hand stays full for the rows after",
    );
  } else {
    const empty = `document.querySelector(".vf-cards .vf-card") === null`;
    await until("the hand emptied", 5_000, empty);
  }
  say(`SMOKE_CANVAS_COPY_EMPTIED ${JSON.stringify({ cards: emptied })}`);
  return problems;
}
