/**
 * W7 (N14 (a)) — the labs call the terminals up: the in-page ask calls the
 * seam Godview lends under its markers exactly once when it appears, does
 * nothing on a tree that lends none, never outlasts a drawn pane or its bound,
 * and keeps what it did on the page — so a deck wait that fails after `up()`
 * threw says the throw. Run against a fake page: the expression's globals are
 * handed in.
 */
import type { BrowserWindow } from "electron";
import { describe, expect, it } from "vitest";
import {
  ASK_GODVIEW_DECK_UP,
  DECK_UP_GIVE_UP_MS,
  DECK_UP_POLL_MS,
  type DeckAsk,
  deckAskWords,
  READ_GODVIEW_DECK_ASK,
  readGodviewDeckAsk,
  sayingDeckAsk,
} from "../src/testing/godview-deck-up";

interface FakePage {
  window: { __vfGodviewDeck?: { up: () => void }; __vfLabDeckAsk?: DeckAsk };
  pane: boolean;
  now: number;
  timers: (() => void)[];
  ups: number;
}

function fakePage(): FakePage {
  return { window: {}, pane: false, now: 0, timers: [], ups: 0 };
}

/** Run the ask in the fake page; returns what the expression returned. */
function ask(page: FakePage): unknown {
  const run = new Function(
    "window",
    "document",
    "performance",
    "setTimeout",
    `return ${ASK_GODVIEW_DECK_UP};`,
  );
  return run(
    page.window,
    {
      querySelector: (selector: string) => (selector === ".ghostty-pane" && page.pane ? {} : null),
    },
    { now: () => page.now },
    (fn: () => void, ms: number) => {
      expect(ms).toBe(DECK_UP_POLL_MS);
      page.timers.push(fn);
    },
  );
}

/** Let one poll pass: the clock moves one step and the queued tick runs. */
function step(page: FakePage): boolean {
  const next = page.timers.shift();
  if (next === undefined) return false;
  page.now += DECK_UP_POLL_MS;
  next();
  return true;
}

const lend = (page: FakePage): void => {
  page.window.__vfGodviewDeck = { up: () => (page.ups += 1) };
};

/** A window whose page answers `READ_GODVIEW_DECK_ASK` with `read` (or throws). */
function windowReading(read: unknown | Error): BrowserWindow {
  return {
    webContents: {
      executeJavaScript: async (script: string) => {
        expect(script).toBe(READ_GODVIEW_DECK_ASK);
        if (read instanceof Error) throw read;
        return read;
      },
    },
  } as unknown as BrowserWindow;
}

describe("the labs' ask for the terminals (W7)", () => {
  it("returns at once and calls the seam once, when it appears after the view opened", () => {
    const page = fakePage();
    expect(ask(page)).toBe(true);
    expect(page.window.__vfLabDeckAsk).toEqual({ state: "waiting" });
    expect(page.ups).toBe(0);
    step(page);
    step(page);
    lend(page);
    step(page);
    expect(page.ups).toBe(1);
    expect(page.window.__vfLabDeckAsk).toEqual({ state: "asked" });
    // called: no tick is left to call it again
    expect(step(page)).toBe(false);
    expect(page.ups).toBe(1);
  });

  it("calls a seam that is already there at once", () => {
    const page = fakePage();
    lend(page);
    ask(page);
    expect(page.ups).toBe(1);
    expect(page.timers).toHaveLength(0);
  });

  it("stops at a throw from the seam and keeps its message", () => {
    const page = fakePage();
    page.window.__vfGodviewDeck = {
      up: () => {
        page.ups += 1;
        throw new Error("the deck's door is not open");
      },
    };
    expect(() => ask(page)).not.toThrow();
    expect(page.ups).toBe(1);
    expect(page.timers).toHaveLength(0);
    expect(page.window.__vfLabDeckAsk).toEqual({
      state: "threw",
      error: "the deck's door is not open",
    });
  });

  it("asks nothing on a tree that lends no seam: a drawn pane ends it", () => {
    const page = fakePage();
    ask(page);
    step(page);
    page.pane = true;
    step(page);
    expect(page.timers).toHaveLength(0);
    expect(page.ups).toBe(0);
    expect(page.window.__vfLabDeckAsk).toEqual({ state: "pane" });
  });

  it("gives up at its bound when neither the seam nor a pane comes", () => {
    const page = fakePage();
    ask(page);
    let polls = 0;
    while (step(page)) polls += 1;
    expect(page.ups).toBe(0);
    expect(polls).toBe(DECK_UP_GIVE_UP_MS / DECK_UP_POLL_MS);
    expect(page.window.__vfLabDeckAsk).toEqual({ state: "gave-up" });
  });
});

describe("what a failed deck wait says of the ask", () => {
  it("adds words only for a throw", () => {
    expect(deckAskWords({ state: "threw", error: "boom" })).toBe("the deck's up() threw: boom");
    expect(deckAskWords({ state: "threw" })).toBe("the deck's up() threw: (no message)");
    for (const state of ["waiting", "asked", "pane", "gave-up"] as const) {
      expect(deckAskWords({ state })).toBeNull();
    }
    expect(deckAskWords(null)).toBeNull();
  });

  it("reads the page's record, and null for nothing, a stranger or a page that is gone", async () => {
    expect(await readGodviewDeckAsk(windowReading('{"state":"asked"}'))).toEqual({
      state: "asked",
    });
    expect(await readGodviewDeckAsk(windowReading("null"))).toBeNull();
    expect(await readGodviewDeckAsk(windowReading(true))).toBeNull();
    expect(await readGodviewDeckAsk(windowReading('{"nope":1}'))).toBeNull();
    expect(await readGodviewDeckAsk(windowReading(new Error("destroyed")))).toBeNull();
  });

  it("keeps the wait's own words first and its error as the cause", async () => {
    const timedOut = new Error("timed out after 60000ms waiting for the terminal deck");
    const threw = windowReading('{"state":"threw","error":"boom"}');
    const said = await sayingDeckAsk(threw, Promise.reject(timedOut)).catch(
      (error: Error) => error,
    );
    expect((said as Error).message).toBe(
      "timed out after 60000ms waiting for the terminal deck; the deck's up() threw: boom",
    );
    expect((said as Error).cause).toBe(timedOut);
    // no throw to tell: the wait's own error, the same object
    const asked = windowReading('{"state":"asked"}');
    await expect(sayingDeckAsk(asked, Promise.reject(timedOut))).rejects.toBe(timedOut);
    // a wait that ends well is the wait's value, and the page is not read
    const unread = {
      webContents: { executeJavaScript: async () => expect.unreachable("read") },
    } as unknown as BrowserWindow;
    expect(await sayingDeckAsk(unread, Promise.resolve(7))).toBe(7);
  });
});
