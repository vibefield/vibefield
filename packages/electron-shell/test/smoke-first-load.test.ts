/**
 * PT-5b2 — a page's first load, in the product (testing/smoke-first-load.ts): the judges its rows hold the product to —
 * FIRST-REDIRECT, FIRST-CLICK, NO-DOCUMENT, STARTING and TAPS — each passing what the product does (the numbers of a green
 * run) and failing, in words with its numbers, what it should not. PT-5b3: SWITCH-STARTING and TAPS-COLD; NO-DOCUMENT
 * counts what its page was refused.
 */
import { describe, expect, it } from "vitest";
import { FIXTURE_BUSY_MS, FIXTURE_HOLD_MS } from "../src/testing/live-fixture";
import {
  FIRST_ROWS,
  type FirstFace,
  type FirstLoadSeen,
  judgeClick,
  judgeDownGone,
  judgeNoDocument,
  judgePending,
  judgeRedirect,
  judgeStarting,
  judgeSwitch,
  judgeTaps,
  judgeTapsCold,
  judgeTidy,
  judgeZoomed,
  type PendingSeen,
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
  refused: 0,
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
  face: { ...failed("no-document", `${O}/file.bin?p=n`), refused: 1 },
  page: WORDS,
  tool: "Reload",
  again: { ...failed("no-document", `${O}/file.bin?p=n`), refused: 2 },
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

  it("NO-DOCUMENT: an address that is no page SAYS so in its page's area — never starting for good — its download REFUSED and counted, and ↻ asks again", () => {
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
      "NO-DOCUMENT: the pane's page was refused 0 downloads, not the one its address is — the attachment was not refused (or was never asked for)",
      "NO-DOCUMENT: the pane's page area holds 0 pixels of the words' ink, not 40 — the face says nothing",
      "NO-DOCUMENT: ↻ asked for the address 0 times, not once more",
      "NO-DOCUMENT: asked again, the pane is without a face (no reason) — not failed: no-document as before",
    ]);
    expect(
      judgeNoDocument({
        ...NO_DOCUMENT,
        asked: [3, 3, 3],
        face: {
          ...failed("load-failed: Browser source could not load", `${O}/elsewhere`),
          refused: 1,
        },
        page: { ...WORDS, film: 100_000, hue: 900_000 },
        tool: "Stop",
      }),
    ).toEqual([
      "NO-DOCUMENT: the attachment was asked for 0 times when the pane was laid, not once — the row proved nothing",
      "NO-DOCUMENT: the pane whose address is an attachment is failed (load-failed: Browser source could not load), not failed: no-document — a load that ended with nothing is never said",
      `NO-DOCUMENT: the face says it is at ${O}/elsewhere, not the address it was asked for`,
      "NO-DOCUMENT: the pane's page area is 9.6% film, not 60% — something is drawn as its page",
      'NO-DOCUMENT: in hand ↻ reads "Stop", not Reload',
      "NO-DOCUMENT: ↻ asked for the address 0 times, not once more",
    ]);
    expect(judgeNoDocument({ ...NO_DOCUMENT, page: null })).toEqual([
      "NO-DOCUMENT: the pane's page area could not be read",
    ]);
    // PT-5b3 — what the row's "no window raised" could not see: a download that was NOT refused is no refusal counted —
    // at the pane's laying, or at ↻
    expect(
      judgeNoDocument({ ...NO_DOCUMENT, face: { ...NO_DOCUMENT.face, refused: 0 } as FirstFace }),
    ).toEqual([
      "NO-DOCUMENT: the pane's page was refused 0 downloads, not the one its address is — the attachment was not refused (or was never asked for)",
    ]);
    expect(
      judgeNoDocument({ ...NO_DOCUMENT, again: { ...NO_DOCUMENT.again, refused: 1 } as FirstFace }),
    ).toEqual([
      "NO-DOCUMENT: asked again, the pane's page was refused 1 downloads in all, not two",
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

  it("SWITCH-STARTING (PT-5b3): a pane whose first address has not answered, its device switched to another of the same density, stays starting at its address — its address asked for once more — and, the gate opened, is live as that device", () => {
    const waiting = face({
      state: "starting",
      address: `${O}/gate?p=w`,
      loading: true,
      presented: 0,
    });
    const seen: FirstLoadSeen["switched"] = {
      before: waiting,
      offered: true,
      after: waiting,
      asked: [1, 2],
      waiting: 1,
      opened: face({ address: `${O}/gate?p=w` }),
      touchPoints: 5,
      agent:
        "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      askedOpened: 2,
      told: 1,
    };
    expect(judgeSwitch(seen)).toEqual([]);
    // the lane before PT-5b3: the engine's own reload — of the window's blank — and the page said there was none
    expect(
      judgeSwitch({
        ...seen,
        after: failed("no-document", `${O}/gate?p=w`),
        asked: [1, 1],
        waiting: 0,
        opened: failed("no-document", `${O}/gate?p=w`),
        touchPoints: null,
        agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        askedOpened: 1,
      }),
    ).toEqual([
      "SWITCH-STARTING: its device switched, the pane is failed (no-document, loading false), not starting — a page whose address had only not answered yet was reloaded as its window's blank",
      "SWITCH-STARTING: its address was asked for 1 times in all, not twice — once, and once more on the device it was switched to",
      "SWITCH-STARTING: 0 loads wait at the gate, not the one that replaced the first",
      `SWITCH-STARTING: the gate opened, the pane is failed at ${O}/gate?p=w (no-document, 0 frames) — not live at its address`,
      "SWITCH-STARTING: the page says it has no word of its touch points — it was not loaded as the tablet it was switched to",
      'SWITCH-STARTING: the load the gate answered came as "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/" — not as the tablet: the page was asked for as the device before',
      "SWITCH-STARTING: once live its address had been asked for 1 times, not twice — the page loaded again after the gate opened",
    ]);
    // WHAT THE FIRST RUN OF THIS ROW FOUND: the engine holds a device's commands while a load is pending — told on the
    // same window, the pane waited (rightly `starting`), was answered as the device BEFORE, and loaded again once live
    expect(judgeSwitch({ ...seen, asked: [1, 1], askedOpened: 2 })).toEqual([
      "SWITCH-STARTING: its address was asked for 1 times in all, not twice — once, and once more on the device it was switched to",
    ]);
    // the address asked for twice over; loaded as the device before; a third load once live; no switch told at all
    expect(
      judgeSwitch({ ...seen, asked: [1, 3], waiting: 2, touchPoints: 0, askedOpened: 3, told: 0 }),
    ).toEqual([
      "SWITCH-STARTING: its address was asked for 3 times in all, not twice — once, and once more on the device it was switched to",
      "SWITCH-STARTING: 2 loads wait at the gate, not the one that replaced the first",
      "SWITCH-STARTING: the page says it has 0 touch points — it was not loaded as the tablet it was switched to",
      "SWITCH-STARTING: once live its address had been asked for 3 times, not twice — the page loaded again after the gate opened",
      "SWITCH-STARTING: the desk told its pages 0 device switches, not the one — the row proved nothing",
    ]);
    // rows that proved nothing: a pane that was live already; no act on the bar; the pane gone elsewhere
    expect(
      judgeSwitch({
        ...seen,
        before: face({ address: `${O}/gate?p=w` }),
        offered: false,
        after: { ...waiting, address: `${O}/elsewhere` },
      }),
    ).toEqual([
      "SWITCH-STARTING: before the switch the pane was live (1 frames, its address asked for 1 times), not starting at the shut gate — the row proved nothing",
      "SWITCH-STARTING: the bar offered no act for the tablet — the row proved nothing",
      `SWITCH-STARTING: its device switched, the pane says it is at ${O}/elsewhere, not its address`,
    ]);
  });

  it("TIDY (PT-5b3): a pane on a page that tidies its own address keeps its photograph — put down, filed under the address NOW; at rest and the window reloaded, shown before its page's first frame", () => {
    const at = (path: string) => `${O}${path}`;
    const inHand = face({ address: at("/gate?p=t&tidy=1"), presented: 2 });
    const seen: FirstLoadSeen["tidy"] = {
      before: inHand,
      after: { ...inHand, address: at("/gate?p=t") },
      down: { ...inHand, address: at("/gate?p=t") },
      url: at("/gate?p=t"),
      kept: {
        address: at("/gate?p=t"),
        logical: [1280, 800],
        size: [1600, 1000],
        type: "image/webp",
        bytes: 10_368,
        takenAt: 2_000,
        keptAt: 2_070,
      },
      rested: true,
      reloaded: true,
      waiting: 1,
      shown: face({
        state: "starting",
        address: at("/gate?p=t"),
        loading: true,
        presented: 0,
      }),
      still: true,
      bytes: 8_532_924,
      page: { ...WORDS, hue: 780_000, film: 0, ink: 150_000 },
      opened: face({ address: at("/gate?p=t") }),
    };
    expect(judgeTidy(seen)).toEqual([]);
    // the lane before PT-5b3: the put-down took nothing (its texture "of the address before"), so the reload found no
    // photograph — the film
    expect(
      judgeTidy({
        ...seen,
        kept: null,
        still: false,
        bytes: 0,
        page: { ...WORDS, hue: 0 },
      }),
    ).toEqual([
      "TIDY: put down, the pane kept NO still — an address that moved within its document cost it its photograph",
      "TIDY: after the reload, before its page's first frame, the pane is starting with no still and 0 bytes — the film, not its photograph",
      "TIDY: after the reload the pane's page area is 0.0% the fixture's hue, not 40% — its photograph is not drawn",
    ]);
    // a still filed under the address before; the document not following the page's own move
    expect(
      judgeTidy({
        ...seen,
        kept: seen.kept === null ? null : { ...seen.kept, address: at("/gate?p=t&tidy=1") },
        url: at("/gate?p=t&tidy=1"),
      }),
    ).toEqual([
      `TIDY: the document says the pane is at ${at("/gate?p=t&tidy=1")}, not where its page tidied itself to (/gate?p=t)`,
      `TIDY: put down, its still is filed under ${at("/gate?p=t&tidy=1")}, not the address now (/gate?p=t)`,
    ]);
    // rows that proved nothing: a page that did not tidy; a frame after the tidy; no rest, no reload, no load waiting
    expect(
      judgeTidy({
        ...seen,
        after: { ...inHand, presented: 3 },
        rested: false,
        reloaded: false,
        waiting: 0,
        opened: null,
      }),
    ).toEqual([
      `TIDY: once told, the page says it is at ${at("/gate?p=t&tidy=1")}, not /gate?p=t — it did not tidy its address: the row proved nothing`,
      "TIDY: the pane was not at rest before the reload — its page would not load again",
      "TIDY: the desk did not come back after the reload",
      "TIDY: no load waited at the fixture's gate after the reload — the row proved nothing",
      "TIDY: the gate opened, the pane is without a face (0 frames) — its page did not replace its still",
    ]);
    expect(judgeTidy({ ...seen, after: { ...seen.after, presented: 3 } as FirstFace })).toEqual([
      "TIDY: 1 frames landed after the page tidied its address — its texture is of the address NOW whatever the law: the row proved nothing",
    ]);
    // PT-5c (ruling 7): a frame between the tidy and the put-down (the pointer leaving for the bar repainted the page)
    expect(judgeTidy({ ...seen, down: { ...seen.down, presented: 4 } as FirstFace })).toEqual([
      "TIDY: 2 frames landed between the page's tidy and the put-down — the still is of the address NOW whatever the law: the row proved nothing",
    ]);
  });

  it("TAPS-COLD (PT-5b3): two quick taps sent while a phone's page is held busy, its scale never read, are heard once it is free — start, end, start, end — never dropped", () => {
    const seen: FirstLoadSeen["tapsCold"] = {
      view: [402, 874],
      held: 1,
      sentWithinMs: 128,
      hold: [5_210, 5_210 + FIXTURE_HOLD_MS],
      log: ["start", "end", "start", "end"],
      at: [6_712, 6_713, 6_715, 6_716],
    };
    expect(judgeTapsCold(seen)).toEqual([]);
    // the lane before PT-5b3: the read not answered inside 200 ms, no scale known for the document — not sent
    expect(judgeTapsCold({ ...seen, log: [], at: [] })).toEqual([
      "TAPS-COLD: the page, held busy with its scale never read, heard nothing for two taps, not start, end, start, end — a press on a page too busy to say its scale was dropped, not delivered late",
    ]);
    expect(judgeTapsCold({ ...seen, log: ["start", "end"], at: [6_712, 6_713] })).toEqual([
      "TAPS-COLD: the page, held busy with its scale never read, heard start, end for two taps, not start, end, start, end — a press on a page too busy to say its scale was dropped, not delivered late",
    ]);
    // rows that proved nothing: a page never held (or held short); taps sent after the hold; touches heard inside it
    expect(judgeTapsCold({ ...seen, held: 0, hold: null })).toEqual([
      `TAPS-COLD: the page said it was held 0 times and kept its thread 0 ms, not once for ${FIXTURE_HOLD_MS} — the row proved nothing`,
    ]);
    expect(judgeTapsCold({ ...seen, hold: [5_210, 5_400] })).toEqual([
      `TAPS-COLD: the page said it was held 1 times and kept its thread 190 ms, not once for ${FIXTURE_HOLD_MS} — the row proved nothing`,
    ]);
    expect(judgeTapsCold({ ...seen, sentWithinMs: FIXTURE_HOLD_MS + 40 })).toEqual([
      `TAPS-COLD: the taps were sent ${FIXTURE_HOLD_MS + 40} ms after the page said it was held — past its ${FIXTURE_HOLD_MS} ms hold: the row proved nothing`,
    ]);
    expect(judgeTapsCold({ ...seen, at: [5_300, 5_301, 5_340, 5_341] })).toEqual([
      `TAPS-COLD: the page heard its first touch at 5300 ms, before its hold ended (${5_210 + FIXTURE_HOLD_MS}) — the taps did not arrive while it was held: the row proved nothing`,
    ]);
    expect(judgeTapsCold({ ...seen, view: [1280, 800] })).toEqual([
      "TAPS-COLD: the page's view is 1280 × 800, not a phone's 402 wide — the row proved nothing",
    ]);
  });
});

describe("a page's first load, in the product — what the rows read by", () => {
  it("a face's states as a run: each said once while it lasts", () => {
    expect(runOf([])).toEqual([]);
    expect(runOf(["starting", "starting", "live", "live", "live"])).toEqual(["starting", "live"]);
    expect(runOf(["live", "failed", "live"])).toEqual(["live", "failed", "live"]);
  });

  it("the two taps are quick AGAINST THE FIXTURE'S OWN TIMES: the second press falls inside the stretch `/busy` keeps its thread at the first touch, and both taps fit well inside `/cold`'s hold", () => {
    const { held, between } = FIRST_ROWS.tap;
    // TAPS: the first touch keeps the page FIXTURE_BUSY_MS — the second press must arrive while it is kept
    expect(held + between).toBeLessThan(FIXTURE_BUSY_MS);
    // TAPS-COLD: press, release, press, release — sent inside the hold with half of it to spare
    expect(held + between + held).toBeLessThan(FIXTURE_HOLD_MS / 2);
  });

  it("TAPS-PENDING (PT-5c, ruling 1): a link to the shut gate pressed, then at once the page's own field — the page that STOOD hears the tap (its focus on its field), the page the gate lets through hears nothing of it; and its desktop twin: a click and a key behind the pane's scheme, told meanwhile", () => {
    const seen: PendingSeen = {
      asked: 1,
      told: false,
      standing: { touches: 2, focused: "field", field: "" },
      next: { touches: 0, focused: "", field: "", path: "/gate?p=pending-phone" },
      face: face({ address: `${O}/gate?p=pending-phone` }),
    };
    expect(judgePending(seen, false)).toEqual([]);
    // the lane before PT-5c: the tap waited on a read the engine does not answer while a navigation pends — and landed on
    // the next page
    expect(
      judgePending(
        {
          ...seen,
          standing: { touches: 1, focused: "", field: "" },
          next: { touches: 1, focused: "field", field: "", path: "/gate?p=pending-phone" },
        },
        false,
      ),
    ).toEqual([
      "TAPS-PENDING: the page that stood heard 1 touches, its focus on nothing — the tap on its own field did not reach it while the link's navigation pended",
      "TAPS-PENDING: the next page heard 1 touches, its focus on field — a tap aimed at the page that stood was delivered to the one that replaced it",
    ]);
    // rows that proved nothing: the link never waited at the gate; the next page never stood
    expect(judgePending({ ...seen, asked: 0, face: face({ state: "starting" }) }, false)).toEqual([
      "TAPS-PENDING: the link's navigation never waited at the gate — the row proved nothing",
      "TAPS-PENDING: the page the gate let through never stood (starting) — the row proved nothing",
    ]);
    expect(judgePending({ ...seen, standing: null }, false)).toEqual([
      "TAPS-PENDING: the page that stood said nothing",
    ]);
    const desk: PendingSeen = {
      ...seen,
      told: true,
      standing: { touches: 0, focused: "field", field: "q" },
      next: { touches: 0, focused: "", field: "", path: "/gate?p=pending-laptop" },
    };
    expect(judgePending(desk, true)).toEqual([]);
    expect(
      judgePending(
        {
          ...desk,
          told: false,
          standing: { touches: 0, focused: "", field: "" },
          next: { touches: 0, focused: "field", field: "q", path: "/gate?p=pending-laptop" },
        },
        true,
      ),
    ).toEqual([
      "TAPS-PENDING (desktop): the pane's scheme was not told — no device command pended: the row proved nothing",
      "TAPS-PENDING (desktop): the page that stood has \"\" in its field, its focus on nothing — the click and the key sent behind the scheme's command did not reach it while the link's navigation pended",
      'TAPS-PENDING (desktop): the next page has "q" in its field, its focus on field — the click and the key were delivered to the page that replaced the one they were aimed at',
    ]);
  });

  it("DOWN-GONE (PT-5c, ruling 2): a finger down when the app's window reloads is ENDED for it (a cancel), and the pane back hovers — the page hears no move", () => {
    const seen: FirstLoadSeen["downGone"] = {
      before: ["start"],
      after: ["start", "cancel"],
      reloaded: true,
      kept: true,
    };
    expect(judgeDownGone(seen)).toEqual([]);
    // the lane before PT-5c: nothing ended the finger; the attachment back dragged the page with its first hover
    expect(judgeDownGone({ ...seen, after: ["start", "move", "move"] })).toEqual([
      "DOWN-GONE: after the window came back the page heard start, move, move — its finger was left down, and the first hover dragged the page",
    ]);
    expect(judgeDownGone({ ...seen, after: ["start"] })).toEqual([
      "DOWN-GONE: the page heard start — its finger was never ended when the attachment that pressed it went",
    ]);
    // rows that proved nothing
    expect(judgeDownGone({ before: [], after: [], reloaded: false, kept: false })).toEqual([
      "DOWN-GONE: the page never heard its finger down — the row proved nothing",
      "DOWN-GONE: the app's window did not come back — the row proved nothing",
    ]);
    expect(judgeDownGone({ ...seen, kept: false })).toEqual([
      "DOWN-GONE: the pane's page was not kept through the window's reload (another document) — the row proved nothing",
    ]);
  });

  it("ZOOMED (PT-5c, ruling 1): a phone's page that zooms itself at a double tap SAYS so, and a tap where its field is drawn puts the focus on the field — the press went at the scale the page said", () => {
    expect(judgeZoomed({ scale: 2, focused: "field" })).toEqual([]);
    // the scale never followed (no word after the zoom): the press went at 1 — twice as far — and missed the field
    expect(judgeZoomed({ scale: 2, focused: "" })).toEqual([
      "ZOOMED: a tap where its field is drawn put its focus on nothing — the press did not go at the scale the page said after it zoomed",
    ]);
    // the page that did not zoom proves nothing
    expect(judgeZoomed({ scale: 1, focused: "field" })).toEqual([
      "ZOOMED: the page says it is drawn at 1, not 2 — it did not zoom at the double tap: the row proved nothing",
    ]);
    expect(judgeZoomed({ scale: null, focused: "" })).toEqual([
      "ZOOMED: the page says it is drawn at no scale, not 2 — it did not zoom at the double tap: the row proved nothing",
    ]);
  });
});
