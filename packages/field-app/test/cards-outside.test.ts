// @vitest-environment happy-dom
/**
 * HN-6 — what another app hands over (DESIGN.md §8 "The hand", where cards come from — brought
 * in; HN-D2, HN-D10, HN-L1, HN-L3; LC-7, LC-8). ⌘V with no caret deals a card for each thing the
 * paste holds, and every caret's own paste is left alone; a paste of what the newest card already
 * is lifts it; a drag from another app is the drag machine's waiting card from its enter to its
 * drop, which fills it — into a pane once (the pane's own drop never runs), anywhere else into the
 * hand. The transfers take the browser's own shape (`types` says "Files"; during a drag only the
 * kinds can be read); the shell's file door and a picture's decoder are fixtures; the clock is
 * faked: the watchdog, the play, the fade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { carriedLabel } from "../src/frame/cards/CarriedCardLayer";
import {
  endCardDrag,
  getCarriedCard,
  PLAY_HOME_MS,
  PLAY_SHRINK_MS,
  resetCardDragForTest,
  startCardDrag,
} from "../src/frame/cards/card-drag";
import {
  type CardAnswer,
  type CardPlayed,
  type CardTarget,
  cardTargets,
  TARGET_LAYER,
} from "../src/frame/cards/card-targets";
import {
  type Card,
  type FileCard,
  type PictCard,
  textCardOf,
} from "../src/frame/cards/cards-model";
import {
  FIRST_LINES_BYTES,
  folderOf,
  listenForOtherApps,
  type OtherAppsOptions,
  OUTSIDE_WATCH_MS,
  type Pixels,
  waitingCardOf,
} from "../src/frame/cards/cards-outside";
import { CardStore } from "../src/frame/cards/cards-store";
import { OUTSIDE_WORDS, TARGET_WORDS, WAITING_WORDS } from "../src/frame/cards/cards-words";
import { hearLineSays } from "../src/frame/line-door";

/** A picture's first bytes: what it measures is the decoder fixture's to say. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const DRAGGED = { view: "outside", how: "drag" } as const;

let store: CardStore;
let offs: Array<() => void> = [];
let said: string[] = [];
/** The shell's file door, faked: each File's path on disk. */
let paths = new Map<File, string>();
/** A picture's decoder, faked: what each picture measures — none, one it cannot draw. */
let sizes = new Map<Blob, Pixels>();
let places = 0;

interface Contents {
  readonly files?: readonly File[];
  readonly text?: string;
  /** which of the files are folders */
  readonly folders?: readonly File[];
  /** a drag under way: the system says what kind each item is, and nothing more */
  readonly kindsOnly?: boolean;
}

/** A transfer in the browser's own shape — its `types` say "Files" for files, as Chromium's do
 * (happy-dom's would name each file's type) — holding files, words, both or neither. */
function transfer(contents: Contents = {}): DataTransfer {
  const files = contents.files ?? [];
  const readable = contents.kindsOnly !== true;
  const types: string[] = [];
  const items: object[] = [];
  for (const file of files) {
    const folder = contents.folders?.includes(file) === true;
    items.push({
      kind: "file",
      type: file.type,
      getAsFile: () => (readable ? file : null),
      webkitGetAsEntry: () => (readable ? { isDirectory: folder } : null),
    });
  }
  if (files.length > 0) types.push("Files");
  if (contents.text !== undefined) {
    items.push({ kind: "string", type: "text/plain", getAsFile: () => null });
    types.push("text/plain");
  }
  const words = readable ? (contents.text ?? "") : "";
  return {
    types,
    items,
    files: readable ? files : [],
    getData: (format: string) => (format === "text/plain" ? words : ""),
    dropEffect: "none",
  } as unknown as DataTransfer;
}

/** ⌘V as the app menu sends it, at whatever holds the keys: trusted, as the person's own paste
 * is — a page's own (a test's, the deck's door) is not. */
