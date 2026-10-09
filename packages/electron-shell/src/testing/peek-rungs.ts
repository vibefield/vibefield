import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import { app, type BrowserWindow } from "electron";
import { HISTORY_SEED_WORDS } from "./typed-agent";

// THE PEEK'S RUNGS in `pnpm smoke:godview` (GV-D8/D9/D10, 2026-10-08; DESIGN.md
// §8 "Search — the Peek"; the lane brief P1 §6). Both ride the History rung,
// after it has enrolled and opened the person's own seeded conversation
// (`openSeededSession`, typed-agent.ts' seed — build-hf L4):
//
//   · the GEOMETRY rung: ⌘F — a product chord while History is the view —
//     opens the frame's popup centred in the window at 900 × 560 (K6's clamp
//     otherwise), over the scrim, with what you see (the still, the cover AND
//     the frame — `.field-recede`) receded to 0.98, the desk's own box never
//     transformed (DK-15), and the field out of reach; Esc folds it and the box
//     comes back to no transform at all (a resting transform would bury the
//     head under the drag strip) — inert at rest: no stacking context, no
//     pointer of its own, every child positioned;
//   · the SEEDED HIT rung: a word only the seeded reply says, found by the
//     real rosettad as Everything asks it; ⌘F, the word, the row read, then
//     ↵ — the room lands AT THE LINE (`data-hit` / `.is-landed`), the row's
//     newest matched line.
//
// And a third, LAST in the smoke: the popup photographed in light and dark
// holding that word (offscreen captures) — last because its theme round trip
// disturbs a later rung (`peekPhotosRung`).
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
  const recede = document.querySelector(".field-recede");
  const scene = document.querySelector(".field-scene");
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
    recedeTransform: recede ? getComputedStyle(recede).transform : null,
    sceneTransform: scene ? getComputedStyle(scene).transform : null,
    // the desk's box as DRAWN against its layout: every transform above it
    // counts here, its own computed transform alone would miss the field's
    sceneDrawn: scene && scene.offsetWidth > 0 ? Math.round((scene.getBoundingClientRect().width / scene.offsetWidth) * 1000) / 1000 : null,
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
  recedeTransform: string | null;
  sceneTransform: string | null;
  sceneDrawn: number | null;
  wrapInert: boolean | null;
  fieldFocused: boolean;
  button: string | null;
  rows: number;
  foot: string | null;
}

