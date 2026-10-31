import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import type { BrowserWindow } from "electron";
import type { StagedTypedAgent } from "./typed-agent";

// JUMP TO's RUNG in `pnpm smoke:godview` (P3; DESIGN.md §8 "History"; AR-D43,
// K11). It rides the History rung, after that rung enrolled and opened the
// person's own seeded conversation (`openSeededSession`), and the typed-agent
// rows, after the stub stands as the agent's install:
//
//   · the agent STARTS: History's own Resume, pressed on the seeded session's
//     row (R4) — the typed stub, continued by `agent.resume`'s native form,
//     placed in Godview's active pane;
//   · a second `agent.resume` of the running conversation, asked over the
//     harness's own client, is REFUSED by fieldd (AR-4b's one-run law,
//     `terminal-alive`) — what a Resume on a live session met before P3;
//   · a split makes another pane the active one; back in History the session's
//     row says JUMP TO under `jump`, and pressed, the window moves to
//     Godview with the agent's session in the FOCUSED pane — MIRRORED there,
//     its own pane still showing it (GV-D4, re-ruled 2026-10-18: "Everywhere",
//     "Mirror it"), the deck's pane count unchanged;
//   · LIVE NOW IN HISTORY (P2, docket PK5): another pane active again, ⌘F in
//     History and Live now list the running agent — the Peek's own feed, open
//     only while the tab shows — and a pick shows it in Godview's focused pane
//     the same way (Jump to's path);
//   · the run's PTY ended, History showing again says Resume once more.
//
// *Corrected 2026-10-18:* until GV-D4's re-ruling, Jump to and the pick made
// the agent's own pane the active one and never mounted it again.
// *Moved 2026-10-29 (HN-7, LN-D2):* Resume and Jump to were pressed on the
// line's create, which is New terminal since; they are the chosen session's
// acts — its row's, ④'s head's and the palette's — with the same words.
//
// It leaves Godview's panes showing that ENDED session (the mirrors with it),
// so the smoke runs it after every row that types into a shell (after 11h, the
// line's keys).
//
// Test-only by construction: this module rides the smoke bundle
// (dist/testing/smoke.cjs), which packaging omits.

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The deck's marker, as far as this rung reads it. */
interface JumpDeckFacts {
  active: boolean;
  panes: number;
  sessionIds: readonly string[];
  activeSessionId?: string;
}

interface JumpDeckWatch {
  until(
    predicate: (facts: JumpDeckFacts) => boolean,
    what: string,
    timeoutMs: number,
  ): Promise<JumpDeckFacts>;
}

/** How many of the deck's panes show `sessionId` (one entry per pane). */
const showingOf = (facts: JumpDeckFacts, sessionId: string): number =>
  facts.sessionIds.filter((id) => id === sessionId).length;

/** GV-D4, re-ruled 2026-10-18 ("Mirror it"): `act` showed `sessionId` in the
 * FOCUSED pane while another pane showed it — one pane more on it, and no pane
 * added. Throws the rung's own words when the deck did anything else. */
