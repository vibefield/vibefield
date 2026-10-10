import { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AgentListResult, IndexSessionsResult, ProjectListResult } from "@vibefield/contracts";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import type { BrowserWindow } from "electron";
import { readTypedAgentCalls, type StagedTypedAgent } from "./typed-agent";

// HISTORY BY PROJECT's RUNG in `pnpm smoke:godview` (PJ-4, H1 (a): "we map,
// the room draws"). It rides the History rung, after that rung opened the
// person's seeded conversation (`openSeededSession`): the REAL fieldd joins
// that session to the PJ project whose place its own scanner read for its
// folder (`index.sessions`' `projectKey`, A-D4), `project.list` names that
// project, and the REAL room lists it by that name — the row the opened
// session sits in, chosen. The seeded folder is the run's own throwaway work
// folder, so the name is whatever fieldd's grouping says of it (a folder
// under the OS's temporary root is the Temporary bucket); the rung reads the
// name from fieldd and never assumes one.
//
// Test-only by construction: this module rides the smoke bundle
// (dist/testing/smoke.cjs), which packaging omits.

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const HISTORY_ROOM = `document.querySelector('[data-cover-view="history"] .vf-history .ah-frame')`;

/** The room's project rows as it draws them: each row's name, and which is chosen. */
const ROOM_PROJECTS = `(() => {
  const room = ${HISTORY_ROOM};
  if (!room) return JSON.stringify(null);
  return JSON.stringify([...room.querySelectorAll(".ah-project-list-item")].map((row) => ({
    name: (row.querySelector(".ah-project-list-item__header strong")?.textContent ?? "").trim(),
    chosen: row.classList.contains("is-selected"),
  })));
})()`;

interface RoomProject {
  name: string;
  chosen: boolean;
}

export interface HistoryByProjectVerdict {
  checked: boolean;
  why?: string;
  key?: string;
  name?: string;
  nameFrom?: string;
  rows?: readonly RoomProject[];
  waitedMs?: number;
}

/**
 * The seeded session's PJ project, as fieldd files and names it, listed by
 * that name in the room — and chosen, since the opened session sits in it.
 * Waits (the place scanner reads a new folder on its own clock, then the
 * grouping settles) and fails with what it saw.
 */
export async function historyByProjectRung(
  win: BrowserWindow,
  opts: { handle: FielddHandle; seeded: boolean; nativeSessionId: string | undefined },
): Promise<HistoryByProjectVerdict> {
  if (!opts.seeded || opts.nativeSessionId === undefined)
    return { checked: false, why: "the seeded conversation did not open, so no project to read" };
  const started = Date.now();
  const deadline = started + 120_000;
  let seen = "";
  while (Date.now() < deadline) {
    const listing = IndexSessionsResult.parse(
      await opts.handle.client.request("index.sessions", { scope: "local", limit: 500 }),
    );
    const session = listing.rows.find((row) => row.nativeSessionId === opts.nativeSessionId);
    const key = session?.projectKey;
    if (key === undefined) {
      seen = session === undefined ? "the seeded session is not listed" : "not filed yet";
      await sleep(500);
      continue;
    }
    const projects = ProjectListResult.parse(
      await opts.handle.client.request("project.list", { limit: 500 }),
    );
    const project = projects.rows.find((row) => row.key === key);
    if (project === undefined) {
      seen = `filed under ${key}, which project.list does not name yet`;
      await sleep(500);
      continue;
    }
    const name =
      project.disambiguation !== undefined
        ? `${project.name} · ${project.disambiguation}`
        : project.name;
    const rows = JSON.parse((await win.webContents.executeJavaScript(ROOM_PROJECTS)) as string) as
      | RoomProject[]
      | null;
    const row = rows?.find((candidate) => candidate.name === name);
    if (row?.chosen === true)
      return {
        checked: true,
        key,
        name,
        nameFrom: project.nameFrom,
        rows: rows ?? [],
        waitedMs: Date.now() - started,
      };
    seen = `fieldd names it "${name}"; the room shows ${JSON.stringify(rows)}`;
    await sleep(500);
  }
  throw new Error(`History did not list the seeded session's project by its name: ${seen}`);
}

