// PT-5b — THE LAST STILL AND THE MANY, IN THE PRODUCT (smoke:canvas; the PORTALS brief PT-5b §2): browser panes laid on clear
// ground, pointed at the smoke's own fixture (testing/live-fixture.ts — each at its own address, `/gate?p=…`, a page the
// smoke can HOLD AT ITS DOOR), with the desk's cap on pages alive lowered by its TEST door (`__vfDesk.liveCap`). Judged by
// the desk's own word (each face's row: alive, rested, its still; the service's counts), main's (the offscreen WebContents
// that ARE the pages alive, their sound; the app's memory), this device's shelf (a still's address, sizes, type, bytes and
// times — NEVER its pixels) and the desk's pixels where a pane is drawn — never a hash:
//   REST        — three panes seen, the cap at 2: two pages alive (main counts two), the third AT REST on its still — its face
//                 `paused`, `still` said, its head carrying the rest mark, its page's area the fixture's hue (a step dimmer
//                 than the page alive) and no film. The third PICKED UP: it comes alive, and one of the two others is put to
//                 rest — its still kept FIRST (the shelf's `takenAt` and `keptAt` newer than before: the page had painted
//                 since);
//   HELD-NEVER  — the cap lowered to 1 under the pane in hand: the other goes; the held one is never rested (alive, its
//                 page the same one — its token — main's one page its own);
//   SILENT      — a page woken is born as its ask says: the page that comes alive when the cap is raised is HEARD (not
//                 muted); the pane at rest has NO page in main — panned out of view (its ask paused) it still has none, so
//                 none is born silent; the pages alive are muted unseen and heard again seen;
//   BUDGET      — the panes' faces are rows of the desk's raster budget under the kind's name: as many rows as faces holding
//                 a texture, their bytes the textures' own;
//   FORGOT      — the test's short grace: a pane deleted and undone within it has its page (the same token) and its still;
//                 a pane deleted and its grace run out has neither — its still gone from the shelf, counted forgotten;
//   STILL       — a pane put down (its still taken at the put-down), put to rest, the app's window RELOADED with the gate
//                 shut: its page's load waits at the fixture's door and the pane shows its STILL — the fixture's hue in its
//                 page's area, `still` said, the rest mark — then the gate opens and the live page replaces it: sampled each
//                 frame across the hand-over, the face is never the film (still → live, nothing between), nor is any capture
//                 of its page's area;
//   TWO-WINDOWS — a second window joined to the same document (the smoke plays the mesh — `?docRelay=1`): each window's
//                 pane alive on a page of its own; A's page navigates by a click; the `url` reaches B and B's page follows
//                 ONCE; B writes nothing back;
//   MEMORY      — the app's memory (every process's working set, summed) with no page, one laptop page alive, six, and six
//                 alive beside fourteen at rest — said in the row.
// Then the panes are removed and the board is as found. `--last-still` beside `--smoke-canvas` runs these rows alone after
// the boot's (the author's loop).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { FIXTURE_HUE, type FixtureReport } from "./live-fixture";
import { PANE, type PaneHands, paneHands } from "./smoke-browser-pane";
import type { LiveRowsDriver } from "./smoke-live-pane";
import { type HeldFrameSeen, pageOnWindow } from "./smoke-use-pane";

/** The flag beside `--smoke-canvas` that runs these rows alone after the boot's (the author's loop). */
export const STILL_FLAG = "--last-still";

/** The rows' numbers. */
export const STILL_ROWS = {
  /** the cap the test door lowers the desk to */
  cap: 2,
  /** how long a page's word, a face's turn or a still is waited for */
  withinMs: 30_000,
  /** FORGOT: the test's short grace, and how long past it the shelf is read */
  graceMs: 2_500,
  graceSlackMs: 2_000,
  /** a laptop's pane as it is laid (the manifest's size), and the gap between two */
  laid: { w: 698.16, h: 461.94 },
  gap: 82,
  /** a pixel of the fixture's ground — at the page's own light or a photograph's dimmer one: its hue within this many
   * degrees, this saturated, this bright; the film: this dark */
  hue: { deg: 18, minSat: 0.35, minMax: 70 },
  filmLuma: 42,
  /** a page's area shown as the page or as its still: at least this share of the fixture's ground, at most this of film */
  shown: { hue: 0.4, film: 0.15 },
  /** a still is a step dimmer than its page alive: its brightest pixel at most this share of the live page's */
  dimmer: 0.94,
  /** MEMORY: the panes laid, the cap they end under, the most alive while their stills are made, the settle before a read */
  memory: { panes: 20, alive: 6, making: 10, settleMs: 2_500 },
} as const;

/** The fixture ground's hue angle (degrees). */
export const STILL_HUE_DEG = ((): number => {
  const { r, g, b } = FIXTURE_HUE;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
})();

/**
 * The pixel classifier, as source: 1 the fixture's ground (at its own light, or a still's dimmer one), 2 the film, 0
 * anything else. The renderer runs it over a capture (a bitmap never crosses) and the rows' units run the same text.
 */
export const STILL_CLASSIFY = `((r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (max >= ${STILL_ROWS.hue.minMax} && d > 0 && d / max >= ${STILL_ROWS.hue.minSat}) {
    const h = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
    const off = Math.abs(h - ${STILL_HUE_DEG.toFixed(2)});
    if (Math.min(off, 360 - off) <= ${STILL_ROWS.hue.deg}) return 1;
  }
  return l <= ${STILL_ROWS.filmLuma} ? 2 : 0;
})`;

/** A page's area read back from a capture: its pixels, those of the fixture's ground, those of the film, its brightest. */
export interface PageSeen {
  readonly px: number;
  readonly hue: number;
  readonly film: number;
  readonly lumaMax: number;
}

/** A face's row as these rows read it. */
export interface FaceSeen {
  readonly state: string;
  readonly ask: string | null;
  readonly wire: string | null;
  readonly alive: boolean;
  readonly rested: boolean;
  /** when the still its texture holds was taken (null: its texture is the page's own frame, or it has none) */
  readonly still: number | null;
  readonly stillAt: number | null;
  readonly presented: number;
  readonly veiled: boolean;
  /** its texture's bytes on the device (0: none) */
  readonly bytes: number;
}

/** A pane's last still as the shelf keeps it — never its pixels. */
export interface StillSaid {
  readonly address: string;
  readonly logical: readonly [number, number];
  readonly size: readonly [number, number];
  readonly type: string;
  readonly bytes: number;
  readonly takenAt: number;
  readonly keptAt: number | null;
}

/** A page as main holds it: an offscreen WebContents, its address, its sound. */
export interface MainPage {
  readonly id: number;
  readonly url: string;
  readonly muted: boolean;
}

/** The app's memory as main counts it: every process's working set, summed (MB), and how many processes. */
export interface AppMemory {
  readonly mb: number;
  readonly processes: number;
}

