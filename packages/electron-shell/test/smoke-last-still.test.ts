/**
 * PT-5b — the last still and the many, in the product (testing/smoke-last-still.ts): the judges the rows hold the product to —
 * REST, HELD-NEVER, SILENT, BUDGET, FORGOT, STILL, TWO-WINDOWS and MEMORY — each passing what the product should do and
 * failing, in words with its numbers, what it should not; the still's pixel classifier (the fixture's ground at the page's
 * own light and at a photograph's dimmer one, the film, anything else); a pane's page at rest through the camera; and the
 * hand-over's frames read as runs. PT-5b2: SWEEP and EVICTED; a photograph's ground held to the live page's at THE LAW'S DIM
 * (REST, STILL — a still through the wrong transfer curve does not pass); what EVICTED's watcher saw, read.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_HUE } from "../src/testing/live-fixture";
import {
  dimmed,
  type FaceSeen,
  judgeBudget,
  judgeEvicted,
  judgeForgot,
  judgeHeldNever,
  judgeMemory,
  judgeRest,
  judgeSilent,
  judgeStill,
  judgeSweep,
  judgeTwoWindows,
  judgeUnderWords,
  type LastStillSeen,
  type PageSeen,
  pageAtRest,
  runsOf,
  STILL_CLASSIFY,
  STILL_HUE_DEG,
  STILL_ROWS,
  type StillSaid,
  seenAgain,
} from "../src/testing/smoke-last-still";

const ORIGIN = "http://127.0.0.1:60348";
const stillAt = (q: string, takenAt: number, over: Partial<StillSaid> = {}): StillSaid => ({
  address: `${ORIGIN}/gate?p=${q}`,
  logical: [1280, 800],
  size: [1600, 1000],
  type: "image/webp",
  bytes: 10_368,
  takenAt,
  keptAt: takenAt + 70,
  ...over,
});
const LIVE: FaceSeen = {
  state: "live",
  reason: null,
  ask: "live",
  wire: "live",
  alive: true,
  rested: false,
  still: null,
  stillAt: 1_000,
  presented: 24,
  veiled: false,
  bytes: 21_845_272,
};
const RESTED: FaceSeen = {
  ...LIVE,
  state: "paused",
  wire: "hibernated",
  alive: false,
  rested: true,
  still: 1_000,
  presented: 1,
};
const PAGE: PageSeen = {
  px: 171_872,
  hue: 128_753,
  film: 0,
  lumaMax: 255,
  ink: 9_000,
  hueLuma: 104.2,
  // (the fixture's ground under the desk's lamp, as a green run read it)
  ground: [46.6, 116.3, 218.1],
};
/** The page as its photograph (a green run's reading: the law's dim of the page's light, within a level or two). */
const DIM: PageSeen = { ...PAGE, lumaMax: 220, hueLuma: 89.6, ground: [43.5, 101.3, 186.9] };
/** A page's area read back, the rest as the fixture's own. */
const area = (over: Partial<PageSeen>): PageSeen => ({ ...PAGE, ...over });

