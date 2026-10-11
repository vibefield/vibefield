/**
 * PT-5b2 — a page's first load, in the product (testing/smoke-first-load.ts): the judges its rows hold the product to —
 * FIRST-REDIRECT, FIRST-CLICK, NO-DOCUMENT, STARTING and TAPS — each passing what the product does (the numbers of a green
 * run) and failing, in words with its numbers, what it should not.
 */
import { describe, expect, it } from "vitest";
import {
  FIRST_FLAG,
  FIRST_ROWS,
  type FirstFace,
  type FirstLoadSeen,
  judgeClick,
  judgeNoDocument,
  judgeRedirect,
  judgeStarting,
  judgeTaps,
  runOf,
} from "../src/testing/smoke-first-load";
import type { PageSeen } from "../src/testing/smoke-last-still";

const O = "http://127.0.0.1:57067";
const face = (over: Partial<FirstFace> = {}): FirstFace => ({
  state: "live",
  reason: null,
  address: `${O}/next`,
  loading: false,
  presented: 1,
  ...over,
});
/** A failed face's page area as a green run read it: the film, the words' ink on it. */
const WORDS: PageSeen = {
  px: 1_043_936,
  hue: 0,
  film: 1_023_717,
  lumaMax: 234,
  ink: 7_329,
  hueLuma: 0,
  ground: [0, 0, 0],
};

const REDIRECT: FirstLoadSeen["redirect"] = {
  asked: 1,
  served: 1,
  states: ["paused", "starting", "live"],
  face: face({ address: `${O}/next?from=redirect` }),
  windows: [3],
};
const CLICK: FirstLoadSeen["click"] = {
  loading: true,
  hung: 2,
  served: 1,
  states: ["live"],
  face: face({ presented: 2 }),
  windows: [4],
};
const failed = (reason: string, address: string): FirstFace =>
  face({ state: "failed", reason, address, presented: 0 });
const NO_DOCUMENT: FirstLoadSeen["noDocument"] = {
  asked: [0, 1, 2],
  face: failed("no-document", `${O}/file.bin?p=n`),
  raised: 0,
  page: WORDS,
  tool: "Reload",
  again: failed("no-document", `${O}/file.bin?p=n`),
};
const STARTING: FirstLoadSeen["starting"] = {
  sent: {
    before: face({ state: "starting", address: `${O}/gate?p=s1`, loading: true, presented: 0 }),
    after: face({ address: `${O}${FIRST_ROWS.typed}` }),
    at: FIRST_ROWS.typed,
  },
  stopped: {
    before: face({ state: "starting", address: `${O}/gate?p=s2`, loading: true, presented: 0 }),
    tool: "Stop",
    waiting: [1, 0],
    face: failed("load-stopped", `${O}/gate?p=s2`),
    page: { ...WORDS, film: 1_029_188, ink: 6_019 },
    retry: "Reload",
    loaded: face({ address: `${O}/gate?p=s2` }),
  },
};
const TAPS: FirstLoadSeen["taps"] = { view: [402, 874], log: ["start", "end", "start", "end"] };