function paste(target: EventTarget, data: DataTransfer, isTrusted = true): ClipboardEvent {
  const event = new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData: data,
  });
  Object.defineProperty(event, "isTrusted", { value: isTrusted });
  target.dispatchEvent(event);
  return event;
}

/** A drag event as the system sends one, at a window point — at the page's body unless told, and
 * into nothing (the window's outside) unless told. */
function drag(
  type: "dragenter" | "dragover" | "dragleave" | "drop",
  data: DataTransfer,
  at: { readonly x: number; readonly y: number },
  options: { readonly target?: EventTarget; readonly into?: EventTarget } = {},
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
    relatedTarget: options.into ?? null,
  });
  Object.defineProperty(event, "dataTransfer", { value: data });
  (options.target ?? document.body).dispatchEvent(event);
  return event;
}

const pointerAt = (x: number, y: number): void => {
  document.body.dispatchEvent(
    new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }),
  );
};

/** A DOM that hit-tests, as the drag reads what is under the pointer: what lies under each point,
 * topmost first (happy-dom draws nothing). */
const hits = (under: (x: number, y: number) => Element[]): void => {
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: under });
};

/** What another app handed over is read through promises: let them all come back. */
const settled = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

/** Hear another app as the mounted hand does: the shell's door and the decoder, unless told. */
function listen(options: OtherAppsOptions = {}): void {
  offs.push(
    listenForOtherApps({
      store,
      host: { pathForFile: (file) => paths.get(file) ?? null },
      measure: async (picture) => sizes.get(picture) ?? null,
      ...options,
    }),
  );
}

/** A fixture place, registered for the case: what it answers each card, what it was handed. */
function place(options: {
  readonly kind: CardTarget["kind"];
  readonly box: DOMRect;
  /** its own element: it answers only where the element on top lies inside it */
  readonly element?: Element;
  readonly answer?: (card: Card) => CardAnswer | null;
  readonly played?: CardPlayed;
}): { readonly played: Card[]; readonly asked: Card[] } {
  places += 1;
  const played: Card[] = [];
  const asked: Card[] = [];
  const target: CardTarget = {
    id: `place-${places}`,
    kind: options.kind,
    layer: TARGET_LAYER[options.kind],
    rect: () => options.box,
    ...(options.element === undefined ? {} : { element: () => options.element ?? null }),
    answer: (card) => {
      asked.push(card);
      return options.answer === undefined
        ? { ok: true, label: "Paste into vibe-field" }
        : options.answer(card);
    },
    play: async (card) => {
      played.push(card);
      return options.played ?? { ok: true, note: "Pasted into vibe-field" };
    },
  };
  offs.push(cardTargets.register(target));
  return { played, asked };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetCardDragForTest();
  store = new CardStore(() => 1_000);
  said = [];
  paths = new Map();
  sizes = new Map();
  offs = [hearLineSays((note) => said.push(note))];
});

afterEach(() => {
  for (const off of offs.splice(0)) off();
  resetCardDragForTest();
  document.body.innerHTML = "";
  delete (document as unknown as Record<string, unknown>)["elementsFromPoint"];
  vi.useRealTimers();
});

