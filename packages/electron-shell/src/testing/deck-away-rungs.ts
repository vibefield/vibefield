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

// THE EDGE'S OUTCOMES — the rung after it (round 3, W4; DESIGN.md §8 "A drag
// has three outcomes", "Two readouts", "The monitor makes room"), driven with
// the smoke's own input (`sendInputEvent`: trusted moves, read at the window):
//
//   · held down 60 and let go slowly, the edge STAYS there and is remembered,
//     and the monitor's field ends 12 above it;
//   · held down past the line — less than 120 left — the stage says Minimize
//     the terminals, and let go there they go AWAY, the remembered edge kept;
//   · a body brings them back up at that remembered edge;
//   · a double-click puts the edge back at rest and forgets it.
//
// It starts from rest (a fresh profile's) and leaves the edge there.

/** The lip where a person takes it — its middle, left of the grip and clear
 * of the buttons — and the edge as the page holds it. */
const LIP_NOW = `(() => {
  const stage = document.querySelector(".vf-cover .vf-godview");
  const lip = stage?.querySelector('.vf-godview-deck-lip[role="separator"]');
  if (!stage || !lip) return JSON.stringify({ absent: true });
  const box = lip.getBoundingClientRect();
  const sheet = stage.querySelector(".vf-godview-terminal-deck");
  const monitor = stage.querySelector(".vf-godview-monitor-stage");
  return JSON.stringify({
    x: Math.round(box.left + box.width / 2 - 160),
    y: Math.round(box.top + box.height / 2),
    shift: stage.style.getPropertyValue("--vf-godview-deck-shift"),
    field: stage.style.getPropertyValue("--vf-godview-field-shift"),
    remembered: localStorage.getItem("vf-godview-deck-edge-v1"),
    readout: stage.querySelector(".vf-godview-deck-readout")?.getAttribute("data-on") ?? null,
    sheetTop: sheet ? sheet.offsetTop : null,
    monitorFoot: monitor ? Math.round(monitor.getBoundingClientRect().bottom) : null,
    windowFoot: window.innerHeight,
  });
})()`;

interface LipNow {
  absent?: true;
  x: number;
  y: number;
  shift: string;
  field: string;
  remembered: string | null;
  readout: string | null;
  sheetTop: number | null;
  monitorFoot: number | null;
  windowFoot: number;
}

async function lipNow(win: BrowserWindow): Promise<LipNow> {
  const now = JSON.parse((await win.webContents.executeJavaScript(LIP_NOW)) as string) as LipNow;
  if (now.absent === true) throw new Error("the deck draws no edge to hold");
  return now;
}

/** Press the lip, move it to `toY` in `steps` moves `every` ms apart (slowly:
 * no fling), let `held` look while it is still held, then let go there. */
async function holdLip(
  win: BrowserWindow,
  from: { x: number; y: number },
  toY: number,
  steps: number,
  every: number,
  held?: () => Promise<void>,
): Promise<void> {
  const input = win.webContents;
  input.sendInputEvent({ type: "mouseMove", x: from.x, y: from.y });
  await sleep(60);
  input.sendInputEvent({ type: "mouseDown", x: from.x, y: from.y, button: "left", clickCount: 1 });
  await sleep(every);
  for (let step = 1; step <= steps; step += 1) {
    input.sendInputEvent({
      type: "mouseMove",
      x: from.x,
      y: Math.round(from.y + ((toY - from.y) * step) / steps),
      button: "left",
      modifiers: ["leftbuttondown"],
    });
    await sleep(every);
  }
  if (held !== undefined) await held();
  await sleep(every);
  input.sendInputEvent({ type: "mouseUp", x: from.x, y: toY, button: "left", clickCount: 1 });
  await sleep(120);
}

