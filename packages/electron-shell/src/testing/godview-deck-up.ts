import type { BrowserWindow } from "electron";

// THE LABS CALL THE TERMINALS UP (W7; N14 (a), ruled 2026-10-12): Godview opens
// with its terminals away, and the first call brings them up. Under the Godview
// markers only, Godview lends a lab `window.__vfGodviewDeck.up` (the History
// lead's seam: idempotent, safe while the deck is already up, never read by the
// product), so a lab that measures the deck asks for it as a person's first call
// would. Before W7 nothing lends it and the deck is up already: the ask finds no
// seam and does nothing.
//
// The seam appears only once Godview has mounted, after the view was asked for,
// so the ask waits for it in the page: every 100 ms, it calls `up()` once when
// the seam is there, and stops when it has called, when a pane is drawn (the
// deck is up), or after 30 s. It never blocks the lab, whose own wait for the
// deck (`GODVIEW_DECK`) still decides whether the deck is ready. What happened is
// kept on the page (`window.__vfLabDeckAsk`), so a wait that fails after `up()`
// threw says so, and a W7 bug reads as itself rather than as a bare timeout.

/** Poll cadence and bound of the in-page ask. */
export const DECK_UP_POLL_MS = 100;
export const DECK_UP_GIVE_UP_MS = 30_000;

/** What the in-page ask did: still looking for the seam, called it, saw it
 * throw (and stopped), found a pane already drawn, or gave up at its bound. */
export interface DeckAsk {
  state: "waiting" | "asked" | "threw" | "pane" | "gave-up";
  error?: string;
}

/** The in-page ask, as `executeJavaScript` runs it: it returns at once. */
export const ASK_GODVIEW_DECK_UP = `(() => {
  const ask = { state: "waiting" };
  window.__vfLabDeckAsk = ask;
  const started = performance.now();
  const tick = () => {
    const door = window.__vfGodviewDeck;
    if (door && typeof door.up === "function") {
      try {
        door.up();
        ask.state = "asked";
      } catch (error) {
        ask.state = "threw";
        ask.error = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    if (document.querySelector(".ghostty-pane") !== null) {
      ask.state = "pane";
      return;
    }
    if (performance.now() - started < ${DECK_UP_GIVE_UP_MS}) setTimeout(tick, ${DECK_UP_POLL_MS});
    else ask.state = "gave-up";
  };
  tick();
  return true;
})()`;

/** Reads what the ask did, as JSON (null: never asked, or not readable). */
export const READ_GODVIEW_DECK_ASK = `JSON.stringify(window.__vfLabDeckAsk ?? null)`;

/** Ask Godview for its terminals, once it lends the door; never waits for them. */
export async function askGodviewDeckUp(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(ASK_GODVIEW_DECK_UP);
}

/** What the ask did, or null; never throws (a page that is gone reads null). */
export async function readGodviewDeckAsk(win: BrowserWindow): Promise<DeckAsk | null> {
  try {
    const read = await win.webContents.executeJavaScript(READ_GODVIEW_DECK_ASK);
    if (typeof read !== "string") return null;
    const ask = JSON.parse(read) as DeckAsk | null;
    return ask !== null && typeof ask === "object" && typeof ask.state === "string" ? ask : null;
  } catch {
    return null;
  }
}

/** The words a failed deck wait adds for the ask: only a throw is news. */
export function deckAskWords(ask: DeckAsk | null): string | null {
  return ask?.state === "threw" ? `the deck's up() threw: ${ask.error ?? "(no message)"}` : null;
}

/** A deck wait that fails says what the ask did, when that is news; its own
 * words first, unchanged, and the wait's error as the cause. */
export async function sayingDeckAsk<T>(win: BrowserWindow, wait: Promise<T>): Promise<T> {
  try {
    return await wait;
  } catch (error) {
    const words = deckAskWords(await readGodviewDeckAsk(win));
    if (words === null) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}; ${words}`, { cause: error });
  }
}
