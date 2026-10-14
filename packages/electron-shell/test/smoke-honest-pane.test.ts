/**
 * PT-5a — the page's honest life, in the product (testing/smoke-honest-pane.ts): the judges the honest rows hold the product
 * to — BAR, POPUP, ALERT, PICKER, DOWNLOAD, CARET, FAVICON-ONCE, HEARD, PARKED, FAIL and STOPPED — each passing what the
 * product does (the numbers of a green run) and failing, in words with its numbers, what it should not; the notice's pixel
 * classifier; the page's area of a pane in hand; and the capsule's place, said by the smoke on its own.
 */
import { describe, expect, it } from "vitest";
import { FIXTURE_HUE } from "../src/testing/live-fixture";
import {
  type FailedFaceSeen,
  HONEST_ROWS,
  type HonestSeen,
  heldPageArea,
  judgeAlert,
  judgeBar,
  judgeCaret,
  judgeDownload,
  judgeFail,
  judgeFaviconOnce,
  judgeHeard,
  judgeNotice,
  judgeParked,
  judgePicker,
  judgePopup,
  judgeSleep,
  judgeStopped,
  NOTICE_CLASSIFY,
  noticeCapsule,
  type WindowsSeen,
  windowsRaised,
} from "../src/testing/smoke-honest-pane";

const HOST = "127.0.0.1:57263";
const ADDRESS = `http://${HOST}/revived`;

/** A green run's rows, as the product said them. */
const BAR: HonestSeen["bar"] = {
  fresh: { disabled: true, label: "Back" },
  pressed: { path: "/page", navigations: 0, held: true },
  after: { disabled: false, label: "Back" },
  loading: { disabled: false, label: "Stop" },
  stopped: { disabled: false, label: "Reload" },
  path: "/acts",
  slow: { asked: 1, answered: 0, aborted: 1 },
};
const POPUP: HonestSeen["popup"] = {
  blank: "/next",
  opened: "null",
  openedPath: "/next?opened=1",
  windows: [2, 2],
  raised: 0,
  faces: [1, 1],
  panes: [1, 1],
};
const ALERT: HonestSeen["alert"] = {
  alerts: 1,
  confirmed: false,
  prompted: null,
  windows: [2, 2],
  raised: 0,
};
const PICKER: HonestSeen["picker"] = {
  cancels: 1,
  changes: 0,
  windows: [2, 2],
  raised: 0,
  focused: [null, null],
};
const DOWNLOAD: HonestSeen["download"] = {
  serial: 1,
  said: "Download blocked",
  unsaidMs: 2650,
  path: "/acts",
  asked: 1,
};
const CARET: HonestSeen["caret"] = {
  focused: "field",
  ms: 4002,
  arrivals: 8,
  presented: 8,
  submits: 8,
  steps: 481,
  sleeps: 0,
};
const FAVICON: HonestSeen["faviconOnce"] = {
  bytes: [1, 1],
  cursors: ["pointer", "text", "default", "pointer", "text", "default"],
  head: "icon:0aae65c21fc074a7",
};
const HEARD_ON = { muted: false, audible: true };
const HEARD: HonestSeen["heard"] = {
  tone: "running",
  held: HEARD_ON,
  rest: HEARD_ON,
  unseen: { muted: true, audible: true, offScreen: true },
  seenAgain: HEARD_ON,
  deleted: { muted: true, audible: true, ms: 156 },
  undone: { ...HEARD_ON, samePage: true },
};
const PARKED: HonestSeen["parked"] = {
  parked: true,
  before: { frames: 45, muted: false },
  under: { frames: 0, muted: true, wire: "paused" },
  after: { frames: 45, muted: false, wire: "live" },
};
const REFUSED: FailedFaceSeen = {
  state: "failed",
  reason: "connection-refused",
  veiled: true,
  address: ADDRESS,
  display: HOST,
  pixels: { px: 1342856, ink: 8029, film: 1332159, hue: 0 },
};
const FAIL: HonestSeen["fail"] = {
  host: HOST,
  rest: { ...REFUSED, pixels: { px: 969388, ink: 5589, film: 961453, hue: 0 } },
  restPart: "",
  held: REFUSED,
  capsule: "pointer",
  film: "default",
  reload: { disabled: false, label: "Reload" },
  retried: { state: "live", veiled: false, path: "/revived" },
};
const STOPPED: HonestSeen["stopped"] = {
  killed: true,
  face: {
    ...REFUSED,
    reason: "stopped: Browser page stopped",
    pixels: { px: 1342856, ink: 7695, film: 1331866, hue: 0 },
  },
  recovered: { state: "live", newPage: true },
};

