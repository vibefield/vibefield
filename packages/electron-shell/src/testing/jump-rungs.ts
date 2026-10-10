import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import type { BrowserWindow } from "electron";
import type { StagedTypedAgent } from "./typed-agent";

// JUMP TO's RUNG in `pnpm smoke:godview` (P3; DESIGN.md §8 "History"; AR-D43,
// K11). It rides the History rung, after that rung enrolled and opened the
// person's own seeded conversation (`openSeededSession`), and the typed-agent
// rows, after the stub stands as the agent's install:
//
//   · the agent STARTS: History's own Resume, pressed on the seeded session —
//     the typed stub, continued by `agent.resume`'s native form, placed in
//     Godview's active pane;
//   · a second `agent.resume` of the running conversation, asked over the
//     harness's own client, is REFUSED by fieldd (AR-4b's one-run law,
//     `terminal-alive`) — what a Resume on a live session met before P3;
//   · a split makes another pane the active one; back in History the line's
//     create says JUMP TO under `jump`, and pressed, the window moves to
//     Godview with the agent's pane the ACTIVE one — the same pane, activated,
//     never mounted again (the deck's pane count does not move);
//   · LIVE NOW IN HISTORY (P2, docket PK5): another pane active again, ⌘F in
//     History and Live now list the running agent — the Peek's own feed, open
//     only while the tab shows — and a pick reveals its pane in Godview,
//     activated, never mounted again (Jump to's path);
//   · the run's PTY ended, History showing again says Resume once more.
//
// It leaves Godview's active pane showing that ENDED session, so the smoke runs
// it after every row that types into a shell (after 11h, the line's keys).
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

const VIEW_NOW = `(document.querySelector(".vf-views-line")?.getAttribute("data-view") ?? "absent")`;

/** The Peek's popup: open or not, and its scope (P2). */
const PEEK_SCOPE = `(document.querySelector('.vf-peek-pop[role="dialog"]')?.getAttribute("data-scope") ?? "closed")`;
const HISTORY_ROOM = `document.querySelector('[data-cover-view="history"] .vf-history .ah-frame')`;

/** The line's create as the window draws it now. */
const CREATE_NOW = `(() => {
  const create = document.querySelector(".vf-line-create");
  return JSON.stringify({
    name: create?.getAttribute("aria-label") ?? null,
    title: create?.getAttribute("title") ?? null,
    waits: create?.getAttribute("aria-disabled") === "true",
    glyph: create?.querySelector("[data-shown]")?.getAttribute("data-glyph") ?? null,
  });
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

interface CreateNow {
  name: string | null;
  title: string | null;
  waits: boolean;
  glyph: string | null;
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
  const createNow = async (): Promise<CreateNow> => JSON.parse(await evaluate(CREATE_NOW));
  /** Press the line's create and hear the note it comes to (one of `ends`). */
  const pressCreate = async (label: string, ends: readonly string[]): Promise<string> => {
    await evaluate(NOTES_ARM);
    await evaluate(`(document.querySelector(".vf-line-create")?.click(), "ok")`);
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
        if (project && !project.classList.contains("is-selected")) project.click();
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

  // 2. The agent starts: History's Resume, as a person presses it.
  const resumeFace = await untilValue(
    "History's create to offer Resume for the seeded session",
    createNow,
    (face) => face.name === "Resume this session" && !face.waits,
    30_000,
  );
  verdict["before"] = { name: resumeFace.name, glyph: resumeFace.glyph };
  const resumed = await pressCreate("Resume's note", [
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

  // 5. History again: the create says Jump to under `jump`.
  await toView("history");
  const jumpFace = await untilValue(
    "History's create to say Jump to for the running session",
    createNow,
    (face) => face.name === "Jump to this session" && face.glyph === "jump" && !face.waits,
    30_000,
  );
  verdict["live"] = { name: jumpFace.name, glyph: jumpFace.glyph };

  // 6. Jump to: Godview, the agent's pane the active one — activated, not
  //    mounted again (the same panes, the same sessions).
  const note = await pressCreate("Jump to's note", [
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
    "the agent's pane to be the active one after Jump to",
    30_000,
  );
  if (
    jumped.panes !== split.panes ||
    [...jumped.sessionIds].sort().join() !== [...split.sessionIds].sort().join()
  ) {
    throw new Error(
      `Jump to mounted rather than activated: before ${JSON.stringify(split)} after ${JSON.stringify(jumped)}`,
    );
  }
  verdict["jumped"] = { note, activeSessionId: jumped.activeSessionId, panes: jumped.panes };

  // 6b. Live now in History (P2, docket PK5): the agent's pane not the active
  //     one again; ⌘F in History, Live now, the running agent listed by its
  //     floor session; picked, the window moves to Godview and the deck
  //     reveals the same pane — activated, the deck's panes unchanged.
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
    "the agent's pane to be the active one after a Live now pick",
    30_000,
  );
  if (
    revealed.panes !== resplit.panes ||
    [...revealed.sessionIds].sort().join() !== [...resplit.sessionIds].sort().join()
  ) {
    throw new Error(
      `a Live now pick mounted rather than activated: before ${JSON.stringify(resplit)} after ${JSON.stringify(revealed)}`,
    );
  }
  verdict["liveNow"] = {
    listed: JSON.parse(listed) as unknown,
    activeSessionId: revealed.activeSessionId,
    panes: revealed.panes,
  };

  // 7. The run's PTY ended: History showing again says Resume once more.
  await opts.handle.client.request("terminal.terminate", { sessionId: floor });
  await untilValue("fieldd's fold to drop the run", floorOfRun, (found) => found === null, 30_000);
  await toView("history");
  const endedFace = await untilValue(
    "History's create to say Resume once the run ended",
    createNow,
    (face) => face.name === "Resume this session" && face.glyph === "resume",
    30_000,
  );
  verdict["ended"] = { name: endedFace.name, glyph: endedFace.glyph };
  await toView("godview");
  return verdict;
}
