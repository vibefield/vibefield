// @vitest-environment happy-dom
/**
 * HN-5 — THE COPY DOOR (frame/cards/copy-door.ts; DESIGN.md §8 "The hand", where cards come
 * from, and §8 "Copy"): every copy puts what it copied on the system clipboard FIRST — words
 * through the host's copy door, a picture through the clipboard's picture door — and deals its
 * card only once the write was taken; both bounds are checked before either door; a refusal
 * deals nothing and comes back in Copy's voice — a door's typed refusal in its terms, anything
 * else in the door's one sentence, never a bridge's error, which only the log keeps; with no
 * host (the browser catalog) the web's own write stands; and the write alone, a program's,
 * deals nothing at all.
 */
import { IPC_CHANNELS, SHELL_CLIPBOARD } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardOrigin, PictCard } from "../src/frame/cards/cards-model";
import { CardStore, cardsStore, type DealFrom } from "../src/frame/cards/cards-store";
import { COPY_DOOR_WORDS } from "../src/frame/cards/cards-words";
import {
  type CopyHost,
  copyNamedWords,
  copyToHand,
  copyWords,
  dealFromElement,
  writeClipboard,
} from "../src/frame/cards/copy-door";
import { type FieldHost, setHost } from "../src/host";
import { type RendererLogger, setRendererLogger } from "../src/logging";

const ORIGIN: CardOrigin = { view: "godview", place: "Settings", how: "copy" };
const FROM: DealFrom = { left: 600, top: 320, width: 64, height: 24 };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Electron's own words for a handler that threw, as the page receives them (invoke rewraps). */
const REMOTE = `Error invoking remote method '${IPC_CHANNELS.clipboardWriteImage}': Error: refused`;

/** The renderer's log, as the cards' lines reach it. */
function hearLog(): Array<{ event: string; attrs: unknown }> {
  const heard: Array<{ event: string; attrs: unknown }> = [];
  const logger = {
    child: () => logger,
    warn: (event: string, _message: string, attrs?: unknown) => heard.push({ event, attrs }),
  } as unknown as RendererLogger;
  setRendererLogger(logger);
  return heard;
}

/** The two doors, each recording what it was given and answering as told. */
function doors(over: { words?: () => Promise<void>; picture?: () => Promise<void> } = {}) {
  const copied: string[] = [];
  const pictures: Array<{ png: Uint8Array; text: string | undefined }> = [];
  const host: CopyHost = {
    diagnostics: {
      copyText: async (text: string) => {
        copied.push(text);
        await over.words?.();
      },
    },
    clipboard: {
      writeImage: async (png: Uint8Array, text?: string) => {
        pictures.push({ png, text });
        await over.picture?.();
      },
    },
  };
  return { host, copied, pictures };
}

function pictCard(store: CardStore): PictCard {
  return {
    id: store.nextId("pict"),
    kind: "pict",
    origin: { view: "canvas", how: "copy" },
    at: store.now(),
    title: "Clock",
    width: 376,
    height: 276,
    src: "blob:clock",
    bytes: new Blob([PNG], { type: "image/png" }),
    paste: "",
  };
}