const VIEW_NOW = `(document.querySelector(".vf-views-line")?.getAttribute("data-view") ?? "absent")`;

/** Choose the project named `name` in ① (opening Temporary's fold at the
 * foot first, H5) and, with `session`, its newest session: one step per
 * evaluation, "chosen" once both are. */
const chooseProject = (name: string, session: boolean): string => `(() => {
  const room = ${HISTORY_ROOM};
  if (!room) return "no room";
  const rows = [...room.querySelectorAll(".ah-project-list-item")];
  const row = rows.find((candidate) =>
    (candidate.querySelector(".ah-project-list-item__header strong")?.textContent ?? "").trim() ===
      ${JSON.stringify(name)});
  if (!row) {
    const fold = room.querySelector('.ah-fold[aria-expanded="false"]');
    if (fold) { fold.click(); return "fold"; }
    return "no project row";
  }
  // a project row with a host act (H4) is a box: its covering button chooses
  if (!row.classList.contains("is-selected")) { (row.querySelector(".ah-project-list-item__hit") ?? row).click(); return "project"; }
  if (!${session}) return "chosen";
  const first = room.querySelector(".ah-session-list-item");
  if (!first) return "no session row";
  if (!first.classList.contains("is-selected")) { (first.querySelector(".ah-session-list-item__hit") ?? first).click(); return "session"; }
  return "chosen";
})()`;

/** Every note the line says from now on, in order (a note stands 2.4s; a
 * loaded host's evaluate can be slower) — jump-rungs.ts's ear, its own globals. */
const NOTES_ARM = `(() => {
  window.__vfHistoryNotes = [];
  if (!window.__vfHistoryNoteEar) {
    window.__vfHistoryNoteEar = new MutationObserver(() => {
      const text = (document.querySelector(".vf-line-note")?.textContent ?? "").trim();
      const heard = window.__vfHistoryNotes;
      if (text !== "" && heard[heard.length - 1] !== text) heard.push(text);
    });
    window.__vfHistoryNoteEar.observe(document.body, { subtree: true, childList: true, characterData: true });
  }
  return "ok";
})()`;
const NOTES_HEARD = `JSON.stringify(window.__vfHistoryNotes ?? [])`;
const NOTES_OFF = `(() => { window.__vfHistoryNoteEar?.disconnect(); delete window.__vfHistoryNoteEar; delete window.__vfHistoryNotes; return "ok"; })()`;

async function heardNote(
  win: BrowserWindow,
  label: string,
  starts: readonly string[],
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let heard: string[] = [];
  while (Date.now() < deadline) {
    heard = JSON.parse(String(await win.webContents.executeJavaScript(NOTES_HEARD))) as string[];
    const note = heard.find((text) => starts.some((start) => text.startsWith(start)));
    if (note !== undefined) return note;
    await sleep(150);
  }
  throw new Error(`${label}: the line said ${JSON.stringify(heard)}`);
}

/** A path as the OS resolves it (macOS's /var is /private/var), or itself. */
function resolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export interface HistoryActRungOptions {
  handle: FielddHandle;
  staged: StagedTypedAgent | undefined;
  /** the History-by-project rung's verdict: its project's name */
  byProject: { checked?: boolean; name?: string } | undefined;
  /** ⌘2 / ⌘3, the road a person takes (the smoke's `pressViewKey`) */
  pressViewKey: (view: "godview" | "history") => void;
}

/**
 * NEW AGENT FROM HISTORY (PJ-4, H6; PJ-L5 "a place acts"): in the seeded
 * session's project, ②'s New agent, its menu's typed agent — the stub —
 * starts in the folder ③ shows. Witnessed three ways: the line says "Started
 * in …", fieldd lists a NEW run of that agent whose workspace is that folder,
 * and the stub itself recorded running there. The window moves to Godview,
 * whose deck placed the pane.
 */