describe("⌘V with no caret (HN-6, HN-L3)", () => {
  it("deals one card for each thing the paste holds, from the pointer's last place: its words, a picture by its bytes and pixels, a file by its path", async () => {
    listen();
    pointerAt(300, 200);
    const words = paste(document.body, transfer({ text: "Ship it. The tests pass." }));
    expect(words.defaultPrevented, "a paste the hand deals is the hand's").toBe(true);
    await settled();
    const [text] = store.snapshot().cards;
    expect(text).toMatchObject({
      kind: "text",
      title: "Ship it.",
      body: "The tests pass.",
      paste: "Ship it. The tests pass.",
      origin: { view: "outside", how: "paste" },
    });
    // it leaves from the point itself, the smallest box: the deal's smallest, growing on its way
    expect(store.snapshot().arriving.get(text?.id ?? "")).toEqual({
      left: 300,
      top: 200,
      width: 0,
      height: 0,
    });

    const shot = new File([PNG], "image.png", { type: "image/png" });
    sizes.set(shot, { width: 1440, height: 900 });
    const plan = new File(["# Plan\nShip it.\n"], "plan.md", { type: "text/markdown" });
    paths.set(plan, "/Users/me/vibe-field/docs/plan.md");
    const report = new File([new Uint8Array(12_000)], "report.pdf", { type: "application/pdf" });
    paths.set(report, "/Users/me/Desktop/report.pdf");
    // a Finder copy names its files in words too: the files are the things it holds
    paste(document.body, transfer({ files: [shot, plan, report], text: "plan.md" }));
    await settled();
    const [, picture, file, other] = store.snapshot().cards;
    expect(store.snapshot().cards).toHaveLength(4);
    expect(picture).toMatchObject({
      kind: "pict",
      title: "image.png",
      width: 1440,
      height: 900,
      bytes: shot,
      paste: "",
      origin: { view: "outside", how: "paste" },
    });
    expect((picture as PictCard).src).toMatch(/^blob:/u);
    expect(picture, "a picture with no file has none to give").not.toHaveProperty("path");
    expect(file).toMatchObject({
      kind: "file",
      name: "plan.md",
      folder: "vibe-field/docs",
      lines: "# Plan\nShip it.",
      paste: "/Users/me/vibe-field/docs/plan.md",
    });
    expect(other).toMatchObject({
      kind: "file",
      name: "report.pdf",
      folder: "me/Desktop",
      facts: "PDF · 12 KB",
      paste: "/Users/me/Desktop/report.pdf",
    });
    expect(other).not.toHaveProperty("lines");
    // several leave a step apart, so they fan on their way in
    const from = [...store.snapshot().arriving.values()].slice(1);
    expect(from.map((box) => box?.left)).toEqual([300, 314, 328]);
  });

  it("leaves a paste the caret's owner takes alone: a field's, a pane's, one already taken, one a page made", async () => {
    listen();
    const field = document.createElement("textarea");
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    const inEditor = document.createElement("span");
    editor.append(inEditor);
    const pane = document.createElement("div");
    pane.className = "ghostty-pane";
    pane.dataset.paneId = "pane-1";
    const inPane = document.createElement("canvas");
    pane.append(inPane);
    const taker = document.createElement("div");
    taker.addEventListener("paste", (event) => event.preventDefault());
    document.body.append(field, editor, pane, taker);

    for (const target of [field, inEditor, inPane, taker]) {
      const event = paste(target, transfer({ text: "Not the hand's." }));
      expect(event.defaultPrevented, target.nodeName).toBe(target === taker);
    }
    // the deck's own synthetic paste into a pane, say: never the person's
    const made = paste(document.body, transfer({ text: "A page's." }), false);
    expect(made.defaultPrevented).toBe(false);
    // and a paste of nothing a card can be is nobody's business but the page's
    expect(paste(document.body, transfer({ text: "   " })).defaultPrevented).toBe(false);
    await settled();
    expect(store.snapshot().cards).toEqual([]);
  });

  it("lifts the newest card for a paste of what it already is, and deals no second (HN-D10): words by their words, a picture with no file by its pixels (LC-8)", async () => {
    listen();
    paste(document.body, transfer({ text: "pnpm verify" }));
    await settled();
    const [first] = store.snapshot().cards;
    const again = paste(document.body, transfer({ text: "  pnpm verify\n" }));
    expect(again.defaultPrevented, "the paste is answered: the card lifts").toBe(true);
    await settled();
    expect(store.snapshot().cards).toHaveLength(1);
    expect(store.snapshot().nudged).toEqual({ id: first?.id, at: 1_000 });

    // the snapshot tool puts its still on the clipboard too: ⌘V right after brings it back with
    // no path, and the same pixels are that card
    const still: PictCard = {
      id: "card-pict-still",
      kind: "pict",
      origin: { view: "canvas", how: "snapshot" },
      at: 0,
      title: "Snapshot",
      width: 640,
      height: 400,
      src: "vibefield-still://stills/vibefield-screenshot-1.png",
      path: "/tmp/vibefield-screenshot-1.png",
      paste: "/tmp/vibefield-screenshot-1.png",
    };
    store.deal(still);
    const pixels = new File([PNG], "image.png", { type: "image/png" });
    sizes.set(pixels, { width: 640, height: 400 });
    paste(document.body, transfer({ files: [pixels] }));
    await settled();
    expect(store.snapshot().cards.map((card) => card.id)).toEqual([first?.id, still.id]);
    expect(store.snapshot().nudged?.id).toBe(still.id);
  });

  it("names a file by its path only where the shell has a file door: the catalog's have none, and two such are never one card", async () => {
    listen({ host: {} });
    const a = new File(["x"], "a.txt", { type: "text/plain" });
    const b = new File(["y"], "b.txt", { type: "text/plain" });
    // the door would know this one: the catalog has no door to ask
    paths.set(a, "/Users/me/a.txt");
    paste(document.body, transfer({ files: [a] }));
    await settled();
    paste(document.body, transfer({ files: [b] }));
    await settled();
    const cards = store.snapshot().cards;
    expect(cards.map((card) => [card.kind, card.paste])).toEqual([
      ["file", ""],
      ["file", ""],
    ]);
    expect(cards[0]).not.toHaveProperty("folder");
    expect(store.snapshot().nudged, "two files with no path read as one").toBeNull();
  });

  it("reads a text file's first lines from its first 640 bytes, a line cut there left out; any other file — a picture it cannot draw, a folder — says what it is", async () => {
    listen();
    const long = new File([`${"a".repeat(600)}\n${"b".repeat(100)}\n`], "long.txt", {
      type: "text/plain",
    });
    const tool = new File(["\u0000\u0001ELF"], "tool.sh", { type: "" });
    const heic = new File([PNG], "IMG_0001.HEIC", { type: "image/heic" });
    const folder = new File([], "vibe-field", { type: "" });
    paths.set(folder, "/Users/me/Projects/vibe-field");
    paste(document.body, transfer({ files: [long, tool, heic, folder], folders: [folder] }));
    await settled();
    const [a, b, c, d] = store.snapshot().cards;
    expect(FIRST_LINES_BYTES).toBe(640);
    expect((a as FileCard).lines).toBe("a".repeat(600));
    // words by its name, but a NUL among its bytes: not words
    expect(b).toMatchObject({ kind: "file", name: "tool.sh", facts: "SH · 5 bytes" });
    expect(b).not.toHaveProperty("lines");
    // no decoder here draws it: a file, never a picture of nothing
    expect(c).toMatchObject({ kind: "file", name: "IMG_0001.HEIC", facts: "HEIC · 4 bytes" });
    // a folder is its path, and no size of its own
    expect(d).toMatchObject({
      kind: "file",
      name: "vibe-field",
      folder: "me/Projects",
      paste: "/Users/me/Projects/vibe-field",
    });
    expect(d).not.toHaveProperty("facts");
  });

  it("prints a file's folder by its last two names, on either platform's separator", () => {
    expect(folderOf("/Users/me/vibe-field/src/routes.ts")).toBe("vibe-field/src");
    expect(folderOf("C:\\Users\\me\\Desktop\\report.pdf")).toBe("me/Desktop");
    expect(folderOf("/report.pdf")).toBeNull();
  });
});

