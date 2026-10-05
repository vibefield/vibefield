// DK-10 — THE TRY BOARD: a plugin author's kinds DRAWN in the product (the ten-minute bar's last step).
//
// Before the pegboard (DK-13) nothing a person can do lays an object of a plugin's kind, and the kit's checks never
// compile a kind's WGSL (they READ it; the still that compiles waits on the pin). So `vibefield-plugin try <dir>` (and
// `pnpm smoke:plugin` from a checkout) stages the plugin in a dev root of its own (`FIELDD_PLUGIN_DEV_ROOTS`, DK-9's
// way) and runs smoke:canvas with `--try`: the renderer loads with `?deskTry=<types>` (field-app `SEED_TRY`), so the
// first board lays ONE object of each of the plugin's kinds, alone, framed by the arrival fit — and these rows hold
// each one DRAWN, the way the CLOCK row holds the example plugin's: on the board, its kind made on the host's device
// (not refused at create — its WGSL compiled — nor struck), and PICKED where it lies on the presented frame. The stills
// are the author's: the board and each object, by day and by night. A desk that never comes to rest with the kind on
// it is SAID (a kind whose `tick` answers no `due` keeps the whole desk awake), never failed: an animated kind may.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { BrowserWindow } from "electron";

/** The flag `smoke:plugin` passes after `--smoke-canvas`: run the try board's rows instead of the canvas witnesses. */
export const TRY_FLAG = "--try";

/** The types to lay, comma-separated (`vibefield-plugin try` sets it from the plugin's manifest). */
export const TRY_TYPES_ENV = "VF_SMOKE_TRY";

/** The renderer's URL door (field-app `field/desk/desk-seed.ts` `SEED_TRY` — restated: the shell imports no field-app). */
export const TRY_SEARCH_KEY = "deskTry";

/** The most types one try board lays (field-app `SEED_TRY_MAX`). */
export const TRY_MAX = 16;

/** Every object type the plugins under a PATH-style list of dev roots declare (each root's child directories that hold a
 * `vibefield.plugin.json`), in root order then directory order — what `smoke:plugin` lays when no type is named. */
export function devRootObjectTypes(roots: string | undefined): string[] {
  const types: string[] = [];
  for (const root of (roots ?? "").split(delimiter).filter((r) => r.length > 0)) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).sort()) {
      const manifestPath = join(root, name, "vibefield.plugin.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          contributes?: { objects?: { type?: unknown }[] };
        };
        for (const row of manifest.contributes?.objects ?? []) {
          if (typeof row.type === "string" && !types.includes(row.type)) types.push(row.type);
        }
      } catch {
        // a manifest that does not parse is fieldd's to refuse, and the run's log says why
      }
    }
  }
  return types;
}

/** The try board's types: `VF_SMOKE_TRY` when named, else every object type under `FIELDD_PLUGIN_DEV_ROOTS`. */
export function tryTypes(env: NodeJS.ProcessEnv): { types: string[]; from: "env" | "dev-roots" } {
  const named = (env[TRY_TYPES_ENV] ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t, i, all) => t.length > 0 && all.indexOf(t) === i);
  if (named.length > 0) return { types: named.slice(0, TRY_MAX), from: "env" };
  return {
    types: devRootObjectTypes(env["FIELDD_PLUGIN_DEV_ROOTS"]).slice(0, TRY_MAX),
    from: "dev-roots",
  };
}

/** A file name for a type's still: its characters a path keeps. */
export function stillName(type: string, theme: string): string {
  return `try-${type.replaceAll(/[^A-Za-z0-9._-]/g, "_")}-${theme}.png`;
}

/** Where one type was picked on the presented frame: the box of the scan's hits, CSS px in window coordinates. */
interface PickedBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly hits: number;
  readonly parts: readonly string[];
}