function mirroredInto(
  act: string,
  before: JumpDeckFacts,
  after: JumpDeckFacts,
  sessionId: string,
): void {
  if (
    after.panes !== before.panes ||
    showingOf(after, sessionId) !== showingOf(before, sessionId) + 1
  ) {
    throw new Error(
      `${act} did not mirror the session into the focused pane: before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
    );
  }
}

const VIEW_NOW = `(document.querySelector(".vf-views-line")?.getAttribute("data-view") ?? "absent")`;

/** The Peek's popup: open or not, and its scope (P2). */
const PEEK_SCOPE = `(document.querySelector('.vf-peek-pop[role="dialog"]')?.getAttribute("data-scope") ?? "closed")`;
const HISTORY_ROOM = `document.querySelector('[data-cover-view="history"] .vf-history .ah-frame')`;

/** The chosen session's row in the room. */
const CHOSEN_ROW = `${HISTORY_ROOM}?.querySelector(".ah-session-list-item.is-selected")`;

/** The chosen session's own act as its row draws it now (R4): Resume, or Jump to while it
 * runs here — the act's label its name, its glyph the act's; none there, the row's reason. */
const ACT_NOW = `(() => {
  const row = ${CHOSEN_ROW};
  const act = row?.querySelector('.ah-hostact[data-place="row"]');
  return JSON.stringify({
    name: act?.getAttribute("aria-label") ?? null,
    waits: act === null || act === undefined || act.disabled === true,
    glyph: act?.querySelector("svg[data-glyph]")?.getAttribute("data-glyph") ?? null,
    reason: row?.querySelector(".vf-history-reason")?.textContent ?? null,
  });
})()`;

/** Press it IN THE SAME evaluation that finds it, so a miss is said, never read as a press
 * (history-project-rungs.ts's `pressWhenThere`). */
const ACT_PRESS = `(() => {
  const act = ${CHOSEN_ROW}?.querySelector('.ah-hostact[data-place="row"]');
  if (!act || act.disabled) return "absent";
  act.click();
  return "pressed";
})()`;

/** Every note the line says from now on, in order — a note stands 2.4s, and a
 * loaded host's evaluate can be slower than that. Cleared at each arming; the
 * ear is taken down at the rung's end (`NOTES_OFF`). */
const NOTES_ARM = `(() => {
  window.__vfJumpNotes = [];
  if (!window.__vfJumpNoteEar) {
    window.__vfJumpNoteEar = new MutationObserver(() => {
      const text = (document.querySelector(".vf-line-note")?.textContent ?? "").trim();
      const heard = window.__vfJumpNotes;
      if (text !== "" && heard[heard.length - 1] !== text) heard.push(text);
    });
    window.__vfJumpNoteEar.observe(document.body, { subtree: true, childList: true, characterData: true });
  }
  return "ok";
})()`;
const NOTES_HEARD = `JSON.stringify(window.__vfJumpNotes ?? [])`;
const NOTES_OFF = `(() => { window.__vfJumpNoteEar?.disconnect(); delete window.__vfJumpNoteEar; delete window.__vfJumpNotes; return "ok"; })()`;

interface SessionActNow {
  name: string | null;
  waits: boolean;
  glyph: string | null;
  reason: string | null;
}

async function untilValue<T>(
  label: string,
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let seen: T | undefined;
  while (Date.now() < deadline) {
    seen = await read();
    if (accept(seen)) return seen;
    await sleep(150);
  }
  throw new Error(`${label} did not happen within ${timeoutMs}ms (${JSON.stringify(seen)})`);
}

interface JumpRungOptions {
  handle: FielddHandle;
  staged: StagedTypedAgent | undefined;
  seeded: boolean;
  deck: JumpDeckWatch;
  /** ⌘2 / ⌘3, the road a person takes (the smoke's `pressViewKey`). */
  pressViewKey: (view: "godview" | "history") => void;
  /** A split of the deck's active pane, landed: the smoke's own chord. */
  split: () => Promise<void>;
}

/** The rung. `seeded`: the History rung opened the person's conversation. */
export async function jumpToRung(
  win: BrowserWindow,
  opts: JumpRungOptions,
): Promise<Record<string, unknown>> {
  if (!opts.seeded || opts.staged === undefined) {
    return { unavailable: "the History rung seeded no conversation (no person, or no index)" };
  }
  try {
    return await jumpToSteps(win, opts, opts.staged);
  } finally {
    // the note ear never outlives the rung (later rows measure frames)
    await win.webContents.executeJavaScript(NOTES_OFF).catch(() => undefined);
  }
}

async function jumpToSteps(
  win: BrowserWindow,
  opts: JumpRungOptions,
  staged: StagedTypedAgent,
): Promise<Record<string, unknown>> {
  const native = staged.history.nativeSessionId;
  const evaluate = async (expression: string): Promise<string> =>
    String(await win.webContents.executeJavaScript(expression));
  const actNow = async (): Promise<SessionActNow> => JSON.parse(await evaluate(ACT_NOW));
  /** Press the chosen session's act and hear the note it comes to (one of `ends`). */
  const pressAct = async (label: string, ends: readonly string[]): Promise<string> => {
    await evaluate(NOTES_ARM);
    if ((await evaluate(ACT_PRESS)) !== "pressed") {
      throw new Error(
        `${label}: the chosen session's row held no act to press (${await evaluate(ACT_NOW)})`,
      );
    }
    const heard = await untilValue(
      label,
      async () => JSON.parse(await evaluate(NOTES_HEARD)) as string[],
      (notes) => notes.some((note) => ends.some((end) => note.startsWith(end))),
      60_000,
    );
    return heard.find((note) => ends.some((end) => note.startsWith(end))) ?? "";
  };
  const toView = async (view: "godview" | "history"): Promise<void> => {
    opts.pressViewKey(view);
    await untilValue(
      `⌘ to ${view}`,
      () => evaluate(VIEW_NOW),
      (now) => now === view,
      10_000,
    );
  };
  /** The run continuing the seeded conversation, as fieldd's own fold lists it. */
  const floorOfRun = async (): Promise<string | null> => {
    const listed = (await opts.handle.client.request("agent.list", {})) as {
      sessions?: Array<{
        sessionId?: string;
        terminal?: { hosted?: string; runtimeSessionId?: string };
        continuation?: { exited?: boolean };
      }>;
    };
    const row = (listed.sessions ?? []).find(
      (session) =>
        session.sessionId === native &&
        session.continuation?.exited !== true &&
        session.terminal?.hosted === "local",
    );
    return row?.terminal?.runtimeSessionId ?? null;
  };
  const verdict: Record<string, unknown> = {};

  // 1. History, the seeded session chosen (the History rung left it chosen;
  //    chosen again here if a later row moved the room).
  await toView("history");
  await untilValue(
    "the seeded session chosen in History",
    () =>
      evaluate(`(() => {
        const room = ${HISTORY_ROOM};
        if (!room) return "no room";
        const session = room.querySelector(".ah-session-list-item");
        if (session) {
          if (session.classList.contains("is-selected")) return "chosen";
          // PJ-4: a row with a host act is a box; its covering button chooses
          (session.querySelector(".ah-session-list-item__hit") ?? session).click();
          return "session";
        }
        const project = room.querySelector(".ah-project-list-item");
        // a project row with a host act (H4) is a box: its covering button chooses
        if (project && !project.classList.contains("is-selected")) (project.querySelector(".ah-project-list-item__hit") ?? project).click();
        // PJ-4 (H5): a project in a folded section (Temporary) opens its fold first
        if (!project) room.querySelector('.ah-fold[aria-expanded="false"]')?.click();
        return "project";
      })()`),
    (answer) => answer === "chosen",
    30_000,
  );
  if ((await floorOfRun()) !== null) {
    throw new Error("the seeded conversation already runs here before the rung started it");
  }

  // 2. The agent starts: History's Resume, as a person presses it — on the
  //    seeded session's row (the line's create until HN-7).
  const resumeFace = await untilValue(
    "the seeded session's row to offer Resume",
    actNow,
    (face) => face.name === "Resume this session" && !face.waits,
    30_000,
  );
  verdict["before"] = { name: resumeFace.name, glyph: resumeFace.glyph };
  const resumed = await pressAct("Resume's note", [
    "Resumed in the active pane",
    "Could not resume",
    "This session is running",
  ]);
  if (resumed !== "Resumed in the active pane") {
    throw new Error(`the seeded session did not resume: ${resumed}`);
  }
  verdict["resumed"] = resumed;
  const floor = await untilValue(
    "fieldd's fold to list the resumed run on this desktop's floor",
    floorOfRun,
    (found) => found !== null,
    30_000,
  );
  if (floor === null) throw new Error("unreachable: the fold's run has no floor session");
  verdict["floorSessionId"] = floor;
  await opts.deck.until(
    (facts) => facts.active && facts.activeSessionId === floor,
    "the resumed agent in Godview's active pane",
    30_000,
  );

  // 3. What a Resume of a running conversation meets in fieldd: refused, and
  //    nothing started (the fold still lists ONE run on it).
  try {
    await opts.handle.client.request("agent.resume", {
      provider: staged.agentId,
      nativeSessionId: native,
      cwd: staged.work,
    });
    throw new Error("fieldd resumed a conversation that was already running: two runs on it");
  } catch (error) {
    const refusal = error as { kind?: unknown; details?: { state?: unknown }; message?: unknown };
    if (refusal.details?.state !== "terminal-alive") throw error;
    verdict["secondResume"] = {
      kind: refusal.kind,
      state: refusal.details.state,
      words: String(refusal.message ?? ""),
    };
  }

  // 4. Another pane becomes the active one (a split of the agent's).
  await opts.split();
  const split = await opts.deck.until(
    (facts) => facts.activeSessionId !== undefined && facts.activeSessionId !== floor,
    "a split pane to be the active one",
    30_000,
  );
  if (!split.sessionIds.includes(floor)) {
    throw new Error(`the agent's pane left the deck at the split: ${JSON.stringify(split)}`);
  }

  // 5. History again: the session's row says Jump to under `jump`.
  await toView("history");
  const jumpFace = await untilValue(
    "the session's row to say Jump to for the running session",
    actNow,
    (face) => face.name === "Jump to this session" && face.glyph === "jump" && !face.waits,
    30_000,
  );
  verdict["live"] = { name: jumpFace.name, glyph: jumpFace.glyph };

  // 6. Jump to: Godview, the agent's session in the FOCUSED pane (the split's)
  //    — mirrored there, its own pane still showing it (GV-D4, re-ruled
  //    2026-10-18: "Everywhere", "Mirror it"), the pane count unchanged.
  const note = await pressAct("Jump to's note", [
    "Jumped to its pane",
    "Could not jump",
    "This session has ended",
  ]);
  if (note !== "Jumped to its pane") throw new Error(`Jump to said: ${note}`);
  await untilValue(
    "the window to move to Godview",
    () => evaluate(VIEW_NOW),
    (now) => now === "godview",
    20_000,
  );
  const jumped = await opts.deck.until(
    (facts) => facts.active && facts.activeSessionId === floor,
    "the agent's session in the focused pane after Jump to",
    30_000,
  );
  mirroredInto("Jump to", split, jumped, floor);
  verdict["jumped"] = {
    note,
    activeSessionId: jumped.activeSessionId,
    panes: jumped.panes,
    showing: showingOf(jumped, floor),
  };

  // 6b. Live now in History (P2, docket PK5): the agent's session not in the
  //     focused pane again (a split of the mirror); ⌘F in History, Live now,
  //     the running agent listed by its floor session; picked, the window
  //     moves to Godview and the deck shows it in the focused pane the same
  //     way — one more mirror, the deck's pane count unchanged.
  await opts.split();
  const resplit = await opts.deck.until(
    (facts) => facts.activeSessionId !== undefined && facts.activeSessionId !== floor,
    "another split pane to be the active one (Live now)",
    30_000,
  );
  await toView("history");
  const modifiers: ("meta" | "control")[] = [process.platform === "darwin" ? "meta" : "control"];
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "f", modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "f", modifiers });
  await untilValue(
    "⌘F to open the Peek on Everything in History",
    () => evaluate(PEEK_SCOPE),
    (scope) => scope === "everything",
    10_000,
  );
  await evaluate(`(() => {
    const radios = [...document.querySelectorAll('.vf-peek-pop [role="radio"]')];
    radios.find((radio) => radio.textContent === "Live now")?.click();
    return "ok";
  })()`);
  const listed = await untilValue(
    "Live now in History to list the running agent by its floor session",
    () =>
      evaluate(`(() => {
        const row = document.querySelector('.vf-peek-pop .vf-peek-row[data-floor-session=${JSON.stringify(floor)}]');
        return row ? JSON.stringify({
          title: row.querySelector(".vf-peek-title")?.textContent ?? null,
          state: row.querySelector(".vf-peek-when")?.textContent ?? null,
          foot: document.querySelector(".vf-peek-pop .vf-peek-said")?.textContent ?? null,
        }) : "absent";
      })()`),
    (value) => value !== "absent",
    30_000,
  );
  await evaluate(
    `(document.querySelector('.vf-peek-pop .vf-peek-row[data-floor-session=${JSON.stringify(floor)}]')?.click(), "ok")`,
  );
  await untilValue(
    "the window to move to Godview from Live now",
    () => evaluate(VIEW_NOW),
    (now) => now === "godview",
    20_000,
  );
  const revealed = await opts.deck.until(
    (facts) => facts.active && facts.activeSessionId === floor,
    "the agent's session in the focused pane after a Live now pick",
    30_000,
  );
  mirroredInto("a Live now pick", resplit, revealed, floor);
  verdict["liveNow"] = {
    listed: JSON.parse(listed) as unknown,
    activeSessionId: revealed.activeSessionId,
    panes: revealed.panes,
    showing: showingOf(revealed, floor),
  };

  // 7. The run's PTY ended: History showing again says Resume once more.
  await opts.handle.client.request("terminal.terminate", { sessionId: floor });
  await untilValue("fieldd's fold to drop the run", floorOfRun, (found) => found === null, 30_000);
  await toView("history");
  const endedFace = await untilValue(
    "the session's row to say Resume once the run ended",
    actNow,
    (face) => face.name === "Resume this session" && face.glyph === "resume",
    30_000,
  );
  verdict["ended"] = { name: endedFace.name, glyph: endedFace.glyph };
  await toView("godview");
  return verdict;
}
