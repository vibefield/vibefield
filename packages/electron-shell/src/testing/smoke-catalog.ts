// FG — THE CATALOG JUDGED (desk-gates row 32's fourth walk, `catalog`; VF-PM 2026-11-01 02:17Z). The design catalog's
// Setup Assistant frames (OnboardingPreview: the shipping panes on the shipping glass over the field's still), every
// face their controls offer, by DAY and then by NIGHT through the catalog's own toggle, each judged by row 32's own
// measure: its words found by the same finder (`PAGE_WORDS`), cut from the frame's capture and held at §8's 4.5:1
// (`inkCuts`, `firstRunContrast`, `judgeContrast`). It reaches the faces no live walk does, the wizard's error line among
// them (02's refusal, A4's and A5's: `--vf-wizard-ink-attention`, set by arithmetic until now and never measured).
//
// One launch in main's smoke-first-run mode, its product window never made: the walk's window stands on a partition of
// its own, in memory (`CATALOG_PARTITION`), whose app scheme serves the design build `build:design` writes and
// production never reads (`VF_CATALOG_RENDERER`, the launcher's `.vibefield/studio/catalog-renderer`); a missing
// build is red. Its content is wide enough that each frame stands at FG-L2's ground or more (976 × 736; the frame's
// height is that floor, scenes.css), so the glass stands at its own size: a face whose glass is scaled is red, never
// judged small. A choice is the control's own click in the page: nothing here is a person's input.
//
// What else it judges: each frame faced in both themes and both themes meeting as many faces; the error line standing
// on its three faces in both; and DESIGN.md §2.4's ramp (item 127) in pixels, the catalog's "Text ramp" chips (each
// tier on each chrome ground of the theme) held to their floors, 4.5:1 for a word that is read, 3:1 for t4's marks.
// Every face's still is kept (JPEG) in `VF_SMOKE_SHOT_DIR`, named by its face (`catalogShot`).
//
// A still document (item 264): the catalog animates every scroll (`html { scroll-behavior: smooth }`), and three of its
// views keep themselves in view as they mount, so each theme's first capture waits until the document has rested a
// whole `CATALOG.stillMs`, and every capture is bracketed by the document's position: from a face's settled read (its
// settle inside the bracket) or from just before the ramp's capture, to just after it. A face (or the ramp) the
// document moved during is walked again once, after the document rests again, and named in the facts' `recaptured`;
// a second move is red. Every capture that failed is kept in the facts' `captureFailures`, and one that failed on a
// still document stops the walk. Each theme's wait says what it read, its margin line (`CATALOG_STILL`).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow, NativeImage } from "electron";
import { cutChip, measureChip } from "./smoke-contrast";
import {
  type Box,
  FIRST_RUN,
  firstRunContrast,
  type InkCut,
  type InksSeen,
  inkCuts,
  judgeContrast,
  PAGE_WORDS,
  type WordSeen,
} from "./smoke-first-run";

/** The walk's numbers. */
export const CATALOG = {
  /** the window's content: the catalog in its one column, each frame at least FG-L2's 976 wide and its 736 whole */
  window: { width: 1600, height: 900 },
  /** the design build's page (vite.config.ts's design mode) */
  page: "design-system.html",
  /** the Setup Assistant's frames in the catalog: 01–08 and A1–A6 */
  frames: 13,
  /** the catalog standing, its frames and its Text ramp */
  readyMs: 30_000,
  /** a face standing whole after its choice: the pane swapped, nothing moving but what loops */
  faceMs: 10_000,
  /** a choice said, its pane's swap begins within this */
  swapMs: 120,
  /** a face settled (or the theme turned), its capture waits this long for the compositor's frames */
  settleMs: 150,
  /** the document at rest this long before each theme's first capture (item 264) */
  stillMs: 1_000,
  /** the document's position read this often while the walk waits for it to rest */
  stillPollMs: 100,
  /** the kept stills, for the eye */
  jpegQuality: 82,
} as const;

/** Where the launcher names the design build (`build:design`'s out dir). */
export const CATALOG_RENDERER_ENV = "VF_CATALOG_RENDERER";