/** The scale a computed `transform` draws at (its matrix's a), 1 for none. */
function scaleOf(transform: string | null): number | null {
  if (transform === null) return null;
  if (transform === "none") return 1;
  const a = /^matrix\(([^,]+),/.exec(transform)?.[1];
  return a === undefined ? Number.NaN : Number(a);
}

/** The recede's box at rest, as the window stacks and hits it (DK-15 × GV-D8):
 * no transform and nothing else that makes a stacking context, no pointer of
 * its own, every child of it positioned (so none paints or hits in a new place
 * for being inside it), and no point of the window hits the box itself. */
const RESTING_NOW = `(() => {
  const recede = document.querySelector(".field-recede");
  if (!recede) return JSON.stringify({ present: false });
  const style = getComputedStyle(recede);
  const children = [...recede.children].map((child) => {
    const own = getComputedStyle(child);
    const box = child.getBoundingClientRect();
    return { tag: child.tagName.toLowerCase(), cls: String(child.className).slice(0, 40), position: own.position, display: own.display, area: Math.round(box.width * box.height) };
  });
  const points = [];
  for (const fx of [0.05, 0.5, 0.95]) for (const fy of [0.08, 0.5, 0.92]) points.push([Math.round(innerWidth * fx), Math.round(innerHeight * fy)]);
  const hitsBox = points.filter(([x, y]) => document.elementFromPoint(x, y) === recede).length;
  return JSON.stringify({
    present: true,
    transform: style.transform,
    zIndex: style.zIndex,
    opacity: style.opacity,
    filter: style.filter,
    isolation: style.isolation,
    willChange: style.willChange,
    pointerEvents: style.pointerEvents,
    children: children.length,
    unpositioned: children.filter((c) => c.position === "static" && c.display !== "none" && c.area > 0),
    sceneOutside: !recede.contains(document.querySelector(".field-scene")),
    hitsBox,
    points: points.length,
  });
})()`;

interface RestingNow {
  present: boolean;
  transform?: string;
  zIndex?: string;
  opacity?: string;
  filter?: string;
  isolation?: string;
  willChange?: string;
  pointerEvents?: string;
  children?: number;
  unpositioned?: unknown[];
  sceneOutside?: boolean;
  hitsBox?: number;
  points?: number;
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
  // GV-D8 × DK-15: NO transform reaches the desk's own box or the field's
  // wrapper — the scene's own transform rests at scale(1) (the sheets' recede,
  // base.css): identity, never a recede, and the box is drawn at its layout
  // size, nothing above it scaling it…
  if (
    scaleOf(open.sceneTransform) !== 1 ||
    open.sceneDrawn !== 1 ||
    open.wrapTransform !== "none"
  ) {
    throw new Error(
      `a transform reached the desk's box under the Peek: scene ${open.sceneTransform} drawn at ${open.sceneDrawn}, wrap ${open.wrapTransform}`,
    );
  }
  // …while what you see recedes: the still and the chrome, the cover with it
  const recedeScale = scaleOf(open.recedeTransform);
  if (recedeScale === null || Math.abs(recedeScale - 0.98) > 0.001) {
    throw new Error(`the still and the chrome did not recede to 0.98: ${open.recedeTransform}`);
  }
  if (!(open.scrimFilter ?? "").includes("blur(18px)")) {
    throw new Error(`the scrim does not blur 18: ${open.scrimFilter}`);
  }
  key(win, "Escape");
  const closed = JSON.parse(
    await untilValue(win, "Esc folding the Peek, the field back", PEEK_NOW, 10_000, (value) => {
      const now = JSON.parse(value) as PeekNow;
      return !now.open && now.recedeTransform === "none" && now.scrimOpacity === "0";
    }),
  ) as PeekNow;
  // …and at rest the recede's box changes nothing: no stacking context, no
  // pointer of its own, every child positioned, no point hitting the box
  const resting = JSON.parse(await win.webContents.executeJavaScript(RESTING_NOW)) as RestingNow;
  if (
    !resting.present ||
    resting.transform !== "none" ||
    resting.zIndex !== "auto" ||
    resting.opacity !== "1" ||
    resting.filter !== "none" ||
    resting.isolation !== "auto" ||
    resting.willChange !== "auto" ||
    resting.pointerEvents !== "none" ||
    (resting.unpositioned?.length ?? 1) !== 0 ||
    resting.sceneOutside !== true ||
    resting.hitsBox !== 0
  ) {
    throw new Error(`the recede's box is not inert at rest: ${JSON.stringify(resting)}`);
  }
  return {
    button: before.button,
    size: `${open.width}×${open.height}`,
    window: `${open.innerWidth}×${open.innerHeight}`,
    centred: `${open.left},${open.top}`,
    scrim: { opacity: open.scrimOpacity, filter: open.scrimFilter },
    coverScale: open.coverScale,
    fieldInert: open.wrapInert,
    recede: {
      open: open.recedeTransform,
      scene: open.sceneTransform,
      sceneDrawn: open.sceneDrawn,
      wrap: open.wrapTransform,
    },
    escFolded: !closed.open,
    restingTransform: closed.recedeTransform,
    resting: {
      children: resting.children,
      unpositioned: resting.unpositioned?.length,
      hitsBox: `${resting.hitsBox}/${resting.points}`,
      pointerEvents: resting.pointerEvents,
      zIndex: resting.zIndex,
    },
  };
}

/** A word only the seeded conversation's reply says (`HISTORY_SEED_WORDS`). */
export const PEEK_SEED_WORD = "harbour";
if (!HISTORY_SEED_WORDS.split(/\s+/).includes(PEEK_SEED_WORD)) {
  throw new Error(`the seeded reply no longer says “${PEEK_SEED_WORD}”`);
}

interface SearchAnswer {
  answered: boolean;
  hits: Array<{ sessionId: string; rootSessionId?: string; timelineId: string; at?: number }>;
}

async function capture(win: BrowserWindow, path: string): Promise<string> {
  writeFileSync(path, (await win.webContents.capturePage()).toPNG());
  return path;
}

/** ⌘F in History and the word typed into the Peek's field, until a row for
 * it is listed and the foot counts what matched. */
async function searchInPeek(win: BrowserWindow, word: string): Promise<PeekNow> {
  await untilValue(win, "History, the view", VIEW_NOW, 10_000, (value) => value === "history");
  chord(win, "f");
  await untilValue(win, "⌘F opening the Peek", PEEK_NOW, 10_000, (value) =>
    settled(JSON.parse(value) as PeekNow),
  );
  // the words stay between opens: select what the field holds, then type
  await win.webContents.executeJavaScript(`document.querySelector('.vf-peek-pop input')?.select()`);
  await type(win, word);
  return JSON.parse(
    await untilValue(win, "the Peek's row for the word", PEEK_NOW, 30_000, (value) => {
      const now = JSON.parse(value) as PeekNow;
      return now.rows > 0 && (now.foot ?? "").includes("matched");
    }),
  ) as PeekNow;
}

/** The real hit, over the person's own seeded conversation — enrolled and
 * opened by the History rung just before (typed-agent.ts' seed, build-hf L4):
 * a word only its reply says, found by the index unscoped as Everything asks,
 * then ⌘F in History, the word typed, the row read, and ↵ — the room must land
 * on the row's newest matched line. */
export async function peekSeededHitRung(
  win: BrowserWindow,
  opts: { handle: FielddHandle; seeded: boolean; word: string },
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

  const found = await searchInPeek(win, opts.word);
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
  };
}