describe("the last still and the many — its rows", () => {
  const rest: LastStillSeen["rest"] = {
    cap: 2,
    before: { alive: 3, pages: 3 },
    stills: [stillAt("a", 1_000), stillAt("b", 1_000), stillAt("c", 1_030)],
    after: { alive: 2, pages: 2, rested: 1 },
    third: { face: RESTED, mark: true, page: DIM, alive: PAGE },
    picked: {
      face: LIVE,
      pages: 2,
      gave: "c",
      before: stillAt("c", 1_030),
      after: stillAt("c", 4_800),
    },
  };

  it("REST: two alive under the cap, the third on its still — paused, said, marked, its page's area the fixture's hue a step dimmer; picked up it comes alive and another rests, its still kept first", () => {
    expect(judgeRest(rest)).toEqual([]);
    // the cap never fell: three alive, nothing at rest, the pane's face its page's own
    expect(
      judgeRest({
        ...rest,
        after: { alive: 3, pages: 3, rested: 0 },
        third: { face: null, mark: false, page: null, alive: null },
      }),
    ).toEqual([
      "REST: under a cap of 2, 3 faces are alive and main holds 3 pages",
      "REST: 0 faces are at rest, not the third alone",
      "REST: the pane at rest has no face",
      "REST: the head of the pane at rest carries no rest mark",
      "REST: the page's area of the pane at rest could not be read",
      "REST: the pane's page was not read while it was alive",
    ]);
    // a pane put to rest with no still shown: the film — and passed off as nothing
    expect(
      judgeRest({
        ...rest,
        third: {
          face: { ...RESTED, still: null, state: "starting", wire: "paused" },
          mark: false,
          page: area({ px: 1000, hue: 0, film: 990, lumaMax: 30, ink: 0, hueLuma: 0 }),
          alive: PAGE,
        },
      }),
    ).toEqual([
      "REST: the pane at rest says starting, not paused",
      "REST: the pane at rest does not say its texture is a still",
      "REST: the pane at rest is asked paused on its wire, not hibernated",
      "REST: the head of the pane at rest carries no rest mark",
      "REST: the page's area of the pane at rest is 0.0% the fixture's hue, not 40% — the page is not drawn there",
      "REST: the page's area of the pane at rest is 99.0% film — the pane shows its dark film",
    ]);
    // a still drawn at the page's own light: passed off as the page
    expect(judgeRest({ ...rest, third: { ...rest.third, page: PAGE } })).toEqual([
      "REST: the still's brightest pixel is 255 against the live page's 255 — a still is not drawn dimmer than its page",
      "REST: the pane at rest's ground reads rgb(46.6, 116.3, 218.1) where the live page's rgb(46.6, 116.3, 218.1) at the law's dim (0.7 of the page's light) is rgb(43.1, 100.2, 186.8) — 31.3 off on a channel, past the 4 the row allows: the photograph is not drawn at the law's dim",
    ]);
    // PT-5b2 — a still through the WRONG TRANSFER CURVE: the fixture's hue yet, and dimmer than its page (all the row held
    // it to before) — not the page's ground at the law's dim
    expect(
      judgeRest({
        ...rest,
        third: { ...rest.third, page: { ...DIM, hueLuma: 55.6, ground: [12.1, 61.5, 152.3] } },
      }),
    ).toEqual([
      "REST: the pane at rest's ground reads rgb(12.1, 61.5, 152.3) where the live page's rgb(46.6, 116.3, 218.1) at the law's dim (0.7 of the page's light) is rgb(43.1, 100.2, 186.8) — 38.7 off on a channel, past the 4 the row allows: the photograph is not drawn at the law's dim",
    ]);
    // the rest hibernated its page WITHOUT taking its still first: the shelf's is the old one
    expect(judgeRest({ ...rest, picked: { ...rest.picked, after: stillAt("c", 1_030) } })).toEqual([
      "REST: the pane put to rest kept no newer still (taken 1030 → 1030, kept 1100 → 1100) — its still was not taken first",
    ]);
    // picked up, the pane stays on its still; nobody gives it a slot
    expect(
      judgeRest({
        ...rest,
        picked: { face: RESTED, pages: 2, gave: null, before: null, after: null },
      }),
    ).toEqual([
      "REST: picked up, the pane is paused (alive false, rested true, still true) — it did not come alive",
      "REST: no pane was put to rest for the one picked up",
    ]);
    // the stills as kept: a picture, at most 1600 px, its page's logical size and its own address beside it
    expect(
      judgeRest({
        ...rest,
        stills: [
          null,
          stillAt("b", 1_000, { size: [2560, 1600], bytes: 120, type: "text/plain" }),
          stillAt("c", 1_030, { logical: [2560, 1600], address: `${ORIGIN}/elsewhere` }),
        ],
      }),
    ).toEqual([
      "REST: pane 1 had no still on the shelf after resting in view",
      "REST: pane 2's still is 120 bytes of text/plain — no picture",
      "REST: pane 2's still is 2560 × 1600 — past 1600 px on its long side",
      "REST: pane 3's still says its page is 2560 × 1600, not 1280 × 800",
      `REST: pane 3's still is of ${ORIGIN}/elsewhere — not its page's address`,
    ]);
    expect(judgeRest({ ...rest, cap: 6, before: { alive: 2, pages: 2 } }).slice(0, 2)).toEqual([
      "REST: the test door set the cap to 6, not 2",
      "REST: before the cap fell 2 faces were alive and main held 2 pages, not the three panes' — the row proved nothing",
    ]);
  });

  it("HELD-NEVER: the cap lowered to 1 under the pane in hand — the others go; the held page stays, the same one, main's only page", () => {
    const seen: LastStillSeen["heldNever"] = {
      cap: 1,
      held: LIVE,
      token: { before: "t-1", after: "t-1" },
      pages: [`${ORIGIN}/gate?p=a`],
      own: `${ORIGIN}/gate?p=a`,
      rested: 2,
      rests: 3,
    };
    expect(judgeHeldNever(seen)).toEqual([]);
    // the held page put to rest for the cap
    expect(
      judgeHeldNever({
        ...seen,
        held: RESTED,
        token: { before: "t-1", after: "t-9" },
        pages: [`${ORIGIN}/gate?p=b`],
        rested: 1,
      }),
    ).toEqual([
      "HELD-NEVER: under a cap of 1 the pane in hand is paused (alive false, rested true, asked hibernated) — the held page was put to rest",
      "HELD-NEVER: the held page's token was t-1 and is t-9 — not the same page",
      `HELD-NEVER: main holds ${JSON.stringify([`${ORIGIN}/gate?p=b`])}, not the held pane's page alone (${ORIGIN}/gate?p=a)`,
      "HELD-NEVER: 1 faces are at rest, not the two others",
    ]);
    expect(judgeHeldNever({ ...seen, cap: 2, held: null, pages: [] })).toEqual([
      "HELD-NEVER: the test door set the cap to 2, not 1",
      "HELD-NEVER: the pane in hand has no face",
      `HELD-NEVER: main holds [], not the held pane's page alone (${ORIGIN}/gate?p=a)`,
    ]);
  });

  it("SILENT: a page woken under a live ask is heard; a pane at rest has no page — seen, out of view (its ask paused) or back — so none is born silent; pages alive are muted out of view and heard again seen", () => {
    const a = { id: 6, url: `${ORIGIN}/gate?p=a`, muted: false };
    const b = { id: 7, url: `${ORIGIN}/gate?p=b`, muted: false };
    const seen: LastStillSeen["silent"] = {
      woken: { address: b.url, page: b },
      rested: {
        address: `${ORIGIN}/gate?p=c`,
        seen: 0,
        unseen: 0,
        ask: "paused",
        wire: "hibernated",
        back: 0,
      },
      unseen: [
        { ...a, muted: true },
        { ...b, muted: true },
      ],
      back: [a, b],
    };
    expect(judgeSilent(seen)).toEqual([]);
    // a page woken muted: seen, and not heard
    expect(
      judgeSilent({ ...seen, woken: { address: b.url, page: { ...b, muted: true } } }),
    ).toEqual([
      "SILENT: the page woken under a live ask was born MUTED — it is seen, and not heard",
    ]);
    // a window made for a pane at rest whose ask fell to paused
    expect(
      judgeSilent({
        ...seen,
        rested: { ...(seen.rested as NonNullable<typeof seen.rested>), unseen: 1, back: 1 },
      }),
    ).toEqual([
      "SILENT: the pane at rest has 0 pages in main seen, 1 out of view, 1 back — a page was made for a pane at rest",
    ]);
    // a page heard out of view; one still muted back in view
    expect(
      judgeSilent({
        ...seen,
        unseen: [a, { ...b, muted: true }],
        back: [{ ...a, muted: true }, b],
      }),
    ).toEqual([
      `SILENT: out of view the page at ${a.url} is NOT muted`,
      `SILENT: back in view the page at ${a.url} is still muted`,
    ]);
    expect(judgeSilent({ woken: null, rested: null, unseen: [], back: [] })).toEqual([
      "SILENT: no page came alive when the cap was raised",
      "SILENT: no pane was left at rest — the row proved nothing",
      "SILENT: no page was alive out of view — the row proved nothing",
    ]);
    expect(
      judgeSilent({
        ...seen,
        woken: { address: b.url, page: null },
        rested: { ...(seen.rested as NonNullable<typeof seen.rested>), ask: "live", wire: "live" },
        back: [a],
      }),
    ).toEqual([
      `SILENT: the page woken (${b.url}) is not among main's pages`,
      "SILENT: out of view the pane at rest asks live, not paused — the row proved nothing",
      "SILENT: out of view the pane at rest is asked LIVE on its wire",
      "SILENT: 1 pages are alive back in view, not the 2 there were",
    ]);
  });

  it("BUDGET: the faces are rows of the desk's budget under the kind's name — as many as hold a texture, their bytes the textures'", () => {
    const seen: LastStillSeen["budget"] = {
      owner: { bytes: 65_535_816, entries: 3 },
      faces: { textures: 3, bytes: 65_535_816 },
      cap: 268_435_456,
    };
    expect(judgeBudget(seen)).toEqual([]);
    // PT-2 built none of it: no row at all
    expect(judgeBudget({ ...seen, owner: null })).toEqual([
      "BUDGET: the desk's budget has no row of vibefield.browser-pane (cap 268435456)",
    ]);
    // a face not charged; a charge that is not the texture's bytes
    expect(judgeBudget({ ...seen, owner: { bytes: 43_690_544, entries: 2 } })).toEqual([
      "BUDGET: the kind has 2 rows of the budget for 3 faces holding a texture",
      "BUDGET: the kind's rows hold 43690544 bytes, the faces' textures 65535816",
    ]);
    expect(
      judgeBudget({ owner: { bytes: 0, entries: 0 }, faces: { textures: 0, bytes: 0 }, cap: null }),
    ).toEqual([
      "BUDGET: no face holds a texture — the row proved nothing",
      "BUDGET: the budget's cap is null",
    ]);
  });

  it("FORGOT: undone within the grace, the pane's page — the same one — and its still are back; its grace run out, both are gone and the still counted forgotten", () => {
    const seen: LastStillSeen["forgot"] = {
      graceMs: STILL_ROWS.graceMs,
      undone: {
        before: stillAt("b", 2_000),
        after: stillAt("b", 2_000),
        token: { before: "t-b", after: "t-b" },
        forgotten: 0,
      },
      gone: { before: stillAt("c", 2_100), after: null, pages: 0, forgotten: 1, waitedMs: 2_713 },
    };
    expect(judgeForgot(seen)).toEqual([]);
    // the still forgotten AT the delete: the undo finds its page and no still; its page another one
    expect(
      judgeForgot({
        ...seen,
        undone: {
          before: stillAt("b", 2_000),
          after: null,
          token: { before: "t-b", after: "t-z" },
          forgotten: 1,
        },
      }),
    ).toEqual([
      "FORGOT: undone within the grace, the pane's still is gone from the shelf",
      "FORGOT: undone within the grace, the pane's page is t-z, not the one it had (t-b) — its page was not kept",
      "FORGOT: 1 stills were forgotten for a pane undone within its grace",
    ]);
    // a deleted pane's still never forgotten: kept on the shelf for good
    expect(
      judgeForgot({
        ...seen,
        gone: {
          before: stillAt("c", 2_100),
          after: stillAt("c", 2_100),
          pages: 1,
          forgotten: 0,
          waitedMs: 10_600,
        },
      }),
    ).toEqual([
      "FORGOT: 10600 ms after its delete (the grace: 2500) the pane's still is on the shelf yet",
      "FORGOT: 0 stills were counted forgotten, not the deleted pane's one",
      "FORGOT: main holds 1 pages at the deleted pane's address after its grace",
    ]);
    expect(
      judgeForgot({
        graceMs: 60_000,
        undone: { before: null, after: null, token: { before: null, after: null }, forgotten: 0 },
        gone: { before: null, after: null, pages: 0, forgotten: 1, waitedMs: 1 },
      }),
    ).toEqual([
      "FORGOT: the test's grace is 60000 ms, not 2500",
      "FORGOT: the pane had no still before its delete — the row proved nothing",
      "FORGOT: undone within the grace, the pane's page is null, not the one it had (null) — its page was not kept",
      "FORGOT: the deleted pane had no still — the row proved nothing",
    ]);
  });

  it("STILL: taken at the put-down; across a reload the pane shows it before its page's first frame — said, marked, the fixture's hue — and the page replaces it with no film between", () => {
    const seen: LastStillSeen["still"] = {
      putDown: { taken: { before: 5, after: 6 }, said: stillAt("a", 3_000) },
      rested: RESTED,
      shown: {
        reloaded: true,
        waiting: 1,
        face: {
          ...RESTED,
          state: "starting",
          ask: "live",
          wire: "live",
          alive: true,
          rested: false,
          presented: 0,
        },
        mark: true,
        page: DIM,
      },
      handOver: {
        runs: "-8 F4 S212 L40",
        captures: 9,
        worstFilm: 0,
        leastHue: 0.74,
        face: { ...LIVE, presented: 2 },
        mark: false,
        page: PAGE,
      },
    };
    expect(judgeStill(seen)).toEqual([]);
    // (the frames before the still is laid — no face yet, then the film under the boot's splash — are not "between")
    expect(judgeStill({ ...seen, handOver: { ...seen.handOver, runs: "S3 L9" } })).toEqual([]);
    // the first run of these rows: the still let go for a blank — the film, then the window's blank frame passed as live
    expect(
      judgeStill({
        ...seen,
        shown: {
          reloaded: true,
          waiting: 1,
          face: { ...LIVE, presented: 1 },
          mark: false,
          page: area({ px: 374_616, hue: 0, film: 0, lumaMax: 255, ink: 0, hueLuma: 0 }),
        },
        handOver: { ...seen.handOver, runs: "-8 F4 S7 F16 L3868", leastHue: 0 },
      }),
    ).toEqual([
      "STILL: before its page's first frame the pane does not say its texture is a still",
      "STILL: before its page's first frame the pane says live, not starting or paused",
      "STILL: 1 frames of the page landed while its load waited at the gate",
      "STILL: the head of the pane showing its still carries no rest mark",
      "STILL: the page's area before the page's first frame is 0.0% the fixture's hue, not 40% — the page is not drawn there",
      "STILL: the film showed between the still and the page (-8 F4 S7 F16 L3868) — a frame with neither",
      "STILL: a capture across the hand-over was 0.0% the fixture's hue — the page's area was not the page's",
    ]);
    // PT-5b2 — the photograph off the shelf at ANOTHER dim (0.8 of the page's light), and one whose live page was not read
    expect(
      judgeStill({
        ...seen,
        shown: { ...seen.shown, page: { ...DIM, ground: [44.3, 105.9, 198] } },
      }),
    ).toEqual([
      "STILL: the still's ground reads rgb(44.3, 105.9, 198) where the live page's rgb(46.6, 116.3, 218.1) at the law's dim (0.7 of the page's light) is rgb(43.1, 100.2, 186.8) — 11.2 off on a channel, past the 4 the row allows: the photograph is not drawn at the law's dim",
    ]);
    expect(judgeStill({ ...seen, handOver: { ...seen.handOver, page: null } })).toEqual([
      "STILL: the live page's ground was not read — the still's was held to nothing",
    ]);
    // no still at all: the film until the page
    expect(
      judgeStill({
        ...seen,
        shown: {
          ...seen.shown,
          face: { ...RESTED, state: "starting", still: null, bytes: 0, presented: 0 },
          mark: false,
          page: area({ px: 1000, hue: 0, film: 1000, lumaMax: 20, ink: 0, hueLuma: 0 }),
        },
        handOver: { ...seen.handOver, runs: "F260 L40", worstFilm: 1, leastHue: 0 },
      }),
    ).toEqual([
      "STILL: before its page's first frame the pane does not say its texture is a still",
      "STILL: before its page's first frame the pane holds no texture — the film",
      "STILL: the head of the pane showing its still carries no rest mark",
      "STILL: the page's area before the page's first frame is 0.0% the fixture's hue, not 40% — the page is not drawn there",
      "STILL: the page's area before the page's first frame is 100.0% film — the pane shows its dark film",
      "STILL: the hand-over never showed the still (F260 L40)",
      "STILL: a capture across the hand-over was 100.0% film — the film flashed between the still and the page",
      "STILL: a capture across the hand-over was 0.0% the fixture's hue — the page's area was not the page's",
    ]);
    // the page never replaces its still; its head keeps the mark
    expect(
      judgeStill({
        ...seen,
        handOver: {
          ...seen.handOver,
          runs: "S400",
          face: { ...RESTED, state: "starting" },
          mark: true,
        },
      }),
    ).toEqual([
      "STILL: the hand-over did not end on the page's own frame (S400)",
      "STILL: after the hand-over the pane is starting (still true, 1 frames) — the page did not replace its still",
      "STILL: the head of the live page still carries the rest mark",
    ]);
    // the put-down took nothing; the pane was alive at the reload; nothing waited at the gate
    expect(
      judgeStill({
        ...seen,
        putDown: { taken: { before: 5, after: 5 }, said: null },
        rested: LIVE,
        shown: { ...seen.shown, reloaded: false, waiting: 0 },
        handOver: { ...seen.handOver, captures: 1 },
      }),
    ).toEqual([
      "STILL: the put-down took 0 stills, not one",
      "STILL: no still on the shelf after the put-down",
      "STILL: the pane was not at rest before the reload — its page would not load again",
      "STILL: the desk did not come back after the reload",
      "STILL: no load waited at the fixture's gate — the page was never asked for again",
      "STILL: only 1 captures were made across the hand-over",
    ]);
  });

  it("UNDER-WORDS: a failed face over its still — the still shown under the words, dimmed FURTHER than the photograph, no rest mark, the notice one more row of the budget (the words' block alone); ↻ loads the page again and the row goes", () => {
    const seen: NonNullable<LastStillSeen["underWords"]> = {
      killed: true,
      face: { ...RESTED, state: "failed", reason: "stopped: Browser page stopped", rested: false },
      mark: false,
      page: area({ hue: 250_000, px: 374_616, film: 0, ink: 3_100, hueLuma: 45.1 }),
      photograph: 89.6,
      rows: 3,
      textures: 2,
      noticeBytes: 598_332,
      recovered: LIVE,
      after: { rows: 2, textures: 2 },
    };
    expect(judgeUnderWords(seen)).toEqual([]);
    expect(judgeUnderWords(null)).toEqual(["UNDER-WORDS: the row did not run"]);
    expect(judgeUnderWords({ ...seen, killed: false })).toEqual([
      "UNDER-WORDS: the page's process could not be found to kill — the row proved nothing",
    ]);
    // PT-5a's face: the film alone, whatever the shelf keeps — and the notice laid over the page's whole area
    expect(
      judgeUnderWords({
        ...seen,
        face: { ...(seen.face as FaceSeen), still: null, veiled: true },
        page: area({ px: 374_616, hue: 0, film: 368_000, ink: 3_100, hueLuma: 0 }),
        noticeBytes: 10_485_760,
      }),
    ).toEqual([
      "UNDER-WORDS: the failed face shows no still (still false, hidden true, 21845272 bytes) — the film, though the shelf keeps a still of the address that stopped",
      "UNDER-WORDS: the page's area under the words is 0.0% the fixture's hue, not 40% — the page is not drawn there",
      "UNDER-WORDS: the page's area under the words is 98.2% film — the pane shows its dark film",
      "UNDER-WORDS: the notice holds 10485760 bytes — not the words' block alone (at most 2000000)",
    ]);
    // the still shown as a photograph — at rest, it would say — with no words on it, the notice uncharged
    expect(
      judgeUnderWords({
        ...seen,
        mark: true,
        page: area({ px: 374_616, hue: 269_731, film: 0, ink: 12, hueLuma: 89.6 }),
        rows: 2,
        noticeBytes: 0,
      }),
    ).toEqual([
      "UNDER-WORDS: the failed pane's head carries the rest mark — a failed page is not at rest",
      "UNDER-WORDS: 12 pixels of the words' ink in the page's area, not 40 — the pane says nothing over its still",
      "UNDER-WORDS: the still's ground reads 89.6 under the words against 89.6 as a photograph — it is not dimmed further",
      "UNDER-WORDS: the kind has 2 rows of the budget for 2 faces and a notice — the notice is not charged",
      "UNDER-WORDS: the notice holds 0 bytes — not the words' block alone (at most 2000000)",
    ]);
    // the page never comes back; its notice's row is left behind
    expect(
      judgeUnderWords({
        ...seen,
        face: { ...LIVE },
        recovered: seen.face,
        after: { rows: 3, textures: 2 },
      }),
    ).toEqual([
      "UNDER-WORDS: the killed page's face is live (no reason), not failed: stopped",
      "UNDER-WORDS: the failed face shows no still (still false, hidden false, 21845272 bytes) — the film, though the shelf keeps a still of the address that stopped",
      "UNDER-WORDS: after ↻ the pane is failed (still true) — the page was not loaded again",
      "UNDER-WORDS: after ↻ the kind has 3 rows of the budget for 2 faces — the notice's row was not released",
    ]);
  });

  it("TWO-WINDOWS: each window's pane alive on a page of its own; A's click reaches B through the document; B follows ONCE and writes nothing back", () => {
    const seen: NonNullable<LastStillSeen["twoWindows"]> = {
      joined: true,
      pages: 2,
      faces: { a: LIVE, b: LIVE },
      served: { before: 0, after: 2, later: 2 },
      url: { a: `${ORIGIN}/next`, b: `${ORIGIN}/next` },
      handedBack: 0,
      navigations: { a: 0, b: 1 },
    };
    expect(judgeTwoWindows(seen)).toEqual([]);
    expect(judgeTwoWindows(null)).toEqual(["TWO-WINDOWS: the row did not run"]);
    // B echoes the address it was sent to; A follows the echo — a page each way, for ever
    expect(
      judgeTwoWindows({
        ...seen,
        served: { before: 0, after: 2, later: 5 },
        handedBack: 1,
        navigations: { a: 2, b: 2 },
      }),
    ).toEqual([
      "TWO-WINDOWS: /next was served 3 more times a moment later — a page followed more than once",
      "TWO-WINDOWS: B handed 1 commits of its own back while it followed — it wrote the address it was sent to",
      "TWO-WINDOWS: B's desk sent its page 2 navigations, not the one that follows A",
      "TWO-WINDOWS: A's desk sent its own page 2 navigations — its page went by its click",
    ]);
    // the url reaches B's document and its page never follows
    expect(
      judgeTwoWindows({
        ...seen,
        served: { before: 0, after: 1, later: 1 },
        navigations: { a: 0, b: 0 },
      }),
    ).toEqual([
      "TWO-WINDOWS: /next was served 1 times after A's click, not twice — A's page and B's following it",
      "TWO-WINDOWS: B's desk sent its page 0 navigations, not the one that follows A",
    ]);
    // B never joined: one page, no face
    expect(
      judgeTwoWindows({
        ...seen,
        joined: false,
        pages: 1,
        faces: { a: LIVE, b: null },
        url: { a: `${ORIGIN}/gate?p=a`, b: null },
      }),
    ).toEqual([
      "TWO-WINDOWS: the second window never held the pane — it did not join the document",
      "TWO-WINDOWS: main holds 1 pages at the pane's address, not one a window",
      "TWO-WINDOWS: window B's pane is without a face — not alive",
      `TWO-WINDOWS: A's document says the pane is at ${ORIGIN}/gate?p=a, not /next`,
      `TWO-WINDOWS: B's document says null, A's ${ORIGIN}/gate?p=a — the url did not reach B`,
    ]);
  });

  it("MEMORY: the four reads made, the desk as it says it stood for the last — six alive, fourteen at rest, twenty stills kept, never more than ten pages at once", () => {
    const seen: NonNullable<LastStillSeen["memory"]> = {
      none: { mb: 1059, processes: 4 },
      one: { mb: 1122, processes: 5 },
      six: { mb: 1618, processes: 10 },
      many: { mb: 1650, processes: 10 },
      alive: 6,
      rested: 14,
      pages: 6,
      shelf: { bytes: 210_000, stills: 20 },
      budget: 300_000_000,
      peak: 10,
    };
    expect(judgeMemory(seen)).toEqual([]);
    expect(judgeMemory(null)).toEqual(["MEMORY: the row did not run"]);
    expect(
      judgeMemory({
        ...seen,
        many: null,
        alive: 6,
        rested: 4,
        shelf: { bytes: 105_071, stills: 10 },
        peak: 20,
      }),
    ).toEqual([
      "MEMORY: the app's memory with six alive and fourteen at rest was not read",
      "MEMORY: 4 faces were at rest, not 14",
      "MEMORY: the shelf keeps 10 stills, not the 20 panes'",
      "MEMORY: main held 20 pages at once — past the 10 the row allows itself",
    ]);
    expect(
      judgeMemory({ ...seen, six: { mb: 1100, processes: 5 }, alive: 20, pages: 20, rested: 0 }),
    ).toEqual([
      "MEMORY: at the last read 20 faces were alive and main held 20 pages, not 6",
      "MEMORY: 0 faces were at rest, not 14",
      "MEMORY: six pages (1100 MB) weigh no more than one (1122 MB) — the reads are not of what they say",
    ]);
  });
  it("SWEEP (PT-5b2): a pane at rest deleted, the window reloaded INSIDE its long grace — its still is gone from the shelf after the reload, and the panes that stand keep theirs", () => {
    const seen: NonNullable<LastStillSeen["sweep"]> = {
      graceMs: 60_000,
      reloadedAfterMs: 2_542,
      gone: {
        rested: true,
        before: stillAt("x", 7_000),
        atReload: stillAt("x", 7_000),
        after: null,
        stands: false,
        readAfterMs: 5_740,
      },
      kept: [
        { before: stillAt("a", 8_000), after: stillAt("a", 8_000) },
        { before: stillAt("b", 3_000), after: stillAt("b", 9_500) },
      ],
    };
    expect(judgeSweep(seen)).toEqual([]);
    // the lane before PT-5b2: the reload took the grace's timer, and nothing swept the shelf
    expect(
      judgeSweep({
        ...seen,
        gone: { ...seen.gone, after: stillAt("x", 7_000), readAfterMs: 15_800 },
      }),
    ).toEqual([
      "SWEEP: 15800 ms after its delete — the window reloaded 2542 ms after it, inside its 60000 ms grace — the deleted pane's still is on the shelf yet: the reload took the grace's timer, and nothing swept it",
    ]);
    // a sweep that takes a standing pane's still (an object that had only not arrived yet reads as a deleted one)
    expect(
      judgeSweep({
        ...seen,
        kept: [
          { before: stillAt("a", 8_000), after: null },
          { before: stillAt("b", 3_000), after: stillAt("b", 2_000) },
        ],
      }),
    ).toEqual([
      "SWEEP: standing pane 1 lost its still at the reload — the sweep took a still whose pane stands",
      "SWEEP: standing pane 2's still after the reload is an older one",
    ]);
    // rows that proved nothing: the test's short grace (the timer forgot it), a reload past the grace, a delete not saved,
    // a pane with a page yet, no still to begin with, nothing standing
    expect(
      judgeSweep({
        ...seen,
        graceMs: 2_500,
        gone: { ...seen.gone, rested: false, atReload: null, stands: true },
      }),
    ).toEqual([
      "SWEEP: the pane was deleted under a grace of 2500 ms, not the pool's own long one (at least 30000) — the row proved nothing",
      "SWEEP: the pane was not at rest when it was deleted — a page of it was left in main",
      "SWEEP: the deleted pane's still was gone BEFORE the reload — forgotten by its grace, not swept: the row proved nothing",
      "SWEEP: after the reload the document holds the deleted pane — its delete was not saved: the row proved nothing",
    ]);
    expect(
      judgeSweep({
        ...seen,
        reloadedAfterMs: 61_000,
        gone: { ...seen.gone, before: null, atReload: null },
        kept: [{ before: null, after: null }],
      }),
    ).toEqual([
      "SWEEP: the window was reloaded 61000 ms after the delete — past its 60000 ms grace: the row proved nothing",
      "SWEEP: the pane had no still before its delete — the row proved nothing",
      "SWEEP: standing pane 1 had no still before the reload — the row proved nothing",
    ]);
    expect(judgeSweep({ ...seen, graceMs: null, kept: [] })).toEqual([
      "SWEEP: the pane was deleted under a grace of null ms, not the pool's own long one (at least 30000) — the row proved nothing",
      "SWEEP: no pane stood across the reload — the row proved nothing",
    ]);
    expect(judgeSweep(null)).toEqual(["SWEEP: the row did not run"]);
  });

  it("EVICTED (PT-5b2): out of view, its page alive, the pane's texture is the budget's to take — seen again it shows its page's own frame within the bound, no rest mark", () => {
    const paused: FaceSeen = {
      ...LIVE,
      state: "paused",
      ask: "paused",
      wire: "paused",
      bytes: 0,
      presented: 1,
    };
    const seen: NonNullable<LastStillSeen["evicted"]> = {
      seen: { ...LIVE, presented: 1 },
      still: stillAt("e", 9_000),
      unseen: {
        fill: { laid: 3, alive: 3, bytes: 262_143_816, each: [87_381_272, 87_381_272, 87_381_272] },
        face: paused,
        pages: 1,
        evictions: 1,
        used: 305_407_816,
        cap: 268_435_456,
      },
      again: {
        runs: "F1 L131",
        ms: 9,
        frames: 1,
        face: { ...LIVE, presented: 2 },
        mark: false,
        page: PAGE,
      },
    };
    expect(judgeEvicted(seen)).toEqual([]);
    // (it may wear its still a moment: the shelf's read came before the page's frame)
    expect(
      judgeEvicted({ ...seen, again: { ...seen.again, runs: "F1 S14 L60", ms: 250 } }),
    ).toEqual([]);
    // THE FINDING the row is for: a quiet page's resume brings no frame — the pane wears its still, dimmed and deaf, for good
    expect(
      judgeEvicted({
        ...seen,
        again: {
          runs: "F2 S1800",
          ms: null,
          frames: 0,
          face: { ...LIVE, still: 9_000, bytes: 8_532_924, presented: 1 },
          mark: true,
          page: DIM,
        },
      }),
    ).toEqual([
      "EVICTED: seen again, the pane never showed its page's own frame (F2 S1800; 0 frames of its page landed) — its page is alive and the pane wears its still for good",
      "EVICTED: seen again, the pane is live (still true, 8532924 bytes) — not its page alive in its texture",
      "EVICTED: seen again, the pane's head carries the rest mark — its page is alive",
    ]);
    // no still to wear, no frame either: the film for good; a frame that came late
    expect(
      judgeEvicted({
        ...seen,
        again: { runs: "F1800", ms: null, frames: 0, face: paused, mark: false, page: null },
      }),
    ).toEqual([
      "EVICTED: seen again, the pane never showed its page's own frame (F1800; 0 frames of its page landed) — its page is alive and the pane wears its film for good",
      "EVICTED: seen again, the pane is paused (still false, 0 bytes) — not its page alive in its texture",
      "EVICTED: the page's area of the pane seen again could not be read",
    ]);
    expect(
      judgeEvicted({ ...seen, again: { ...seen.again, runs: "F1 S400 L9", ms: 6_700 } }),
    ).toEqual(["EVICTED: seen again, the page's own frame took 6700 ms (F1 S400 L9) — past 3000"]);
    // rows that proved nothing: the budget evicted nothing of it; its page was put to rest, not left alive; it was never live
    expect(
      judgeEvicted({
        ...seen,
        unseen: {
          ...seen.unseen,
          face: { ...paused, bytes: 21_845_272 },
          evictions: 0,
          used: 152_915_904,
        },
      }),
    ).toEqual([
      "EVICTED: out of view the pane holds 21845272 bytes and 0 textures were evicted (the budget: 152915904 charged of 268435456; 3 large panes laid, 3 alive, on 262143816 bytes) — the budget evicted nothing of it: the row proved nothing",
    ]);
    expect(
      judgeEvicted({
        ...seen,
        unseen: {
          ...seen.unseen,
          face: { ...paused, alive: false, rested: true, wire: "hibernated" },
          pages: 0,
        },
      }),
    ).toEqual([
      "EVICTED: evicted, the pane's page is alive false, rested true, asked paused, with 0 pages in main — not an unseen face whose page is ALIVE: the row proved nothing",
    ]);
    expect(
      judgeEvicted({ ...seen, seen: null, still: null, unseen: { ...seen.unseen, face: null } }),
    ).toEqual([
      "EVICTED: seen, the pane was without a face (alive false, still false, 0 bytes) — not its page's own frame: the row proved nothing",
      "EVICTED: the pane had no still on the shelf — what it would wear was not there: the row proved nothing",
      "EVICTED: out of view the pane has no face",
    ]);
    expect(judgeEvicted(null)).toEqual(["EVICTED: the row did not run"]);
  });
});