export async function historyNewAgentRung(
  win: BrowserWindow,
  opts: HistoryActRungOptions,
): Promise<Record<string, unknown>> {
  const staged = opts.staged;
  const name = opts.byProject?.name;
  if (staged === undefined || opts.byProject?.checked !== true || name === undefined)
    return { unavailable: "History by project was not witnessed in this run" };
  const evaluate = async (expression: string): Promise<string> =>
    String(await win.webContents.executeJavaScript(expression));
  try {
    opts.pressViewKey("history");
    await untilValue(win, "History, the view", VIEW_NOW, 10_000, (value) => value === "history");
    await untilValue(
      win,
      `${name} chosen`,
      chooseProject(name, false),
      20_000,
      (v) => v === "chosen",
    );
    // ③'s folder: the one New agent starts in (its title is the whole path)
    const folder = await untilValue(
      win,
      "③'s folder",
      `(${HISTORY_ROOM}?.querySelector("button.ah-folderpick")?.getAttribute("title") ?? "")`,
      20_000,
      (value) => value !== "",
    );
    const before = AgentListResult.parse(await opts.handle.client.request("agent.list", {}));
    const runsBefore = new Set(before.sessions.map((row) => row.runtimeRunId));
    const callsBefore = readTypedAgentCalls(staged.calls).length;
    await evaluate(NOTES_ARM);
    await evaluate(
      `(${HISTORY_ROOM}?.querySelector('.ah-hostact[data-place="head"][data-act="new-agent"]')?.click(), "ok")`,
    );
    // the menu's row for the typed agent (its key is the catalog id, then the persona)
    const item = await untilValue(
      win,
      "New agent's menu, the typed agent's row",
      `(() => {
        const items = [...(${HISTORY_ROOM}?.querySelectorAll(".ah-menu [role=menu] .ah-menu__item") ?? [])];
        const row = items.find((candidate) =>
          (candidate.getAttribute("data-key") ?? "").startsWith(${JSON.stringify(`${staged.agentId}`)}));
        if (!row) return "";
        return JSON.stringify({
          key: row.getAttribute("data-key"),
          disabled: row.disabled || row.getAttribute("aria-disabled") === "true",
          text: (row.textContent ?? "").replace(/\\s+/g, " ").trim(),
        });
      })()`,
      10_000,
      (value) => value !== "",
    );
    const row = JSON.parse(item) as { key: string; disabled: boolean; text: string };
    if (row.disabled)
      throw new Error(`New agent's row for the typed agent is disabled: ${row.text}`);
    const startsIn = await evaluate(
      `([...(${HISTORY_ROOM}?.querySelectorAll(".ah-menu [role=menu] .ah-menu__item") ?? [])].find((c) => c.getAttribute("data-key") === "where")?.textContent ?? "").replace(/\\s+/g, " ").trim()`,
    );
    await evaluate(
      `([...(${HISTORY_ROOM}?.querySelectorAll(".ah-menu [role=menu] .ah-menu__item") ?? [])].find((c) => c.getAttribute("data-key") === ${JSON.stringify(row.key)})?.click(), "ok")`,
    );
    const note = await heardNote(win, "New agent", ["Started in ", "Could not start"], 60_000);
    if (!note.startsWith("Started in ")) throw new Error(`New agent said: ${note}`);
    // fieldd's own account: a new run of the typed agent, its workspace the folder
    const want = resolved(folder);
    const started = Date.now();
    let run: { runtimeRunId: string; root?: string; source?: string } | undefined;
    while (Date.now() - started < 30_000) {
      const after = AgentListResult.parse(await opts.handle.client.request("agent.list", {}));
      const fresh = after.sessions.find(
        (candidate) => candidate.kind === staged.agentId && !runsBefore.has(candidate.runtimeRunId),
      );
      if (fresh !== undefined) {
        run = {
          runtimeRunId: fresh.runtimeRunId,
          ...(fresh.workspace?.root !== undefined ? { root: fresh.workspace.root } : {}),
          ...(fresh.workspace?.sourcePath !== undefined
            ? { source: fresh.workspace.sourcePath }
            : {}),
        };
        break;
      }
      await sleep(250);
    }
    if (run === undefined)
      throw new Error("New agent said it started, but fieldd lists no new run");
    const where = run.root ?? run.source;
    if (where === undefined || resolved(where) !== want)
      throw new Error(`the new run's workspace is ${String(where)}, not ③'s folder ${folder}`);
    // and the stub's own record: a session of it ran in that folder
    const call = await (async () => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const found = readTypedAgentCalls(staged.calls)
          .slice(callsBefore)
          .find((candidate) => candidate.argv.includes("--session-id"));
        if (found !== undefined) return found;
        await sleep(250);
      }
      return undefined;
    })();
    if (call === undefined) throw new Error("the stub recorded no session run after New agent");
    if (call.cwd !== want)
      throw new Error(`the stub ran in ${String(call.cwd)}, not ③'s folder ${want}`);
    const view = await untilValue(
      win,
      "Godview showing the new pane",
      VIEW_NOW,
      10_000,
      (value) => value === "godview",
    );
    return { project: name, folder, startsIn, item: row.text, note, run, stubCwd: call.cwd, view };
  } finally {
    await evaluate(NOTES_OFF).catch(() => undefined);
  }
}