/** The page's own clipboard (no host), recording its writes. */
function webClipboard(takes = true) {
  const writeText = vi.fn(async (_text: string) => {
    if (!takes) throw new Error("NotAllowedError");
  });
  const write = vi.fn(async (_items: unknown[]) => {
    if (!takes) throw new Error("NotAllowedError");
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText, write },
  });
  // a picture is handed over as a ClipboardItem: the page's own, stood in for here
  vi.stubGlobal(
    "ClipboardItem",
    class {
      readonly items: unknown;
      constructor(items: unknown) {
        this.items = items;
      }
    },
  );
  return { writeText, write };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the copy door (HN-5)", () => {
  it("writes the words first, then deals them as a text card from their box", async () => {
    let take: () => void = () => undefined;
    const taken = new Promise<void>((resolve) => {
      take = resolve;
    });
    const { host, copied } = doors({ words: () => taken });
    const store = new CardStore(() => 7_000);
    const copy = copyWords("Ship it. Then the covers.", ORIGIN, FROM, { host, store });
    await Promise.resolve();
    // asked, not yet taken: nothing is dealt
    expect(copied).toEqual(["Ship it. Then the covers."]);
    expect(store.snapshot().cards).toEqual([]);
    take();
    await expect(copy).resolves.toEqual({ ok: true });
    const [card] = store.snapshot().cards;
    expect(card).toMatchObject({
      kind: "text",
      title: "Ship it.",
      body: "Then the covers.",
      paste: "Ship it. Then the covers.",
      origin: ORIGIN,
      at: 7_000,
    });
    expect(store.snapshot().arriving.get(card?.id ?? "")).toEqual(FROM);
  });

  it("writes a picture through the picture door, then deals its card", async () => {
    const { host, copied, pictures } = doors();
    const store = new CardStore(() => 7_000);
    const card = pictCard(store);
    await expect(copyToHand({ card, from: FROM, png: PNG }, { host, store })).resolves.toEqual({
      ok: true,
    });
    expect(pictures).toEqual([{ png: PNG, text: undefined }]);
    expect(copied).toEqual([]);
    expect(store.snapshot().cards).toEqual([card]);
    expect(store.snapshot().arriving.get(card.id)).toEqual(FROM);
  });

  it("writes a picture's words beside it in the picture door's one write (LC-19)", async () => {
    const { host, copied, pictures } = doors();
    const store = new CardStore(() => 7_000);
    const card = pictCard(store);
    const copy = { card, from: FROM, png: PNG, text: "Ship the desk by Friday." };
    await expect(copyToHand(copy, { host, store })).resolves.toEqual({ ok: true });
    expect(pictures).toEqual([{ png: PNG, text: "Ship the desk by Friday." }]);
    expect(copied).toEqual([]);
    expect(store.snapshot().cards).toEqual([card]);
  });

  it("checks both bounds itself, before either door, its sizes as §9 counts them", async () => {
    const store = new CardStore(() => 7_000);
    const { host, copied, pictures } = doors();
    const web = webClipboard();
    const words = "x".repeat(80_000);
    expect(await copyWords(words, ORIGIN, FROM, { host, store })).toEqual({
      ok: false,
      reason: "the words hold 80 KB; the clipboard takes at most 65 KB",
      error: "too-large: words 80000 bytes, past 65536",
    });
    // one byte past: the size rounded up and the bound down, so the two never read as equal
    const justPast = "x".repeat(SHELL_CLIPBOARD.WRITE_TEXT_MAX_BYTES + 1);
    expect(await writeClipboard({ text: justPast }, { host })).toMatchObject({
      reason: "the words hold 66 KB; the clipboard takes at most 65 KB",
    });
    const picture = new Uint8Array(SHELL_CLIPBOARD.WRITE_IMAGE_MAX_BYTES + 1);
    expect(await writeClipboard({ png: picture }, { host })).toEqual({
      ok: false,
      reason: "the picture holds 67.2 MB; the clipboard takes at most 67.1 MB",
      error: "too-large: picture 67108865 bytes, past 67108864",
    });
    // the words beside a picture are bounded alike, and the web's own write is no way round
    expect(await writeClipboard({ png: PNG, text: words }, { host })).toMatchObject({
      reason: "the words hold 80 KB; the clipboard takes at most 65 KB",
    });
    expect(await writeClipboard({ text: words }, { host: null })).toMatchObject({ ok: false });
    // nothing past a bound is asked of a door, nor dealt
    expect(copied).toEqual([]);
    expect(pictures).toEqual([]);
    expect(web.writeText).not.toHaveBeenCalled();
    expect(store.snapshot().cards).toEqual([]);
    expect(COPY_DOOR_WORDS.refused(COPY_DOOR_WORDS.tooLarge("words", 80_000, 65_536))).toBe(
      "Not copied — the words hold 80 KB; the clipboard takes at most 65 KB",
    );
  });

  it("says a door's typed refusal in its terms, and deals nothing", async () => {
    const store = new CardStore(() => 7_000);
    const sent = { reason: "too-large", what: "words-as-sent", bytes: 80_000, max: 65_465 };
    const port = doors({ words: () => Promise.reject(sent) });
    const breaks = await copyWords("\n".repeat(40_000), ORIGIN, FROM, { host: port.host, store });
    expect(breaks).toEqual({
      ok: false,
      reason: "the words hold 80 KB as sent; a copy sends at most 65 KB",
      error: "too-large: words-as-sent 80000 bytes, past 65465",
    });
    const unread = doors({ picture: () => Promise.reject({ reason: "not-an-image" }) });
    const picture = { card: pictCard(store), from: FROM, png: PNG };
    expect(await copyToHand(picture, { host: unread.host, store })).toEqual({
      ok: false,
      reason: "the picture could not be read",
      error: "not-an-image",
    });
    expect(store.snapshot().cards).toEqual([]);
  });

  it("says anything else in the door's one sentence, never a bridge's, and logs it", async () => {
    const heard = hearLog();
    const store = new CardStore(() => 7_000);
    const timedOut = doors({ words: () => Promise.reject(new Error("request timed out")) });
    expect(await copyWords("words", ORIGIN, FROM, { host: timedOut.host, store })).toEqual({
      ok: false,
      reason: COPY_DOOR_WORDS.words,
      error: "request timed out",
    });
    // Electron's rewrap, a malformed answer, the preload's own assertion: none is said
    const remote = doors({ picture: () => Promise.reject(new Error(REMOTE)) });
    const picture = { card: pictCard(store), from: FROM, png: PNG };
    expect(await copyToHand(picture, { host: remote.host, store })).toEqual({
      ok: false,
      reason: COPY_DOOR_WORDS.picture,
      error: REMOTE,
    });
    expect(store.snapshot().cards).toEqual([]);
    expect(heard).toEqual([
      {
        event: "renderer.cards.copy_refused",
        attrs: { kind: "text", reason: COPY_DOOR_WORDS.words, error: "request timed out" },
      },
      {
        event: "renderer.cards.copy_refused",
        attrs: { kind: "pict", reason: COPY_DOOR_WORDS.picture, error: REMOTE },
      },
    ]);
    expect(COPY_DOOR_WORDS.refused(COPY_DOOR_WORDS.words)).toBe(
      "Not copied — the clipboard did not take the words",
    );
  });

  it("names a record's words by its own name, never by their first character", async () => {
    const { host, copied } = doors();
    const store = new CardStore(() => 7_000);
    const record = JSON.stringify({ event: "desktop.viewer.local", msg: "record 1" }, null, 2);
    const name = { title: "desktop.viewer.local", body: "record 1" };
    await expect(copyNamedWords(record, name, ORIGIN, FROM, { host, store })).resolves.toEqual({
      ok: true,
    });
    expect(copied).toEqual([record]);
    const [card] = store.snapshot().cards;
    expect(card).toMatchObject({ kind: "text", ...name, bare: true, paste: record });
    expect(store.snapshot().arriving.get(card?.id ?? "")).toEqual(FROM);
  });

  it("with no host, the web's own write stands — and its refusal deals nothing", async () => {
    const store = new CardStore(() => 7_000);
    const web = webClipboard();
    await expect(copyWords("hello", ORIGIN, null, { host: null, store })).resolves.toEqual({
      ok: true,
    });
    expect(web.writeText).toHaveBeenCalledWith("hello");
    const card = pictCard(store);
    await expect(
      copyToHand({ card, from: null, png: PNG, text: "two objects" }, { host: null, store }),
    ).resolves.toEqual({ ok: true });
    expect(web.write).toHaveBeenCalledOnce();
    // one item of both formats, as main's one write is
    expect(web.write.mock.calls[0]?.[0]).toEqual([
      { items: { "image/png": expect.any(Blob), "text/plain": "two objects" } },
    ]);
    expect(store.snapshot().cards.map((c) => c.kind)).toEqual(["text", "pict"]);
    // no box to leave from: it rises into its place
    expect(store.snapshot().arriving.get(card.id)).toBeNull();
    webClipboard(false);
    await expect(copyWords("again", ORIGIN, null, { host: null, store })).resolves.toEqual({
      ok: false,
      reason: COPY_DOOR_WORDS.words,
      error: "NotAllowedError",
    });
    expect(store.snapshot().cards).toHaveLength(2);
  });

  it("reaches the window's host when given none, never the page's own clipboard", async () => {
    const copyText = vi.fn(async (_text: string) => undefined);
    setHost({ logger: {}, diagnostics: { copyText } } as unknown as FieldHost);
    const web = webClipboard();
    const store = new CardStore(() => 7_000);
    await expect(copyWords("from Settings", ORIGIN, FROM, { store })).resolves.toEqual({
      ok: true,
    });
    expect(copyText).toHaveBeenCalledWith("from Settings");
    expect(web.writeText).not.toHaveBeenCalled();
  });

  it("the write alone — a program's — reaches the clipboard and deals nothing", async () => {
    const { host, copied } = doors();
    const before = cardsStore.snapshot().cards.length;
    await expect(writeClipboard({ text: "hn5-osc52" }, { host })).resolves.toEqual({ ok: true });
    expect(copied).toEqual(["hn5-osc52"]);
    expect(cardsStore.snapshot().cards).toHaveLength(before);
  });

  it("deals from a pressed control's own box, or from nowhere without one", () => {
    const button = document.createElement("button");
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      width: 30,
      height: 40,
    } as DOMRect);
    expect(dealFromElement(button)).toEqual({ left: 10, top: 20, width: 30, height: 40 });
    expect(dealFromElement(null)).toBeNull();
    expect(dealFromElement(undefined)).toBeNull();
  });
});