/** The walk's window's partition: in memory (no `persist:`), so the catalog leaves nothing in the profile. */
export const CATALOG_PARTITION = "vf-catalog-walk";

/** The faces that stand the wizard's error line (`WizardError`, role="alert"): You's refusal, and Setting up's two. */
export const CATALOG_ERRORS: readonly {
  readonly index: string;
  readonly preview: string;
  readonly choices: readonly string[];
}[] = [
  { index: "02", preview: "field", choices: ["error"] },
  { index: "A4", preview: "setting-up-write-failed", choices: [] },
  { index: "A5", preview: "setting-up-desk-failed", choices: [] },
];

export type CatalogTheme = "day" | "night";

/** A face by its theme, its frame (its index and `data-onboarding-preview`) and the choices that stand it. */
export function catalogAt(face: {
  readonly theme: CatalogTheme;
  readonly index: string;
  readonly preview: string;
  readonly choices: readonly string[];
}): string {
  const by = face.choices.length === 0 ? "" : ` (${face.choices.join(", ")})`;
  return `${face.theme} ${face.index} ${face.preview}${by}`;
}

/** A face's still, the walk's `n`th, named after it. */
export function catalogShot(n: number, at: string): string {
  const name = at
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return `${String(n).padStart(3, "0")}-${name}.jpg`;
}

/** The document's position as the walk read it (`scrollTop()`, CSS px), `at` ms into its wait. */
export interface ScrollReading {
  readonly at: number;
  readonly top: number | null;
}

/** Since when the document has rested, once it has rested `quietMs` or more by the last reading: the first reading of
 * the run at the last one's position. A position the page could not read never rests. */
export function stillSince(readings: readonly ScrollReading[], quietMs: number): number | null {
  const last = readings.at(-1);
  if (last === undefined || last.top === null) return null;
  let since = last.at;
  for (let i = readings.length - 1; i >= 0; i--) {
    const reading = readings[i];
    if (reading === undefined || reading.top !== last.top) break;
    since = reading.at;
  }
  return last.at - since >= quietMs ? since : null;
}

/** Whether the document held through a capture, read on its either side; a position the page could not read never
 * held. */
const held = (before: number | null, after: number | null): boolean =>
  before !== null && before === after;

/** A move during a capture in the walk's words, or null when the document held; `times` 2 is the capture walked
 * again. */
export function movedDuring(
  at: string,
  before: number | null,
  after: number | null,
  times: 1 | 2 = 1,
): string | null {
  if (held(before, after)) return null;
  const twice = times === 2 ? ", twice" : "";
  return `on ${at} the catalog's document moved during the capture (${before} → ${after})${twice}`;
}

/** The words of a face read off the frame's own capture (`capturePage` over `frame`): every box moved from the
 * window onto the frame, then cut as row 32 cuts them (`inkCuts`, against `before`, the page read on the capture's
 * other side). */
export function catalogCuts(
  at: string,
  bitmap: Uint8Array,
  frame: Box,
  seen: Pick<InksSeen, "view" | "words">,
  before: Pick<InksSeen, "view" | "words"> | null,
): InkCut[] {
  const moved = <B extends Box>(b: B): B => ({ ...b, x: b.x - frame.x, y: b.y - frame.y });
  const onFrame = (read: Pick<InksSeen, "words">): InksSeen => ({
    view: { width: frame.width, height: frame.height },
    wizard: true,
    field: null,
    canvas: null,
    stage: null,
    words: read.words.map(
      (word): WordSeen => ({
        ...moved(word),
        lines: word.lines.map(moved),
        list: word.list === null ? null : moved(word.list),
      }),
    ),
  });
  return inkCuts(at, bitmap, onFrame(seen), ["words"], before === null ? null : onFrame(before));
}

/** A face as the walk met it: where it stood, the glass's fit in its frame, and the error line's words where one
 * stood. */
export interface CatalogFace {
  readonly at: string;
  readonly theme: CatalogTheme;
  readonly index: string;
  readonly preview: string;
  readonly choices: readonly string[];
  readonly fit: number | null;
  readonly alert: string | null;
}