describe("a page's first load, in the product — its rows", () => {
  it("FIRST-REDIRECT: live at the redirect's end — never failed on the way — in its one window", () => {
    expect(judgeRedirect(REDIRECT)).toEqual([]);
    // what the lane did before PT-5b2: the superseded load failed the source, its window destroyed
    expect(
      judgeRedirect({
        ...REDIRECT,
        states: ["starting", "live", "failed"],
        face: failed("load-failed: Browser source could not load", `${O}/redirecting?p=r`),
        served: 1,
        windows: [3],
      }),
    ).toEqual([
      "FIRST-REDIRECT: the face said starting → live → failed — the page FAILED on the way (a first load that another navigation supersedes is not a failed page)",
      "FIRST-REDIRECT: at the redirect's end the pane is failed (load-failed: Browser source could not load, 0 frames) — not live",
      `FIRST-REDIRECT: the pane says it is at ${O}/redirecting?p=r, not where its page's script sent it (/next?from=redirect)`,
    ]);
    // a window made again for it (the producer restarted), /next served twice
    expect(judgeRedirect({ ...REDIRECT, served: 2, windows: [3, 5] })).toEqual([
      "FIRST-REDIRECT: /next was served 2 times for the redirect, not once",
      "FIRST-REDIRECT: the pane's page was seen in 2 of main's windows (3, 5), not its one — its window was made again",
    ]);
    expect(judgeRedirect({ ...REDIRECT, asked: 0, face: null, served: 0, windows: [] })).toEqual([
      "FIRST-REDIRECT: /redirecting was asked for 0 times, not once — the row proved nothing",
      "FIRST-REDIRECT: at the redirect's end the pane is without a face (no reason, 0 frames) — not live",
      "FIRST-REDIRECT: the pane says it is at no address, not where its page's script sent it (/next?from=redirect)",
      "FIRST-REDIRECT: /next was served 0 times for the redirect, not once",
      "FIRST-REDIRECT: the pane's page was seen in 0 of main's windows (), not its one — its window was made again",
    ]);
  });

  it("FIRST-CLICK: a link pressed while the page still loads goes to the next page, live, in the same window", () => {
    expect(judgeClick(CLICK)).toEqual([]);
    expect(
      judgeClick({
        ...CLICK,
        states: ["live", "failed"],
        face: failed("load-failed: Browser source could not load", `${O}/loading?p=c`),
      }),
    ).toEqual([
      "FIRST-CLICK: the face said live → failed — the page FAILED on the way (a first load that another navigation supersedes is not a failed page)",
      `FIRST-CLICK: after the press the pane is failed at ${O}/loading?p=c (load-failed: Browser source could not load) — not live at /next`,
    ]);
    // a page that had finished loading proves nothing; a press that did not land
    expect(judgeClick({ ...CLICK, loading: false, hung: 0, served: 0, windows: [4, 6] })).toEqual([
      "FIRST-CLICK: the page did not say it was still loading when its link was pressed (loading false, its hanging image asked 0 times) — the row proved nothing",
      "FIRST-CLICK: /next was served 0 times after the press, not once — the press did not land",
      "FIRST-CLICK: the pane's page was seen in 2 of main's windows, not its one",
    ]);
  });

  it("NO-DOCUMENT: an address that is no page SAYS so in its page's area — never starting for good — raises no window, and ↻ asks again", () => {
    expect(judgeNoDocument(NO_DOCUMENT)).toEqual([]);
    // the lane before PT-5b2: the source failed ("could not load"); or, read off nothing, starting for good
    expect(
      judgeNoDocument({
        ...NO_DOCUMENT,
        face: face({
          state: "starting",
          address: `${O}/file.bin?p=n`,
          loading: true,
          presented: 0,
        }),
        page: { ...WORDS, ink: 0 },
        again: null,
        asked: [0, 1, 1],
      }),
    ).toEqual([
      "NO-DOCUMENT: the pane whose address is an attachment is starting (no reason), not failed: no-document — a load that ended with nothing is never said",
      "NO-DOCUMENT: the pane's page area holds 0 pixels of the words' ink, not 40 — the face says nothing",
      "NO-DOCUMENT: ↻ asked for the address 0 times, not once more",
      "NO-DOCUMENT: asked again, the pane is without a face (no reason) — not failed: no-document as before",
    ]);
    expect(
      judgeNoDocument({
        ...NO_DOCUMENT,
        asked: [3, 3, 3],
        face: failed("load-failed: Browser source could not load", `${O}/elsewhere`),
        raised: 1,
        page: { ...WORDS, film: 100_000, hue: 900_000 },
        tool: "Stop",
      }),
    ).toEqual([
      "NO-DOCUMENT: the attachment was asked for 0 times when the pane was laid, not once — the row proved nothing",
      "NO-DOCUMENT: the pane whose address is an attachment is failed (load-failed: Browser source could not load), not failed: no-document — a load that ended with nothing is never said",
      `NO-DOCUMENT: the face says it is at ${O}/elsewhere, not the address it was asked for`,
      "NO-DOCUMENT: the app has 1 windows it did not have before the pane",
      "NO-DOCUMENT: the pane's page area is 9.6% film, not 60% — something is drawn as its page",
      'NO-DOCUMENT: in hand ↻ reads "Stop", not Reload',
      "NO-DOCUMENT: ↻ asked for the address 0 times, not once more",
    ]);
    expect(judgeNoDocument({ ...NO_DOCUMENT, page: null })).toEqual([
      "NO-DOCUMENT: the pane's page area could not be read",
    ]);
  });

  it("STARTING: a pane whose first address has not answered can be SENT ELSEWHERE, STOPPED — it says so — and loaded again", () => {
    expect(judgeStarting(STARTING)).toEqual([]);
    // the lane before PT-5b2: `go` and `stop` dropped while starting
    expect(
      judgeStarting({
        sent: { ...STARTING.sent, after: STARTING.sent.before, at: null },
        stopped: {
          ...STARTING.stopped,
          waiting: [1, 1],
          face: STARTING.stopped.before,
          page: { ...WORDS, ink: 0 },
          retry: "Stop",
          loaded: STARTING.stopped.before,
        },
      }),
    ).toEqual([
      "STARTING: the typed address's page says it is at nowhere, not /page?typed=1 — a page still starting was not sent there",
      `STARTING: after the typed address the pane is starting at ${O}/gate?p=s1 — not live there`,
      "STARTING: stopped, the pane is starting (no reason), not failed: load-stopped — a first load the person stopped is never said",
      "STARTING: 1 loads waited at the gate before the stop and 1 after — the page's load was not given up",
      "STARTING: the stopped pane's page area holds 0 pixels of the words' ink, not 40 — the face says nothing",
      'STARTING: on the stopped pane ↻ reads "Stop", not Reload',
      `STARTING: the gate open and ↻ pressed, the pane is starting at ${O}/gate?p=s2 (no reason) — its address was not loaded`,
    ]);
    // panes that were live already prove nothing; ↻ that never read Stop
    expect(
      judgeStarting({
        sent: { ...STARTING.sent, before: face() },
        stopped: { ...STARTING.stopped, before: face(), tool: "Reload" },
      }),
    ).toEqual([
      "STARTING: before the address was typed the pane was live (1 frames), not starting at the shut gate — the row proved nothing",
      "STARTING: before the stop the second pane was live, not starting — the row proved nothing",
      'STARTING: over a pane whose first address has not answered ↻ reads "Reload", not Stop',
    ]);
  });

  it("TAPS: two quick taps on a busy phone page are heard start, end, start, end — the order they were sent in", () => {
    expect(judgeTaps(TAPS)).toEqual([]);
    // the lane before PT-5b2: the second tap's release overtook its press — a finger left down
    expect(judgeTaps({ ...TAPS, log: ["start", "end", "start"] })).toEqual([
      "TAPS: the page heard start, end, start for two taps, not start, end, start, end — the hand's events did not reach it in the order they were sent",
    ]);
    expect(judgeTaps({ view: [1280, 800], log: [] })).toEqual([
      "TAPS: the page's view is 1280 × 800, not a phone's 402 wide — the row proved nothing",
      "TAPS: the page heard nothing for two taps, not start, end, start, end — the hand's events did not reach it in the order they were sent",
    ]);
    expect(judgeTaps({ view: null, log: TAPS.log })).toEqual([
      "TAPS: the page's view is not said, not a phone's 402 wide — the row proved nothing",
    ]);
  });
});

describe("a page's first load, in the product — what the rows read by", () => {
  it("a face's states as a run: each said once while it lasts", () => {
    expect(runOf([])).toEqual([]);
    expect(runOf(["starting", "starting", "live", "live", "live"])).toEqual(["starting", "live"]);
    expect(runOf(["live", "failed", "live"])).toEqual(["live", "failed", "live"]);
  });

  it("the rows' numbers: the flag, the words' floor, two taps closer together than the page is busy", () => {
    expect(FIRST_FLAG).toBe("--first-load");
    expect(FIRST_ROWS.ink).toBe(40);
    expect(FIRST_ROWS.film).toBe(0.6);
    expect(FIRST_ROWS.typed).toBe("/page?typed=1");
    // the second tap falls inside the first touch's busy stretch (the fixture's 350 ms)
    expect(FIRST_ROWS.tap.held + FIRST_ROWS.tap.between).toBeLessThan(200);
  });
});
