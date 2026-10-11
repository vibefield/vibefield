/**
 * PT-5b — the last still and the many, in the product (testing/smoke-last-still.ts): the judges the rows hold the product to —
 * REST, HELD-NEVER, SILENT, BUDGET, FORGOT, STILL, TWO-WINDOWS and MEMORY — each passing what the product should do and
 * failing, in words with its numbers, what it should not; the still's pixel classifier (the fixture's ground at the page's
 * own light and at a photograph's dimmer one, the film, anything else); a pane's page at rest through the camera; and the
 * hand-over's frames read as runs.
 */
import { describe, expect, it } from "vitest";
import { FIXTURE_HUE } from "../src/testing/live-fixture";
import {
  type FaceSeen,
  judgeBudget,
  judgeForgot,
  judgeHeldNever,
  judgeMemory,
  judgeRest,
  judgeSilent,
  judgeStill,
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
};
const DIM: PageSeen = { ...PAGE, lumaMax: 220, hueLuma: 89.6 };
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
});