describe("a drag from another app (HN-6, HN-D2)", () => {
  it("says only its kind while it is carried: one picture, a file or how many, or words", () => {
    const png = new File([PNG], "a.png", { type: "image/png" });
    const pdf = new File(["%PDF"], "b.pdf", { type: "application/pdf" });
    const waiting = (contents: Contents): Card =>
      waitingCardOf(transfer({ ...contents, kindsOnly: true }), store);
    expect(waiting({ files: [png] })).toMatchObject({
      kind: "pict",
      waiting: true,
      paste: "",
      origin: DRAGGED,
    });
    expect(waiting({ files: [pdf] })).toMatchObject({ kind: "file", name: "", waiting: true });
    expect(waiting({ files: [png, pdf, png] })).toMatchObject({ kind: "file", name: "3 files" });
    expect(waiting({ text: "words" })).toMatchObject({ kind: "text", title: "", waiting: true });
    expect(WAITING_WORDS.files(3)).toBe("3 files");
  });

  it("is a card the moment it enters the window — one for the whole drag, moved by the system's pointer — and a card picked up goes back for it", () => {
    listen();
    const held = textCardOf("Held.", { id: "card-held", origin: DRAGGED, at: 0 });
    store.deal(held);
    store.pickUp(held.id);
    const kinds = transfer({ files: [new File([PNG], "shot.png", { type: "image/png" })] });
    const enter = drag("dragenter", kinds, { x: 400, y: 300 });
    expect(enter.defaultPrevented).toBe(true);
    expect(getCarriedCard()).toMatchObject({
      source: "outside",
      x: 400,
      y: 300,
      phase: "carry",
      card: { kind: "pict", waiting: true, origin: DRAGGED },
      answer: { kind: "hand", ok: true, label: TARGET_WORDS.hand },
    });
    expect(store.snapshot().held, "the carry has the window").toBeNull();
    // entering each element under it is the same drag
    const first = getCarriedCard()?.drag;
    drag("dragenter", kinds, { x: 420, y: 310 });
    expect(getCarriedCard()?.drag).toBe(first);
    // its moves are the system's: the window's pointer moves nothing
    pointerAt(10, 10);
    expect(getCarriedCard()?.x).toBe(400);
  });

  it("follows the system's pointer on every dragover, which it always prevents: the drop is then the page's", () => {
    listen();
    const kinds = transfer({ text: "words", kindsOnly: true });
    drag("dragenter", kinds, { x: 100, y: 100 });
    const over = drag("dragover", kinds, { x: 640, y: 420 });
    expect(over.defaultPrevented).toBe(true);
    expect(kinds.dropEffect).toBe("copy");
    expect([getCarriedCard()?.x, getCarriedCard()?.y]).toEqual([640, 420]);
  });

  it("is gone once carried back out of the window, and only then: a leave inside it is the next element's", async () => {
    listen();
    const kinds = transfer({ text: "words", kindsOnly: true });
    drag("dragenter", kinds, { x: 300, y: 300 });
    drag("dragleave", kinds, { x: 300, y: 300 }, { into: document.body });
    drag("dragleave", kinds, { x: 300, y: 300 });
    expect(getCarriedCard()?.phase).toBe("carry");
    // on the window's edge, into nothing: out
    drag("dragleave", kinds, { x: 0, y: 300 });
    expect(getCarriedCard()).toMatchObject({ phase: "home", home: null });
    await vi.advanceTimersByTimeAsync(PLAY_HOME_MS + 40);
    expect(getCarriedCard()).toBeNull();
    expect(store.snapshot().cards).toEqual([]);
  });

  it("lets go of a drag the system stopped telling it about: 1.2s with no dragover and its card is gone", async () => {
    listen();
    const kinds = transfer({ text: "words", kindsOnly: true });
    drag("dragenter", kinds, { x: 300, y: 300 });
    for (const x of [310, 320, 330]) {
      await vi.advanceTimersByTimeAsync(OUTSIDE_WATCH_MS - 100);
      drag("dragover", kinds, { x, y: 300 });
    }
    expect(getCarriedCard()?.phase, "a drag still answering is still carried").toBe("carry");
    await vi.advanceTimersByTimeAsync(OUTSIDE_WATCH_MS);
    expect(getCarriedCard()?.phase).toBe("home");
  });

  it("plays a drop on a pane straight in, once — the card the drop filled, never the pane's own drop — and keeps nothing in the hand", async () => {
    listen();
    const { played, asked } = place({ kind: "pane", box: new DOMRect(0, 0, 600, 400) });
    const pane = document.createElement("div");
    const own = vi.fn();
    pane.addEventListener("drop", own);
    document.body.append(pane);
    const kinds = transfer({ text: "git status", kindsOnly: true });
    drag("dragenter", kinds, { x: 300, y: 200 });
    drag("dragover", kinds, { x: 300, y: 200 });
    expect(getCarriedCard()?.answer).toEqual({
      kind: "pane",
      ok: true,
      label: "Paste into vibe-field",
    });

    const dropped = transfer({ text: "git status" });
    const drop = drag("drop", dropped, { x: 300, y: 200 }, { target: pane });
    expect(drop.defaultPrevented).toBe(true);
    expect(own, "the pane's own drop would paste it a second time").not.toHaveBeenCalled();
    await settled();
    expect(asked.at(-1), "the place is asked again of what the drop held").toMatchObject({
      kind: "text",
      paste: "git status",
    });
    await vi.advanceTimersByTimeAsync(PLAY_SHRINK_MS);
    await settled();
    expect(played).toHaveLength(1);
    expect(played[0]).toMatchObject({ kind: "text", paste: "git status", origin: DRAGGED });
    expect(played[0]?.waiting, "the waiting card was played").toBeUndefined();
    expect(said).toEqual(["Pasted into vibe-field"]);
    expect(store.snapshot().cards, "played straight in, it stays nowhere").toEqual([]);
  });

  it("leaves a drop on a field no place answers for to the field (HN-L3): no label over it while carried; let go, not prevented, its card gone, nothing played, dealt or said", async () => {
    listen();
    // a deck lies under the point, but the field is on top of it: the deck answers nothing there
    const deck = document.createElement("section");
    const field = document.createElement("textarea");
    const own = vi.fn();
    field.addEventListener("drop", own);
    document.body.append(deck, field);
    const { played } = place({ kind: "pane", box: new DOMRect(0, 0, 600, 400), element: deck });
    hits(() => [field, deck, document.body]);
    const kinds = transfer({ text: "git status", kindsOnly: true });
    drag("dragenter", kinds, { x: 300, y: 200 });
    drag("dragover", kinds, { x: 300, y: 200 });
    const carried = getCarriedCard();
    expect(carried?.phase).toBe("carry");
    expect(carried?.answer, "letting go there will not put it in the hand").toBeNull();
    expect(carriedLabel(carried!, { width: 1024 }), "nothing under the pointer").toBeNull();

    const dropped = transfer({ text: "git status" });
    const drop = drag("drop", dropped, { x: 300, y: 200 }, { target: field });
    expect(drop.defaultPrevented, "the field inserts it itself").toBe(false);
    expect(own, "the field hears its own drop").toHaveBeenCalledTimes(1);
    expect(getCarriedCard()).toMatchObject({ phase: "home", home: null });
    await settled();
    await vi.advanceTimersByTimeAsync(PLAY_HOME_MS + 40);
    expect(getCarriedCard()).toBeNull();
    expect(played).toEqual([]);
    expect(store.snapshot().cards).toEqual([]);
    expect(said).toEqual([]);
  });

  it("gives a drop on a field a registered place answers for to that place — a place for cards outranks the field: Chat's prompt takes it, prevented and played once", async () => {
    listen();
    const prompt = document.createElement("div");
    const field = document.createElement("textarea");
    const own = vi.fn();
    field.addEventListener("drop", own);
    prompt.append(field);
    document.body.append(prompt);
    const { played } = place({
      kind: "prompt",
      box: new DOMRect(0, 400, 600, 200),
      element: prompt,
    });
    hits(() => [field, prompt, document.body]);
    const kinds = transfer({ text: "make test", kindsOnly: true });
    drag("dragenter", kinds, { x: 300, y: 500 });
    drag("dragover", kinds, { x: 300, y: 500 });
    expect(getCarriedCard()?.answer).toEqual({
      kind: "prompt",
      ok: true,
      label: "Paste into vibe-field",
    });

    const dropped = transfer({ text: "make test" });
    const drop = drag("drop", dropped, { x: 300, y: 500 }, { target: field });
    expect(drop.defaultPrevented).toBe(true);
    expect(own, "the field's own drop would insert it a second time").not.toHaveBeenCalled();
    await settled();
    await vi.advanceTimersByTimeAsync(PLAY_SHRINK_MS);
    await settled();
    expect(played).toHaveLength(1);
    expect(played[0]).toMatchObject({ kind: "text", paste: "make test", origin: DRAGGED });
    expect(said).toEqual(["Pasted into vibe-field"]);
    expect(store.snapshot().cards).toEqual([]);
  });

  it("settles a drop where nothing takes it straight into the hand — the desk included — from the box it hung in; the rest follow it", async () => {
    listen();
    place({ kind: "desk", box: new DOMRect(0, 0, 1024, 768) });
    const notes = new File(["one\ntwo\n"], "notes.txt", { type: "text/plain" });
    paths.set(notes, "/Users/me/Desktop/notes.txt");
    const shot = new File([PNG], "shot.png", { type: "image/png" });
    sizes.set(shot, { width: 800, height: 600 });
    paths.set(shot, "/Users/me/Desktop/shot.png");
    drag("dragenter", transfer({ files: [notes, shot], kindsOnly: true }), { x: 500, y: 300 });
    expect(getCarriedCard()?.card).toMatchObject({ kind: "file", name: "2 files", waiting: true });
    expect(getCarriedCard()?.answer).toEqual({ kind: "hand", ok: true, label: TARGET_WORDS.hand });

    drag("drop", transfer({ files: [notes, shot] }), { x: 500, y: 300 });
    await settled();
    expect(getCarriedCard(), "its carry is over: the hand deals it").toBeNull();
    const [note, picture] = store.snapshot().cards;
    expect(note).toMatchObject({
      kind: "file",
      name: "notes.txt",
      folder: "me/Desktop",
      lines: "one\ntwo",
      paste: "/Users/me/Desktop/notes.txt",
      origin: DRAGGED,
    });
    expect(picture).toMatchObject({
      kind: "pict",
      width: 800,
      height: 600,
      path: "/Users/me/Desktop/shot.png",
      paste: "/Users/me/Desktop/shot.png",
    });
    // from where the carried card hung by its top edge, the second a step to the right
    expect([...store.snapshot().arriving.values()]).toEqual([
      { left: 448, top: 288, width: 104, height: 146 },
      { left: 462, top: 288, width: 104, height: 146 },
    ]);
  });

  it("cancels a drop that held nothing a card can be — a file another app only promised — and says so on the line", async () => {
    listen();
    const pdf = new File(["%PDF"], "b.pdf", { type: "application/pdf" });
    drag("dragenter", transfer({ files: [pdf], kindsOnly: true }), { x: 300, y: 300 });
    // the drop of a file only promised (a photo out of Photos, say) brings no file with it
    const drop = drag("drop", transfer({ files: [pdf], kindsOnly: true }), { x: 300, y: 300 });
    expect(drop.defaultPrevented).toBe(true);
    await settled();
    expect(said).toEqual(["Not brought in — it held no words, picture or file"]);
    expect(said).toEqual([OUTSIDE_WORDS.nothing]);
    expect(getCarriedCard()).toMatchObject({ phase: "home", home: null });
    expect(store.snapshot().cards).toEqual([]);
  });

  it("leaves a drag that began in this page to the page — a selection, a link — until it ends", () => {
    listen();
    document.body.dispatchEvent(new Event("dragstart", { bubbles: true }));
    const words = transfer({ text: "a selection", kindsOnly: true });
    expect(drag("dragenter", words, { x: 300, y: 300 }).defaultPrevented).toBe(false);
    expect(drag("drop", words, { x: 300, y: 300 }).defaultPrevented).toBe(false);
    expect(getCarriedCard()).toBeNull();
    document.body.dispatchEvent(new Event("dragend", { bubbles: true }));
    drag("dragenter", words, { x: 300, y: 300 });
    expect(getCarriedCard()?.source).toBe("outside");
  });

  it("lets a card carried in go when the hand goes, and hears nothing after", async () => {
    listen();
    const kinds = transfer({ text: "words", kindsOnly: true });
    drag("dragenter", kinds, { x: 300, y: 300 });
    // the listener alone; the line's hearer stays
    for (const off of offs.splice(1)) off();
    expect(getCarriedCard()?.phase).toBe("home");
    await vi.advanceTimersByTimeAsync(PLAY_HOME_MS + 40);
    expect(paste(document.body, transfer({ text: "After." })).defaultPrevented).toBe(false);
    expect(drag("dragenter", kinds, { x: 300, y: 300 }).defaultPrevented).toBe(false);
    await settled();
    expect(getCarriedCard()).toBeNull();
    expect(store.snapshot().cards).toEqual([]);
  });
});