/** The catalog's faces judged: each glass at its own size (FG-L2's ground), every frame faced in each theme, the
 * error line standing on its faces in each, and both themes meeting as many faces. */
export function judgeCatalog(faces: readonly CatalogFace[]): string[] {
  const problems: string[] = [];
  for (const face of faces) {
    if (face.fit === null) problems.push(`on ${face.at} the glass's fit could not be read`);
    else if (face.fit < 0.999)
      problems.push(
        `on ${face.at} the glass stands at fit ${face.fit}, under its own size (FG-L2's ground of 976 × 736)`,
      );
  }
  const count: Record<CatalogTheme, number> = { day: 0, night: 0 };
  for (const theme of ["day", "night"] as const) {
    const met = faces.filter((face) => face.theme === theme);
    count[theme] = met.length;
    const frames = new Set(met.map((face) => face.index)).size;
    if (frames !== CATALOG.frames)
      problems.push(`by ${theme} the catalog showed ${frames} frames, not ${CATALOG.frames}`);
    for (const error of CATALOG_ERRORS) {
      const stood = met.some(
        (face) =>
          face.index === error.index &&
          face.choices.join("\n") === error.choices.join("\n") &&
          face.alert !== null,
      );
      if (!stood) {
        const at = catalogAt({ theme, ...error }).slice(theme.length + 1);
        problems.push(`by ${theme} the wizard's error line never stood on ${at}`);
      }
    }
  }
  if (count.day !== count.night)
    problems.push(`the walk met ${count.day} faces by day and ${count.night} by night`);
  return problems;
}

/** The catalog's "Text ramp" as the page reads it (DESIGN.md §2.4): the window's size, the specimen's box, and each
 * chip, its tier on its ground with its floor and the box its glyphs take, in CSS px of the window. */
export interface RampSeen {
  readonly view: { readonly width: number; readonly height: number };
  readonly box: Box;
  readonly chips: readonly (Box & {
    readonly tier: string;
    readonly ground: string;
    readonly floor: number;
    readonly text: string;
    readonly shown: number;
  })[];
}

/** A chip of the ramp as DK-16 measured the mat's (`measureChip`): its ground and ink as measured and their ratio, or
 * nulls where its capture could not give it up. */
export interface RampReading {
  readonly theme: CatalogTheme;
  readonly tier: string;
  readonly ground: string;
  readonly floor: number;
  readonly ratio: number | null;
  readonly ink: readonly [number, number, number] | null;
  readonly groundRgb: readonly [number, number, number] | null;
}

/** The ramp's chips read off the specimen's own capture (`capturePage` over `ramp.box`). */
export function rampReadings(
  theme: CatalogTheme,
  bitmap: Uint8Array,
  ramp: RampSeen,
): RampReading[] {
  const view = { width: ramp.box.width, height: ramp.box.height };
  return ramp.chips.map(({ tier, ground, floor, ...chip }) => {
    const px = cutChip(bitmap, view, {
      x: chip.x - ramp.box.x,
      y: chip.y - ramp.box.y,
      width: chip.width,
      height: chip.height,
    });
    if (px === null) return { theme, tier, ground, floor, ratio: null, ink: null, groundRgb: null };
    const read = measureChip(px);
    return { theme, tier, ground, floor, ratio: read.ratio, ink: read.ink, groundRgb: read.ground };
  });
}

/** DESIGN.md §2.4 in pixels: each chip at its tier's floor or more on its ground; one its capture could not give up
 * is red as unread. */
export function judgeRamp(readings: readonly RampReading[]): string[] {
  const problems: string[] = [];
  for (const r of readings) {
    const at = `by ${r.theme} ${r.tier} on ${r.ground}`;
    if (r.ratio === null) problems.push(`${at} could not be cut from its capture`);
    else if (r.ratio < r.floor)
      problems.push(
        `${at} reads ${r.ratio}:1 (${JSON.stringify(r.groundRgb)} → ${JSON.stringify(r.ink)}), under its floor ${r.floor}:1 (DESIGN.md §2.4)`,
      );
  }
  return problems;
}