describe("the last still and the many — what the rows read by", () => {
  it("the still's classifier: the fixture's ground at the page's own light and at a photograph's dimmer one; the film; anything else", () => {
    const classify = new Function(`return ${STILL_CLASSIFY};`)() as (
      r: number,
      g: number,
      b: number,
    ) => number;
    const { r, g, b } = FIXTURE_HUE;
    expect(STILL_HUE_DEG).toBeGreaterThan(210);
    expect(STILL_HUE_DEG).toBeLessThan(220);
    expect(classify(r, g, b)).toBe(1);
    // a still: 0.7 of the page's light — its bytes at 0.7^(1/2.2); under a failure's words dimmer still (0.16)
    const dim = (k: number): [number, number, number] => [
      Math.round(r * k ** (1 / 2.2)),
      Math.round(g * k ** (1 / 2.2)),
      Math.round(b * k ** (1 / 2.2)),
    ];
    expect(classify(...dim(0.7))).toBe(1);
    expect(classify(...dim(0.16))).toBe(1);
    // the film: the pane's dark film, its glass over it
    expect(classify(8, 9, 11)).toBe(2);
    expect(classify(34, 36, 38)).toBe(2);
    // a light grey: a notice's ink — and a page's own white (its headline; a blank frame)
    expect(classify(230, 232, 234)).toBe(3);
    expect(classify(255, 255, 255)).toBe(3);
    expect(classify(217, 217, 217)).toBe(3);
    // none of them: the page's runner, the mat, a middle grey
    expect(classify(255, 211, 77)).toBe(0);
    expect(classify(74, 104, 58)).toBe(0);
    expect(classify(128, 128, 128)).toBe(0);
    // a dark blue is the film's, not the page's: too dim to be its ground
    expect(classify(4, 14, 30)).toBe(2);
  });

  it("a pane's page at rest, through the camera: inside the border and under the head, a tenth in from each side", () => {
    // a laptop's pane as laid, its corner at the view's, at actual size
    const at = pageAtRest({ x: 0, y: 0, w: 698.16, h: 461.94 }, { x: 0, y: 0, zoom: 1 });
    const mm = 200 / 76.2;
    const w = 698.16 - 10 * mm;
    const h = 461.94 - 16 * mm;
    expect(at).toEqual({
      x: Math.round(5 * mm + 0.1 * w),
      y: Math.round(11 * mm + 0.1 * h),
      width: Math.round(0.8 * w),
      height: Math.round(0.8 * h),
    });
    // zoomed out to a half, the view's corner elsewhere: every measure halves
    const half = pageAtRest(
      { x: 1000, y: 400, w: 698.16, h: 461.94 },
      { x: 800, y: 300, zoom: 0.5 },
    );
    expect(half.x).toBe(Math.round((200 + 5 * mm + 0.1 * w) * 0.5));
    expect(half.y).toBe(Math.round((100 + 11 * mm + 0.1 * h) * 0.5));
    expect(half.width).toBe(Math.round(0.4 * w));
    expect(half.height).toBe(Math.round(0.4 * h));
    // never an empty rect
    expect(pageAtRest({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, zoom: 0.1 })).toMatchObject({
      width: 1,
      height: 1,
    });
  });

  it("PT-5b2 — a live page's ground as its photograph reads by THE LAW: the page's own light at 0.7, the pane's own light as it is", () => {
    // the fixture's ground with no light but its own: 0.7 of its light, a channel each
    expect(dimmed([FIXTURE_HUE.r, FIXTURE_HUE.g, FIXTURE_HUE.b])).toEqual([23.1, 93.7, 184.2]);
    // under the desk's lamp (a green run's reading): what the lamp adds on the glass is not the page's, and is not dimmed —
    // the run's own photograph read rgb(43.5, 101.3, 186.9) off the shelf, rgb(43.6, 100.3, 187.1) as it was put to rest
    expect(dimmed([46.6, 116.3, 218.1])).toEqual([43.1, 100.2, 186.8]);
    // another dim is another reading — by more than the row allows; no dim at all is the live page
    expect(dimmed([46.6, 116.3, 218.1], undefined, 0.8)).toEqual([44.3, 105.9, 198]);
    expect(dimmed([46.6, 116.3, 218.1], undefined, 1)).toEqual([46.6, 116.3, 218.1]);
    // a page whose live reading is darker than the fixture's own light at (1 − dim) is black, never a negative light
    expect(dimmed([2, 2, 2])).toEqual([0, 0, 0]);
  });

  it("PT-5b3 — the still's dim is ONE number: the row's law is the pane's own (`display.still` in the plugin's law — read off its source: the shell may not import the plugin)", () => {
    const law = readFileSync(
      new URL("../../../plugins/browser-pane/src/law.ts", import.meta.url),
      "utf8",
    );
    const display = /\bdisplay:\s*\{([^}]*)\}/u.exec(law)?.[1];
    if (display === undefined) throw new Error("the pane's law says no `display`");
    const still = /\bstill:\s*([0-9.]+)/u.exec(display)?.[1];
    expect(Number(still)).toBe(STILL_ROWS.law.dim);
  });

  it("PT-5b2 — what EVICTED's watcher saw, read: from the frame the pane asks live again, the face as runs and how long until the page's own frame", () => {
    // out of view (paused) the film; seen: one more frame of film, then the page
    expect(
      seenAgain({
        kinds: ["F", "F", "F", "L", "L"],
        asks: ["paused", "paused", "live", "live", "live"],
        at: [1000, 1008.3, 1016.7, 1025.4, 1033.3],
      }),
    ).toEqual({ runs: "F1 L2", ms: 9 });
    // its still laid first
    expect(
      seenAgain({
        kinds: ["F", "S", "S", "L"],
        asks: ["live", "live", "live", "live"],
        at: [0, 16, 33, 250],
      }),
    ).toEqual({ runs: "F1 S2 L1", ms: 250 });
    // a frame of the page the watcher saw BEFORE the pane asked live again is not the answer
    expect(
      seenAgain({
        kinds: ["L", "F", "F", "S", "L"],
        asks: ["paused", "paused", "live", "live", "live"],
        at: [0, 16, 33, 50, 300],
      }),
    ).toEqual({ runs: "F1 S1 L1", ms: 267 });
    // the page's frame never comes; the pane never asked live; nothing read
    expect(
      seenAgain({ kinds: ["F", "S", "S"], asks: ["paused", "live", "live"], at: [0, 16, 33] }),
    ).toEqual({ runs: "S2", ms: null });
    expect(seenAgain({ kinds: ["F", "F"], asks: ["paused", "paused"], at: [0, 16] })).toEqual({
      runs: "",
      ms: null,
    });
    expect(seenAgain({ kinds: [], asks: [], at: [] })).toEqual({ runs: "", ms: null });
  });

  it("the hand-over's frames as runs", () => {
    expect(runsOf([])).toBe("");
    expect(runsOf(["S"])).toBe("S1");
    expect(runsOf(["-", "-", "F", "S", "S", "S", "L", "L"])).toBe("-2 F1 S3 L2");
    expect(runsOf(["S", "F", "S"])).toBe("S1 F1 S1");
  });

  it("the rows' numbers: a cap of two, a grace shorter than the pool's sixty seconds, twenty panes of which six end alive and never more than ten are", () => {
    expect(STILL_ROWS.cap).toBe(2);
    expect(STILL_ROWS.graceMs).toBeLessThan(60_000);
    expect(STILL_ROWS.memory).toMatchObject({ panes: 20, alive: 6, making: 10 });
    expect(STILL_ROWS.dimmer).toBeLessThan(1);
  });

  it("PT-5b3 — EVICTED's numbers: a large pane is the outline of a laptop's page at twice its size; drawn at its top rung (its device's 2 px a CSS px) its texture is 87 MB — the row's most passes the desk's budget with a large pane to spare, so its ceiling is never what stops it, on any display", () => {
    const mm = 200 / 76.2;
    /** A pane's outline for a page of w × h CSS px at the laptop's density (0.2 mm a px): the border round it, the head. */
    const outline = (w: number, h: number): { w: number; h: number } => ({
      w: Math.round((w * 0.2 + 2 * 5) * mm * 100) / 100,
      h: Math.round((h * 0.2 + 5 + 11) * mm * 100) / 100,
    });
    expect(outline(1280, 800)).toEqual(STILL_ROWS.laid);
    expect(outline(2560, 1600)).toEqual(STILL_ROWS.evicted.big);
    /** A texture's bytes on the device, every level counted (rgba8). */
    const bytes = (w: number, h: number): number => {
      let sum = 0;
      for (let lw = w, lh = h; ; lw = Math.max(1, lw >> 1), lh = Math.max(1, lh >> 1)) {
        sum += lw * lh * 4;
        if (lw === 1 && lh === 1) return sum;
      }
    };
    const { deviceDpr, most } = STILL_ROWS.evicted;
    const large = bytes(2560 * deviceDpr, 1600 * deviceDpr);
    expect(large).toBe(87_381_272);
    // the desk's budget — ICE's OWN constant, read off ICE's build as the field app resolves it (the shell may not import
    // ICE; PT-5c, ruling 7: never a literal): the row's ceiling of large panes, each at its top rung, passes it with a
    // large pane to spare
    const ice = dirname(
      createRequire(new URL("../../field-app/package.json", import.meta.url)).resolve(
        "@vibecook/ice/package.json",
      ),
    );
    const budgets = readdirSync(join(ice, "dist"))
      .filter((name) => name.endsWith(".js"))
      .map(
        (name) =>
          /\bDEFAULT_RASTER_BUDGET = ([0-9 *]+);/u.exec(
            readFileSync(join(ice, "dist", name), "utf8"),
          )?.[1],
      )
      .filter((said): said is string => said !== undefined)
      .map((said) => said.split("*").reduce((product, n) => product * Number(n.trim()), 1));
    expect(new Set(budgets).size).toBe(1);
    const budget = budgets[0] ?? Number.NaN;
    expect(most * large).toBeGreaterThan(budget + large);
    // the pane lies out of the large panes' view
    expect(STILL_ROWS.evicted.away).toBeGreaterThan(4 * STILL_ROWS.evicted.big.h);
  });
});