/** The Peek photographed, light then dark, holding the seeded word over the
 * receded room — then the theme back to the run's own (Auto) and the popup
 * folded. LAST in the smoke, on purpose: a theme round trip through
 * `window.vibefield.theme.set` mid-run made a later rung's synthesized ⇧1
 * type nothing into the line's draft (2 of 2 runs; the same captures without
 * the round trip passed), so nothing runs after it. */
export async function peekPhotosRung(
  win: BrowserWindow,
  opts: { seeded: boolean; word: string; shotDir: string },
): Promise<Record<string, unknown>> {
  if (!opts.seeded) {
    return { unavailable: "the History rung seeded no conversation (no person, or no index)" };
  }
  chord(win, "3");
  const found = await searchInPeek(win, opts.word);
  mkdirSync(opts.shotDir, { recursive: true });
  const THEME_NOW = `document.documentElement.classList.contains("dark") ? "dark" : "light"`;
  const shots: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    await win.webContents.executeJavaScript(`window.vibefield.theme.set(${JSON.stringify(theme)})`);
    await untilValue(win, `the ${theme} theme`, THEME_NOW, 5_000, (value) => value === theme);
    await sleep(500);
    shots.push(await capture(win, join(opts.shotDir, `peek-${theme}.png`)));
  }
  await win.webContents.executeJavaScript(`window.vibefield.theme.set("auto")`);
  key(win, "Escape");
  await untilValue(win, "Esc folding the photographed Peek", PEEK_NOW, 10_000, (value) => {
    const now = JSON.parse(value) as PeekNow;
    return !now.open && now.recedeTransform === "none";
  });
  return { word: opts.word, rows: found.rows, shots };
}

/** Where the Peek's photographs go: the run's own directory when it names
 * one, else a folder under the system's temporary directory. */
export function peekShotDir(): string {
  return process.env["VF_PEEK_SHOT_DIR"] ?? join(app.getPath("temp"), "vf-peek-shots");
}