/** The page's half, run once the catalog has loaded: the reads the walk asks of it, and the two acts it may take, a
 * control's own click and the catalog's theme toggle's. Each frame is found by its place in the catalog (`n`). */
export const CATALOG_PAGE = String.raw`(() => {
  if (globalThis.__vfCatalog !== undefined) return;
  const LEAVING = "vf-wizard-pane-leaving";
${PAGE_WORDS}
  const framesOf = () => [...document.querySelectorAll("article.vf-ds-onboarding-frame[data-onboarding-preview]")];
  const productionOf = (n) => framesOf()[n]?.querySelector(".vf-ds-onboarding-production") ?? null;
  const shellOf = (n) => productionOf(n)?.querySelector(".vf-wizard-shell") ?? null;
  // the root standing in the frame, as the frame itself finds it: its own, never a leaving copy
  const standingRoot = (n) => {
    const frame = shellOf(n)?.querySelector(".vf-wizard-frame") ?? null;
    if (frame === null) return null;
    const roots = [...frame.children].filter((child) => child.hasAttribute("data-face"));
    return roots.reverse().find((child) => !child.classList.contains(LEAVING)) ?? null;
  };
  const controlsOf = (n) => [
    ...(framesOf()[n]?.querySelectorAll(".vf-ds-onboarding-controls fieldset.vf-ui-segmented") ?? []),
  ];
  // a box still moving toward where it rests: an animation or a transition that ends (a loop never does)
  const ending = (animation) =>
    animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity;
  const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const centre = (el) => el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  globalThis.__vfCatalog = {
    ready: () =>
      document.readyState === "complete" &&
      framesOf().length > 0 &&
      document.querySelector("[data-ds-text-ramp]") !== null,
    dark: () => document.documentElement.classList.contains("dark"),
    /** the document's position (item 264): the document is the catalog's scroller, and it animates every scroll */
    scrollTop: () => document.scrollingElement?.scrollTop ?? null,
    turn: () => {
      const toggle = document.querySelector(".vf-ds-theme-toggle");
      toggle?.click();
      return toggle !== null;
    },
    frames: () =>
      framesOf().map((frame) => ({
        index: frame.querySelector(".vf-ds-onboarding-frame-index")?.textContent.trim() ?? "",
        preview: frame.getAttribute("data-onboarding-preview"),
      })),
    /** each of the frame's controls, its choices by id */
    controls: (n) =>
      controlsOf(n).map((set) => [...set.querySelectorAll("button[data-id]")].map((b) => b.getAttribute("data-id"))),
    choose: (n, at, id) => {
      const button = controlsOf(n)[at]?.querySelector('button[data-id="' + CSS.escape(id) + '"]') ?? null;
      button?.click();
      return button !== null;
    },
    show: (n) => {
      const production = productionOf(n);
      if (production !== null) centre(production);
      return production !== null;
    },
    /** the frame as it stands: its box, the glass's fit in it, the face standing and whether it has settled, the
     * field under it, any of the catalog's own chrome over it, the error line's words, and every word of the band and
     * the standing pane (row 32's finder) */
    face: (n) => {
      const production = productionOf(n);
      const shell = shellOf(n);
      if (production === null || shell === null) return null;
      const root = standingRoot(n);
      const field = production.querySelector(".vf-field")?.getAttribute("data-field") ?? null;
      const settled =
        root !== null &&
        shell.querySelector("." + LEAVING) === null &&
        opacity(root) >= 0.999 &&
        !production.getAnimations({ subtree: true }).some(ending) &&
        field === "still";
      const alert = root?.querySelector('[role="alert"]')?.textContent.replace(/\s+/g, " ").trim() ?? "";
      return {
        view: { width: innerWidth, height: innerHeight },
        box: box(production),
        // the document's position, read with the frame's box: a face's capture is bracketed from here (item 264)
        top: document.scrollingElement?.scrollTop ?? null,
        fit: shell.getBoundingClientRect().width / shell.offsetWidth,
        standing: root?.getAttribute("data-face") ?? null,
        settled,
        field,
        covered: [...document.querySelectorAll(".vf-ds-theme-toggle, .vf-ds-sidebar")]
          .filter((el) => meets(box(el), box(production)))
          .map((el) => el.className),
        alert: alert === "" ? null : alert,
        words: [...wordsIn(shell.querySelector(".vf-wizard-steps")), ...wordsIn(root)],
      };
    },
    showRamp: () => {
      const ramp = document.querySelector("[data-ds-text-ramp]");
      if (ramp !== null) centre(ramp);
      return ramp !== null;
    },
    /** The Text ramp as it stands: reading geometry must not scroll again immediately before capture. */
    ramp: () => {
      const ramp = document.querySelector("[data-ds-text-ramp]");
      if (ramp === null) return null;
      return {
        view: { width: innerWidth, height: innerHeight },
        box: box(ramp),
        chips: [...ramp.querySelectorAll("[data-ramp-tier]")].map((chip) => {
          const range = document.createRange();
          range.selectNodeContents(chip);
          const r = range.getBoundingClientRect();
          let shown = 1;
          for (let at = chip; at !== null; at = at.parentElement) shown *= opacity(at);
          return {
            tier: chip.getAttribute("data-ramp-tier"),
            ground: chip.getAttribute("data-ramp-ground"),
            floor: Number(chip.getAttribute("data-ramp-floor")),
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            text: chip.textContent.trim(),
            shown: Math.round(shown * 1000) / 1000,
          };
        }),
      };
    },
  };
})();`;