/**
 * RESUME ON A GONE FOLDER SAYS WHY (PJ-4, R4; PJ-D9): the seeded session's
 * folder taken away (renamed aside, and put back after), its row's Resume
 * pressed: History reads the session again whole and says why on the line —
 * "Could not resume — folder is gone" (the launcher's words), never a silent
 * press and never an agent started in a folder that is not there.
 */
export async function historyGoneFolderRung(
  win: BrowserWindow,
  opts: HistoryActRungOptions,
): Promise<Record<string, unknown>> {
  const staged = opts.staged;
  const name = opts.byProject?.name;
  if (staged === undefined || opts.byProject?.checked !== true || name === undefined)
    return { unavailable: "History by project was not witnessed in this run" };
  const evaluate = async (expression: string): Promise<string> =>
    String(await win.webContents.executeJavaScript(expression));
  const listing = IndexSessionsResult.parse(
    await opts.handle.client.request("index.sessions", { scope: "local", limit: 500 }),
  );
  const session = listing.rows.find(
    (candidate) => candidate.nativeSessionId === staged.history.nativeSessionId,
  );
  if (session === undefined) throw new Error("the seeded session is not listed");
  const rowAct = (act: string) =>
    `${HISTORY_ROOM}?.querySelector('.ah-session-list-item[data-motion-key=${JSON.stringify(session.sessionId)}] .ah-hostact[data-place="row"][data-act="${act}"]')`;
  const aside = `${staged.work}.gone-${process.pid}`;
  let moved = false;
  try {
    opts.pressViewKey("history");
    await untilValue(win, "History, the view", VIEW_NOW, 10_000, (value) => value === "history");
    await untilValue(
      win,
      `${name} chosen`,
      chooseProject(name, false),
      20_000,
      (v) => v === "chosen",
    );
    // the seeded session, ended (Jump to's rung ended its run): its row says Resume
    await untilValue(
      win,
      "the seeded session's row offering Resume",
      `(${rowAct("resume")} ? "resume" : "")`,
      30_000,
      (value) => value === "resume",
    );
    renameSync(staged.work, aside);
    moved = true;
    await evaluate(NOTES_ARM);
    await evaluate(`(${rowAct("resume")}?.click(), "ok")`);
    const note = await heardNote(
      win,
      "Resume on a gone folder",
      ["Could not resume", "Resumed"],
      30_000,
    );
    if (!/^Could not resume — (its )?folder is gone$/u.test(note))
      throw new Error(`Resume on a gone folder said: ${note}`);
    const view = await evaluate(VIEW_NOW);
    if (view !== "history") throw new Error(`Resume on a gone folder moved the window to ${view}`);
    return { project: name, sessionId: session.sessionId, folder: staged.work, note, view };
  } finally {
    await evaluate(NOTES_OFF).catch(() => undefined);
    if (moved && existsSync(aside) && !existsSync(staged.work)) renameSync(aside, staged.work);
  }
}