describe("the page's honest life — its rows", () => {
  it("BAR: ‹ disabled on a fresh page and its press and chord nothing; live after a click; ↻ Stop while a page loads, and its press stops the load", () => {
    expect(judgeBar(BAR)).toEqual([]);
    expect(judgeBar({ ...BAR, fresh: { disabled: false, label: "Back" } })).toEqual([
      "BAR: ‹ is not aria-disabled on a fresh page — the bar says there is somewhere to go",
    ]);
    expect(judgeBar({ ...BAR, fresh: null })).toEqual(["BAR: the held bar has no ‹"]);
    // the disabled tool DID something: the page went, a navigation was sent, the pane was put down
    expect(
      judgeBar({ ...BAR, pressed: { path: "about:blank", navigations: 2, held: false } }),
    ).toEqual([
      "BAR: after a press on the disabled ‹ and ⌘[ the page is at about:blank, not where it was",
      "BAR: the disabled ‹ and its chord sent 2 navigations — a disabled tool does nothing",
      "BAR: the pane left the hand at the disabled ‹'s press or chord",
    ]);
    expect(judgeBar({ ...BAR, after: { disabled: true, label: "Back" } })).toEqual([
      "BAR: ‹ is still disabled after the page went to its link — it never came live",
    ]);
    // the bar never said Stop
    expect(judgeBar({ ...BAR, loading: { disabled: false, label: "Reload" } })).toEqual([
      'BAR: during the slow load ↻ reads "Reload", not Stop',
    ]);
    // …or said it and did not stop: the slow page was answered, ↻ still says Stop, the page went there
    expect(
      judgeBar({
        ...BAR,
        stopped: { disabled: false, label: "Stop" },
        slow: { asked: 1, answered: 1, aborted: 0 },
        path: "/slow",
      }),
    ).toEqual([
      'BAR: after its press ↻ reads "Stop", not Reload — the load was not stopped',
      "BAR: the slow load was answered 1 times and given up 0 — Stop did not stop it",
      "BAR: after the stop the page is at /slow, not the page it was on",
    ]);
    expect(judgeBar({ ...BAR, slow: { asked: 0, answered: 0, aborted: 0 } })).toEqual([
      "BAR: the slow address was never asked for",
      "BAR: the slow load was answered 0 times and given up 0 — Stop did not stop it",
    ]);
  });

  it("POPUP: the same pane goes where a new window was asked for — no window, no page, no pane more; window.open answers null", () => {
    expect(judgePopup(POPUP)).toEqual([]);
    // a window was opened: one more of everything, and the pane's own page never moved
    expect(
      judgePopup({
        blank: "/acts",
        opened: "window",
        openedPath: "/acts",
        windows: [2, 3],
        raised: 1,
        faces: [1, 2],
        panes: [1, 2],
      }),
    ).toEqual([
      "POPUP: the target=_blank link left the pane's page at /acts, not /next — the same pane did not go there",
      'POPUP: window.open answered "window", not null — a page was given a window',
      "POPUP: window.open left the pane's page at /acts, not /next?opened=1",
      "POPUP: the app has 1 windows it did not have before (2 then, 3 now)",
      "POPUP: 2 pages live on the desk, not the 1 before",
      "POPUP: 2 panes on the board, not the 1 before",
    ]);
    // PT-5b — a window that only LEFT meanwhile (an earlier row set's page, its grace run out) is no window raised…
    expect(judgePopup({ ...POPUP, windows: [5, 4], raised: 0 })).toEqual([]);
    // …and a count that stands does not hide one that came beside it
    expect(judgePopup({ ...POPUP, windows: [5, 5], raised: 1 })).toEqual([
      "POPUP: the app has 1 windows it did not have before (5 then, 5 now)",
    ]);
  });

  it("PT-5b: the windows RAISED are those that were not there before — by what they are, never by their count", () => {
    const seen = (ids: number[]): WindowsSeen => ({ count: ids.length, focused: null, ids });
    expect(windowsRaised(seen([1, 2, 3]), seen([1, 2, 3]))).toBe(0);
    expect(windowsRaised(seen([1, 2, 3]), seen([1, 3]))).toBe(0);
    expect(windowsRaised(seen([1, 2, 3]), seen([1, 3, 9]))).toBe(1);
    expect(windowsRaised(seen([]), seen([4, 5]))).toBe(2);
  });

  it("ALERT: the page's word AFTER its dialogs arrives — the alert returned, the confirm false, the prompt null — and no window was raised", () => {
    expect(judgeAlert(ALERT)).toEqual([]);
    expect(
      judgeAlert({ alerts: 0, confirmed: null, prompted: "unasked", windows: [2, 3], raised: 1 }),
    ).toEqual([
      "ALERT: the page's word after its alert never came — it is blocked behind a dialog",
      "ALERT: confirm answered null, not false (cancelled)",
      'ALERT: prompt answered "unasked", not null (cancelled)',
      "ALERT: the app has 1 windows it did not have before the dialogs (2 then, 3 now)",
    ]);
    expect(judgeAlert({ ...ALERT, windows: [5, 4] })).toEqual([]);
    expect(judgeAlert({ ...ALERT, confirmed: true })).toEqual([
      "ALERT: confirm answered true, not false (cancelled)",
    ]);
    // Electron's own prompt throws: the page said so
    expect(judgeAlert({ ...ALERT, prompted: "threw" })).toEqual([
      'ALERT: prompt answered "threw", not null (cancelled)',
    ]);
    expect(judgeAlert({ ...ALERT, prompted: undefined })[0]).toMatch(/prompt answered undefined/);
  });

  it("PICKER: the input hears cancel and nothing is chosen; the app's windows and its focused window are as they were", () => {
    expect(judgePicker(PICKER)).toEqual([]);
    expect(judgePicker({ ...PICKER, focused: [7, 7] })).toEqual([]);
    expect(
      judgePicker({ cancels: 0, changes: 1, windows: [2, 3], raised: 1, focused: [7, null] }),
    ).toEqual([
      "PICKER: the file input never heard `cancel` — its picker was not answered (a panel may be up)",
      "PICKER: the file input changed 1 times",
      "PICKER: the app has 1 windows it did not have before (2 then, 3 now)",
      "PICKER: the focused window is null, not 7 as before the press",
    ]);
    expect(judgePicker({ ...PICKER, windows: [5, 4] })).toEqual([]);
  });

  it("DOWNLOAD: cancelled and SAID — the head says it for its moment, then its address again", () => {
    expect(judgeDownload(DOWNLOAD)).toEqual([]);
    expect(judgeDownload({ serial: 0, said: null, unsaidMs: 0, path: "/acts", asked: 1 })).toEqual([
      "DOWNLOAD: the face's words carry no refusal — the page's download was not said",
      'DOWNLOAD: the head said null, not "Download blocked"',
    ]);
    expect(judgeDownload({ ...DOWNLOAD, unsaidMs: null })).toEqual([
      `DOWNLOAD: the head went on saying it past ${HONEST_ROWS.saidWithinMs} ms — its address never came back`,
    ]);
    expect(judgeDownload({ ...DOWNLOAD, asked: 0, path: "/file.bin" })).toEqual([
      "DOWNLOAD: the download was never asked for",
      "DOWNLOAD: the page is at /file.bin, not the page that asked",
    ]);
  });

  it("PT-6a (M7 C1) SLEEP: a held page that is still lets the desk sleep — asleep a second after its field blurred; after a key or a wheel asleep again after the hand's quiet (not before it, not long after); after the lease's end and the page's last frame within their bounds; each stir wakes it", () => {
    const ok = {
      still: true,
      after: {
        key: { woke: true, ms: 262 },
        wheel: { woke: true, ms: 270 },
        lease: { woke: true, ms: 24 },
        arrival: { woke: true, ms: 290 },
      },
    };
    expect(judgeSleep(ok)).toEqual([]);
    // before C1: a held page never let the desk sleep
    expect(
      judgeSleep({
        still: false,
        after: {
          key: { woke: false, ms: null },
          wheel: { woke: false, ms: null },
          lease: { woke: false, ms: null },
          arrival: { woke: false, ms: null },
        },
      }),
    ).toEqual([
      "SLEEP: a held page with nothing moving — its field blurred, a second gone — keeps the desk awake: it steps every frame for nothing",
      "SLEEP: the key did not wake the desk — what it moved was never drawn",
      "SLEEP: the wheel did not wake the desk — what it moved was never drawn",
      "SLEEP: the lease did not wake the desk — what it moved was never drawn",
      "SLEEP: the arrival did not wake the desk — what it moved was never drawn",
    ]);
    // asleep too soon after a key; too late after a wheel; never again after the page's frames
    expect(
      judgeSleep({
        ...ok,
        after: {
          ...ok.after,
          key: { woke: true, ms: 40 },
          wheel: { woke: true, ms: 900 },
          arrival: { woke: true, ms: null },
        },
      }),
    ).toEqual([
      `SLEEP: after the key the desk slept 40 ms later — before the hand's quiet (${HONEST_ROWS.sleepNotBeforeMs})`,
      `SLEEP: after the wheel the desk slept 900 ms later, not within ${HONEST_ROWS.sleepWithinMs}`,
      `SLEEP: after the arrival the desk was still awake ${HONEST_ROWS.sleepWatchMs} ms later, not within ${HONEST_ROWS.sleepArrivalWithinMs}`,
    ]);
  });

  it("CARET: a held page with a resting caret costs a caret's frames — under the ceiling — and no more than a frame's worth of submits each", () => {
    expect(judgeCaret(CARET)).toEqual([]);
    // a still page (no caret at all) is no problem of this row's
    expect(judgeCaret({ ...CARET, arrivals: 0, presented: 0, submits: 0 })).toEqual([]);
    expect(judgeCaret({ ...CARET, focused: "" })).toEqual([
      'CARET: the page\'s focus is on "", not its field',
    ]);
    // the page streams at its display's rate though nothing moves but a caret
    expect(judgeCaret({ ...CARET, arrivals: 240, presented: 240, submits: 240 })).toEqual([
      `CARET: 60.0 frames a second arrive from a held page with a resting caret, over ${HONEST_ROWS.caretMaxFps}`,
    ]);
    // the desk submits many times for each frame that lands
    expect(judgeCaret({ ...CARET, submits: 2_000 })).toEqual([
      "CARET: 2000 submits for 8 presented frames in 481 steps — more than a frame's worth each",
    ]);
  });

  it("FAVICON-ONCE: the cursor moved — summaries crossed — and the favicon's bytes arrived no more; a hover that moved nothing proves nothing", () => {
    expect(judgeFaviconOnce(FAVICON)).toEqual([]);
    expect(judgeFaviconOnce({ ...FAVICON, bytes: [1, 7] })).toEqual([
      "FAVICON-ONCE: the favicon's bytes arrived 6 more times over a hover — they ride the page's summaries",
    ]);
    expect(judgeFaviconOnce({ ...FAVICON, cursors: ["default"] })).toEqual([
      'FAVICON-ONCE: the page\'s cursor was ["default"] over the hover — no summary of its state crossed, the row proved nothing',
    ]);
    expect(judgeFaviconOnce({ bytes: [0, 0], cursors: FAVICON.cursors, head: "generic" })).toEqual([
      "FAVICON-ONCE: the favicon's bytes never arrived at all — the row proved nothing",
      'FAVICON-ONCE: the head says "generic", not the page\'s own favicon',
    ]);
  });

  it("HEARD: audible and unmuted in hand and at rest in view; muted off the view; muted at once when its pane is deleted; the same page heard again undone", () => {
    expect(judgeHeard(HEARD)).toEqual([]);
    const silent = { muted: false, audible: false };
    expect(judgeHeard({ ...HEARD, tone: "suspended", held: silent, rest: silent })).toEqual([
      'HEARD: the page\'s tone is "suspended", not running — the row proved nothing',
      'HEARD: in hand the page is {"muted":false,"audible":false} — not audible and unmuted',
      'HEARD: at rest in view the page is {"muted":false,"audible":false} — not audible and unmuted',
    ]);
    // heard though nobody sees it
    expect(
      judgeHeard({ ...HEARD, unseen: { muted: false, audible: true, offScreen: true } }),
    ).toEqual(["HEARD: panned off the view the page is NOT muted"]);
    expect(
      judgeHeard({ ...HEARD, unseen: { muted: true, audible: true, offScreen: false } }),
    ).toEqual(["HEARD: the pane was never panned off the view — the row proved nothing"]);
    expect(judgeHeard({ ...HEARD, seenAgain: { muted: true, audible: true } })).toEqual([
      'HEARD: panned back the page is {"muted":true,"audible":true} — not heard again',
    ]);
    // PT-2b's finding: a deleted pane's page heard for its grace
    expect(judgeHeard({ ...HEARD, deleted: { muted: false, audible: true, ms: null } })).toEqual([
      `HEARD: the deleted pane's page was not muted within ${HONEST_ROWS.silentWithinMs} ms — it is heard after its pane is gone`,
    ]);
    expect(judgeHeard({ ...HEARD, deleted: null })).toEqual([
      "HEARD: the deleted pane's page was gone before it could be read",
    ]);
    expect(
      judgeHeard({ ...HEARD, undone: { muted: true, audible: true, samePage: true } }),
    ).toEqual([
      'HEARD: after the undo the page is {"muted":true,"audible":true,"samePage":true} — not heard again',
    ]);
    expect(judgeHeard({ ...HEARD, undone: { ...HEARD_ON, samePage: false } })).toEqual([
      "HEARD: after the undo the pane shows ANOTHER page — the grace did not keep its own",
    ]);
  });

  it("PARKED: under the cover no frame arrives and the page is muted and asked paused; the cover down, the frames, the sound and the ask return", () => {
    expect(judgeParked(PARKED)).toEqual([]);
    expect(judgeParked({ ...PARKED, parked: false })).toEqual([
      "PARKED: the desk never parked under the cover",
    ]);
    // the page went on under the cover
    expect(judgeParked({ ...PARKED, under: { frames: 44, muted: false, wire: "live" } })).toEqual([
      "PARKED: 44 frames arrived from the page while the desk was parked",
      "PARKED: the page is not muted under the cover",
      "PARKED: the page was asked live under the cover, not paused",
    ]);
    // …or never came back
    expect(judgeParked({ ...PARKED, after: { frames: 0, muted: true, wire: "paused" } })).toEqual([
      "PARKED: 0 frames arrived after the cover came down — the page did not come back",
      "PARKED: the page is still muted after the cover came down",
      "PARKED: the page was asked paused after the cover came down, not live",
    ]);
    // a page that was not animating proves nothing
    expect(judgeParked({ ...PARKED, before: { frames: 1, muted: false } })).toEqual([
      "PARKED: 1 frames arrived from the animating page before the cover — the row proved nothing",
    ]);
  });

  it("FAIL: a refused address is a failed face — its word, its texture hidden, the ASKED address on its words and its head; ink over film at rest and in hand; the capsule a part in hand; Try again loads it", () => {
    expect(judgeFail(FAIL)).toEqual([]);
    // today's failure before PT-5a: the engine's own error page shown, under its own address
    const chrome: FailedFaceSeen = {
      state: "live",
      reason: null,
      veiled: false,
      address: "chrome-error://chromewebdata/",
      display: "chromewebdata",
      pixels: { px: 1000, ink: 900, film: 40, hue: 0 },
    };
    const before = judgeFail({ ...FAIL, rest: chrome, held: chrome });
    expect(before).toContain("FAIL (at rest): the face is live, not failed");
    expect(before).toContain(
      'FAIL (at rest): the face\'s reason is null, not "connection-refused"',
    );
    expect(before).toContain(
      "FAIL (in hand): the face's texture is not hidden — what the page last painted may be shown",
    );
    expect(before).toContain(
      `FAIL (in hand): the face's address is "chrome-error://chromewebdata/", not the one asked for (${HOST})`,
    );
    expect(before).toContain(
      `FAIL (in hand): the head prints "chromewebdata", not the address asked for (${HOST})`,
    );
    expect(before).toContain(
      "FAIL (in hand): 90.0 % of the page's area is light — a page (the engine's own error page?), not a film with words",
    );
    // the film alone, no words; the page before still shown
    expect(
      judgeFail({
        ...FAIL,
        held: { ...REFUSED, pixels: { px: 1000, ink: 0, film: 1000, hue: 0 } },
      }),
    ).toEqual([
      "FAIL (in hand): 0.00 % of the page's area is the words' ink, under 0.15 % — the film says nothing",
    ]);
    expect(
      judgeFail({
        ...FAIL,
        rest: { ...FAIL.rest, pixels: { px: 1000, ink: 30, film: 100, hue: 800 } },
      }),
    ).toEqual([
      "FAIL (at rest): 10.0 % of the page's area is the film, under 60 %",
      "FAIL (at rest): 80.0 % of the page's area is the fixture's hue — the page before the failure is still shown",
    ]);
    // another reason is another failure; a host's detail after the word is the same word
    expect(judgeFail({ ...FAIL, held: { ...REFUSED, reason: "timed-out" } })).toEqual([
      'FAIL (in hand): the face\'s reason is "timed-out", not "connection-refused"',
    ]);
    expect(
      judgeFail({ ...FAIL, held: { ...REFUSED, reason: "connection-refused: net::ERR (-102)" } }),
    ).toEqual([]);
    // the parts
    expect(judgeFail({ ...FAIL, restPart: "retry", capsule: "default", film: "pointer" })).toEqual([
      'FAIL: at rest a point of the failed page picks "retry", not the pane itself (no part)',
      'FAIL: in hand the cursor over the notice\'s capsule is "default", not a pointer — Try again is not a part',
      'FAIL: in hand the cursor over the film beside the capsule is "pointer" — the film is not the pane\'s own glass',
    ]);
    expect(judgeFail({ ...FAIL, reload: { disabled: true, label: "Reload" } })).toEqual([
      "FAIL: the bar's ↻ is disabled on a page that can be tried again",
    ]);
    // Try again did nothing
    expect(judgeFail({ ...FAIL, retried: { state: "failed", veiled: true, path: null } })).toEqual([
      "FAIL: after Try again the face is failed, not live",
      "FAIL: after Try again the face's texture is still hidden",
      "FAIL: after Try again the page is at null, not the address that was asked for",
    ]);
  });

  it("STOPPED: the killed page is said to have stopped — its address kept, its film worded — and ↻ loads a NEW page there", () => {
    expect(judgeStopped(STOPPED, HOST)).toEqual([]);
    expect(judgeStopped({ ...STOPPED, killed: false }, HOST)).toEqual([
      "STOPPED: the page's process could not be found to kill — the row proved nothing",
    ]);
    // restarted behind the person: never said
    expect(
      judgeStopped(
        {
          ...STOPPED,
          face: {
            ...STOPPED.face,
            state: "live",
            reason: null,
            veiled: false,
            pixels: { px: 1000, ink: 20, film: 10, hue: 900 },
          },
        },
        HOST,
      ),
    ).toEqual([
      "STOPPED: the face is live, not failed",
      'STOPPED: the face\'s reason is null, not "stopped"',
      "STOPPED: the face's texture is not hidden — what the page last painted may be shown",
      "STOPPED: 1.0 % of the page's area is the film, under 60 %",
      "STOPPED: 90.0 % of the page's area is the fixture's hue — the page before the failure is still shown",
    ]);
    expect(
      judgeStopped({ ...STOPPED, recovered: { state: "failed", newPage: false } }, HOST),
    ).toEqual([
      "STOPPED: after ↻ the face is failed, not live",
      "STOPPED: after ↻ no NEW page spoke at the address — the page was not loaded again",
    ]);
  });
});

