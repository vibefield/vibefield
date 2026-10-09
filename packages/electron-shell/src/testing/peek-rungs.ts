import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import { app, type BrowserWindow } from "electron";

// THE PEEK'S RUNGS in `pnpm smoke:godview` (GV-D8/D9/D10, 2026-10-08; DESIGN.md
// §8 "Search — the Peek"; the lane brief P1 §6). Both ride the History rung,
// after it has enrolled and opened the person's own seeded conversation
// (`openSeededSession`, typed-agent.ts' seed — build-hf L4):
//
//   · the GEOMETRY rung: ⌘F — a product chord while History is the view —
//     opens the frame's popup centred in the window at 900 × 560 (K6's clamp
//     otherwise), over the scrim, with the field (the cover AND the frame)
//     receded to 0.98 and out of reach; Esc folds it and the field comes back
//     to no transform at all (a resting transform would bury the head under
//     the drag strip);
//   · the SEEDED HIT rung: a word only the seeded reply says, found by the
//     real rosettad as Everything asks it; ⌘F, the word, the row read and the
//     popup photographed in light and dark (offscreen captures), then ↵ —
//     the room lands AT THE LINE (`data-hit` / `.is-landed`), the row's
//     newest matched line.
//
// Test-only by construction: this module rides the smoke bundle
// (dist/testing/smoke.cjs), which packaging omits.

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

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

/** ⌘<key> (Ctrl off the Mac) as a keyboard presses a command chord: down and
 * up, no character. */
function chord(win: BrowserWindow, keyCode: string): void {
  const modifiers: ("meta" | "control")[] = [process.platform === "darwin" ? "meta" : "control"];
  win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}

function key(win: BrowserWindow, keyCode: string): void {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode });
}

async function type(win: BrowserWindow, text: string): Promise<void> {
  for (const character of text) {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: character });
    win.webContents.sendInputEvent({ type: "char", keyCode: character });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: character });
    await sleep(30);
  }
}

const VIEW_NOW = `(document.querySelector(".vf-views-line")?.getAttribute("data-view") ?? "absent")`;

/** The popup's place and the field's recede, as the window draws them now. */
const PEEK_NOW = `(() => {
  const pop = document.querySelector('.vf-peek-pop[role="dialog"]');
  const wrap = document.querySelector(".field-wrap");
  const cover = document.querySelector(".vf-cover");
  const scrim = document.querySelector(".vf-peek-scrim");
  const c = cover ? cover.getBoundingClientRect() : null;
  const r = pop ? pop.getBoundingClientRect() : null;
  return JSON.stringify({
    open: pop !== null,
    width: r ? Math.round(r.width) : null,
    height: r ? Math.round(r.height) : null,
    left: r ? Math.round(r.left) : null,
    top: r ? Math.round(r.top) : null,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrimOpacity: scrim ? getComputedStyle(scrim).opacity : null,
    scrimFilter: scrim ? getComputedStyle(scrim).backdropFilter : null,
    coverScale: c ? Math.round((c.width / window.innerWidth) * 1000) / 1000 : null,
    wrapTransform: wrap ? getComputedStyle(wrap).transform : null,
    wrapInert: wrap ? wrap.inert === true : null,
    fieldFocused: pop !== null && document.activeElement === pop.querySelector("input"),
    button: document.querySelector(".vf-peek-button kbd")?.textContent ?? null,
    rows: pop ? pop.querySelectorAll('[role="option"]').length : 0,
    foot: pop?.querySelector(".vf-peek-said")?.textContent ?? null,
  });
})()`;

interface PeekNow {
  open: boolean;
  width: number | null;
  height: number | null;
  left: number | null;
  top: number | null;
  innerWidth: number;
  innerHeight: number;
  scrimOpacity: string | null;
  scrimFilter: string | null;
  coverScale: number | null;
  wrapTransform: string | null;
  wrapInert: boolean | null;
  fieldFocused: boolean;
  button: string | null;
  rows: number;
  foot: string | null;
}