/** The frame as the page reads it (`face(n)`). */
interface FrameRead extends Pick<InksSeen, "view" | "words"> {
  readonly box: Box;
  /** the document's position, read with the box (item 264) */
  readonly top: number | null;
  readonly fit: number;
  readonly standing: string | null;
  readonly settled: boolean;
  readonly field: string | null;
  readonly covered: readonly string[];
  readonly alert: string | null;
}

/** A capture and the document's position on its either side (item 264): `image` is null where the capture failed,
 * and `failure` is what it threw (null where it did not). */
interface Captured {
  readonly image: NativeImage | null;
  readonly before: number | null;
  readonly after: number | null;
  readonly failure: unknown;
}

/** A capture that failed, as the walk's facts keep it (item 264): where, the document's position on its either side,
 * and the first line of what it threw. */
interface CaptureFailure {
  readonly at: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly error: string;
}

/** The first line of what a failure threw. */
const failureOf = (failure: unknown): string =>
  (failure instanceof Error ? failure.message : String(failure)).split("\n")[0] ?? "";

/** Whether a box stands whole in the window. */
const standsWhole = (b: Box, view: { readonly width: number; readonly height: number }): boolean =>
  b.y >= 0 && b.x >= 0 && b.y + b.height <= view.height && b.x + b.width <= view.width;