interface Seen {
  readonly faults: readonly { readonly kind?: unknown; readonly reason?: unknown }[];
  readonly boxes: Readonly<Record<string, PickedBox>>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Keep one still's path under its subject (the board, or a type) and theme. */
function keep(
  stills: Record<string, Record<string, string>>,
  subject: string,
  theme: string,
  path: string,
): void {
  const row = stills[subject] ?? {};
  row[theme] = path;
  stills[subject] = row;
}

async function until(
  win: BrowserWindow,
  label: string,
  timeoutMs: number,
  expression: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await win.webContents.executeJavaScript(expression, true)) === true) return;
    await sleep(100);
  }
  throw new Error(`${label} did not happen within ${timeoutMs}ms`);
}

/**
 * The try board's rows, after DESK_READY: the board's census (each type once), each type DRAWN (not faulted, picked),
 * the stills by day and by night (the whole window and each object), and the rest it comes to. Returns the problems —
 * each says what was seen and what would make it pass.
 */
export async function tryBoardRows(
  win: BrowserWindow,
  types: readonly string[],
  shotDir: string | undefined,
  say: (line: string) => void,
): Promise<string[]> {
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const problems: string[] = [];

  // THE BOARD — one of each, laid by the first board's seed (`?deskTry=`); a type the desk did not lay is named with why
  let census: Record<string, number> = {};
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    census =
      (await js<Record<string, number> | null>("globalThis.__vfDesk?.census() ?? null")) ?? {};
    if (types.every((type) => (census[type] ?? 0) >= 1)) break;
    await sleep(100);
  }
  const registered = await js<string[]>("globalThis.__vfFieldSmoke?.widgetTypes() ?? []");
  say(
    `SMOKE_TRY_BOARD ${JSON.stringify({ types, census, registered: types.filter((t) => registered.includes(t)) })}`,
  );
  for (const type of types) {
    if ((census[type] ?? 0) >= 1) continue;
    problems.push(
      registered.includes(type)
        ? `${type} is registered but the desk did not lay it — the row must provide "desk.object" (the desk places by what a row provides)`
        : `${type} is not registered with the desk — its plugin was not staged, or the host refused its row (the run's log says why)`,
    );
  }

  // let the board settle under the arrival fit before reading what was drawn
  const frames = await js<number>("globalThis.__vfDesk.perf().frames");
  await until(
    win,
    "a frame drawn on the try board",
    10_000,
    `globalThis.__vfDesk.perf().frames > ${frames + 2}`,
  );
  await sleep(300);

  // DRAWN — its kind not refused at create nor quarantined (`status().faults`), and PICKED on the presented frame: a scan
  // of the view at 6 CSS px; the box of its hits is where the desk drew it (the kind's `hit` mirrors its pass)
  const seen = await js<Seen>(`(() => {
    const d = globalThis.__vfDesk;
    const el = document.querySelector("[data-desk]");
    const box = el === null ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : el.getBoundingClientRect();
    const boxes = {};
    for (let y = 3; y < box.height; y += 6)
      for (let x = 3; x < box.width; x += 6) {
        const hit = d.pick({ x, y });
        if (hit === null || typeof hit.type !== "string") continue;
        const wx = box.left + x, wy = box.top + y;
        const b = boxes[hit.type] ?? (boxes[hit.type] = { x0: wx, y0: wy, x1: wx, y1: wy, hits: 0, parts: [] });
        b.x0 = Math.min(b.x0, wx); b.y0 = Math.min(b.y0, wy); b.x1 = Math.max(b.x1, wx); b.y1 = Math.max(b.y1, wy);
        b.hits += 1;
        if (!b.parts.includes(hit.part)) b.parts.push(hit.part);
      }
    return { faults: d.status().faults ?? [], boxes };
  })()`);

  // THE STILLS — the board and each object, by day and by night (the app's theme owner, as the canvas row does it)
  const stills: Record<string, Record<string, string>> = {};
  for (const theme of ["light", "dark"] as const) {
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(theme)})`);
    await until(
      win,
      `the desk dressed ${theme}`,
      10_000,
      `globalThis.__vfDesk.theme() === ${JSON.stringify(theme)}`,
    );
    const from = await js<number>("globalThis.__vfDesk.perf().frames");
    await until(
      win,
      `a frame drawn ${theme}`,
      10_000,
      `globalThis.__vfDesk.perf().frames > ${from}`,
    );
    await sleep(400);
    if (shotDir === undefined) continue;
    mkdirSync(shotDir, { recursive: true });
    const board = join(shotDir, `try-board-${theme}.png`);
    writeFileSync(board, (await win.capturePage()).toPNG());
    keep(stills, "board", theme, board);
    for (const type of types) {
      const b = seen.boxes[type];
      if (b === undefined) continue;
      // the hits are where the kind's `hit` answers — its drawing (a shadow, a point past the pick) reaches further
      const pad = Math.round(24 + 0.3 * Math.max(b.x1 - b.x0, b.y1 - b.y0));
      const rect = {
        x: Math.max(0, Math.floor(b.x0 - pad)),
        y: Math.max(0, Math.floor(b.y0 - pad)),
        width: Math.ceil(b.x1 - b.x0 + 2 * pad),
        height: Math.ceil(b.y1 - b.y0 + 2 * pad),
      };
      const path = join(shotDir, stillName(type, theme));
      writeFileSync(path, (await win.capturePage(rect)).toPNG());
      keep(stills, type, theme, path);
    }
  }
  say(`SMOKE_TRY_STILLS ${JSON.stringify(stills["board"] ?? null)}`);

  // EACH TYPE'S ROW — the line `vibefield-plugin try` reads
  for (const type of types) {
    const faults = seen.faults.filter((fault) => fault.kind === type);
    const picked = seen.boxes[type] ?? null;
    say(
      `SMOKE_TRY_OBJECT ${JSON.stringify({ type, census: census[type] ?? 0, faults, picked, stills: stills[type] ?? null })}`,
    );
    if ((census[type] ?? 0) < 1) continue; // said above, with why
    if (faults.length > 0) {
      problems.push(
        `the desk refused ${type}'s kind: ${faults.map((f) => String(f.reason)).join(" · ")} — it wears the missing face`,
      );
    } else if (picked === null) {
      problems.push(
        `${type} was laid but not picked on the drawn frame — the desk drew nothing of it where it lies, or its hit() misses what its pass draws`,
      );
    }
  }

  // AT REST — the desk with the kind on it comes to rest (zero steps until something is due), read after the stills'
  // theme flips have settled: a fact, never a failure. A try kind is NAMED only when its own row in the desk's `due()`
  // asks for a time (its local()'s `due`) while the desk never sleeps — the rest of the desk's wakes are not the author's.
  type Rest = { asleep?: unknown; due?: { kinds?: Record<string, unknown> } } | null;
  let rest: Rest = null;
  const restBy = Date.now() + 20_000;
  while (Date.now() < restBy) {
    rest = await js<Rest>("globalThis.__vfDesk.rest()");
    if (rest?.asleep === true) break;
    await sleep(250);
  }
  const asleep = rest?.asleep === true;
  const kinds = rest?.due?.kinds ?? {};
  const awake = types.filter((type) => {
    const at = kinds[type];
    return typeof at === "number" && Number.isFinite(at) && at >= 0;
  });
  say(`SMOKE_TRY_REST ${JSON.stringify({ asleep, awake, rest })}`);
  if (!asleep && awake.length > 0) {
    say(
      `SMOKE_TRY_NOTE the desk did not come to rest within 20 s, and ${awake.join(", ")} asks for frames — a kind whose local() ticks must answer due(now) with the next time it needs a frame (Infinity when nothing moves), or the whole desk draws every frame`,
    );
  }
  return problems;
}
