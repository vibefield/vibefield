import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IndexSessionsResult, ProjectListResult } from "@vibefield/contracts";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import type { BrowserWindow } from "electron";

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
    `(() => {
      const room = ${HISTORY_ROOM};
      if (!room) return "no room";
      const rows = [...room.querySelectorAll(".ah-project-list-item")];
      const row = rows.find((candidate) =>
        (candidate.querySelector(".ah-project-list-item__header strong")?.textContent ?? "").trim() ===
          ${JSON.stringify(opts.name ?? "")}) ?? rows[0];
      if (!row) return "no project row";
      if (!row.classList.contains("is-selected")) { row.click(); return "project"; }
      const session = room.querySelector(".ah-session-list-item");
      if (!session) return "no session row";
      if (!session.classList.contains("is-selected")) { session.click(); return "session"; }
      return "chosen";
    })()`,
    20_000,
    (value) => value === "chosen",
  );
  mkdirSync(opts.shotDir, { recursive: true });
  const shots: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    await win.webContents.executeJavaScript(`window.vibefield.theme.set(${JSON.stringify(theme)})`);
    await untilValue(win, `the ${theme} theme`, THEME_NOW, 5_000, (value) => value === theme);
    await sleep(500);
    const path = join(opts.shotDir, `history-by-project-${theme}.png`);
    writeFileSync(path, (await win.webContents.capturePage()).toPNG());
    shots.push(path);
  }
  await win.webContents.executeJavaScript(`window.vibefield.theme.set("auto")`);
  return { shots };
}