const THEME_NOW = `document.documentElement.classList.contains("dark") ? "dark" : "light"`;

async function untilValue(
  win: BrowserWindow,
  label: string,
  expression: string,
  timeoutMs: number,
  accept: (value: string) => boolean,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = "";
  while (Date.now() < deadline) {
    seen = String(await win.webContents.executeJavaScript(expression));
    if (accept(seen)) return seen;
    await sleep(150);
  }
  throw new Error(`${label} did not happen within ${timeoutMs}ms (${seen})`);
}

/**
 * History by project, photographed light then dark (PJ-4's photos), then the
 * theme back to the run's own (Auto). It runs LAST, after the Peek's photos,
 * for the same reason those do: a theme round trip mid-run disturbed a later
 * rung's synthesized typing (peek-rungs.ts), so nothing runs after it.
 */
export async function historyByProjectPhotos(
  win: BrowserWindow,
  opts: { checked: boolean; name?: string | undefined; shotDir: string },
): Promise<Record<string, unknown>> {
  if (!opts.checked) return { unavailable: "History by project was not witnessed in this run" };
  const command = process.platform === "darwin" ? "meta" : "control";
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "3", modifiers: [command] });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "3", modifiers: [command] });
  await untilValue(win, "History, the view", VIEW_NOW, 10_000, (value) => value === "history");
  // the warm open reloaded the renderer since the rung chose the project: the
  // photographed room chooses it again, and its newest session, as a person does
  await untilValue(
    win,
    "the witnessed project and its session chosen for the photographs",
    chooseProject(opts.name ?? "", true),
    20_000,
    (value) => value === "chosen",
  );
  mkdirSync(opts.shotDir, { recursive: true });
  const shots: string[] = [];
  const seen: Record<string, unknown> = {};
  // what each photograph holds open (lane room's finding 2: the host's menus,
  // chips, sections and row acts, measured in happy-dom, seen in Electron):
  // the room at rest, ②'s New agent menu, ①'s desktop chip, ②'s agent chip
  // and ③'s folder list, the worktree opened for it (its toggle, then shut)
  const opens: ReadonlyArray<{ shot: string; trigger: string | null; worktree?: boolean }> = [
    { shot: "history-by-project", trigger: null },
    {
      shot: "history-new-agent",
      trigger: '.ah-hostact[data-place="head"][data-act="new-agent"]',
    },
    { shot: "history-folders", trigger: "button.ah-folderpick", worktree: true },
    { shot: "history-chip-desktop", trigger: 'button.ah-chipselect[data-filter="desktop"]' },
    { shot: "history-chip-agent", trigger: 'button.ah-chipselect[data-filter="agent"]' },
  ];
  const WORKTREE_TOGGLE = 'button[aria-label="Toggle the project worktree"]';
  const worktreeOpen = `(${HISTORY_ROOM}?.querySelector(${JSON.stringify(WORKTREE_TOGGLE)})?.getAttribute("aria-pressed") ?? "absent")`;
  const press = (selector: string): Promise<unknown> =>
    win.webContents.executeJavaScript(
      `(${HISTORY_ROOM}?.querySelector(${JSON.stringify(selector)})?.click(), "ok")`,
    );
  // A menu is opened as a person's pointer opens it (ROOM API v3: a synthetic
  // `.click()` reads as a key's, and a key's open rings its row): a real
  // press at the control's centre, sent into this window's page — the
  // smoke's own window, never the OS's input
  const pointAt = async (selector: string): Promise<void> => {
    const at = JSON.parse(
      String(
        await win.webContents.executeJavaScript(`(() => {
          const r = ${HISTORY_ROOM}?.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
          return JSON.stringify(r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null);
        })()`),
      ),
    ) as { x: number; y: number } | null;
    if (at === null) throw new Error(`nothing to press at ${selector}`);
    win.webContents.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: at.x,
      y: at.y,
      button: "left",
      clickCount: 1,
    });
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: at.x,
      y: at.y,
      button: "left",
      clickCount: 1,
    });
  };
  const drawn = `(() => {
    const room = ${HISTORY_ROOM};
    if (!room) return "{}";
    const words = (node) => (node?.textContent ?? "").replace(/\\s+/g, " ").trim();
    return JSON.stringify({
      sections: [...room.querySelectorAll(".ah-section[data-section], .ah-fold[data-section]")].map((node) => node.getAttribute("data-section") + ": " + words(node)),
      rowActs: [...room.querySelectorAll('.ah-hostact[data-place="row"]')].map((node) => node.getAttribute("data-act")),
      reasons: [...room.querySelectorAll(".ah-session-list-item__reason")].map(words),
      chips: [...room.querySelectorAll("button.ah-chipselect")].map(words),
      folder: room.querySelector("button.ah-folderpick")?.getAttribute("title") ?? null,
      menu: [...room.querySelectorAll(".ah-menu [role=menu] .ah-menu__item")].map((node) => (node.disabled ? "(off) " : "") + words(node)),
      // ROOM API v3: the menu hangs in the room's root, inside the room's box,
      // and a pointer's open rings no row
      layer: (() => {
        const menu = room.querySelector(":scope > .ah-menu[data-layer]");
        if (!menu) return null;
        const m = menu.getBoundingClientRect(), r = room.getBoundingClientRect();
        return { side: menu.getAttribute("data-side"), inside: m.left >= r.left && m.right <= r.right && m.top >= r.top && m.bottom <= r.bottom, ringed: [...menu.querySelectorAll(".ah-menu__item")].filter((node) => node.matches(":focus-visible")).length };
      })(),
    });
  })()`;
  for (const theme of ["light", "dark"] as const) {
    await win.webContents.executeJavaScript(`window.vibefield.theme.set(${JSON.stringify(theme)})`);
    await untilValue(win, `the ${theme} theme`, THEME_NOW, 5_000, (value) => value === theme);
    for (const open of opens) {
      let opened = false;
      if (open.worktree === true) {
        const now = String(await win.webContents.executeJavaScript(worktreeOpen));
        if (now === "absent") {
          seen[open.shot] = { unavailable: "this room offers no worktree here" };
          continue;
        }
        if (now === "false") {
          await press(WORKTREE_TOGGLE);
          await untilValue(win, "the worktree shown", worktreeOpen, 5_000, (v) => v === "true");
          opened = true;
        }
      }
      if (open.trigger !== null) {
        await pointAt(open.trigger);
        await untilValue(
          win,
          `${open.shot}'s menu open`,
          `(${HISTORY_ROOM}?.querySelector(".ah-menu [role=menu]") ? "open" : "")`,
          5_000,
          (value) => value === "open",
        );
      }
      await sleep(500);
      const path = join(opts.shotDir, `${open.shot}-${theme}.png`);
      writeFileSync(path, (await win.webContents.capturePage()).toPNG());
      shots.push(path);
      if (theme === "light")
        seen[open.shot] = JSON.parse(String(await win.webContents.executeJavaScript(drawn)));
      if (open.trigger !== null) {
        // Escape folds it (the room's own close)
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
        await untilValue(
          win,
          `${open.shot}'s menu folded`,
          `(${HISTORY_ROOM}?.querySelector(".ah-menu") ? "open" : "folded")`,
          5_000,
          (value) => value === "folded",
        );
      }
      if (opened) {
        await press(WORKTREE_TOGGLE);
        await untilValue(win, "the worktree shut", worktreeOpen, 5_000, (v) => v === "false");
      }
    }
  }
  await win.webContents.executeJavaScript(`window.vibefield.theme.set("auto")`);
  return { shots, seen };
}