/** The popup's size in this window, by the Peek's own law (K6). */
function expectedSize(now: PeekNow): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(900, now.innerWidth - 48)),
    height: Math.max(0, Math.min(560, now.innerHeight - 192)),
  };
}

const settled = (now: PeekNow): boolean => {
  const want = expectedSize(now);
  return (
    now.open &&
    now.width === want.width &&
    now.height === want.height &&
    now.scrimOpacity === "1" &&
    now.coverScale === 0.98
  );
};

/** ⌘F in History: the popup centred at 900 × 560, the scrim up, the field at
 * 0.98 and out of reach; Esc folds it all and the field rests untransformed. */
export async function peekGeometryRung(win: BrowserWindow): Promise<Record<string, unknown>> {
  const before = JSON.parse(await win.webContents.executeJavaScript(PEEK_NOW)) as PeekNow;
  if (before.button === null) throw new Error("the frame's search button is not in History");
  chord(win, "f");
  const open = JSON.parse(
    await untilValue(win, "⌘F opening the Peek, settled", PEEK_NOW, 10_000, (value) =>
      settled(JSON.parse(value) as PeekNow),
    ),
  ) as PeekNow;
  const want = expectedSize(open);
  const centredLeft = Math.round((open.innerWidth - want.width) / 2);
  const centredTop = Math.round((open.innerHeight - want.height) / 2);
  if (Math.abs((open.left ?? 0) - centredLeft) > 1 || Math.abs((open.top ?? 0) - centredTop) > 1) {
    throw new Error(
      `the Peek is not centred: at ${open.left},${open.top}, the window's centre puts it at ${centredLeft},${centredTop}`,
    );
  }
  if (!open.fieldFocused) throw new Error("⌘F opened the Peek without the caret in its field");
  if (open.wrapInert !== true) throw new Error("the field stayed in reach under the Peek");
  if (!(open.scrimFilter ?? "").includes("blur(18px)")) {
    throw new Error(`the scrim does not blur 18: ${open.scrimFilter}`);
  }
  key(win, "Escape");
  const closed = JSON.parse(
    await untilValue(win, "Esc folding the Peek, the field back", PEEK_NOW, 10_000, (value) => {
      const now = JSON.parse(value) as PeekNow;
      return !now.open && now.wrapTransform === "none" && now.scrimOpacity === "0";
    }),
  ) as PeekNow;
  return {
    button: before.button,
    size: `${open.width}×${open.height}`,
    window: `${open.innerWidth}×${open.innerHeight}`,
    centred: `${open.left},${open.top}`,
    scrim: { opacity: open.scrimOpacity, filter: open.scrimFilter },
    coverScale: open.coverScale,
    fieldInert: open.wrapInert,
    escFolded: !closed.open,
    restingTransform: closed.wrapTransform,
  };
}

interface SearchAnswer {
  answered: boolean;
  hits: Array<{ sessionId: string; rootSessionId?: string; timelineId: string; at?: number }>;
}

async function capture(win: BrowserWindow, path: string): Promise<string> {
  writeFileSync(path, (await win.webContents.capturePage()).toPNG());
  return path;
}

/** The real hit, over the person's own seeded conversation — enrolled and
 * opened by the History rung just before (typed-agent.ts' seed, build-hf L4):
 * a word only its reply says, found by the index unscoped as Everything asks,
 * then ⌘F in History, the word typed, the row read and photographed, and ↵ —
 * the room must land on the row's newest matched line. */