/** What the rows saw — the SMOKE_CANVAS_STILL line, and what the judges read. */
export interface LastStillSeen {
  readonly rest: {
    readonly cap: number | null;
    /** the three panes alive under the desk's own cap: the faces alive, main's pages, each pane's still on the shelf */
    readonly before: { readonly alive: number; readonly pages: number };
    readonly stills: readonly (StillSaid | null)[];
    /** the cap lowered: the faces alive, main's pages, the faces at rest */
    readonly after: { readonly alive: number; readonly pages: number; readonly rested: number };
    /** the pane at rest: its face, whether its head carries the rest mark, its page's area — and that area while the
     * page was alive (the same pane, the same view) */
    readonly third: {
      readonly face: FaceSeen | null;
      readonly mark: boolean;
      readonly page: PageSeen | null;
      readonly alive: PageSeen | null;
    };
    /** the third picked up: its face, main's pages then; the pane put to rest for it — its still before and after */
    readonly picked: {
      readonly face: FaceSeen | null;
      readonly pages: number;
      readonly gave: string | null;
      readonly before: StillSaid | null;
      readonly after: StillSaid | null;
    };
  };
  readonly heldNever: {
    readonly cap: number | null;
    readonly held: FaceSeen | null;
    /** the held page's token before the cap fell and after: the same page */
    readonly token: { readonly before: string | null; readonly after: string | null };
    readonly pages: readonly string[];
    /** the address of the held pane's page; faces at rest then; pages the service put to rest so far */
    readonly own: string;
    readonly rested: number;
    readonly rests: number;
  };
  readonly silent: {
    /** the page that came alive when the cap was raised: its sound in main */
    readonly woken: { readonly address: string; readonly page: MainPage | null } | null;
    /** the pane still at rest: its face, and its pages in main — seen, panned out of view (its ask paused), and back */
    readonly rested: {
      readonly address: string;
      readonly seen: number;
      readonly unseen: number;
      readonly ask: string | null;
      readonly wire: string | null;
      readonly back: number;
    } | null;
    /** the pages alive: muted while every pane is out of view, heard again seen */
    readonly unseen: readonly MainPage[];
    readonly back: readonly MainPage[];
  };
  readonly budget: {
    /** the kind's rows of the desk's budget; the faces holding a texture and their bytes */
    readonly owner: { readonly bytes: number; readonly entries: number } | null;
    readonly faces: { readonly textures: number; readonly bytes: number };
    readonly cap: number | null;
  };
  readonly forgot: {
    readonly graceMs: number | null;
    /** deleted and undone within the grace: its still before and after, its page's token before and after */
    readonly undone: {
      readonly before: StillSaid | null;
      readonly after: StillSaid | null;
      readonly token: { readonly before: string | null; readonly after: string | null };
      readonly forgotten: number;
    };
    /** deleted and its grace run out: its still then, main's pages at its address, stills counted forgotten, the wait */
    readonly gone: {
      readonly before: StillSaid | null;
      readonly after: StillSaid | null;
      readonly pages: number;
      readonly forgotten: number;
      readonly waitedMs: number;
    };
  };
  readonly still: {
    /** the put-down: stills taken before and after it, the shelf's still then */
    readonly putDown: {
      readonly taken: { readonly before: number; readonly after: number };
      readonly said: StillSaid | null;
    };
    /** before the reload: the pane at rest (its face); the gate shut */
    readonly rested: FaceSeen | null;
    /** after the reload, the gate shut: loads waiting at it; the pane's face, its head's rest mark, its page's area */
    readonly shown: {
      readonly reloaded: boolean;
      readonly waiting: number;
      readonly face: FaceSeen | null;
      readonly mark: boolean;
      readonly page: PageSeen | null;
    };
    /** the hand-over, the gate opened: the face each frame as runs ("S212 L40" — F the film, S its still, L the page's
     * own frame, - no face), every capture of its page's area (the worst film share, the least hue share), its face after */
    readonly handOver: {
      readonly runs: string;
      readonly captures: number;
      readonly worstFilm: number;
      readonly leastHue: number;
      readonly face: FaceSeen | null;
      readonly mark: boolean;
    };
  };
  readonly twoWindows: {
    /** B joined A's document: the pane there by the same key; each window's page alive (main's pages at its address) */
    readonly joined: boolean;
    readonly pages: number;
    readonly faces: { readonly a: FaceSeen | null; readonly b: FaceSeen | null };
    /** A's click: `/next` served before and after (the two pages' loads); the `url` each window's document holds; what B
     * handed back (its local commits) while it followed; A's and B's navigations sent by the desk's second service */
    readonly served: { readonly before: number; readonly after: number; readonly later: number };
    readonly url: { readonly a: string | null; readonly b: string | null };
    readonly handedBack: number;
    readonly navigations: { readonly a: number; readonly b: number };
  } | null;
  readonly memory: {
    readonly none: AppMemory | null;
    readonly one: AppMemory | null;
    readonly six: AppMemory | null;
    /** six alive beside fourteen at rest: the memory, the faces alive and at rest, main's pages, the shelf's stills, and
     * the kind's bytes of the desk's budget */
    readonly many: AppMemory | null;
    readonly alive: number;
    readonly rested: number;
    readonly pages: number;
    readonly shelf: { readonly bytes: number; readonly stills: number } | null;
    readonly budget: number | null;
    /** the most pages main held at once while the stills were made */
    readonly peak: number;
  } | null;
}

const share = (n: number, of: number): number => (of === 0 ? 0 : n / of);
const pct = (n: number, of: number): string => `${(share(n, of) * 100).toFixed(1)}%`;

/** Is a page's area SHOWN — the fixture's hue, not the film? */
function shown(row: string, what: string, page: PageSeen | null): string[] {
  if (page === null || page.px === 0) return [`${row}: ${what} could not be read`];
  const out: string[] = [];
  if (share(page.hue, page.px) < STILL_ROWS.shown.hue)
    out.push(
      `${row}: ${what} is ${pct(page.hue, page.px)} the fixture's hue, not ${STILL_ROWS.shown.hue * 100}% — the page is not drawn there`,
    );
  if (share(page.film, page.px) > STILL_ROWS.shown.film)
    out.push(`${row}: ${what} is ${pct(page.film, page.px)} film — the pane shows its dark film`);
  return out;
}