/** What the walk needs: its window, made on `CATALOG_PARTITION` over the design build with the catalog loaded. */
export interface CatalogDriver {
  readonly win: BrowserWindow;
  /** this walk's own folder of stills, outside the run's own folders (`shotDirRefusal`) */
  readonly shotDir: string;
  readonly say: (line: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether the design build stands where the launcher said: its page is there. */
export function catalogBuildRefusal(root: string | undefined): string | null {
  if (root === undefined || root.length === 0)
    return `${CATALOG_RENDERER_ENV} names no design build (run-first-run.mjs hands the catalog's walk one)`;
  if (!existsSync(join(root, CATALOG.page)))
    return `no design build at ${root} (pnpm --filter @vibefield/electron-shell build:design writes it)`;
  return null;
}

/** The walk over the loaded catalog: facts for the verdict line, and every problem in words. A step that never comes
 * stops the walk, its problem last after every one it had found. */
export async function catalogRows(
  d: CatalogDriver,
): Promise<{ facts: Record<string, unknown>; problems: string[] }> {
  const problems: string[] = [];
  const shots: string[] = [];
  const facts: Record<string, unknown> = { walk: "catalog", shots: 0 };
  const page = async <T>(call: string): Promise<T | null> =>
    (await d.win.webContents.executeJavaScript(
      `globalThis.__vfCatalog?.${call} ?? null`,
      true,
    )) as T | null;
  const until = async <T>(
    what: string,
    ms: number,
    read: () => Promise<T | null | false>,
  ): Promise<T> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const seen = await read();
      if (seen !== null && seen !== false) return seen;
      if (Date.now() > deadline) throw new Error(`${what}: not within ${ms}ms`);
      await sleep(50);
    }
  };
  const rounded = (b: Box): Box => {
    const x = Math.round(b.x);
    const y = Math.round(b.y);
    return { x, y, width: Math.round(b.x + b.width) - x, height: Math.round(b.y + b.height) - y };
  };
  const keep = (at: string, image: NativeImage): Uint8Array => {
    const file = catalogShot(shots.length + 1, at);
    writeFileSync(join(d.shotDir, file), image.toJPEG(CATALOG.jpegQuality));
    shots.push(file);
    return new Uint8Array(image.toBitmap());
  };
  const faces: CatalogFace[] = [];
  const cuts: InkCut[] = [];
  const readings: RampReading[] = [];
  const unsettled: string[] = [];
  const recaptured: string[] = [];
  const captureFailures: CaptureFailure[] = [];
  let lowestFit: number | null = null;
  // one capture, bracketed by the document's position (item 264): from `since`, the position its caller read with the
  // geometry it captures (a face's settled read, so the settle stands inside), or else from just before it, to just
  // after it. A capture the document moved during is not of what the walk read, and one that failed while it moved is
  // the same move; what a failure threw is kept, never dropped
  const capture = async (rect: Box, since?: number | null): Promise<Captured> => {
    const before = since === undefined ? await page<number>("scrollTop()") : since;
    let image: NativeImage | null = null;
    let failure: unknown = null;
    try {
      image = await d.win.webContents.capturePage(rect);
    } catch (e) {
      failure = e;
    }
    const after = await page<number>("scrollTop()");
    return { image, before, after, failure };
  };
  // the document at rest a whole `CATALOG.stillMs` before a theme's first capture (item 264); a document never at rest
  // within `CATALOG.readyMs` stops the walk, its last positions said. What it read is the walk's margin line: how long
  // it waited, how long the document had rested when it ended, where, and how often it moved meanwhile
  const untilStill = async (
    theme: CatalogTheme,
  ): Promise<{ waitedMs: number; restedMs: number; top: number | null; moves: number }> => {
    const start = Date.now();
    const seen: ScrollReading[] = [];
    for (;;) {
      const reading = { at: Date.now() - start, top: await page<number>("scrollTop()") };
      seen.push(reading);
      const since = stillSince(seen, CATALOG.stillMs);
      if (since !== null) {
        const moves = seen.filter((r, i) => i > 0 && r.top !== seen[i - 1]?.top).length;
        return { waitedMs: reading.at, restedMs: reading.at - since, top: reading.top, moves };
      }
      if (Date.now() - start > CATALOG.readyMs) {
        const last = seen.slice(-5).map((reading) => String(reading.top));
        throw new Error(
          `by ${theme} the catalog's document never stood still for ${CATALOG.stillMs}ms within ${CATALOG.readyMs}ms (its last positions: ${last.join(", ")})`,
        );
      }
      await sleep(CATALOG.stillPollMs);
    }
  };
  // a capture walked again, once, when the document moved during it (item 264): first the document comes to rest again
  // (fd's F2, so a mover still going cannot hit the second capture too), then the attempt re-runs whole (centred,
  // settled, read, captured), named in `recaptured`. A move during the second is the walk's problem to say, quoting
  // the last thing a capture of this face threw. Every capture that failed is kept in `captureFailures` (fd's F1); the
  // caller lets one that failed on a still document stand
  const steady = async <T extends { readonly shot: Captured | null }>(
    theme: CatalogTheme,
    at: string,
    attempt: () => Promise<T>,
  ): Promise<T & { readonly moved: string | null }> => {
    const threw: string[] = [];
    const take = async (): Promise<T> => {
      const taken = await attempt();
      const shot = taken.shot;
      if (shot !== null && shot.image === null) {
        const error = failureOf(shot.failure);
        threw.push(error);
        captureFailures.push({ at, before: shot.before, after: shot.after, error });
      }
      return taken;
    };
    const first = await take();
    if (first.shot === null || held(first.shot.before, first.shot.after))
      return { ...first, moved: null };
    recaptured.push(at);
    await untilStill(theme);
    const again = await take();
    const moved =
      again.shot === null ? null : movedDuring(at, again.shot.before, again.shot.after, 2);
    if (moved === null) return { ...again, moved: null };
    const last = threw.at(-1);
    return {
      ...again,
      moved: last === undefined ? moved : `${moved}; the capture failed: ${last}`,
    };
  };