export async function peekSeededHitRung(
  win: BrowserWindow,
  opts: { handle: FielddHandle; seeded: boolean; word: string; shotDir?: string },
): Promise<Record<string, unknown>> {
  if (!opts.seeded) {
    return { unavailable: "the History rung seeded no conversation (no person, or no index)" };
  }
  const answer = (await opts.handle.client.request("index.search", {
    q: opts.word,
    scope: "local",
  })) as SearchAnswer;
  if (!answer.answered || answer.hits.length === 0) {
    throw new Error(`the index does not find “${opts.word}” in the seeded conversation`);
  }
  // The newest matched line of the root the Peek's first row names: where ↵ lands.
  const first = answer.hits[0];
  const root = first?.rootSessionId ?? first?.sessionId;
  const lands = answer.hits
    .filter((hit) => (hit.rootSessionId ?? hit.sessionId) === root)
    .sort(
      (a, b) => (b.at ?? Number.NEGATIVE_INFINITY) - (a.at ?? Number.NEGATIVE_INFINITY),
    )[0]?.timelineId;

  await untilValue(win, "History, the view", VIEW_NOW, 10_000, (value) => value === "history");
  chord(win, "f");
  await untilValue(win, "⌘F opening the Peek", PEEK_NOW, 10_000, (value) =>
    settled(JSON.parse(value) as PeekNow),
  );
  // the words stay between opens: clear what the field holds, then type
  await win.webContents.executeJavaScript(`document.querySelector('.vf-peek-pop input')?.select()`);
  await type(win, opts.word);
  const found = JSON.parse(
    await untilValue(win, "the Peek's row for the word", PEEK_NOW, 30_000, (value) => {
      const now = JSON.parse(value) as PeekNow;
      return now.rows > 0 && (now.foot ?? "").includes("matched");
    }),
  ) as PeekNow;
  const row = String(
    await win.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('.vf-peek-pop [role="option"]');
      const mark = row?.querySelector("mark");
      return JSON.stringify({
        title: row?.querySelector(".vf-peek-title")?.textContent ?? null,
        sub: row?.querySelector(".vf-peek-sub")?.textContent ?? null,
        lines: [...(row?.querySelectorAll(".vf-peek-ev") ?? [])].map((line) => line.textContent),
        marks: [...(row?.querySelectorAll("mark") ?? [])].map((each) => each.textContent),
        markInk: mark ? getComputedStyle(mark).color + " on " + getComputedStyle(mark).backgroundColor : null,
        peek: document.querySelector(".vf-peek-past-head b")?.textContent ?? null,
      });
    })()`),
  );
  // Photographs, light then dark, the popup over the receded room — then the
  // theme back to the run's own (Auto).
  const shots: string[] = [];
  if (opts.shotDir !== undefined) {
    mkdirSync(opts.shotDir, { recursive: true });
    const THEME_NOW = `document.documentElement.classList.contains("dark") ? "dark" : "light"`;
    for (const theme of ["light", "dark"] as const) {
      await win.webContents.executeJavaScript(
        `window.vibefield.theme.set(${JSON.stringify(theme)})`,
      );
      await untilValue(win, `the ${theme} theme`, THEME_NOW, 5_000, (value) => value === theme);
      await sleep(500);
      shots.push(await capture(win, join(opts.shotDir, `peek-${theme}.png`)));
    }
    await win.webContents.executeJavaScript(`window.vibefield.theme.set("auto")`);
  }
  // ↵ — the popup folds and the room lands on the line.
  key(win, "Return");
  const landed = await untilValue(
    win,
    "the room landing on the picked line",
    `(() => {
      if (document.querySelector('.vf-peek-pop[role="dialog"]')) return "popup still open";
      const slot = document.querySelector('[data-cover-view="history"]');
      const hit = slot?.querySelector("[data-timeline-id][data-hit], .is-landed");
      return hit ? hit.getAttribute("data-timeline-id") ?? "landed (no id)" : "not landed";
    })()`,
    30_000,
    (value) => value !== "popup still open" && value !== "not landed",
  );
  if (lands !== undefined && landed !== lands) {
    throw new Error(`the room landed on ${landed}, not the row's newest line ${lands}`);
  }
  return {
    word: opts.word,
    hits: answer.hits.length,
    rows: found.rows,
    foot: found.foot,
    row: JSON.parse(row) as unknown,
    landedOn: landed,
    ...(shots.length > 0 ? { shots } : {}),
  };
}

/** Where the Peek's photographs go: the run's own directory when it names
 * one, else a folder under the system's temporary directory. */
export function peekShotDir(): string {
  return process.env["VF_PEEK_SHOT_DIR"] ?? join(app.getPath("temp"), "vf-peek-shots");
}