describe("the drag machine's filled card (HN-6, B2)", () => {
  it("plays the card the drop filled, the place asked again; a place that refuses what it holds says so, and it is the hand's", async () => {
    const { played, asked } = place({
      kind: "pane",
      box: new DOMRect(0, 0, 600, 400),
      answer: (card) =>
        card.kind === "pict"
          ? { ok: false, label: TARGET_WORDS.pictureNoFile }
          : { ok: true, label: "Paste into vibe-field" },
    });
    const carry = (): void =>
      startCardDrag({
        card: waitingCardOf(transfer({ text: "x", kindsOnly: true }), store),
        source: "outside",
        pointerId: null,
        at: { x: 100, y: 100 },
        grab: { x: 52, y: 12 },
        home: () => null,
      });
    const filled = textCardOf("make test", { id: "card-text-filled", origin: DRAGGED, at: 0 });

    carry();
    const going = endCardDrag(100, 100, filled);
    expect(getCarriedCard()?.card, "the drop's card takes the waiting one's place").toBe(filled);
    expect(asked.at(-1)).toBe(filled);
    await vi.advanceTimersByTimeAsync(PLAY_SHRINK_MS);
    await expect(going).resolves.toBe("played");
    expect(played).toEqual([filled]);
    expect(said).toEqual(["Pasted into vibe-field"]);
    await vi.advanceTimersByTimeAsync(PLAY_HOME_MS + 40);

    // a picture with no file let go on that pane: under the pointer the pane answered the waiting
    // card, so its refusal is said now — and the card is the hand's, its carry over
    carry();
    const loose: PictCard = {
      id: "card-pict-loose",
      kind: "pict",
      origin: DRAGGED,
      at: 0,
      title: "image.png",
      width: 10,
      height: 10,
      src: "",
      paste: "",
    };
    await expect(endCardDrag(100, 100, loose)).resolves.toBe("hand");
    expect(said.at(-1)).toBe("A picture with no file can't be pasted yet");
    expect(getCarriedCard()).toBeNull();
    expect(played).toHaveLength(1);

    // a card from the hand let go where nothing takes it still flies home, as it always has
    startCardDrag({
      card: filled,
      source: "hand",
      pointerId: 7,
      at: { x: 900, y: 600 },
      grab: { x: 52, y: 20 },
      home: () => null,
    });
    await expect(endCardDrag(900, 600)).resolves.toBe("home");
    await expect(endCardDrag(900, 600), "nothing is carried now").resolves.toBe("none");
  });
});