/** The rung. */
export async function deckEdgeRung(
  win: BrowserWindow,
  opts: DeckAwayRungOptions,
): Promise<Record<string, unknown>> {
  const verdict: Record<string, unknown> = {};
  try {
    return await deckEdgeSteps(win, opts, verdict);
  } catch (error) {
    // Leave the terminals up and the edge at rest for whatever runs next.
    const now = await stageNow(win).catch(() => null);
    if (now?.state === "away") {
      await click(win, ACTIVE_BODY, "calling the terminals back after a failure").catch(
        () => undefined,
      );
    }
    await win.webContents
      .executeJavaScript(
        `(() => { const lip = document.querySelector('.vf-cover .vf-godview-deck-lip[role="separator"]'); lip?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); return "ok"; })()`,
      )
      .catch(() => undefined);
    const said = error instanceof Error ? error.message : String(error);
    throw new Error(`${said} [read: ${JSON.stringify(verdict)}; now: ${JSON.stringify(now)}]`);
  }
}

async function deckEdgeSteps(
  win: BrowserWindow,
  opts: DeckAwayRungOptions,
  verdict: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  opts.pressViewKey("godview");
  await opts.deck.until(
    (facts) => facts.active && facts.wrapper?.state === "up",
    "Godview showing its terminals up",
    30_000,
  );
  await stageAtRest(win, "the terminals up");
  const before = await opts.settled();
  const restTop = before.wrapper?.top;
  if (restTop === undefined) throw new Error("the deck's marker carries no wrapper facts");
  const start = await lipNow(win);
  if (start.shift !== "" || start.remembered !== null) {
    return { unavailable: `the edge was not at rest (${start.shift || start.remembered})` };
  }
  verdict["rest"] = { top: restTop, monitorFoot: start.monitorFoot };

  // STAYS — 60 down, let go slowly
  await holdLip(win, start, start.y + 60, 6, 80);
  await opts.deck.until(
    (facts) => facts.wrapper?.state === "up" && facts.wrapper.top !== restTop,
    "a slow let-go to leave the edge where it was let go",
    10_000,
  );
  // what the edge came to once the let-go has settled (a held edge's marker
  // moves with it)
  const stayed = await opts.settled();
  const there = await lipNow(win);
  verdict["stays"] = {
    top: stayed.wrapper?.top,
    remembered: there.remembered,
    field: there.field,
    monitorFoot: there.monitorFoot,
  };
  if (Math.abs((stayed.wrapper?.top ?? 0) - (restTop + 60)) > 1) {
    throw new Error(
      `let go 60 down, the edge stands at ${stayed.wrapper?.top}, not ${restTop + 60}`,
    );
  }
  if (there.remembered !== there.shift.replace("px", "") || there.field !== there.shift) {
    throw new Error(
      `the edge that stayed is not the one remembered and measured (${JSON.stringify(there)})`,
    );
  }
  if (there.sheetTop === null || there.monitorFoot === null) {
    throw new Error("the stage lost its sheet or its monitor");
  }
  if (Math.abs(there.sheetTop - 12 - there.monitorFoot) > 1) {
    throw new Error(
      `the monitor's field ends at ${there.monitorFoot}, not 12 above the edge (${there.sheetTop})`,
    );
  }

  // AWAY — held past the line (70 left above the panes' foot), let go slowly
  const line = there.windowFoot - COVER_RESERVE - 70;
  let saidWhileHeld: string | null = null;
  await holdLip(win, there, line, 8, 80, async () => {
    saidWhileHeld = (await lipNow(win)).readout;
  });
  verdict["readoutWhileHeld"] = saidWhileHeld;
  if (saidWhileHeld !== "true") {
    throw new Error(`held past the line, the stage said nothing (readout ${saidWhileHeld})`);
  }
  await opts.deck.until(
    (facts) => !facts.active && facts.wrapper?.state === "away",
    "a let-go with less than 120 left to put the terminals away",
    10_000,
  );
  await stageAtRest(win, "the fall");
  const gone = await lipNow(win);
  verdict["away"] = { remembered: gone.remembered, field: gone.field, readout: gone.readout };
  if (gone.remembered !== there.remembered || gone.field !== there.field) {
    throw new Error(
      `the drag that put them away moved the remembered edge: ${JSON.stringify(there)} → ${JSON.stringify(gone)}`,
    );
  }
  if (gone.readout !== "false") throw new Error("the readout stayed after the let-go");

  // CALLED UP — at the edge that was remembered
  await click(win, ACTIVE_BODY, "a body of the swarm");
  await opts.deck.until(
    (facts) => facts.active && facts.wrapper?.state === "up",
    "a body to bring the terminals back",
    10_000,
  );
  await stageAtRest(win, "the rise");
  const back = await opts.settled();
  verdict["back"] = { top: back.wrapper?.top };
  if (back.wrapper?.top !== stayed.wrapper?.top) {
    throw new Error(
      `they came back with their top at ${back.wrapper?.top}, not where the edge was left (${stayed.wrapper?.top})`,
    );
  }

  // REST — a double-click on the lip, and the memory goes
  const lip = await lipNow(win);
  const input = win.webContents;
  for (const clickCount of [1, 2]) {
    input.sendInputEvent({ type: "mouseDown", x: lip.x, y: lip.y, button: "left", clickCount });
    input.sendInputEvent({ type: "mouseUp", x: lip.x, y: lip.y, button: "left", clickCount });
  }
  const rested = await opts.deck.until(
    (facts) => facts.wrapper?.top === restTop,
    "a double-click to put the edge back at rest",
    10_000,
  );
  const atRest = await lipNow(win);
  verdict["rested"] = { top: rested.wrapper?.top, remembered: atRest.remembered };
  if (atRest.remembered !== null || atRest.shift !== "" || atRest.field !== "") {
    throw new Error(`rest did not forget the edge (${JSON.stringify(atRest)})`);
  }
  verdict["outcomes"] = true;
  return verdict;
}

