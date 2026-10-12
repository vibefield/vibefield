import type { BrowserWindow } from "electron";

// THE TERMINALS AWAY, AND CALLED UP — the rung in `pnpm smoke:godview`
// (Godview round 3 — GV-D5, GV-D6; DESIGN.md §8 "Minimized", "Called up",
// "One resize per change"; §6 "The terminals rise and fall"):
//
//   · the Lip's minimize, pressed: the deck says away, its panes take no
//     demand (the marker's `active` false), the sheet is inert and unseen
//     below the foot, no pane holds the keyboard, and the monitor alone has
//     the window down to the covers' reserve (692 in the drawing's window);
//   · a body of the swarm — the one the active pane shows — brings them back:
//     the same sessions in the panes, the edge where it was left, and the box
//     the terminals fill laid out at most once per change (the marker's
//     `wrapper.bodyResizes`, which only grows).
//
// It changes shared state — the terminals' state, kept for the run — so it
// runs after every other deck rung, and it leaves the deck up at its old top;
// a failure part-way still calls the terminals up before it says so.
//
// Test-only by construction: this module rides the smoke bundle
// (dist/testing/smoke.cjs), which packaging omits.

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The deck's marker, as far as this rung reads it. */
export interface AwayDeckFacts {
  active: boolean;
  panes: number;
  sessionIds: readonly string[];
  wrapper?: { state: "away" | "up" | "maximized"; top: number; bodyResizes: number };
}

interface AwayDeckWatch {
  until(
    predicate: (facts: AwayDeckFacts) => boolean,
    what: string,
    timeoutMs: number,
  ): Promise<AwayDeckFacts>;
}

export interface DeckAwayRungOptions {
  deck: AwayDeckWatch;
  /** The deck once it has published nothing new for a while (`deckSettled`). */
  settled: () => Promise<AwayDeckFacts>;
  /** ⌘2, the road a person takes (the smoke's `pressViewKey`). */
  pressViewKey: (view: "godview") => void;
}

/** The covers' reserve above the window's foot (FC-D15): where the monitor
 * alone ends. */
const COVER_RESERVE = 88;

/** The body of the session the active pane shows: the swarm's list button the
 * package marks current (its reachability rule — each body has one). */
const ACTIVE_BODY = '.vf-monitor-swarm-list button[aria-current="true"]';

/** The stage as the page lays it out now. */
const STAGE_NOW = `(() => {
  const stage = document.querySelector(".vf-cover .vf-godview");
  const sheet = stage?.querySelector(".vf-godview-terminal-deck");
  const monitor = stage?.querySelector(".vf-godview-monitor-stage");
  if (!stage || !sheet || !monitor) return JSON.stringify({ absent: true });
  return JSON.stringify({
    state: stage.getAttribute("data-godview-deck"),
    travel: stage.getAttribute("data-godview-deck-motion"),
    inert: sheet.hasAttribute("inert"),
    visibility: getComputedStyle(sheet).visibility,
    sheetTop: Math.round(sheet.getBoundingClientRect().top),
    focusInDeck: sheet.contains(document.activeElement),
    monitorFoot: Math.round(monitor.getBoundingClientRect().bottom),
    windowFoot: window.innerHeight,
    minimize: Boolean(sheet.querySelector('button[aria-label="Minimize the terminals"]')),
  });
})()`;

interface StageNow {
  absent?: true;
  state: string | null;
  travel: string | null;
  inert: boolean;
  visibility: string;
  sheetTop: number;
  focusInDeck: boolean;
  monitorFoot: number;
  windowFoot: number;
  minimize: boolean;
}

async function stageNow(win: BrowserWindow): Promise<StageNow> {
  return JSON.parse((await win.webContents.executeJavaScript(STAGE_NOW)) as string) as StageNow;
}

/** The page once no travel is under way — the fall's 300ms, the rise's 480ms,
 * each with its two frames of grace. */
async function stageAtRest(win: BrowserWindow, what: string): Promise<StageNow> {
  const deadline = Date.now() + 5_000;
  let seen: StageNow | null = null;
  while (Date.now() < deadline) {
    seen = await stageNow(win);
    if (seen.absent !== true && seen.travel === null) return seen;
    await sleep(100);
  }
  throw new Error(`${what}: the sheet was still travelling after 5s (${JSON.stringify(seen)})`);
}