/** REST: two alive under the cap, the third on its still; picked up, it comes alive and another rests — its still first. */
export function judgeRest(seen: LastStillSeen["rest"]): string[] {
  const out: string[] = [];
  if (seen.cap !== STILL_ROWS.cap)
    out.push(`REST: the test door set the cap to ${seen.cap}, not ${STILL_ROWS.cap}`);
  if (seen.before.alive !== 3 || seen.before.pages !== 3)
    out.push(
      `REST: before the cap fell ${seen.before.alive} faces were alive and main held ${seen.before.pages} pages, not the three panes' — the row proved nothing`,
    );
  seen.stills.forEach((s, i) => {
    if (s === null) out.push(`REST: pane ${i + 1} had no still on the shelf after resting in view`);
    else {
      if (!/^image\//.test(s.type) || s.bytes < 500)
        out.push(`REST: pane ${i + 1}'s still is ${s.bytes} bytes of ${s.type} — no picture`);
      if (Math.max(s.size[0], s.size[1]) > 1600)
        out.push(
          `REST: pane ${i + 1}'s still is ${s.size.join(" × ")} — past 1600 px on its long side`,
        );
      if (s.logical[0] !== 1280 || s.logical[1] !== 800)
        out.push(
          `REST: pane ${i + 1}'s still says its page is ${s.logical.join(" × ")}, not 1280 × 800`,
        );
      if (!/\/gate\?p=/.test(s.address))
        out.push(`REST: pane ${i + 1}'s still is of ${s.address} — not its page's address`);
    }
  });
  if (seen.after.alive !== STILL_ROWS.cap || seen.after.pages !== STILL_ROWS.cap)
    out.push(
      `REST: under a cap of ${STILL_ROWS.cap}, ${seen.after.alive} faces are alive and main holds ${seen.after.pages} pages`,
    );
  if (seen.after.rested !== 1)
    out.push(`REST: ${seen.after.rested} faces are at rest, not the third alone`);
  const third = seen.third.face;
  if (third === null) out.push("REST: the pane at rest has no face");
  else {
    if (third.state !== "paused")
      out.push(`REST: the pane at rest says ${third.state}, not paused`);
    if (third.still === null)
      out.push("REST: the pane at rest does not say its texture is a still");
    if (third.alive || !third.rested)
      out.push(`REST: the pane at rest is alive ${third.alive}, rested ${third.rested}`);
    if (third.wire !== "hibernated")
      out.push(`REST: the pane at rest is asked ${third.wire} on its wire, not hibernated`);
  }
  if (!seen.third.mark) out.push("REST: the head of the pane at rest carries no rest mark");
  out.push(...shown("REST", "the page's area of the pane at rest", seen.third.page));
  if (seen.third.page !== null && seen.third.alive !== null) {
    if (seen.third.page.lumaMax > seen.third.alive.lumaMax * STILL_ROWS.dimmer)
      out.push(
        `REST: the still's brightest pixel is ${seen.third.page.lumaMax} against the live page's ${seen.third.alive.lumaMax} — a still is not drawn dimmer than its page`,
      );
  } else if (seen.third.alive === null)
    out.push("REST: the pane's page was not read while it was alive");
  const picked = seen.picked.face;
  if (picked === null) out.push("REST: the pane picked up has no face");
  else {
    if (!picked.alive || picked.rested || picked.state !== "live" || picked.still !== null)
      out.push(
        `REST: picked up, the pane is ${picked.state} (alive ${picked.alive}, rested ${picked.rested}, still ${picked.still !== null}) — it did not come alive`,
      );
  }
  if (seen.picked.pages !== STILL_ROWS.cap)
    out.push(
      `REST: with the third in hand main holds ${seen.picked.pages} pages, not ${STILL_ROWS.cap}`,
    );
  if (seen.picked.gave === null) out.push("REST: no pane was put to rest for the one picked up");
  else if (seen.picked.before === null || seen.picked.after === null)
    out.push("REST: the pane put to rest has no still on the shelf");
  else if (
    seen.picked.after.takenAt <= seen.picked.before.takenAt ||
    (seen.picked.after.keptAt ?? 0) <= (seen.picked.before.keptAt ?? 0)
  )
    out.push(
      `REST: the pane put to rest kept no newer still (taken ${seen.picked.before.takenAt} → ${seen.picked.after.takenAt}, kept ${seen.picked.before.keptAt} → ${seen.picked.after.keptAt}) — its still was not taken first`,
    );
  return out;
}

/** HELD-NEVER: the cap lowered to 1 under the pane in hand — the other goes, the held one stays, the same page. */
export function judgeHeldNever(seen: LastStillSeen["heldNever"]): string[] {
  const out: string[] = [];
  if (seen.cap !== 1) out.push(`HELD-NEVER: the test door set the cap to ${seen.cap}, not 1`);
  const held = seen.held;
  if (held === null) out.push("HELD-NEVER: the pane in hand has no face");
  else if (!held.alive || held.rested || held.state !== "live" || held.wire !== "live")
    out.push(
      `HELD-NEVER: under a cap of 1 the pane in hand is ${held.state} (alive ${held.alive}, rested ${held.rested}, asked ${held.wire}) — the held page was put to rest`,
    );
  if (seen.token.before === null || seen.token.after !== seen.token.before)
    out.push(
      `HELD-NEVER: the held page's token was ${seen.token.before} and is ${seen.token.after} — not the same page`,
    );
  if (seen.pages.length !== 1 || seen.pages[0]?.startsWith(seen.own) !== true)
    out.push(
      `HELD-NEVER: main holds ${JSON.stringify(seen.pages)}, not the held pane's page alone (${seen.own})`,
    );
  if (seen.rested !== 2)
    out.push(`HELD-NEVER: ${seen.rested} faces are at rest, not the two others`);
  return out;
}

/** SILENT: a page woken is heard; a pane at rest has no page — seen or not — so none is born silent; unseen pages are muted. */
export function judgeSilent(seen: LastStillSeen["silent"]): string[] {
  const out: string[] = [];
  if (seen.woken === null) out.push("SILENT: no page came alive when the cap was raised");
  else if (seen.woken.page === null)
    out.push(`SILENT: the page woken (${seen.woken.address}) is not among main's pages`);
  else if (seen.woken.page.muted)
    out.push("SILENT: the page woken under a live ask was born MUTED — it is seen, and not heard");
  if (seen.rested === null) out.push("SILENT: no pane was left at rest — the row proved nothing");
  else {
    if (seen.rested.seen !== 0 || seen.rested.unseen !== 0 || seen.rested.back !== 0)
      out.push(
        `SILENT: the pane at rest has ${seen.rested.seen} pages in main seen, ${seen.rested.unseen} out of view, ${seen.rested.back} back — a page was made for a pane at rest`,
      );
    if (seen.rested.ask !== "paused")
      out.push(
        `SILENT: out of view the pane at rest asks ${seen.rested.ask}, not paused — the row proved nothing`,
      );
    if (seen.rested.wire === "live")
      out.push("SILENT: out of view the pane at rest is asked LIVE on its wire");
  }
  if (seen.unseen.length === 0)
    out.push("SILENT: no page was alive out of view — the row proved nothing");
  for (const page of seen.unseen)
    if (!page.muted) out.push(`SILENT: out of view the page at ${page.url} is NOT muted`);
  if (seen.back.length !== seen.unseen.length)
    out.push(
      `SILENT: ${seen.back.length} pages are alive back in view, not the ${seen.unseen.length} there were`,
    );
  for (const page of seen.back)
    if (page.muted) out.push(`SILENT: back in view the page at ${page.url} is still muted`);
  return out;
}

/** BUDGET: the faces are rows of the desk's budget under the kind's name, their bytes the textures'. */
export function judgeBudget(seen: LastStillSeen["budget"]): string[] {
  const out: string[] = [];
  if (seen.owner === null)
    return [`BUDGET: the desk's budget has no row of ${PANE.type} (cap ${seen.cap})`];
  if (seen.faces.textures === 0)
    out.push("BUDGET: no face holds a texture — the row proved nothing");
  if (seen.owner.entries !== seen.faces.textures)
    out.push(
      `BUDGET: the kind has ${seen.owner.entries} rows of the budget for ${seen.faces.textures} faces holding a texture`,
    );
  if (seen.owner.bytes !== seen.faces.bytes)
    out.push(
      `BUDGET: the kind's rows hold ${seen.owner.bytes} bytes, the faces' textures ${seen.faces.bytes}`,
    );
  if (seen.cap === null || seen.cap <= 0) out.push(`BUDGET: the budget's cap is ${seen.cap}`);
  return out;
}

/** FORGOT: undone within the grace, page and still are back; the grace run out, both are gone. */
export function judgeForgot(seen: LastStillSeen["forgot"]): string[] {
  const out: string[] = [];
  if (seen.graceMs !== STILL_ROWS.graceMs)
    out.push(`FORGOT: the test's grace is ${seen.graceMs} ms, not ${STILL_ROWS.graceMs}`);
  const u = seen.undone;
  if (u.before === null)
    out.push("FORGOT: the pane had no still before its delete — the row proved nothing");
  else if (u.after === null)
    out.push("FORGOT: undone within the grace, the pane's still is gone from the shelf");
  else if (u.after.takenAt < u.before.takenAt)
    out.push("FORGOT: undone within the grace, the pane's still is an older one");
  if (u.token.before === null || u.token.after !== u.token.before)
    out.push(
      `FORGOT: undone within the grace, the pane's page is ${u.token.after}, not the one it had (${u.token.before}) — its page was not kept`,
    );
  if (u.forgotten !== 0)
    out.push(`FORGOT: ${u.forgotten} stills were forgotten for a pane undone within its grace`);
  const g = seen.gone;
  if (g.before === null) out.push("FORGOT: the deleted pane had no still — the row proved nothing");
  if (g.after !== null)
    out.push(
      `FORGOT: ${g.waitedMs} ms after its delete (the grace: ${STILL_ROWS.graceMs}) the pane's still is on the shelf yet`,
    );
  if (g.forgotten !== 1)
    out.push(`FORGOT: ${g.forgotten} stills were counted forgotten, not the deleted pane's one`);
  if (g.pages !== 0)
    out.push(`FORGOT: main holds ${g.pages} pages at the deleted pane's address after its grace`);
  return out;
}

/** A run-length reading of the hand-over's frames ("F2 S212 L40"). */
export function runsOf(frames: readonly string[]): string {
  const out: string[] = [];
  let last = "";
  let n = 0;
  for (const f of frames) {
    if (f === last) n += 1;
    else {
      if (n > 0) out.push(`${last}${n}`);
      last = f;
      n = 1;
    }
  }
  if (n > 0) out.push(`${last}${n}`);
  return out.join(" ");
}

/** STILL: taken at the put-down; shown before the page's first frame; replaced by the page with no film between. */
export function judgeStill(seen: LastStillSeen["still"]): string[] {
  const out: string[] = [];
  if (seen.putDown.taken.after !== seen.putDown.taken.before + 1)
    out.push(
      `STILL: the put-down took ${seen.putDown.taken.after - seen.putDown.taken.before} stills, not one`,
    );
  if (seen.putDown.said === null) out.push("STILL: no still on the shelf after the put-down");
  if (seen.rested === null || !seen.rested.rested)
    out.push("STILL: the pane was not at rest before the reload — its page would not load again");
  if (!seen.shown.reloaded) out.push("STILL: the desk did not come back after the reload");
  if (seen.shown.waiting < 1)
    out.push("STILL: no load waited at the fixture's gate — the page was never asked for again");
  const face = seen.shown.face;
  if (face === null) out.push("STILL: after the reload the pane has no face");
  else {
    if (face.still === null)
      out.push("STILL: before its page's first frame the pane does not say its texture is a still");
    if (face.bytes === 0)
      out.push("STILL: before its page's first frame the pane holds no texture — the film");
    if (face.state !== "starting" && face.state !== "paused")
      out.push(
        `STILL: before its page's first frame the pane says ${face.state}, not starting or paused`,
      );
    if (face.presented !== 0)
      out.push(
        `STILL: ${face.presented} frames of the page landed while its load waited at the gate`,
      );
  }
  if (!seen.shown.mark)
    out.push("STILL: the head of the pane showing its still carries no rest mark");
  out.push(...shown("STILL", "the page's area before the page's first frame", seen.shown.page));
  const runs = seen.handOver.runs.split(" ").filter((r) => r !== "");
  const kinds = runs.map((r) => r[0]);
  const firstStill = kinds.indexOf("S");
  if (firstStill < 0)
    out.push(`STILL: the hand-over never showed the still (${seen.handOver.runs})`);
  else {
    if (kinds.slice(firstStill).some((k) => k === "F" || k === "-"))
      out.push(
        `STILL: the film showed between the still and the page (${seen.handOver.runs}) — a frame with neither`,
      );
    if (kinds[kinds.length - 1] !== "L")
      out.push(`STILL: the hand-over did not end on the page's own frame (${seen.handOver.runs})`);
  }
  if (seen.handOver.captures < 3)
    out.push(`STILL: only ${seen.handOver.captures} captures were made across the hand-over`);
  if (seen.handOver.worstFilm > STILL_ROWS.shown.film)
    out.push(
      `STILL: a capture across the hand-over was ${(seen.handOver.worstFilm * 100).toFixed(1)}% film — the film flashed between the still and the page`,
    );
  if (seen.handOver.leastHue < STILL_ROWS.shown.hue)
    out.push(
      `STILL: a capture across the hand-over was ${(seen.handOver.leastHue * 100).toFixed(1)}% the fixture's hue — the page's area was not the page's`,
    );
  const after = seen.handOver.face;
  if (after === null || after.still !== null || after.state !== "live" || after.presented < 1)
    out.push(
      `STILL: after the hand-over the pane is ${after?.state ?? "gone"} (still ${after !== null && after.still !== null}, ${after?.presented ?? 0} frames) — the page did not replace its still`,
    );
  if (seen.handOver.mark) out.push("STILL: the head of the live page still carries the rest mark");
  return out;
}

/** TWO-WINDOWS: each window's pane alive; A's click reaches B through the document; B follows once and writes nothing back. */
export function judgeTwoWindows(seen: LastStillSeen["twoWindows"]): string[] {
  if (seen === null) return ["TWO-WINDOWS: the row did not run"];
  const out: string[] = [];
  if (!seen.joined)
    out.push("TWO-WINDOWS: the second window never held the pane — it did not join the document");
  if (seen.pages !== 2)
    out.push(`TWO-WINDOWS: main holds ${seen.pages} pages at the pane's address, not one a window`);
  for (const [name, face] of [
    ["A", seen.faces.a],
    ["B", seen.faces.b],
  ] as const)
    if (face === null || !face.alive || face.state !== "live")
      out.push(
        `TWO-WINDOWS: window ${name}'s pane is ${face?.state ?? "without a face"} — not alive`,
      );
  if (seen.served.after - seen.served.before !== 2)
    out.push(
      `TWO-WINDOWS: /next was served ${seen.served.after - seen.served.before} times after A's click, not twice — A's page and B's following it`,
    );
  if (seen.served.later !== seen.served.after)
    out.push(
      `TWO-WINDOWS: /next was served ${seen.served.later - seen.served.after} more times a moment later — a page followed more than once`,
    );
  if (seen.url.a === null || !seen.url.a.endsWith("/next"))
    out.push(`TWO-WINDOWS: A's document says the pane is at ${seen.url.a}, not /next`);
  if (seen.url.b !== seen.url.a)
    out.push(
      `TWO-WINDOWS: B's document says ${seen.url.b}, A's ${seen.url.a} — the url did not reach B`,
    );
  if (seen.handedBack !== 0)
    out.push(
      `TWO-WINDOWS: B handed ${seen.handedBack} commits of its own back while it followed — it wrote the address it was sent to`,
    );
  if (seen.navigations.b !== 1)
    out.push(
      `TWO-WINDOWS: B's desk sent its page ${seen.navigations.b} navigations, not the one that follows A`,
    );
  if (seen.navigations.a !== 0)
    out.push(
      `TWO-WINDOWS: A's desk sent its own page ${seen.navigations.a} navigations — its page went by its click`,
    );
  return out;
}

/** MEMORY: the three numbers read, with the desk as it says it stood for each. */
export function judgeMemory(seen: LastStillSeen["memory"]): string[] {
  if (seen === null) return ["MEMORY: the row did not run"];
  const out: string[] = [];
  for (const [name, m] of [
    ["no page", seen.none],
    ["one page", seen.one],
    ["six pages", seen.six],
    ["six alive and fourteen at rest", seen.many],
  ] as const)
    if (m === null || !(m.mb > 0)) out.push(`MEMORY: the app's memory with ${name} was not read`);
  const { alive, panes } = STILL_ROWS.memory;
  if (seen.alive !== alive || seen.pages !== alive)
    out.push(
      `MEMORY: at the last read ${seen.alive} faces were alive and main held ${seen.pages} pages, not ${alive}`,
    );
  if (seen.rested !== panes - alive)
    out.push(`MEMORY: ${seen.rested} faces were at rest, not ${panes - alive}`);
  if (seen.shelf === null || seen.shelf.stills < panes)
    out.push(`MEMORY: the shelf keeps ${seen.shelf?.stills ?? 0} stills, not the ${panes} panes'`);
  if (seen.peak > STILL_ROWS.memory.making)
    out.push(
      `MEMORY: main held ${seen.peak} pages at once — past the ${STILL_ROWS.memory.making} the row allows itself`,
    );
  if (seen.one !== null && seen.six !== null && seen.six.mb <= seen.one.mb)
    out.push(
      `MEMORY: six pages (${seen.six.mb} MB) weigh no more than one (${seen.one.mb} MB) — the reads are not of what they say`,
    );
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The rows' driver: PT-2's (its `reload` loading the renderer with the document relay), main's own word on the desk's
 * pages and on the app's memory, and a second window joined to the smoke's mesh. */
export interface LastStillDriver extends LiveRowsDriver {
  /** Main's offscreen WebContents whose address begins with `prefix`: the pages ALIVE. */
  pages(prefix: string): readonly MainPage[];
  /** Every process's working set, summed. */
  memory(): AppMemory;
  /** A second window on a board of its own, loaded with the document relay (`?docRelay=1`), its desk ready. */
  openPeer(): Promise<BrowserWindow>;
}

/** A face's row by its key, off the door, as these rows read it. */
const FACE = (key: string): string => `(() => {
  const f = (globalThis.__vfDesk.live()?.faces ?? []).find((x) => x.key === ${JSON.stringify(key)});
  return f === undefined ? null : {
    state: f.state.is, ask: f.demand?.mode ?? null, wire: f.wire?.mode ?? null, alive: f.alive, rested: f.rested,
    still: f.still, stillAt: f.stillAt, presented: f.presented, veiled: f.veiled, bytes: f.texture?.bytes ?? 0,
  };
})()`;

/** A region of the desk captured without the marks, its pixels classified. */
const PAGE_PIXELS = (rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string => `(async () => {
  const shot = await globalThis.__vfDesk.capture({ rect: ${JSON.stringify(rect)}, marks: false });
  if (shot === undefined) return null;
  const w = shot.width, h = shot.height;
  const c = new OffscreenCanvas(w, h); const x = c.getContext("2d"); x.drawImage(shot, 0, 0, w, h); shot.close();
  const b = x.getImageData(0, 0, w, h).data;
  const classify = ${STILL_CLASSIFY};
  let hue = 0, film = 0, hi = 0;
  for (let i = 0; i < b.length; i += 4) {
    const k = classify(b[i], b[i + 1], b[i + 2]);
    if (k === 1) hue += 1; else if (k === 2) film += 1;
    const l = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
    if (l > hi) hi = l;
  }
  return { px: w * h, hue, film, lumaMax: Math.round(hi) };
})()`;

/** The hand-over's sampler: each frame, the face's texture as the pane draws it — F the film (none, or hidden), S its
 * still, L the page's own frame, - no face. Installed once the desk's door answers; true when it stands. */
const SAMPLER = (key: string): string => `(() => {
  const d = globalThis.__vfDesk;
  if (d === undefined || d.live() === null) return false;
  if (globalThis.__pt5bHandOver !== undefined) return true;
  const s = { log: [], on: true };
  globalThis.__pt5bHandOver = s;
  const tick = () => {
    if (!s.on) return;
    const f = (globalThis.__vfDesk?.live()?.faces ?? []).find((x) => x.key === ${JSON.stringify(key)});
    s.log.push(f === undefined ? "-" : f.texture === undefined || f.veiled ? "F" : f.still !== null ? "S" : "L");
    if (s.log.length < 30000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;

/**
 * The PAGE of a pane at rest on the desk (desk CSS px), from its world rect through the camera: inside the clear border,
 * under the engraved head — and a tenth in from each side of that (the pane's own eye magnifies its outline a hair, and its
 * shadow and its glass's rim are not the page).
 */
export function pageAtRest(
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  camera: { readonly x: number; readonly y: number; readonly zoom: number },
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const border = PANE.border * PANE.mm;
  const head = PANE.head * PANE.mm;
  const w = rect.w - 2 * border;
  const h = rect.h - head - border;
  return {
    x: Math.round((rect.x + border + 0.1 * w - camera.x) * camera.zoom),
    y: Math.round((rect.y + head + 0.1 * h - camera.y) * camera.zoom),
    width: Math.max(1, Math.round(0.8 * w * camera.zoom)),
    height: Math.max(1, Math.round(0.8 * h * camera.zoom)),
  };
}

/** PT-5b's rows (above). Returns the problems, each in words. */
export async function lastStillRows(d: LastStillDriver): Promise<string[]> {
  const { say, win } = d;
  let h: PaneHands = paneHands(d);
  const problems: string[] = [];
  const said: Partial<Record<keyof LastStillSeen | "gate", unknown>> = {};
  const js = <T>(expression: string): Promise<T> => h.js<T>(expression);
  const ambient = await js<string>("globalThis.__vfDesk.ambient()");
  const themeWas = await js<string>("globalThis.__vfDesk.theme()");
  await h.theme("light");
  await js(`globalThis.__vfDesk.ambient("still")`);
  d.fixture.setPlaying(false);
  d.fixture.gate(true);
  const before = await h.census();
  const origin = d.fixture.origin;
  /** The panes these rows laid, by their durable key (an entity is another after a reload). */
  const laid = new Set<string>();

  interface Pane {
    readonly key: string;
    readonly q: string;
    readonly address: string;
  }
  const at =
    (p: Pane): (() => FixtureReport | null) =>
    () =>
      d.fixture.reportAt(`/gate?p=${p.q}`);
  const waitFor = async <T>(
    label: string,
    ms: number,
    read: () => Promise<T> | T,
    ok: (v: T) => boolean,
  ): Promise<T> => {
    const deadline = Date.now() + ms;
    let last = await read();
    while (!ok(last) && Date.now() < deadline) {
      await sleep(80);
      last = await read();
    }
    if (!ok(last)) say(`SMOKE_CANVAS_STILL_UNMET ${JSON.stringify({ label, last })}`);
    return last;
  };
  const rowsNow = (): Promise<
    { entity: number; key: string | null; rect: Rect4; props: Props }[]
  > => js(`globalThis.__vfDesk.objects(${JSON.stringify(PANE.type)})`);
  const entityOf = async (p: Pane): Promise<number | null> =>
    (await rowsNow()).find((r) => r.key === p.key)?.entity ?? null;
  const face = (p: Pane): Promise<FaceSeen | null> => js<FaceSeen | null>(FACE(p.key));
  const stats = (): Promise<Record<string, number>> =>
    js("globalThis.__vfDesk.live()?.stats ?? {}");
  const stillOf = (p: Pane): Promise<StillSaid | null> =>
    js<StillSaid | null>(`globalThis.__vfDesk.pageStill(${JSON.stringify(p.key)})`);
  const settled = (): Promise<void> => js("globalThis.__vfDesk.liveSettled()");
  const pagesAt = (p: Pane): readonly MainPage[] => d.pages(p.address);
  const camera = (): Promise<{ x: number; y: number; zoom: number }> =>
    js("globalThis.__vfDesk.camera()");
  const settledCamera = async (): Promise<void> => {
    let last = "";
    for (let i = 0; i < 24; i += 1) {
      const now = JSON.stringify(await camera());
      if (now === last) return;
      last = now;
      await sleep(200);
    }
  };
  /** The view framed on some panes (the head's "Zoom to fit" over them), settled, their faces asked again. */
  const frame = async (panes: readonly Pane[]): Promise<void> => {
    const ids: number[] = [];
    for (const p of panes) {
      const e = await entityOf(p);
      if (e !== null) ids.push(e);
    }
    await js(`globalThis.__vfFieldSmoke.frame(${JSON.stringify(ids.map(String))})`);
    await settledCamera();
    await sleep(500);
  };
  const pageOf = async (p: Pane): Promise<PageSeen | null> => {
    const row = (await rowsNow()).find((r) => r.key === p.key);
    if (row === undefined) return null;
    return js<PageSeen | null>(PAGE_PIXELS(pageAtRest(row.rect, await camera())));
  };
  const markOf = async (p: Pane): Promise<boolean> => {
    const e = await entityOf(p);
    return (
      e !== null &&
      (await js<boolean>(
        `globalThis.__vfDesk.local(${JSON.stringify(PANE.type)})?.said?.(${e})?.rest === true`,
      ))
    );
  };
  const middleOf = async (p: Pane): Promise<{ x: number; y: number } | null> => {
    const row = (await rowsNow()).find((r) => r.key === p.key);
    if (row === undefined) return null;
    const c = await camera();
    const off = await h.deskAt();
    return {
      x: off.left + (row.rect.x + row.rect.w / 2 - c.x) * c.zoom,
      y: off.top + (row.rect.y + row.rect.h / 2 - c.y) * c.zoom,
    };
  };
  const select = async (p: Pane): Promise<void> => {
    await h.key("Escape");
    await settledCamera();
    const m = await middleOf(p);
    if (m === null) throw new Error(`pane ${p.q} left the board`);
    await h.press(m);
    await h.until("the pane selected", 10_000, "(globalThis.__vfDesk.anchor()?.count ?? 0) === 1");
    await sleep(250);
  };
  const pickUp = async (p: Pane): Promise<void> => {
    await select(p);
    await h.key("Return");
    const e = await entityOf(p);
    await h.until("the pane in hand", 10_000, `globalThis.__vfDesk.held()?.entity === ${e}`);
    await h.until(
      "the pick-up settled",
      10_000,
      "globalThis.__vfDesk.held()?.frame?.settled === true",
    );
    await sleep(300);
  };
  const done = async (): Promise<void> => {
    await h.pressSelector('[data-selection-bar] [data-act="done"]');
    await h.until("the pane put down by Done", 5_000, "globalThis.__vfDesk.held() === null");
    await settledCamera();
  };
  const shoot = async (name: string, w: BrowserWindow = win): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await w.capturePage()).toPNG());
  };
  /** A pane laid at a world point, pointed at its own address of the fixture; its key once the document names it. */
  const lay = async (q: string, x: number, y: number, path = "/gate?p="): Promise<Pane> => {
    const address = `${origin}${path}${q}`;
    const e = Number(
      await js<string>(
        `globalThis.__vfFieldSmoke.spawnWidget(${JSON.stringify(PANE.type)}, { x: ${x}, y: ${y}, w: ${STILL_ROWS.laid.w}, h: ${STILL_ROWS.laid.h}, props: { url: ${JSON.stringify(address)} } })`,
      ),
    );
    const key = await waitFor(
      `pane ${q}'s durable key`,
      10_000,
      async () => (await rowsNow()).find((r) => r.entity === e)?.key ?? null,
      (k) => k !== null,
    );
    if (key === null) throw new Error(`the door gives pane ${q} no durable key`);
    laid.add(key);
    return { key, q, address };
  };
  const remove = async (p: Pane): Promise<void> => {
    const e = await entityOf(p);
    if (e !== null)
      await js(`globalThis.__vfFieldSmoke.removeWidget(${JSON.stringify(String(e))})`);
    laid.delete(p.key);
  };
  const faceCount = async (
    test: (f: { alive: boolean; rested: boolean }) => boolean,
  ): Promise<number> =>
    (
      await js<{ key: string; alive: boolean; rested: boolean }[]>(
        "(globalThis.__vfDesk.live()?.faces ?? []).map((f) => ({ key: f.key, alive: f.alive, rested: f.rested }))",
      )
    ).filter((f) => laid.has(f.key) && test(f)).length;
  const cap = (n?: number): Promise<number | null> =>
    js<number | null>(`globalThis.__vfDesk.liveCap(${n === undefined ? "" : n})`);

  try {
    // ── clear ground: right of everything on the board, three laptop panes in a row ──────────────────────────────────
    const others = await js<Rect4[]>(`(() => {
      const d = globalThis.__vfDesk; const out = [];
      for (const type of Object.keys(d.census())) for (const o of d.objects(type)) out.push(o.rect);
      return out;
    })()`);
    const x0 = Math.max(0, ...others.map((r) => r.x + r.w)) + 900;
    const y0 = others.length === 0 ? 0 : Math.min(...others.map((r) => r.y));
    const step = STILL_ROWS.laid.w + STILL_ROWS.gap;
    const panes: Pane[] = [];
    for (const [i, q] of ["a", "b", "c"].entries()) panes.push(await lay(q, x0 + i * step, y0));
    await frame(panes);

    // ── REST: three alive under the desk's own cap, each with its still once it has rested in view ───────────────────
    for (const p of panes)
      await waitFor(
        `pane ${p.q} live`,
        STILL_ROWS.withinMs,
        () => face(p),
        (f) => f !== null && f.state === "live" && f.presented >= 1,
      );
    const stills: (StillSaid | null)[] = [];
    for (const p of panes)
      stills.push(
        await waitFor(
          `pane ${p.q}'s still`,
          15_000,
          () => stillOf(p),
          (s) => s !== null,
        ),
      );
    const beforeCap = {
      alive: await faceCount((f) => f.alive),
      pages: d.pages(`${origin}/gate`).length,
    };
    const alivePages = new Map<string, PageSeen | null>();
    for (const p of panes) alivePages.set(p.key, await pageOf(p));
    await shoot("pt-5b-three-alive.png");
    const capSet = await cap(STILL_ROWS.cap);
    await waitFor(
      "one pane at rest",
      STILL_ROWS.withinMs,
      () => d.pages(`${origin}/gate`).length,
      (n) => n === STILL_ROWS.cap,
    );
    await settled();
    await sleep(600);
    let third: Pane | undefined;
    for (const p of panes) if ((await face(p))?.rested === true) third = p;
    const afterCap = {
      alive: await faceCount((f) => f.alive),
      pages: d.pages(`${origin}/gate`).length,
      rested: await faceCount((f) => f.rested),
    };
    await shoot("pt-5b-third-at-rest.png");
    const restSeen: {
      -readonly [K in keyof LastStillSeen["rest"]]: LastStillSeen["rest"][K];
    } = {
      cap: capSet,
      before: beforeCap,
      stills,
      after: afterCap,
      third: {
        face: third === undefined ? null : await face(third),
        mark: third === undefined ? false : await markOf(third),
        page: third === undefined ? null : await pageOf(third),
        alive: third === undefined ? null : (alivePages.get(third.key) ?? null),
      },
      picked: { face: null, pages: 0, gave: null, before: null, after: null },
    };
    if (third === undefined) throw new Error("no pane was put to rest under the cap");
    const others2 = panes.filter((p) => p !== third);
    // the two alive paint again (the fixture plays): a rest takes a NEW still of a page that painted since its last
    const keptBefore = new Map<string, StillSaid | null>();
    for (const p of others2) keptBefore.set(p.key, await stillOf(p));
    d.fixture.setPlaying(true);
    await sleep(1200);
    await pickUp(third);
    await waitFor(
      "the third alive in hand",
      STILL_ROWS.withinMs,
      () => face(third as Pane),
      (f) => f?.alive === true && f.state === "live" && f.still === null && f.presented >= 1,
    );
    await waitFor(
      "main's pages under the cap again",
      STILL_ROWS.withinMs,
      () => d.pages(`${origin}/gate`).length,
      (n) => n === STILL_ROWS.cap,
    );
    await settled();
    d.fixture.setPlaying(false);
    let gave: Pane | undefined;
    for (const p of others2) if ((await face(p))?.rested === true) gave = p;
    restSeen.picked = {
      face: await face(third),
      pages: d.pages(`${origin}/gate`).length,
      gave: gave?.q ?? null,
      before: gave === undefined ? null : (keptBefore.get(gave.key) ?? null),
      after: gave === undefined ? null : await stillOf(gave),
    };
    said.rest = restSeen;
    problems.push(...judgeRest(restSeen));
    await shoot("pt-5b-third-in-hand.png");

    // ── HELD-NEVER: the cap lowered to 1 under the pane in hand ──────────────────────────────────────────────────────
    const tokenBefore = at(third)()?.token ?? null;
    const capOne = await cap(1);
    await waitFor(
      "the held page alone alive",
      STILL_ROWS.withinMs,
      () => d.pages(`${origin}/gate`).length,
      (n) => n === 1,
    );
    await settled();
    await sleep(800);
    const heldNever: LastStillSeen["heldNever"] = {
      cap: capOne,
      held: await face(third),
      token: { before: tokenBefore, after: at(third)()?.token ?? null },
      pages: d.pages(`${origin}/gate`).map((p) => p.url),
      own: third.address,
      rested: await faceCount((f) => f.rested),
      rests: (await stats()).rests ?? 0,
    };
    said.heldNever = heldNever;
    problems.push(...judgeHeldNever(heldNever));

    // ── STILL, its first half: the pane PUT DOWN — its still taken at the put-down ───────────────────────────────────
    // (it painted in the hand: the fixture plays a moment, so a frame landed since its last still)
    d.fixture.setPlaying(true);
    await sleep(700);
    d.fixture.setPlaying(false);
    await sleep(500);
    const takenBefore = (await stats()).stillsTaken ?? 0;
    const stillBefore = await stillOf(third);
    await done();
    const putDownSaid = await waitFor(
      "the put-down's still on the shelf",
      15_000,
      () => stillOf(third as Pane),
      (s) => s !== null && (stillBefore === null || s.takenAt > stillBefore.takenAt),
    );
    await settled();
    const putDown = {
      taken: { before: takenBefore, after: (await stats()).stillsTaken ?? 0 },
      said: putDownSaid,
    };

    // ── SILENT: the cap raised to 2 — a page woken is heard; the pane at rest has no page, seen or not ───────────────
    await frame(panes);
    const aliveWas = new Set(d.pages(`${origin}/gate`).map((p) => p.url));
    await cap(STILL_ROWS.cap);
    await waitFor(
      "a second page alive",
      STILL_ROWS.withinMs,
      () => d.pages(`${origin}/gate`).length,
      (n) => n === STILL_ROWS.cap,
    );
    await settled();
    await sleep(900);
    const wokenPage = d.pages(`${origin}/gate`).find((p) => !aliveWas.has(p.url)) ?? null;
    const wokenPane = panes.find((p) => wokenPage?.url.startsWith(p.address) === true);
    let restedPane: Pane | undefined;
    for (const p of panes) if ((await face(p))?.rested === true) restedPane = p;
    const seenCount = restedPane === undefined ? 0 : pagesAt(restedPane).length;
    // every pane out of view: their asks fall to paused
    const cam0 = await camera();
    await js(`globalThis.__vfFieldSmoke.panTo(${cam0.x + 30_000}, ${cam0.y})`);
    await waitFor(
      "every pane unseen",
      10_000,
      async () => Promise.all(panes.map((p) => face(p))),
      (fs) => fs.every((f) => f !== null && f.ask === "paused"),
    );
    await waitFor(
      "the pages muted out of view",
      10_000,
      () => d.pages(`${origin}/gate`),
      (ps) => ps.every((p) => p.muted),
    );
    const unseenPages = d.pages(`${origin}/gate`);
    const restedUnseen = restedPane === undefined ? null : await face(restedPane);
    const unseenCount = restedPane === undefined ? 0 : pagesAt(restedPane).length;
    await frame(panes);
    await waitFor(
      "the pages heard again in view",
      10_000,
      () => d.pages(`${origin}/gate`),
      (ps) => ps.length > 0 && ps.every((p) => !p.muted),
    );
    const silent: LastStillSeen["silent"] = {
      woken:
        wokenPane === undefined
          ? null
          : { address: wokenPane.address, page: pagesAt(wokenPane)[0] ?? wokenPage },
      rested:
        restedPane === undefined
          ? null
          : {
              address: restedPane.address,
              seen: seenCount,
              unseen: unseenCount,
              ask: restedUnseen?.ask ?? null,
              wire: restedUnseen?.wire ?? null,
              back: pagesAt(restedPane).length,
            },
      unseen: unseenPages,
      back: d.pages(`${origin}/gate`),
    };
    said.silent = silent;
    problems.push(...judgeSilent(silent));

    // ── BUDGET: the faces are rows of the desk's budget, their bytes the textures' ───────────────────────────────────
    await settled();
    await sleep(400);
    const facesNow = await Promise.all(panes.map((p) => face(p)));
    const budgetNow = await js<{
      cap: number;
      byOwner: Record<string, { bytes: number; entries: number }>;
    } | null>("globalThis.__vfDesk.budget()");
    const budget: LastStillSeen["budget"] = {
      owner: budgetNow?.byOwner[PANE.type] ?? null,
      faces: {
        textures: facesNow.filter((f) => f !== null && f.bytes > 0).length,
        bytes: facesNow.reduce((sum, f) => sum + (f?.bytes ?? 0), 0),
      },
      cap: budgetNow?.cap ?? null,
    };
    said.budget = budget;
    problems.push(...judgeBudget(budget));

    // ── FORGOT: the test's short grace — undone within it: page and still back; run out: both gone ───────────────────
    const grace = await js<number | null>(`globalThis.__vfDesk.liveGrace(${STILL_ROWS.graceMs})`);
    const census0 = await h.census();
    // (an ALIVE pane, so that "its page back" is the same page)
    let undoPane: Pane | undefined;
    for (const p of panes) if ((await face(p))?.alive === true && p !== third) undoPane = p;
    undoPane ??= third;
    const undoBefore = await stillOf(undoPane);
    const undoToken = at(undoPane)()?.token ?? null;
    const forgottenWas = (await stats()).stillsForgotten ?? 0;
    await select(undoPane);
    await h.key("Backspace");
    await h
      .until(
        "the pane deleted",
        5_000,
        `(globalThis.__vfDesk.census()[${JSON.stringify(PANE.type)}] ?? 0) === ${census0 - 1}`,
      )
      .catch(() => undefined);
    await sleep(350);
    await h.undoKey();
    await h
      .until(
        "the pane back by the undo",
        10_000,
        `(globalThis.__vfDesk.census()[${JSON.stringify(PANE.type)}] ?? 0) === ${census0}`,
      )
      .catch(() => undefined);
    // past the grace it was deleted under: a still not forgotten by now is kept
    await sleep(STILL_ROWS.graceMs + STILL_ROWS.graceSlackMs);
    await waitFor(
      "the undone pane's page speaking again",
      10_000,
      () => at(undoPane as Pane)()?.token ?? null,
      (t) => t !== null,
    );
    const undone: LastStillSeen["forgot"]["undone"] = {
      before: undoBefore,
      after: await stillOf(undoPane),
      token: { before: undoToken, after: at(undoPane)()?.token ?? null },
      forgotten: ((await stats()).stillsForgotten ?? 0) - forgottenWas,
    };
    // the pane deleted for good: another one, with a still
    const gonePane = panes.find((p) => p !== undoPane && p !== third) ?? panes[0];
    if (gonePane === undefined) throw new Error("no pane to delete");
    const goneBefore = await stillOf(gonePane);
    const forgottenWas2 = (await stats()).stillsForgotten ?? 0;
    await select(gonePane);
    const deletedAt = Date.now();
    await h.key("Backspace");
    await h
      .until(
        "the pane deleted",
        5_000,
        `(globalThis.__vfDesk.census()[${JSON.stringify(PANE.type)}] ?? 0) === ${census0 - 1}`,
      )
      .catch(() => undefined);
    laid.delete(gonePane.key);
    await waitFor(
      "the deleted pane's still forgotten",
      STILL_ROWS.graceMs + 8_000,
      () => stillOf(gonePane),
      (s) => s === null,
    );
    await waitFor(
      "the deleted pane's page gone",
      8_000,
      () => pagesAt(gonePane).length,
      (n) => n === 0,
    );
    const forgot: LastStillSeen["forgot"] = {
      graceMs: grace,
      undone,
      gone: {
        before: goneBefore,
        after: await stillOf(gonePane),
        pages: pagesAt(gonePane).length,
        forgotten: ((await stats()).stillsForgotten ?? 0) - forgottenWas2,
        waitedMs: Date.now() - deletedAt,
      },
    };
    said.forgot = forgot;
    problems.push(...judgeForgot(forgot));
    await js("globalThis.__vfDesk.liveGrace(null)");
    const left = panes.filter((p) => p !== gonePane);

    // ── STILL, its second half: the put-down pane at rest, the window RELOADED with the gate shut ─────────────────────
    await frame(left);
    // the put-down pane is the one at rest: the other is picked up and put down (it is the most recently seen), the cap 1
    const other = left.find((p) => p !== third);
    await cap(1);
    if (other !== undefined && (await face(third))?.rested !== true) {
      await pickUp(other);
      await done();
    }
    const restedFace = await waitFor(
      "the put-down pane at rest",
      STILL_ROWS.withinMs,
      () => face(third as Pane),
      (f) => f?.rested === true && f.wire === "hibernated",
    );
    await waitFor(
      "its page gone from main",
      10_000,
      () => pagesAt(third as Pane).length,
      (n) => n === 0,
    );
    await settled();
    d.fixture.gate(false);
    const gatedWas = d.fixture.gated();
    const reloading = d.reload();
    let sampling = false;
    const armed = Date.now();
    while (!sampling && Date.now() - armed < 60_000) {
      try {
        sampling = await win.webContents.executeJavaScript(SAMPLER(third.key), true);
      } catch {
        sampling = false;
      }
      if (!sampling) await sleep(15);
    }
    const reloaded = await reloading;
    h = paneHands(d);
    await sleep(600);
    await frame(left);
    const shownFace = await waitFor(
      "the pane on its still, its load waiting at the gate",
      STILL_ROWS.withinMs,
      async () => ({ f: await face(third as Pane), waiting: d.fixture.gated().waiting }),
      (v) => v.f !== null && v.f.still !== null && v.waiting >= 1,
    );
    await sleep(500);
    const shown: LastStillSeen["still"]["shown"] = {
      reloaded,
      waiting: d.fixture.gated().waiting,
      face: shownFace.f,
      mark: await markOf(third),
      page: await pageOf(third),
    };
    await shoot("pt-5b-still-before-first-frame.png");
    // the hand-over: captures of the page's area as fast as they come, the gate opened under them
    const row = (await rowsNow()).find((r) => r.key === (third as Pane).key);
    const area = row === undefined ? null : pageAtRest(row.rect, await camera());
    const captures: PageSeen[] = [];
    let opened = false;
    const from = Date.now();
    let liveSince = 0;
    while (Date.now() - from < 40_000) {
      if (area !== null) {
        const c = await js<PageSeen | null>(PAGE_PIXELS(area));
        if (c !== null) captures.push(c);
      }
      if (!opened && captures.length >= 3) {
        d.fixture.gate(true);
        opened = true;
      }
      const f = await face(third);
      if (opened && f !== null && f.still === null && f.presented >= 1) {
        liveSince += 1;
        if (liveSince >= 4) break;
      }
    }
    d.fixture.gate(true);
    const frames = await js<string[]>(
      "(() => { const s = globalThis.__pt5bHandOver; if (s === undefined) return []; s.on = false; return s.log; })()",
    );
    const still: LastStillSeen["still"] = {
      putDown,
      rested: restedFace,
      shown,
      handOver: {
        runs: runsOf(frames),
        captures: captures.length,
        worstFilm: Math.max(0, ...captures.map((c) => share(c.film, c.px))),
        leastHue: captures.length === 0 ? 0 : Math.min(...captures.map((c) => share(c.hue, c.px))),
        face: await face(third),
        mark: await markOf(third),
      },
    };
    said.still = still;
    said.gate = { before: gatedWas, after: d.fixture.gated() };
    problems.push(...judgeStill(still));
    await shoot("pt-5b-still-after-hand-over.png");

    // ── TWO-WINDOWS: a second window joined to the document; A's click; B follows once and writes nothing back ───────
    try {
      const twoWindows = await twoWindowRows(third);
      said.twoWindows = twoWindows;
      problems.push(...judgeTwoWindows(twoWindows));
    } catch (error) {
      problems.push(`TWO-WINDOWS: ${error instanceof Error ? error.message : String(error)}`);
    }

    // ── MEMORY: no page, one, six, six beside fourteen at rest ───────────────────────────────────────────────────────
    for (const p of left) await remove(p);
    try {
      const memory = await memoryRows(x0, y0 + STILL_ROWS.laid.h + 1200);
      said.memory = memory;
      problems.push(...judgeMemory(memory));
    } catch (error) {
      problems.push(`MEMORY: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    // a step that cannot go on ends the rows — never what the rows before it found (they are said with it)
    problems.push(`PT-5b STILL: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    d.fixture.setPlaying(false);
    d.fixture.gate(true);
    say(`SMOKE_CANVAS_STILL ${JSON.stringify(said)}`);
    try {
      if ((await js<number | null>("globalThis.__vfDesk.held()?.entity ?? null")) !== null)
        await done();
      await js("globalThis.__vfDesk.liveGrace(300)");
      for (const row of await rowsNow())
        if (row.key !== null && laid.has(row.key))
          await js(`globalThis.__vfFieldSmoke.removeWidget(${JSON.stringify(String(row.entity))})`);
      await sleep(900);
      await js("globalThis.__vfDesk.liveGrace(null)");
      await js(`globalThis.__vfDesk.liveCap(6)`);
      await js("globalThis.__vfFieldSmoke.frame([])");
    } catch {
      /* a row that cannot go on ends the rows, never what the earlier rows found */
    }
    const after = await h.census().catch(() => -1);
    if (after !== before)
      problems.push(
        `CLEARED: ${after} panes on the board after the still rows, not the ${before} found`,
      );
    say(`SMOKE_CANVAS_STILL_CLEARED ${JSON.stringify({ before, after })}`);
    await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient)})`).catch(() => undefined);
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(themeWas)})`).catch(() => undefined);
  }
  return problems;

  /** TWO-WINDOWS (ruling 6), on the pane `p` of window A. */
  async function twoWindowRows(p: Pane): Promise<LastStillSeen["twoWindows"]> {
    const a = win;
    const b = await d.openPeer();
    const jsB = <T>(expression: string): Promise<T> =>
      b.webContents.executeJavaScript(expression, true) as Promise<T>;
    try {
      await js("globalThis.__vfDesk.liveCap(6)");
      await frame([p]);
      await waitFor(
        "A's pane alive",
        STILL_ROWS.withinMs,
        () => face(p),
        (f) => f?.alive === true && f.state === "live",
      );
      // B joins A's document whole, then follows A's local commits as a lane hands a peer's
      const whole = await js<string | null>("globalThis.__vfDesk.docSnapshot?.() ?? null");
      if (whole === null)
        throw new Error(
          "window A lends no document relay (its page was not loaded with ?docRelay=1)",
        );
      await js("globalThis.__vfDesk.docTap()");
      await jsB(`globalThis.__vfDesk.docApply([${JSON.stringify(whole)}])`);
      let relaying = true;
      const relay = (async () => {
        while (relaying) {
          try {
            const sent = await js<string[]>("globalThis.__vfDesk.docTap()");
            if (sent.length > 0) await jsB(`globalThis.__vfDesk.docApply(${JSON.stringify(sent)})`);
          } catch {
            /* a window on its way out */
          }
          await sleep(40);
        }
      })();
      const eB = await waitFor(
        "the pane in B's document",
        STILL_ROWS.withinMs,
        async () =>
          (
            await jsB<{ entity: number; key: string | null }[]>(
              `globalThis.__vfDesk.objects(${JSON.stringify(PANE.type)})`,
            )
          ).find((r) => r.key === p.key)?.entity ?? null,
        (e) => e !== null,
      );
      const joined = eB !== null;
      if (eB !== null)
        await jsB(`globalThis.__vfFieldSmoke.frame([${JSON.stringify(String(eB))}])`);
      const faceB = (): Promise<FaceSeen | null> => jsB<FaceSeen | null>(FACE(p.key));
      await waitFor(
        "B's pane alive on a page of its own",
        STILL_ROWS.withinMs,
        async () => ({ f: await faceB(), pages: d.pages(p.address).length }),
        (v) => v.f?.alive === true && v.f.state === "live" && v.pages === 2,
      );
      await sleep(800);
      const pages = d.pages(p.address).length;
      const faces = { a: await face(p), b: await faceB() };
      // what B handed back so far (its own boot, its join) is spent; the navigations counted from here
      await jsB("globalThis.__vfDesk.docTap()");
      const navA = (await stats()).navigations ?? 0;
      const navB =
        (await jsB<Record<string, number>>("globalThis.__vfDesk.live()?.stats ?? {}"))
          .navigations ?? 0;
      const servedBefore = d.fixture.served("/next");
      // A's page navigates by a click on its link, in hand
      await pickUp(p);
      const frameA = await js<HeldFrameSeen | null>("globalThis.__vfDesk.held()?.frame ?? null");
      const report = at(p)();
      if (frameA === null || report === null)
        throw new Error("A's pane is not in hand on a page that spoke");
      const link = report.parts.link;
      await h.press(
        pageOnWindow(
          frameA,
          report.view,
          await h.deskAt(),
          link.x + link.w / 2,
          link.y + link.h / 2,
        ),
      );
      await waitFor(
        "/next served to both pages",
        STILL_ROWS.withinMs,
        () => d.fixture.served("/next"),
        (n) => n >= servedBefore + 2,
      );
      const servedAfter = d.fixture.served("/next");
      await sleep(3_000);
      const urlOf = async (run: <T>(e: string) => Promise<T>): Promise<string | null> =>
        (
          await run<{ key: string | null; props: Props }[]>(
            `globalThis.__vfDesk.objects(${JSON.stringify(PANE.type)})`,
          )
        ).find((r) => r.key === p.key)?.props.url ?? null;
      const out: LastStillSeen["twoWindows"] = {
        joined,
        pages,
        faces,
        served: { before: servedBefore, after: servedAfter, later: d.fixture.served("/next") },
        url: { a: await urlOf(js), b: await urlOf(jsB) },
        handedBack: (await jsB<string[]>("globalThis.__vfDesk.docTap()")).length,
        navigations: {
          a: ((await stats()).navigations ?? 0) - navA,
          b:
            ((await jsB<Record<string, number>>("globalThis.__vfDesk.live()?.stats ?? {}"))
              .navigations ?? 0) - navB,
        },
      };
      await shoot("pt-5b-two-windows-a.png", a);
      await shoot("pt-5b-two-windows-b.png", b);
      relaying = false;
      await relay;
      await done();
      return out;
    } finally {
      if (!b.isDestroyed()) b.destroy();
      await sleep(600);
    }
  }

  /**
   * MEMORY (ruling 3): the app with no page, one, six, and six beside fourteen at rest — twenty laptop panes laid from
   * (x, y) in two blocks of ten (5 × 2 each, a wide gap between: a view framed on one block sees none of the other). Each
   * of the fourteen is alive once (its still made), a block at a time — never more than ten pages at once.
   */
  async function memoryRows(x: number, y: number): Promise<LastStillSeen["memory"]> {
    const { panes: count, alive, making, settleMs } = STILL_ROWS.memory;
    /** The app's memory once it has settled: the least of three reads (a working set swells on a transient). */
    const read = async (): Promise<AppMemory> => {
      await sleep(settleMs);
      let least = d.memory();
      for (let i = 0; i < 2; i += 1) {
        await sleep(700);
        const now = d.memory();
        if (now.mb < least.mb) least = now;
      }
      return least;
    };
    await js("globalThis.__vfDesk.liveGrace(300)");
    await waitFor(
      "no page left in main",
      20_000,
      () => d.pages(origin).length,
      (n) => n === 0,
    );
    await js("globalThis.__vfDesk.liveGrace(null)");
    await js(`globalThis.__vfDesk.liveCap(${alive})`);
    const none = await read();
    const grid: Pane[] = [];
    const cell = { w: STILL_ROWS.laid.w + STILL_ROWS.gap, h: STILL_ROWS.laid.h + STILL_ROWS.gap };
    const layAt = (i: number): Promise<Pane> => {
      const block = Math.floor(i / making);
      const at = i % making;
      return lay(
        `m${i}`,
        x + block * (5 * cell.w + 1400) + (at % 5) * cell.w,
        y + Math.floor(at / 5) * cell.h,
        "/page?m=",
      );
    };
    const pagesNow = (): number => d.pages(`${origin}/page?m=`).length;
    let peak = 0;
    const watch = setInterval(() => {
      peak = Math.max(peak, pagesNow());
    }, 100);
    /** Every pane of a block alive once, its still on the shelf — or the row ends in words. */
    const made = async (block: readonly Pane[]): Promise<void> => {
      await frame(block);
      const deadline = Date.now() + 90_000;
      for (;;) {
        const stills = await Promise.all(block.map((p) => stillOf(p)));
        if (stills.every((s) => s !== null)) return;
        if (Date.now() > deadline)
          throw new Error(
            `${stills.filter((s) => s === null).length} of a block's ${block.length} panes had no still after 90 s`,
          );
        await sleep(300);
      }
    };
    try {
      grid.push(await layAt(0));
      await frame(grid);
      await waitFor("one page alive", STILL_ROWS.withinMs, pagesNow, (n) => n === 1);
      await waitFor(
        "the page live",
        STILL_ROWS.withinMs,
        () => face(grid[0] as Pane),
        (f) => f?.state === "live",
      );
      const one = await read();
      for (let i = 1; i < alive; i += 1) grid.push(await layAt(i));
      await frame(grid);
      await waitFor("six pages alive", STILL_ROWS.withinMs, pagesNow, (n) => n === alive);
      for (const p of grid)
        await waitFor(
          `pane ${p.q} live`,
          STILL_ROWS.withinMs,
          () => face(p),
          (f) => f?.state === "live",
        );
      const six = await read();
      // the other fourteen: each alive once, a block at a time
      for (let i = alive; i < count; i += 1) grid.push(await layAt(i));
      await js(`globalThis.__vfDesk.liveCap(${making})`);
      await made(grid.slice(0, making));
      await made(grid.slice(making));
      await frame(grid);
      await js(`globalThis.__vfDesk.liveCap(${alive})`);
      await waitFor(
        "six pages alive beside fourteen at rest",
        60_000,
        pagesNow,
        (n) => n === alive,
      );
      await settled();
      await waitFor(
        "fourteen faces at rest",
        STILL_ROWS.withinMs,
        () => faceCount((f) => f.rested),
        (n) => n === count - alive,
      );
      const many = await read();
      await shoot("pt-5b-six-and-fourteen.png");
      const budgetNow = await js<{ byOwner: Record<string, { bytes: number }> } | null>(
        "globalThis.__vfDesk.budget()",
      );
      return {
        none,
        one,
        six,
        many,
        alive: await faceCount((f) => f.alive),
        rested: await faceCount((f) => f.rested),
        pages: pagesNow(),
        shelf: await js("globalThis.__vfDesk.pageStills()"),
        budget: budgetNow?.byOwner[PANE.type]?.bytes ?? null,
        peak,
      };
    } finally {
      clearInterval(watch);
    }
  }
}

interface Rect4 {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
type Props = Readonly<Record<string, string | undefined>>;