// MAXIMIZED — the rung after the edge's (round 3, W6 — GV-D11; DESIGN.md §8
// "Maximized — the bar is the window's title bar"):
//
//   · the Lip's maximize: the deck says maximized, the sheet is laid out at the
//     window's top, the terminals laid out once; the bar is a window-drag region
//     with its grip and buttons as holes, and the frame's ONE search button
//     stands in it (never a second one inside the stage);
//   · that button opens the Peek over the terminals, and Escape folds it;
//   · restore: up again at the same top, once more laid out, the same panes.

/** The title bar as the page draws it. */
const BAR_NOW = `(() => {
  const stage = document.querySelector(".vf-cover .vf-godview");
  const lip = stage?.querySelector(".vf-godview-deck-lip");
  const hit = stage?.querySelector(".vf-godview-deck-grip-hit");
  const find = document.querySelector(".vf-peek-find");
  const region = (el) => (el ? getComputedStyle(el).getPropertyValue("-webkit-app-region").trim() : null);
  return JSON.stringify({
    layout: stage?.getAttribute("data-godview-deck-layout") ?? null,
    sheetTop: stage?.querySelector(".vf-godview-terminal-deck")?.offsetTop ?? null,
    lipRegion: region(lip),
    gripRegion: region(hit),
    findInBar: find?.getAttribute("data-bar") === "true",
    findInStage: find?.closest(".vf-godview") !== null && find !== null,
    searchButtons: document.querySelectorAll(".vf-peek-button").length,
    head: document.querySelector(".vf-stories")?.getAttribute("data-deck") ?? null,
  });
})()`;

interface BarNow {
  layout: string | null;
  sheetTop: number | null;
  lipRegion: string | null;
  gripRegion: string | null;
  findInBar: boolean;
  findInStage: boolean;
  searchButtons: number;
  head: string | null;
}

async function barNow(win: BrowserWindow): Promise<BarNow> {
  return JSON.parse((await win.webContents.executeJavaScript(BAR_NOW)) as string) as BarNow;
}

/** The rung. */
export async function deckMaximizeRung(
  win: BrowserWindow,
  opts: DeckAwayRungOptions,
): Promise<Record<string, unknown>> {
  const verdict: Record<string, unknown> = {};
  try {
    return await deckMaximizeSteps(win, opts, verdict);
  } catch (error) {
    // Leave the terminals up for whatever runs next.
    await win.webContents
      .executeJavaScript(
        `(() => { document.querySelector('button[aria-label="Restore the terminals to their place"]')?.click(); return "ok"; })()`,
      )
      .catch(() => undefined);
    const said = error instanceof Error ? error.message : String(error);
    throw new Error(`${said} [read: ${JSON.stringify(verdict)}]`);
  }
}