describe("the page's honest life — its pixels and its places", () => {
  it("the classifier knows the words' ink (light and grey), the film (dark) and the fixture's hue — and nothing else", () => {
    const classify = new Function(`return ${NOTICE_CLASSIFY};`)() as (
      r: number,
      g: number,
      b: number,
    ) => number;
    // the ink as drawn (a soft white), and dimmer for the detail's line
    expect(classify(230, 232, 234)).toBe(1);
    expect(classify(160, 162, 163)).toBe(1);
    // the film, in hand by day (a lit black) and its darkest
    expect(classify(36, 37, 39)).toBe(2);
    expect(classify(8, 9, 11)).toBe(2);
    // the fixture's ground: the page before the failure
    expect(classify(FIXTURE_HUE.r, FIXTURE_HUE.g, FIXTURE_HUE.b)).toBe(3);
    expect(classify(FIXTURE_HUE.r + 20, FIXTURE_HUE.g - 20, FIXTURE_HUE.b + 20)).toBe(3);
    // a light COLOUR is not ink (the runner's yellow), nor a mid grey film
    expect(classify(255, 211, 77)).toBe(0);
    expect(classify(120, 120, 120)).toBe(0);
    // a white page is all ink — which the judge refuses as a page, not a film with words
    expect(classify(255, 255, 255)).toBe(1);
    expect(judgeNotice("ROW", { px: 100, ink: 100, film: 0, hue: 0 })).toEqual([
      "ROW: 100.0 % of the page's area is light — a page (the engine's own error page?), not a film with words",
      "ROW: 0.0 % of the page's area is the film, under 60 %",
    ]);
    expect(judgeNotice("ROW", null)).toEqual(["ROW: the page's area could not be read"]);
    expect(judgeNotice("ROW", { px: 0, ink: 0, film: 0, hue: 0 })).toEqual([
      "ROW: the page's area could not be read",
    ]);
  });

  it("the page's area of a pane in hand: under its head, a little in from its edges", () => {
    // the extent 800 × 540 at (600, 400): its page 800 wide and 500 tall (1280 × 800 at 0.625), under a 40-tall head
    const area = heldPageArea({ cx: 600, cy: 400, hx: 400, hy: 270 }, [1280, 800]);
    expect(area).toEqual({ x: 232, y: 190, width: 736, height: 460 });
    // inside the page on every side
    expect(area.x).toBeGreaterThan(200);
    expect(area.x + area.width).toBeLessThan(1000);
    expect(area.y).toBeGreaterThan(170);
    expect(area.y + area.height).toBeLessThan(670);
  });

  it("the capsule's place is the pane's own layout, said again: on a laptop's page and on a phone's, inside the page", () => {
    expect(noticeCapsule([1280, 800])).toEqual({ cx: 640, cy: 394.5, hx: 88, hy: 26 });
    const phone = noticeCapsule([402, 874]);
    expect(phone.cx).toBe(201);
    expect(phone.hx).toBeCloseTo(57.2, 9);
    expect(phone.cy - phone.hy).toBeGreaterThan(0);
    expect(phone.cy + phone.hy).toBeLessThan(874);
    // a short page: the block is held on the page
    const short = noticeCapsule([320, 240]);
    expect(short.cy + short.hy).toBeLessThan(240);
  });
});