async function click(win: BrowserWindow, selector: string, what: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  let seen = "";
  while (Date.now() < deadline) {
    const clicked = (await win.webContents.executeJavaScript(
      `(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        if (!target) return "absent";
        const label = target.getAttribute("aria-label") ?? "";
        target.click();
        return "ok:" + label;
      })()`,
    )) as string;
    if (clicked.startsWith("ok:")) return clicked.slice(3);
    seen = clicked;
    await sleep(200);
  }
  throw new Error(`${what}: nothing matched ${selector} within 20s (${seen})`);
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

/** The rung. */
export async function deckAwayRung(
  win: BrowserWindow,
  opts: DeckAwayRungOptions,
): Promise<Record<string, unknown>> {
  const verdict: Record<string, unknown> = {};
  try {
    return await deckAwaySteps(win, opts, verdict);
  } catch (error) {
    // Leave the deck up for whatever runs next, then say what failed, with
    // what the rung had read until then.
    const now = await stageNow(win).catch(() => null);
    if (now?.state === "away") {
      await click(win, ACTIVE_BODY, "calling the terminals back after a failure").catch(
        () => undefined,
      );
    }
    const said = error instanceof Error ? error.message : String(error);
    throw new Error(`${said} [read: ${JSON.stringify(verdict)}; now: ${JSON.stringify(now)}]`);
  }
}

async function deckAwaySteps(
  win: BrowserWindow,
  opts: DeckAwayRungOptions,
  verdict: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  opts.pressViewKey("godview");
  await opts.deck.until(
    (facts) => facts.active && facts.panes >= 1 && facts.wrapper?.state === "up",
    "Godview showing its terminals up (a bundle without `wrapper` predates round 3)",
    30_000,
  );
  const before = await opts.settled();
  const beforeWrapper = before.wrapper;
  if (beforeWrapper === undefined) throw new Error("the deck's marker carries no wrapper facts");
  const up = await stageAtRest(win, "the terminals up");
  if (!up.minimize) throw new Error("the Lip draws no minimize button");
  verdict["before"] = {
    panes: before.panes,
    top: beforeWrapper.top,
    bodyResizes: beforeWrapper.bodyResizes,
  };

  // MINIMIZE — the Lip's button, by its accessible name
  await click(win, 'button[aria-label="Minimize the terminals"]', "the Lip's minimize");
  await opts.deck.until(
    (facts) => !facts.active && facts.wrapper?.state === "away",
    "minimize to put the terminals away (the marker: away, and no demand)",
    10_000,
  );
  const away = await stageAtRest(win, "the fall");
  const problems: string[] = [];
  if (away.state !== "away") problems.push(`the stage says ${String(away.state)}`);
  if (!away.inert) problems.push("the sheet is not inert");
  if (away.visibility !== "hidden") problems.push(`the sheet is ${away.visibility}`);
  if (away.focusInDeck) problems.push("a pane still holds the keyboard");
  if (away.sheetTop < away.windowFoot) {
    problems.push(
      `the sheet's top stands at ${away.sheetTop}, above the foot (${away.windowFoot})`,
    );
  }
  if (Math.abs(away.monitorFoot - (away.windowFoot - COVER_RESERVE)) > 1) {
    problems.push(
      `the monitor alone ends at ${away.monitorFoot}, not at the reserve (${away.windowFoot - COVER_RESERVE})`,
    );
  }
  if (problems.length > 0) {
    throw new Error(`away is not fully away: ${problems.join("; ")} [${JSON.stringify(away)}]`);
  }
  const awaySettled = await opts.settled();
  const awayResizes = (awaySettled.wrapper?.bodyResizes ?? 0) - beforeWrapper.bodyResizes;
  verdict["away"] = {
    monitorFoot: away.monitorFoot,
    windowFoot: away.windowFoot,
    bodyResizes: awayResizes,
  };
  if (awayResizes > 1) {
    throw new Error(
      `minimizing laid the terminals out ${awayResizes} times — one change is one resize at most (§8)`,
    );
  }
  if (sorted(awaySettled.sessionIds).join() !== sorted(before.sessionIds).join()) {
    throw new Error(
      `minimizing changed what the panes hold: ${JSON.stringify(before.sessionIds)} → ${JSON.stringify(awaySettled.sessionIds)} — every session keeps running in its pane`,
    );
  }

  // CALLED UP — a body: the one the active pane shows
  verdict["called"] = await click(win, ACTIVE_BODY, "a body of the swarm");
  await opts.deck.until(
    (facts) => facts.active && facts.wrapper?.state === "up",
    "a body to bring the terminals back",
    10_000,
  );
  const back = await stageAtRest(win, "the rise");
  if (back.inert || back.visibility !== "visible") {
    throw new Error(`the terminals came back unusable: ${JSON.stringify(back)}`);
  }
  const after = await opts.settled();
  const afterWrapper = after.wrapper;
  if (afterWrapper === undefined) throw new Error("the deck's marker lost its wrapper facts");
  const resizes = afterWrapper.bodyResizes - beforeWrapper.bodyResizes;
  verdict["after"] = { panes: after.panes, top: afterWrapper.top, bodyResizes: resizes };
  if (sorted(after.sessionIds).join() !== sorted(before.sessionIds).join()) {
    throw new Error(
      `the terminals came back holding other sessions: ${JSON.stringify(before.sessionIds)} → ${JSON.stringify(after.sessionIds)} — as they were left, the same panes`,
    );
  }
  if (afterWrapper.top !== beforeWrapper.top) {
    throw new Error(
      `the terminals came back with their top at ${afterWrapper.top}, not where it was left (${beforeWrapper.top})`,
    );
  }
  if (resizes > 2) {
    throw new Error(
      `away and back laid the terminals out ${resizes} times — one change is one resize at most (§8)`,
    );
  }
  verdict["roundTripped"] = true;
  return verdict;
}