async function deckMaximizeSteps(
  win: BrowserWindow,
  opts: DeckAwayRungOptions,
  verdict: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  opts.pressViewKey("godview");
  await opts.deck.until(
    (facts) => facts.active && facts.wrapper?.state === "up",
    "Godview showing its terminals up",
    30_000,
  );
  await stageAtRest(win, "the terminals up");
  const before = await opts.settled();
  const top = before.wrapper?.top;
  const resizes = before.wrapper?.bodyResizes;
  if (top === undefined || resizes === undefined) {
    throw new Error("the deck's marker carries no wrapper facts");
  }
  verdict["before"] = { top, bodyResizes: resizes };

  // MAXIMIZE — the Lip's button
  await click(win, 'button[aria-label="Maximize the terminals"]', "the Lip's maximize");
  await opts.deck.until(
    (facts) => facts.active && facts.wrapper?.state === "maximized",
    "maximize to fill the window (the marker: maximized)",
    10_000,
  );
  await stageAtRest(win, "the rise to the top");
  const full = await opts.settled();
  const bar = await barNow(win);
  const fullResizes = (full.wrapper?.bodyResizes ?? 0) - resizes;
  verdict["maximized"] = { top: full.wrapper?.top, bodyResizes: fullResizes, bar };
  const problems: string[] = [];
  if (full.wrapper?.top !== 0) problems.push(`the sheet's top is ${full.wrapper?.top}, not 0`);
  if (fullResizes > 1) problems.push(`the terminals were laid out ${fullResizes} times`);
  if (bar.layout !== "maximized") problems.push(`the layout is ${bar.layout}`);
  if (bar.lipRegion !== "drag") problems.push(`the bar's region is ${bar.lipRegion}, not drag`);
  if (bar.gripRegion !== "no-drag") problems.push(`the grip's region is ${bar.gripRegion}`);
  if (!bar.findInBar) problems.push("the frame's search button does not stand in the bar");
  if (bar.findInStage) problems.push("a search button stands inside the stage");
  if (bar.searchButtons !== 1) problems.push(`${bar.searchButtons} search buttons`);
  if (problems.length > 0) {
    throw new Error(`maximized is not the title bar: ${problems.join("; ")}`);
  }

  // SEARCH IN THE BAR — the one popup, over the terminals
  await click(win, '.vf-peek-find[data-bar="true"] .vf-peek-button', "the bar's search");
  const opened = (await win.webContents.executeJavaScript(
    `new Promise((done) => { const t0 = Date.now(); const tick = () => { if (document.querySelector('.vf-peek-pop[role="dialog"]')) done(true); else if (Date.now() - t0 > 10000) done(false); else setTimeout(tick, 100); }; tick(); })`,
  )) as boolean;
  verdict["peekFromBar"] = opened;
  if (!opened) throw new Error("the bar's search opened no popup");
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await sleep(400);

  // RESTORE — back to the edge
  await click(win, 'button[aria-label="Restore the terminals to their place"]', "restore");
  await opts.deck.until(
    (facts) => facts.active && facts.wrapper?.state === "up",
    "restore to bring the sheet back",
    10_000,
  );
  await stageAtRest(win, "the fall back");
  const back = await opts.settled();
  const backResizes = (back.wrapper?.bodyResizes ?? 0) - resizes;
  verdict["restored"] = { top: back.wrapper?.top, bodyResizes: backResizes };
  if (back.wrapper?.top !== top) {
    throw new Error(`restored, the top is ${back.wrapper?.top}, not ${top}`);
  }
  if (backResizes > 2) {
    throw new Error(`maximized and back laid the terminals out ${backResizes} times`);
  }
  if (sorted(back.sessionIds).join() !== sorted(before.sessionIds).join()) {
    throw new Error(
      `maximized and back changed the panes: ${JSON.stringify(before.sessionIds)} → ${JSON.stringify(back.sessionIds)}`,
    );
  }
  verdict["roundTripped"] = true;
  return verdict;
}