  mkdirSync(d.shotDir, { recursive: true });
  try {
    await d.win.webContents.executeJavaScript(CATALOG_PAGE, true);
    await until("the catalog standing, its frames and its Text ramp", CATALOG.readyMs, () =>
      page<boolean>("ready()"),
    );
    const frames = await until("the catalog's frames", CATALOG.readyMs, () =>
      page<{ index: string; preview: string }[]>("frames()"),
    );
    facts["frames"] = frames.map((frame) => `${frame.index} ${frame.preview}`);

    // one face: its frame centred and settled, captured alone, its words cut from that capture
    const face = async (
      theme: CatalogTheme,
      n: number,
      frame: { index: string; preview: string },
      choices: readonly string[],
    ): Promise<void> => {
      const at = catalogAt({ theme, ...frame, choices });
      const walked = await steady(theme, at, async () => {
        await page<boolean>(`show(${n})`);
        await sleep(CATALOG.swapMs);
        let read: FrameRead | null = null;
        let settled = true;
        try {
          read = await until(`${at} settled`, CATALOG.faceMs, async () => {
            const seen = await page<FrameRead>(`face(${n})`);
            return seen?.settled === true ? seen : null;
          });
        } catch {
          settled = false;
          read = await page<FrameRead>(`face(${n})`);
        }
        if (read === null) return { read, settled, before: null, rect: null, shot: null };
        await sleep(CATALOG.settleMs);
        const before = await page<FrameRead>(`face(${n})`);
        const rect = rounded(read.box);
        return { read, settled, before, rect, shot: await capture(rect, read.top) };
      });
      // judged as it stands, and said: a face that never settles may have words still moving
      if (!walked.settled) unsettled.push(at);
      if (walked.read === null || walked.rect === null || walked.shot === null) {
        problems.push(`on ${at} the frame could not be read`);
        return;
      }
      const { read, before, rect, shot, moved } = walked;
      if (!standsWhole(rect, read.view))
        problems.push(`on ${at} the frame does not stand whole in the window`);
      if (read.covered.length > 0)
        problems.push(`on ${at} the catalog's ${read.covered.join(", ")} stands over the frame`);
      if (moved !== null) problems.push(moved);
      // a capture that failed on a still document stands: the walk stops on it, its frame's problems said first
      if (shot.image === null && moved === null) throw shot.failure;
      if (shot.image !== null) {
        const bitmap = keep(at, shot.image);
        const after = await page<FrameRead>(`face(${n})`);
        // a capture the document moved during is not of the words read, so nothing is cut from it
        if (after !== null && moved === null)
          cuts.push(...catalogCuts(at, bitmap, rect, after, before));
      }
      const fit = Number.isFinite(read.fit) ? Math.round(read.fit * 10_000) / 10_000 : null;
      if (fit !== null) lowestFit = lowestFit === null ? fit : Math.min(lowestFit, fit);
      faces.push({ at, theme, ...frame, choices, fit, alert: read.alert });
    };
    // every face a frame's controls offer: each choice of its first control, and under each, every choice of the
    // next (Connect's variants follow its state)
    const walkControls = async (
      theme: CatalogTheme,
      n: number,
      frame: { index: string; preview: string },
      depth: number,
      chosen: readonly string[],
    ): Promise<void> => {
      const controls = (await page<string[][]>(`controls(${n})`)) ?? [];
      const ids = controls[depth];
      if (ids === undefined || ids.length === 0) {
        await face(theme, n, frame, chosen);
        return;
      }
      for (const id of ids) {
        if ((await page<boolean>(`choose(${n}, ${depth}, ${JSON.stringify(id)})`)) !== true)
          problems.push(
            `on ${catalogAt({ theme, ...frame, choices: chosen })} "${id}" could not be chosen`,
          );
        await walkControls(theme, n, frame, depth + 1, [...chosen, id]);
      }
    };

    for (const theme of ["day", "night"] as const) {
      const dark = theme === "night";
      if ((await page<boolean>("dark()")) !== dark) await page<boolean>("turn()");
      await until(`the catalog by ${theme}`, CATALOG.readyMs, async () =>
        (await page<boolean>("dark()")) === dark ? true : null,
      );
      await sleep(CATALOG.settleMs);
      d.say(`CATALOG_THEME ${theme}`);
      const still = await untilStill(theme);
      d.say(`CATALOG_STILL ${theme} ${JSON.stringify(still)}`);

      // DESIGN.md §2.4's ramp, in pixels
      const ramp = await steady(theme, `${theme} text ramp`, async () => {
        const shown = await page<boolean>("showRamp()");
        await sleep(CATALOG.settleMs);
        const seen = await page<RampSeen>("ramp()");
        if (shown !== true || seen === null) return { seen: null, rect: null, shot: null };
        const rect = rounded(seen.box);
        return { seen, rect, shot: await capture(rect) };
      });
      if (ramp.seen === null || ramp.rect === null || ramp.shot === null)
        problems.push(`by ${theme} the catalog's Text ramp did not stand`);
      else {
        // held to the window as each face is (fd's F4), and said before a failure can stop the walk
        if (!standsWhole(ramp.rect, ramp.seen.view))
          problems.push(
            `by ${theme} the Text ramp does not stand whole in the window: its rect ${JSON.stringify(ramp.rect)} in ${ramp.seen.view.width} × ${ramp.seen.view.height}`,
          );
        if (ramp.moved !== null) problems.push(ramp.moved);
        if (ramp.shot.image === null && ramp.moved === null) throw ramp.shot.failure;
        if (ramp.shot.image !== null) {
          const bitmap = keep(`${theme} text ramp`, ramp.shot.image);
          // a capture the document moved during is not of the chips read, so nothing is read from it
          if (ramp.moved === null) {
            const read = rampReadings(theme, bitmap, { ...ramp.seen, box: ramp.rect });
            if (read.length !== 16)
              problems.push(
                `by ${theme} the Text ramp showed ${read.length} chips, not 16 (four tiers on four grounds)`,
              );
            readings.push(...read);
          }
        }
      }

      for (const [n, frame] of frames.entries()) await walkControls(theme, n, frame, 0, []);
    }
  } catch (e) {
    problems.push(`the walk stopped: ${e instanceof Error ? e.message : String(e)}`);
  }

  const contrast = firstRunContrast(cuts);
  facts["shots"] = shots.length;
  facts["faces"] = {
    day: faces.filter((f) => f.theme === "day").length,
    night: faces.filter((f) => f.theme === "night").length,
  };
  facts["lowestFit"] = lowestFit;
  facts["unsettled"] = unsettled;
  facts["recaptured"] = recaptured;
  facts["captureFailures"] = captureFailures;
  facts["errors"] = faces.filter((f) => f.alert !== null).map((f) => [f.at, f.alert]);
  facts["ramp"] = readings.map((r) => [`${r.theme} ${r.tier} ${r.ground}`, r.ratio, r.floor]);
  facts["contrast"] = contrast;
  problems.unshift(...judgeCatalog(faces), ...judgeRamp(readings), ...judgeContrast(contrast));
  // the bar is row 32's: the walk says it with its counts
  facts["wordContrast"] = FIRST_RUN.wordContrast;
  return { facts, problems };
}
