// PT-5b2 — A PAGE'S FIRST LOAD, IN THE PRODUCT (smoke:canvas; the PORTALS brief PT-5b2 §2 — what PT-5b's grade found: no
// fixture page had ever navigated before its first load finished, and a page still starting could be neither sent anywhere
// nor stopped). Browser panes laid on clear ground, pointed at the smoke's own fixture (testing/live-fixture.ts), judged by
// the desk's own word (each face's row), the page's (its report with each ask), main's (its offscreen WebContents) and
// the desk's pixels where a failed face says why — never a hash:
//   FIRST-REDIRECT — a pane whose page's script sends it on BEFORE its first load finished (`/redirecting`: a subresource
//                    that never arrives): it is `live` at the redirect's end — never `failed` on the way — and main holds
//                    its one window still;
//   FIRST-CLICK    — a pane on a page that never finishes loading (`/loading`), in hand: a press on its link goes to the
//                    next page, live — the same window;
//   NO-DOCUMENT    — a pane whose address is an attachment (`/file.bin`): no page — its face says so in a person's words
//                    on its film, the page was REFUSED its download (the face's refusal count, one more — PT-5b3: a
//                    save panel is no window, so a count of windows could not see one), and ↻ asks for the address again;
//   STARTING       — a pane on the fixture's SHUT gate (its first address has not answered): an address typed over it
//                    goes there; another such pane's ↻ reads Stop, and pressed it stops — the face says so, the gate's
//                    load given up — then, the gate open, ↻ loads it;
//   TAPS           — a phone's page that keeps its thread busy at each touch (`/busy`): two quick taps are heard start,
//                    end, start, end — the hand's events in the order they were sent, whatever is awaited on the way.
// PT-5b3 (what PT-5b2's grade found in those fixes):
//   SWITCH-STARTING — a pane on the shut gate (its first address has not answered), its device switched to another of the
//                    SAME density (the laptop's to the tablet's): it stays `starting` at its address — never "no page at
//                    this address" — the gate asked for it once more; opened, it is live, seen as the device it was
//                    switched to;
//   TAPS-COLD      — a phone's page HELD busy with its scale never read (`/cold`, held on the smoke's word — a page just
//                    loaded and hydrating): two quick taps sent inside the hold are heard once it ends — start, end,
//                    start, end — never dropped for want of a scale;
//   TIDY           — a pane in hand on a page that TIDIES its own address (`?tidy=1`, on the smoke's word:
//                    `history.replaceState`, a move WITHIN the document, nothing painted): put down, its still is kept
//                    under the address NOW; put to rest and the window RELOADED with the gate shut, the pane shows that
//                    still before its page's first frame.
// Then the panes are removed and the board is as found. `--first-load` beside `--smoke-canvas` runs these rows alone
// after the boot's (the author's loop).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_HOLD_MS, type FixtureReport } from "./live-fixture";
import { PANE, type PaneHands, paneHands } from "./smoke-browser-pane";
import {
  type MainPage,
  PAGE_PIXELS,
  type PageSeen,
  pageAtRest,
  STILL_ROWS,
  type StillSaid,
} from "./smoke-last-still";
import type { LiveRowsDriver } from "./smoke-live-pane";
import { type HeldFrameSeen, pageOnWindow } from "./smoke-use-pane";

/** The flag beside `--smoke-canvas` that runs these rows alone after the boot's (the author's loop). */
export const FIRST_FLAG = "--first-load";

/** The rows' numbers. */
export const FIRST_ROWS = {
  /** how long a page's word or a face's turn is waited for */
  withinMs: 30_000,
  /** a laptop's pane as it is laid (the manifest's size), and the gap between two */
  laid: { w: 698.16, h: 461.94 },
  gap: 82,
  /** a failed face's page area: at least this many pixels of the words' ink, at least this share of film */
  ink: 40,
  film: 0.6,
  /** the address typed over a pane whose first address has not answered */
  typed: "/page?typed=1",
  /** TAPS: the gaps of two quick taps (ms) — a press to its release, a release to the next press */
  tap: { held: 15, between: 50 },
  /** SWITCH-STARTING: the device the pane is switched to — another of the laptop's density, told as another device */
  switchTo: "tablet",
} as const;

/** A face's row as these rows read it. */
export interface FirstFace {
  readonly state: string;
  /** a failed face's reason (the host's word leads it), else null */
  readonly reason: string | null;
  readonly address: string | null;
  readonly loading: boolean;
  readonly presented: number;
  /** PT-5b3: the serial of the last thing its page asked for and was refused (a download; 0: nothing) */
  readonly refused: number;
}

/** What the rows saw — the SMOKE_CANVAS_FIRST line, and what the judges read. */
export interface FirstLoadSeen {
  readonly redirect: {
    /** how many times `/redirecting` was asked for, and `/next` served for it */
    readonly asked: number;
    readonly served: number;
    /** every state the face said from its open to the end, in order, each once a run */
    readonly states: readonly string[];
    readonly face: FirstFace | null;
    /** the ids of main's offscreen WebContents the pane's page was seen in */
    readonly windows: readonly number[];
  };
  readonly click: {
    /** the page said it was still loading when its link was pressed, and its hanging image was asked for — counted
     * since ITS pane was laid (PT-5b3: `/redirecting` carries the same image) */
    readonly loading: boolean;
    readonly hung: number;
    readonly served: number;
    readonly states: readonly string[];
    readonly face: FirstFace | null;
    readonly windows: readonly number[];
  };
  readonly noDocument: {
    /** `/file.bin` asked before, after the pane was laid, after ↻ */
    readonly asked: readonly [number, number, number];
    readonly face: FirstFace | null;
    readonly page: PageSeen | null;
    /** what ↻ reads in hand, and the face once the address was asked again */
    readonly tool: string | null;
    readonly again: FirstFace | null;
  };
  readonly starting: {
    readonly sent: {
      /** the face before the address was typed (its first address held at the gate), and after */
      readonly before: FirstFace | null;
      readonly after: FirstFace | null;
      /** the page's own word at the typed address */
      readonly at: string | null;
    };
    readonly stopped: {
      readonly before: FirstFace | null;
      /** ↻'s label while the first address has not answered; the gate's waiting loads before the stop and after */
      readonly tool: string | null;
      readonly waiting: readonly [number, number];
      readonly face: FirstFace | null;
      readonly page: PageSeen | null;
      /** ↻'s label on the stopped face, and the face once the gate was open and ↻ pressed */
      readonly retry: string | null;
      readonly loaded: FirstFace | null;
    };
  };
  readonly taps: {
    /** the page's view as it says it, and every touch it heard, in order */
    readonly view: readonly [number, number] | null;
    readonly log: readonly string[];
  };
  /** PT-5b3 (ruling 2) — SWITCH-STARTING. */
  readonly switched: {
    /** the pane on the shut gate: its face, and whether the bar offered the device's act */
    readonly before: FirstFace | null;
    readonly offered: boolean;
    /** its device switched, the gate shut yet: its face; how many times its address was asked for before the switch and
     * in all; the loads waiting at the gate */
    readonly after: FirstFace | null;
    readonly asked: readonly [number, number];
    readonly waiting: number;
    /** the gate opened: its face; how its page says it is seen (`navigator.maxTouchPoints`; null: it never spoke); the
     * agent the request the gate ANSWERED came with; how many times its address was asked for in all by then; and the
     * device switches the desk told its pages meanwhile */
    readonly opened: FirstFace | null;
    readonly touchPoints: number | null;
    readonly agent: string | null;
    readonly askedOpened: number;
    readonly told: number;
  };
  /** PT-5b3 (ruling 4) — TIDY. */
  readonly tidy: {
    /** in hand, its page live: the face before its page tidied its address, and after (no frame since: `presented`) */
    readonly before: FirstFace | null;
    readonly after: FirstFace | null;
    /** PT-5c (ruling 7): the face read again AT THE PUT-DOWN — still no frame since the tidy (the pointer leaving the pane
     * for the bar can make a page repaint: a frame there would be of the address now, and the row green by any law) */
    readonly down: FirstFace | null;
    /** the document's own word for its address once the page tidied it (the pane follows its page's own moves) */
    readonly url: string | null;
    /** put down: the still the shelf keeps of it — the address it is filed under */
    readonly kept: StillSaid | null;
    /** put to rest before the reload: at rest, its page gone from main */
    readonly rested: boolean;
    /** the window reloaded with the gate shut: came back; its load waiting at the gate; its face; its page's area */
    readonly reloaded: boolean;
    readonly waiting: number;
    readonly shown: FirstFace | null;
    readonly still: boolean;
    readonly bytes: number;
    readonly page: PageSeen | null;
    /** the gate opened: its face */
    readonly opened: FirstFace | null;
  };
  /** PT-5b3 (ruling 6) — TAPS-COLD. */
  readonly tapsCold: {
    readonly view: readonly [number, number] | null;
    /** how many times the page said its hold began; how long after the smoke heard so the second tap had been sent */
    readonly held: number;
    readonly sentWithinMs: number;
    /** the page's own word: when its hold began and ended, every touch it heard, and when (its clock, ms) */
    readonly hold: readonly [number, number] | null;
    readonly log: readonly string[];
    readonly at: readonly number[];
  };
}

const word = (reason: string | null): string => (reason ?? "").split(": ")[0] ?? "";

/** The states a face may say on the way to a page that is there: never `failed`. */
function onTheWay(row: string, states: readonly string[]): string[] {
  return states.includes("failed")
    ? [
        `${row}: the face said ${states.join(" → ")} — the page FAILED on the way (a first load that another navigation supersedes is not a failed page)`,
      ]
    : [];
}

/** FIRST-REDIRECT: live at the redirect's end, never failed on the way, in its one window. */
export function judgeRedirect(seen: FirstLoadSeen["redirect"]): string[] {
  const out: string[] = [];
  if (seen.asked !== 1)
    out.push(
      `FIRST-REDIRECT: /redirecting was asked for ${seen.asked} times, not once — the row proved nothing`,
    );
  out.push(...onTheWay("FIRST-REDIRECT", seen.states));
  const f = seen.face;
  if (f === null || f.state !== "live" || f.presented < 1)
    out.push(
      `FIRST-REDIRECT: at the redirect's end the pane is ${f?.state ?? "without a face"} (${f?.reason ?? "no reason"}, ${f?.presented ?? 0} frames) — not live`,
    );
  if (f?.address?.endsWith("/next?from=redirect") !== true)
    out.push(
      `FIRST-REDIRECT: the pane says it is at ${f?.address ?? "no address"}, not where its page's script sent it (/next?from=redirect)`,
    );
  if (seen.served !== 1)
    out.push(`FIRST-REDIRECT: /next was served ${seen.served} times for the redirect, not once`);
  if (seen.windows.length !== 1)
    out.push(
      `FIRST-REDIRECT: the pane's page was seen in ${seen.windows.length} of main's windows (${seen.windows.join(", ")}), not its one — its window was made again`,
    );
  return out;
}

/** FIRST-CLICK: a link pressed while the page still loads goes to the next page, live, in the same window. */
export function judgeClick(seen: FirstLoadSeen["click"]): string[] {
  const out: string[] = [];
  if (!seen.loading || seen.hung < 1)
    out.push(
      `FIRST-CLICK: the page did not say it was still loading when its link was pressed (loading ${seen.loading}, its hanging image asked ${seen.hung} times) — the row proved nothing`,
    );
  out.push(...onTheWay("FIRST-CLICK", seen.states));
  const f = seen.face;
  if (seen.served !== 1)
    out.push(
      `FIRST-CLICK: /next was served ${seen.served} times after the press, not once — the press did not land`,
    );
  if (f === null || f.state !== "live" || f.address?.endsWith("/next") !== true)
    out.push(
      `FIRST-CLICK: after the press the pane is ${f?.state ?? "without a face"} at ${f?.address ?? "no address"} (${f?.reason ?? "no reason"}) — not live at /next`,
    );
  if (seen.windows.length !== 1)
    out.push(
      `FIRST-CLICK: the pane's page was seen in ${seen.windows.length} of main's windows, not its one`,
    );
  return out;
}

/** A failed face's page area: the words' ink on the film. */
function words(row: string, what: string, page: PageSeen | null): string[] {
  if (page === null || page.px === 0) return [`${row}: ${what} could not be read`];
  const out: string[] = [];
  if (page.ink < FIRST_ROWS.ink)
    out.push(
      `${row}: ${what} holds ${page.ink} pixels of the words' ink, not ${FIRST_ROWS.ink} — the face says nothing`,
    );
  if (page.film / page.px < FIRST_ROWS.film)
    out.push(
      `${row}: ${what} is ${((page.film / page.px) * 100).toFixed(1)}% film, not ${FIRST_ROWS.film * 100}% — something is drawn as its page`,
    );
  return out;
}

/** NO-DOCUMENT: an address that is no page says so — never `starting` for good — its download refused, and ↻ asks again. */
export function judgeNoDocument(seen: FirstLoadSeen["noDocument"]): string[] {
  const out: string[] = [];
  if (seen.asked[1] - seen.asked[0] !== 1)
    out.push(
      `NO-DOCUMENT: the attachment was asked for ${seen.asked[1] - seen.asked[0]} times when the pane was laid, not once — the row proved nothing`,
    );
  const f = seen.face;
  if (f === null || f.state !== "failed" || word(f.reason) !== "no-document")
    out.push(
      `NO-DOCUMENT: the pane whose address is an attachment is ${f?.state ?? "without a face"} (${f?.reason ?? "no reason"}), not failed: no-document — a load that ended with nothing is never said`,
    );
  if (f !== null && f.address?.includes("/file.bin") !== true)
    out.push(`NO-DOCUMENT: the face says it is at ${f.address}, not the address it was asked for`);
  // PT-5b3: what the page asked for and MAY NOT have — its download, cancelled by the session's guard and counted (a save
  // panel is no window of the app's: a count of windows could not have seen one)
  if (f !== null && f.refused !== 1)
    out.push(
      `NO-DOCUMENT: the pane's page was refused ${f.refused} downloads, not the one its address is — the attachment was not refused (or was never asked for)`,
    );
  out.push(...words("NO-DOCUMENT", "the pane's page area", seen.page));
  if (seen.tool !== "Reload")
    out.push(`NO-DOCUMENT: in hand ↻ reads ${JSON.stringify(seen.tool)}, not Reload`);
  if (seen.asked[2] - seen.asked[1] !== 1)
    out.push(
      `NO-DOCUMENT: ↻ asked for the address ${seen.asked[2] - seen.asked[1]} times, not once more`,
    );
  if (
    seen.again === null ||
    seen.again.state !== "failed" ||
    word(seen.again.reason) !== "no-document"
  )
    out.push(
      `NO-DOCUMENT: asked again, the pane is ${seen.again?.state ?? "without a face"} (${seen.again?.reason ?? "no reason"}) — not failed: no-document as before`,
    );
  else if (seen.again.refused !== 2)
    out.push(
      `NO-DOCUMENT: asked again, the pane's page was refused ${seen.again.refused} downloads in all, not two`,
    );
  return out;
}

/** STARTING: a pane whose first address has not answered can be sent elsewhere, stopped (and says so), and loaded again. */
export function judgeStarting(seen: FirstLoadSeen["starting"]): string[] {
  const out: string[] = [];
  const sent = seen.sent;
  if (sent.before === null || sent.before.state !== "starting" || sent.before.presented !== 0)
    out.push(
      `STARTING: before the address was typed the pane was ${sent.before?.state ?? "without a face"} (${sent.before?.presented ?? 0} frames), not starting at the shut gate — the row proved nothing`,
    );
  if (sent.at !== FIRST_ROWS.typed)
    out.push(
      `STARTING: the typed address's page says it is at ${sent.at ?? "nowhere"}, not ${FIRST_ROWS.typed} — a page still starting was not sent there`,
    );
  if (
    sent.after === null ||
    sent.after.state !== "live" ||
    sent.after.address?.endsWith(FIRST_ROWS.typed) !== true
  )
    out.push(
      `STARTING: after the typed address the pane is ${sent.after?.state ?? "without a face"} at ${sent.after?.address ?? "no address"} — not live there`,
    );
  const s = seen.stopped;
  if (s.before === null || s.before.state !== "starting")
    out.push(
      `STARTING: before the stop the second pane was ${s.before?.state ?? "without a face"}, not starting — the row proved nothing`,
    );
  if (s.tool !== "Stop")
    out.push(
      `STARTING: over a pane whose first address has not answered ↻ reads ${JSON.stringify(s.tool)}, not Stop`,
    );
  if (s.face === null || s.face.state !== "failed" || word(s.face.reason) !== "load-stopped")
    out.push(
      `STARTING: stopped, the pane is ${s.face?.state ?? "without a face"} (${s.face?.reason ?? "no reason"}), not failed: load-stopped — a first load the person stopped is never said`,
    );
  if (s.face !== null && s.face.address?.includes("/gate?p=") !== true)
    out.push(`STARTING: stopped, the face says it is at ${s.face.address}, not its address`);
  if (s.waiting[0] < 1 || s.waiting[1] !== s.waiting[0] - 1)
    out.push(
      `STARTING: ${s.waiting[0]} loads waited at the gate before the stop and ${s.waiting[1]} after — the page's load was not given up`,
    );
  out.push(...words("STARTING", "the stopped pane's page area", s.page));
  if (s.retry !== "Reload")
    out.push(`STARTING: on the stopped pane ↻ reads ${JSON.stringify(s.retry)}, not Reload`);
  if (
    s.loaded === null ||
    s.loaded.state !== "live" ||
    s.loaded.address?.includes("/gate?p=") !== true ||
    s.loaded.presented < 1
  )
    out.push(
      `STARTING: the gate open and ↻ pressed, the pane is ${s.loaded?.state ?? "without a face"} at ${s.loaded?.address ?? "no address"} (${s.loaded?.reason ?? "no reason"}) — its address was not loaded`,
    );
  return out;
}

/** TAPS: two quick taps on a busy phone page are heard start, end, start, end. */
export function judgeTaps(seen: FirstLoadSeen["taps"]): string[] {
  const out: string[] = [];
  if (seen.view?.[0] !== PANE.phoneViewport[0])
    out.push(
      `TAPS: the page's view is ${seen.view === null ? "not said" : seen.view.join(" × ")}, not a phone's ${PANE.phoneViewport[0]} wide — the row proved nothing`,
    );
  if (seen.log.join(",") !== "start,end,start,end")
    out.push(
      `TAPS: the page heard ${seen.log.length === 0 ? "nothing" : seen.log.join(", ")} for two taps, not start, end, start, end — the hand's events did not reach it in the order they were sent`,
    );
  return out;
}

/** SWITCH-STARTING (PT-5b3): a device switch on a pane whose first address has not answered asks for the ADDRESS again. */
export function judgeSwitch(seen: FirstLoadSeen["switched"]): string[] {
  const out: string[] = [];
  const b = seen.before;
  if (b === null || b.state !== "starting" || b.presented !== 0 || seen.asked[0] !== 1)
    out.push(
      `SWITCH-STARTING: before the switch the pane was ${b?.state ?? "without a face"} (${b?.presented ?? 0} frames, its address asked for ${seen.asked[0]} times), not starting at the shut gate — the row proved nothing`,
    );
  if (!seen.offered)
    out.push(
      `SWITCH-STARTING: the bar offered no act for the ${FIRST_ROWS.switchTo} — the row proved nothing`,
    );
  const a = seen.after;
  if (a === null || a.state !== "starting" || !a.loading)
    out.push(
      `SWITCH-STARTING: its device switched, the pane is ${a?.state ?? "without a face"} (${a?.reason ?? "no reason"}, loading ${a?.loading ?? false}), not starting — a page whose address had only not answered yet was reloaded as its window's blank`,
    );
  if (a !== null && a.address?.includes("/gate?p=w") !== true)
    out.push(
      `SWITCH-STARTING: its device switched, the pane says it is at ${a.address}, not its address`,
    );
  if (seen.asked[1] !== 2)
    out.push(
      `SWITCH-STARTING: its address was asked for ${seen.asked[1]} times in all, not twice — once, and once more on the device it was switched to`,
    );
  if (seen.waiting !== 1)
    out.push(
      `SWITCH-STARTING: ${seen.waiting} loads wait at the gate, not the one that replaced the first`,
    );
  const o = seen.opened;
  if (
    o === null ||
    o.state !== "live" ||
    o.presented < 1 ||
    o.address?.includes("/gate?p=w") !== true
  )
    out.push(
      `SWITCH-STARTING: the gate opened, the pane is ${o?.state ?? "without a face"} at ${o?.address ?? "no address"} (${o?.reason ?? "no reason"}, ${o?.presented ?? 0} frames) — not live at its address`,
    );
  if (seen.touchPoints === null || seen.touchPoints < 1)
    out.push(
      `SWITCH-STARTING: the page says it has ${seen.touchPoints ?? "no word of its"} touch points — it was not loaded as the ${FIRST_ROWS.switchTo} it was switched to`,
    );
  // the request the gate ANSWERED was the one asked as the device switched to — and no load followed it
  if (seen.agent === null || !/iPad/u.test(seen.agent))
    out.push(
      `SWITCH-STARTING: the load the gate answered came as ${seen.agent === null ? "nothing it kept" : JSON.stringify(seen.agent.slice(0, 60))} — not as the ${FIRST_ROWS.switchTo}: the page was asked for as the device before`,
    );
  if (seen.askedOpened !== 2)
    out.push(
      `SWITCH-STARTING: once live its address had been asked for ${seen.askedOpened} times, not twice — the page loaded again after the gate opened`,
    );
  if (seen.told !== 1)
    out.push(
      `SWITCH-STARTING: the desk told its pages ${seen.told} device switches, not the one — the row proved nothing`,
    );
  return out;
}

/** TIDY (PT-5b3): an address moved WITHIN the document keeps the pane's photograph — under the address NOW, across a reload. */
export function judgeTidy(seen: FirstLoadSeen["tidy"]): string[] {
  const out: string[] = [];
  const b = seen.before;
  const a = seen.after;
  if (b === null || b.state !== "live" || b.presented < 1 || b.address?.includes("tidy=1") !== true)
    out.push(
      `TIDY: in hand the pane was ${b?.state ?? "without a face"} at ${b?.address ?? "no address"} (${b?.presented ?? 0} frames), not live on the page that tidies — the row proved nothing`,
    );
  if (a === null || a.address?.endsWith("/gate?p=t") !== true)
    out.push(
      `TIDY: once told, the page says it is at ${a?.address ?? "no address"}, not /gate?p=t — it did not tidy its address: the row proved nothing`,
    );
  else if (b !== null && a.presented !== b.presented)
    out.push(
      `TIDY: ${a.presented - b.presented} frames landed after the page tidied its address — its texture is of the address NOW whatever the law: the row proved nothing`,
    );
  else if (b !== null && seen.down !== null && seen.down.presented !== b.presented)
    out.push(
      `TIDY: ${seen.down.presented - b.presented} frames landed between the page's tidy and the put-down — the still is of the address NOW whatever the law: the row proved nothing`,
    );
  if (seen.url?.endsWith("/gate?p=t") !== true)
    out.push(
      `TIDY: the document says the pane is at ${seen.url ?? "no address"}, not where its page tidied itself to (/gate?p=t)`,
    );
  if (seen.kept === null)
    out.push(
      "TIDY: put down, the pane kept NO still — an address that moved within its document cost it its photograph",
    );
  else if (!seen.kept.address.endsWith("/gate?p=t"))
    out.push(
      `TIDY: put down, its still is filed under ${seen.kept.address}, not the address now (/gate?p=t)`,
    );
  if (!seen.rested)
    out.push("TIDY: the pane was not at rest before the reload — its page would not load again");
  if (!seen.reloaded) out.push("TIDY: the desk did not come back after the reload");
  if (seen.waiting < 1)
    out.push(
      "TIDY: no load waited at the fixture's gate after the reload — the row proved nothing",
    );
  const sh = seen.shown;
  if (!seen.still || seen.bytes === 0)
    out.push(
      `TIDY: after the reload, before its page's first frame, the pane is ${sh?.state ?? "without a face"} with ${seen.still ? "" : "no "}still and ${seen.bytes} bytes — the film, not its photograph`,
    );
  else if (sh !== null && sh.presented !== 0)
    out.push(
      `TIDY: ${sh.presented} frames of the page landed while its load waited at the gate — the row proved nothing`,
    );
  if (seen.page === null || seen.page.px === 0)
    out.push("TIDY: the pane's page area could not be read after the reload");
  else if (seen.page.hue / seen.page.px < STILL_ROWS.shown.hue)
    out.push(
      `TIDY: after the reload the pane's page area is ${((seen.page.hue / seen.page.px) * 100).toFixed(1)}% the fixture's hue, not ${STILL_ROWS.shown.hue * 100}% — its photograph is not drawn`,
    );
  const o = seen.opened;
  if (o === null || o.state !== "live" || o.presented < 1)
    out.push(
      `TIDY: the gate opened, the pane is ${o?.state ?? "without a face"} (${o?.presented ?? 0} frames) — its page did not replace its still`,
    );
  return out;
}

/** TAPS-COLD (PT-5b3): a press on a page too busy to say its scale WAITS — both taps are heard once the page is free. */
export function judgeTapsCold(seen: FirstLoadSeen["tapsCold"]): string[] {
  const out: string[] = [];
  if (seen.view?.[0] !== PANE.phoneViewport[0])
    out.push(
      `TAPS-COLD: the page's view is ${seen.view === null ? "not said" : seen.view.join(" × ")}, not a phone's ${PANE.phoneViewport[0]} wide — the row proved nothing`,
    );
  const kept = seen.hold === null ? 0 : seen.hold[1] - seen.hold[0];
  if (seen.held !== 1 || seen.hold === null || kept < FIXTURE_HOLD_MS)
    out.push(
      `TAPS-COLD: the page said it was held ${seen.held} times and kept its thread ${kept} ms, not once for ${FIXTURE_HOLD_MS} — the row proved nothing`,
    );
  else if (seen.sentWithinMs >= FIXTURE_HOLD_MS)
    out.push(
      `TAPS-COLD: the taps were sent ${seen.sentWithinMs} ms after the page said it was held — past its ${FIXTURE_HOLD_MS} ms hold: the row proved nothing`,
    );
  if (seen.log.join(",") !== "start,end,start,end")
    out.push(
      `TAPS-COLD: the page, held busy with its scale never read, heard ${seen.log.length === 0 ? "nothing" : seen.log.join(", ")} for two taps, not start, end, start, end — a press on a page too busy to say its scale was dropped, not delivered late`,
    );
  else if (seen.hold !== null && (seen.at[0] ?? Number.NEGATIVE_INFINITY) < seen.hold[1])
    out.push(
      `TAPS-COLD: the page heard its first touch at ${seen.at[0]} ms, before its hold ended (${seen.hold[1]}) — the taps did not arrive while it was held: the row proved nothing`,
    );
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The rows' driver: PT-2's, and main's own word on the desk's pages. */
export interface FirstLoadDriver extends LiveRowsDriver {
  /** Main's offscreen WebContents whose address begins with `prefix`. */
  pages(prefix: string): readonly MainPage[];
}

/** A face's row by its key, off the door, as these rows read it. */
const FACE = (key: string): string => `(() => {
  const f = (globalThis.__vfDesk.live()?.faces ?? []).find((x) => x.key === ${JSON.stringify(key)});
  return f === undefined ? null : {
    state: f.state.is, reason: f.state.reason ?? null, address: f.info?.address ?? null,
    loading: f.info?.loading !== undefined, presented: f.presented, refused: f.refused ?? 0,
  };
})()`;

/** PT-5b3 — a face's photograph, by its key: whether its texture is a still, its texture's bytes, whether it rests. */
const PHOTO = (key: string): string => `(() => {
  const f = (globalThis.__vfDesk.live()?.faces ?? []).find((x) => x.key === ${JSON.stringify(key)});
  return f === undefined ? null : { still: f.still !== null, bytes: f.texture?.bytes ?? 0, rested: f.rested };
})()`;

/** A run of states, each said once while it lasts ("starting", "live"). */
export function runOf(states: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of states) if (out[out.length - 1] !== s) out.push(s);
  return out;
}

/** PT-5b2's rows (above). Returns the problems, each in words. */
export async function firstLoadRows(d: FirstLoadDriver): Promise<string[]> {
  const { say, win } = d;
  let h: PaneHands = paneHands(d);
  const problems: string[] = [];
  const said: Partial<Record<keyof FirstLoadSeen, unknown>> = {};
  const js = <T>(expression: string): Promise<T> => h.js<T>(expression);
  const ambient = await js<string>("globalThis.__vfDesk.ambient()");
  const themeWas = await js<string>("globalThis.__vfDesk.theme()");
  await h.theme("light");
  await js(`globalThis.__vfDesk.ambient("still")`);
  d.fixture.setPlaying(false);
  d.fixture.gate(true);
  const before = await h.census();
  const origin = d.fixture.origin;
  const laid = new Set<string>();

  interface Pane {
    readonly key: string;
    readonly address: string;
    readonly path: string;
  }
  type Rect4 = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  const rowsNow = (): Promise<{ entity: number; key: string | null; rect: Rect4 }[]> =>
    js(`globalThis.__vfDesk.objects(${JSON.stringify(PANE.type)})`);
  const entityOf = async (p: Pane): Promise<number | null> =>
    (await rowsNow()).find((r) => r.key === p.key)?.entity ?? null;
  const face = (p: Pane): Promise<FirstFace | null> => js<FirstFace | null>(FACE(p.key));
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
    if (!ok(last)) say(`SMOKE_CANVAS_FIRST_UNMET ${JSON.stringify({ label, last })}`);
    return last;
  };
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
  const frame = async (panes: readonly Pane[]): Promise<void> => {
    const ids: number[] = [];
    for (const p of panes) {
      const e = await entityOf(p);
      if (e !== null) ids.push(e);
    }
    await js(`globalThis.__vfFieldSmoke.frame(${JSON.stringify(ids.map(String))})`);
    await settledCamera();
    await sleep(400);
  };
  const pageOf = async (p: Pane): Promise<PageSeen | null> => {
    const row = (await rowsNow()).find((r) => r.key === p.key);
    if (row === undefined) return null;
    return js<PageSeen | null>(PAGE_PIXELS(pageAtRest(row.rect, await camera())));
  };
  const select = async (p: Pane): Promise<void> => {
    await h.key("Escape");
    await settledCamera();
    const row = (await rowsNow()).find((r) => r.key === p.key);
    if (row === undefined) throw new Error(`the pane at ${p.path} left the board`);
    const c = await camera();
    const off = await h.deskAt();
    await h.press({
      x: off.left + (row.rect.x + row.rect.w / 2 - c.x) * c.zoom,
      y: off.top + (row.rect.y + row.rect.h / 2 - c.y) * c.zoom,
    });
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
  const heldFrame = (): Promise<HeldFrameSeen | null> =>
    js<HeldFrameSeen | null>("globalThis.__vfDesk.held()?.frame ?? null");
  /** ↻ on the held bar: its label, and a press on it. */
  const TOOL = `[...(document.querySelector('[data-selection-bar] [data-face-row="hand"]')?.querySelectorAll("[data-tool]") ?? [])].find((t) => t.getAttribute("data-tool") === "reload")`;
  const reloadLabel = (): Promise<string | null> =>
    js<string | null>(`(${TOOL})?.getAttribute("aria-label") ?? null`);
  const pressReload = (): Promise<void> =>
    h.pressSelector('[data-selection-bar] [data-face-row="hand"] [data-tool="reload"]');
  const shoot = async (name: string): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await win.capturePage()).toPNG());
  };
  /** A pane laid at a world point, pointed at a path of the fixture; its key once the document names it. */
  const lay = async (
    path: string,
    x: number,
    y: number,
    over: { w?: number; h?: number; props?: Record<string, string> } = {},
  ): Promise<Pane> => {
    const address = `${origin}${path}`;
    const e = Number(
      await js<string>(
        `globalThis.__vfFieldSmoke.spawnWidget(${JSON.stringify(PANE.type)}, { x: ${x}, y: ${y}, w: ${over.w ?? FIRST_ROWS.laid.w}, h: ${over.h ?? FIRST_ROWS.laid.h}, props: ${JSON.stringify({ url: address, ...(over.props ?? {}) })} })`,
      ),
    );
    const key = await waitFor(
      `the pane at ${path}: its durable key`,
      10_000,
      async () => (await rowsNow()).find((r) => r.entity === e)?.key ?? null,
      (k) => k !== null,
    );
    if (key === null) throw new Error(`the door gives the pane at ${path} no durable key`);
    laid.add(key);
    return { key, address, path };
  };
  /** A face watched from here to `until`: every state it said (each once a run), and the ids of main's windows its page
   * was seen in (`prefixes`: the addresses its page may stand at). */
  const watch = async (
    p: Pane,
    prefixes: readonly string[],
    until: (f: FirstFace | null) => boolean,
    ms: number = FIRST_ROWS.withinMs,
  ): Promise<{ states: string[]; windows: number[]; face: FirstFace | null }> => {
    const states: string[] = [];
    const windows = new Set<number>();
    const deadline = Date.now() + ms;
    let f = await face(p);
    for (;;) {
      if (f !== null) states.push(f.state);
      for (const prefix of prefixes) for (const page of d.pages(prefix)) windows.add(page.id);
      if (until(f) || Date.now() > deadline) break;
      await sleep(40);
      f = await face(p);
    }
    if (!until(f))
      say(`SMOKE_CANVAS_FIRST_UNMET ${JSON.stringify({ label: `watch ${p.path}`, last: f })}`);
    return { states: runOf(states), windows: [...windows], face: f };
  };
  const at = (p: Pane): FixtureReport | null => d.fixture.reportAt(p.path);

  try {
    // ── clear ground: right of everything on the board, the panes in a row ────────────────────────────────────────────
    const others = await js<Rect4[]>(`(() => {
      const d = globalThis.__vfDesk; const out = [];
      for (const type of Object.keys(d.census())) for (const o of d.objects(type)) out.push(o.rect);
      return out;
    })()`);
    const x0 = Math.max(0, ...others.map((r) => r.x + r.w)) + 900;
    const y0 = others.length === 0 ? 0 : Math.min(...others.map((r) => r.y));
    const step = FIRST_ROWS.laid.w + FIRST_ROWS.gap;

    // ── FIRST-REDIRECT: the page's script sends it on before its first load finished ──────────────────────────────────
    const nexts0 = d.fixture.served("/next");
    const asked0 = d.fixture.asked("/redirecting");
    const redirecting = await lay("/redirecting?p=r", x0, y0);
    // (watched from its open — the view comes to it meanwhile — so every state it says on the way is read)
    const watching = watch(
      redirecting,
      [`${origin}/redirecting`, `${origin}/next?from=redirect`],
      (f) =>
        f !== null &&
        f.state === "live" &&
        f.presented >= 1 &&
        f.address?.endsWith("/next?from=redirect") === true,
    );
    await frame([redirecting]);
    const redirected = await watching;
    await sleep(600);
    const redirect: FirstLoadSeen["redirect"] = {
      asked: d.fixture.asked("/redirecting") - asked0,
      served: d.fixture.served("/next") - nexts0,
      states: redirected.states,
      face: await face(redirecting),
      windows: redirected.windows,
    };
    said.redirect = redirect;
    problems.push(...judgeRedirect(redirect));
    await shoot("pt-5b2-first-redirect.png");

    // ── FIRST-CLICK: a link pressed while the page still loads ────────────────────────────────────────────────────────
    const hung0 = d.fixture.asked("/hang.png");
    const loading = await lay("/loading?p=c", x0 + step, y0);
    await frame([loading]);
    await waitFor(
      "the loading page's first frame",
      FIRST_ROWS.withinMs,
      () => face(loading),
      (f) => f !== null && f.state === "live" && f.presented >= 1,
    );
    await waitFor(
      "the loading page's word",
      FIRST_ROWS.withinMs,
      () => at(loading),
      (r) => r !== null,
    );
    await pickUp(loading);
    const clickFrame = await heldFrame();
    const word0 = at(loading);
    const loadingSaid = (await face(loading))?.loading === true;
    const nexts1 = d.fixture.served("/next");
    let clicked: Awaited<ReturnType<typeof watch>> = { states: [], windows: [], face: null };
    if (clickFrame !== null && word0 !== null) {
      const link = word0.parts.link;
      await h.press(
        pageOnWindow(
          clickFrame,
          word0.view,
          await h.deskAt(),
          link.x + link.w / 2,
          link.y + link.h / 2,
        ),
      );
      clicked = await watch(
        loading,
        [`${origin}/loading`, `${origin}/next`],
        (f) =>
          f !== null &&
          f.state === "live" &&
          f.address?.endsWith("/next") === true &&
          d.fixture.served("/next") > nexts1,
      );
    }
    await sleep(500);
    const click: FirstLoadSeen["click"] = {
      loading: loadingSaid,
      hung: d.fixture.asked("/hang.png") - hung0,
      served: d.fixture.served("/next") - nexts1,
      states: clicked.states,
      face: await face(loading),
      // (the redirect's pane stands at /next?from=redirect: its window is not this pane's)
      windows: clicked.windows.filter((id) => !redirected.windows.includes(id)),
    };
    said.click = click;
    problems.push(...judgeClick(click));
    await done();

    // ── NO-DOCUMENT: an address that is an attachment ────────────────────────────────────────────────────────────────
    const files0 = d.fixture.asked("/file.bin");
    const file = await lay("/file.bin?p=n", x0 + 2 * step, y0);
    await frame([file]);
    const ended = await waitFor(
      "the attachment's pane says what it is",
      FIRST_ROWS.withinMs,
      () => face(file),
      (f) => f !== null && f.state === "failed",
    );
    await sleep(900);
    const files1 = d.fixture.asked("/file.bin");
    const fileFace = (await face(file)) ?? ended;
    const filePage = await pageOf(file);
    await shoot("pt-5b2-no-document.png");
    await pickUp(file);
    const fileTool = await reloadLabel();
    await pressReload();
    await waitFor(
      "the attachment asked for again",
      FIRST_ROWS.withinMs,
      () => d.fixture.asked("/file.bin"),
      (n) => n > files1,
    );
    const again = await waitFor(
      "the attachment's pane says it again",
      FIRST_ROWS.withinMs,
      () => face(file),
      (f) =>
        f !== null && f.state === "failed" && !f.loading && f.refused > (fileFace?.refused ?? 0),
    );
    await done();
    const noDocument: FirstLoadSeen["noDocument"] = {
      asked: [files0, files1, d.fixture.asked("/file.bin")],
      face: fileFace,
      page: filePage,
      tool: fileTool,
      again,
    };
    said.noDocument = noDocument;
    problems.push(...judgeNoDocument(noDocument));

    // ── STARTING: a pane on the fixture's shut gate — sent elsewhere; another stopped, then loaded ────────────────────
    d.fixture.gate(false);
    const first = await lay("/gate?p=s1", x0, y0 + FIRST_ROWS.laid.h + FIRST_ROWS.gap);
    await frame([first]);
    await waitFor(
      "the first pane's load waiting at the gate",
      FIRST_ROWS.withinMs,
      () => d.fixture.gated().waiting,
      (n) => n >= 1,
    );
    await sleep(600);
    const sentBefore = await face(first);
    await pickUp(first);
    await h.key("l", [process.platform === "darwin" ? "meta" : "control"]);
    await sleep(500);
    for (const ch of `${origin}${FIRST_ROWS.typed}`) {
      win.webContents.sendInputEvent({ type: "char", keyCode: ch });
      await sleep(8);
    }
    await sleep(200);
    await h.key("Return");
    const typedAt = await waitFor(
      "the page at the typed address",
      FIRST_ROWS.withinMs,
      () => d.fixture.reportAt(FIRST_ROWS.typed),
      (r) => r !== null,
    );
    const sentAfter = await waitFor(
      "the pane live at the typed address",
      FIRST_ROWS.withinMs,
      () => face(first),
      (f) => f !== null && f.state === "live" && f.address?.endsWith(FIRST_ROWS.typed) === true,
    );
    await done();
    const second = await lay("/gate?p=s2", x0 + step, y0 + FIRST_ROWS.laid.h + FIRST_ROWS.gap);
    await frame([second]);
    await waitFor(
      "the second pane's load waiting at the gate",
      FIRST_ROWS.withinMs,
      () => d.fixture.gated().waiting,
      (n) => n >= 1,
    );
    await sleep(600);
    const stopBefore = await face(second);
    await pickUp(second);
    const stopTool = await reloadLabel();
    const waiting0 = d.fixture.gated().waiting;
    await pressReload();
    const stoppedFace = await waitFor(
      "the stopped pane says so",
      FIRST_ROWS.withinMs,
      () => face(second),
      (f) => f !== null && f.state === "failed",
    );
    await waitFor(
      "the gate's load given up",
      10_000,
      () => d.fixture.gated().waiting,
      (n) => n < waiting0,
    );
    const waiting1 = d.fixture.gated().waiting;
    await done();
    await frame([second]);
    const stoppedPage = await pageOf(second);
    await shoot("pt-5b2-starting-stopped.png");
    d.fixture.gate(true);
    await pickUp(second);
    const retryTool = await reloadLabel();
    await pressReload();
    const loaded = await waitFor(
      "the stopped pane loaded",
      FIRST_ROWS.withinMs,
      () => face(second),
      (f) => f !== null && f.state === "live" && f.presented >= 1,
    );
    await done();
    const starting: FirstLoadSeen["starting"] = {
      sent: { before: sentBefore, after: sentAfter, at: typedAt?.path ?? null },
      stopped: {
        before: stopBefore,
        tool: stopTool,
        waiting: [waiting0, waiting1],
        face: stoppedFace,
        page: stoppedPage,
        retry: retryTool,
        loaded,
      },
    };
    said.starting = starting;
    problems.push(...judgeStarting(starting));

    // ── TAPS: a phone's page that keeps its thread busy at each touch — two quick taps ───────────────────────────────
    const busy = await lay("/busy?p=t", x0 + 2 * step, y0 + FIRST_ROWS.laid.h + FIRST_ROWS.gap, {
      w: PANE.phoneCut.w,
      h: PANE.phoneCut.h,
      props: { device: "phone" },
    });
    await frame([busy]);
    await waitFor(
      "the phone's page live",
      FIRST_ROWS.withinMs,
      () => face(busy),
      (f) => f !== null && f.state === "live" && f.presented >= 1,
    );
    const busyWord = await waitFor(
      "the phone's page's word",
      FIRST_ROWS.withinMs,
      () => at(busy),
      (r) => r !== null,
    );
    await pickUp(busy);
    const tapFrame = await heldFrame();
    if (tapFrame !== null && busyWord !== null) {
      const view = busyWord.view;
      // the page's ground (the TOUCH row's point): no link, no field there
      const p = pageOnWindow(tapFrame, view, await h.deskAt(), view[0] * 0.85, view[1] * 0.3);
      const point = { x: Math.round(p.x), y: Math.round(p.y) };
      h.move(point.x, point.y);
      await sleep(120);
      for (let tap = 0; tap < 2; tap += 1) {
        win.webContents.sendInputEvent({
          type: "mouseDown",
          ...point,
          button: "left",
          clickCount: 1,
        });
        await sleep(FIRST_ROWS.tap.held);
        win.webContents.sendInputEvent({
          type: "mouseUp",
          ...point,
          button: "left",
          clickCount: 1,
        });
        if (tap === 0) await sleep(FIRST_ROWS.tap.between);
      }
      // both taps heard and said (the page speaks every quarter second, once its thread is free), then a little longer:
      // a touch that arrives late is counted too
      await waitFor(
        "the page's word of its touches",
        10_000,
        () => at(busy)?.touchLog ?? [],
        (log) => log.length >= 4,
      );
      await sleep(1_200);
    }
    const taps: FirstLoadSeen["taps"] = {
      view: at(busy)?.view ?? null,
      log: at(busy)?.touchLog ?? [],
    };
    said.taps = taps;
    problems.push(...judgeTaps(taps));
    await done();

    // ── SWITCH-STARTING (PT-5b3): a pane on the shut gate, its device switched to another of the same density ─────────
    d.fixture.gate(false);
    const y2 = y0 + 2 * (FIRST_ROWS.laid.h + FIRST_ROWS.gap) + 600;
    const gate0 = d.fixture.asked("/gate");
    const waiter = await lay("/gate?p=w", x0, y2);
    await frame([waiter]);
    await waitFor(
      "the pane's load waiting at the gate",
      FIRST_ROWS.withinMs,
      () => d.fixture.gated().waiting,
      (n) => n >= 1,
    );
    await sleep(600);
    const switchBefore = await face(waiter);
    const askedBefore = d.fixture.asked("/gate") - gate0;
    const told0 =
      (await js<Record<string, number>>("globalThis.__vfDesk.live()?.stats ?? {}")).emulations ?? 0;
    // the bar's own act, on the pane at rest
    await select(waiter);
    const act = `[data-selection-bar] .vf-bar-row [data-act="act:device-${FIRST_ROWS.switchTo}"]`;
    const offered = await h
      .until(
        `the bar's ${FIRST_ROWS.switchTo} act`,
        10_000,
        `document.querySelector(${JSON.stringify(act)}) !== null && document.querySelector("[data-selection-bar]")?.getAttribute("data-shown") === "true"`,
      )
      .then(
        () => true,
        () => false,
      );
    if (offered) {
      await sleep(300);
      await h.pressSelector(act);
    }
    // its address asked for again (the load before given up) — or, were the blank reloaded, the page says there is none
    await waitFor(
      "the gate asked for the pane's address once more",
      10_000,
      async () => ({ asked: d.fixture.asked("/gate") - gate0, f: await face(waiter) }),
      (v) => v.asked >= 2 || v.f?.state === "failed",
    );
    await sleep(1_200);
    const switchAfter = await face(waiter);
    const askedAfter = d.fixture.asked("/gate") - gate0;
    const waitingAfter = d.fixture.gated().waiting;
    await shoot("pt-5b3-switch-starting.png");
    d.fixture.gate(true);
    const switchOpened = await waitFor(
      "the switched pane live",
      FIRST_ROWS.withinMs,
      () => face(waiter),
      (f) => f !== null && f.state === "live" && f.presented >= 1,
    );
    const switchWord = await waitFor(
      "the switched pane's page's word",
      10_000,
      () => at(waiter),
      (r) => r !== null,
    );
    await h.key("Escape");
    const switched: FirstLoadSeen["switched"] = {
      before: switchBefore,
      offered,
      after: switchAfter,
      asked: [askedBefore, askedAfter],
      waiting: waitingAfter,
      opened: switchOpened,
      touchPoints: switchWord?.touchPoints ?? null,
      agent: d.fixture.agentSeen("/gate?p=w"),
      askedOpened: d.fixture.asked("/gate") - gate0,
      told:
        ((await js<Record<string, number>>("globalThis.__vfDesk.live()?.stats ?? {}")).emulations ??
          0) - told0,
    };
    said.switched = switched;
    problems.push(...judgeSwitch(switched));

    // ── TAPS-COLD (PT-5b3): a phone's page held busy with its scale never read — two quick taps inside the hold ───────
    const cold = await lay("/cold?p=k", x0 + step, y2, {
      w: PANE.phoneCut.w,
      h: PANE.phoneCut.h,
      props: { device: "phone" },
    });
    await frame([cold]);
    await waitFor(
      "the cold phone's page live",
      FIRST_ROWS.withinMs,
      () => face(cold),
      (f) => f !== null && f.state === "live" && f.presented >= 1,
    );
    const coldWord = await waitFor(
      "the cold phone's page's word",
      FIRST_ROWS.withinMs,
      () => at(cold),
      (r) => r !== null,
    );
    await pickUp(cold);
    const coldFrame = await heldFrame();
    let sentWithinMs = Number.POSITIVE_INFINITY;
    const held0 = d.fixture.asked("/held");
    if (coldFrame !== null && coldWord !== null) {
      const view = coldWord.view;
      const p = pageOnWindow(coldFrame, view, await h.deskAt(), view[0] * 0.85, view[1] * 0.3);
      const point = { x: Math.round(p.x), y: Math.round(p.y) };
      // the pointer over the page BEFORE the hold: a hover is nothing a finger does, and asks the page nothing
      h.move(point.x, point.y);
      await sleep(300);
      d.fixture.hold("/cold", FIXTURE_HOLD_MS);
      await waitFor(
        "the page's word that its hold began",
        10_000,
        () => d.fixture.asked("/held") - held0,
        (n) => n >= 1,
      );
      const heldAt = Date.now();
      for (let tap = 0; tap < 2; tap += 1) {
        win.webContents.sendInputEvent({
          type: "mouseDown",
          ...point,
          button: "left",
          clickCount: 1,
        });
        await sleep(FIRST_ROWS.tap.held);
        win.webContents.sendInputEvent({
          type: "mouseUp",
          ...point,
          button: "left",
          clickCount: 1,
        });
        if (tap === 0) await sleep(FIRST_ROWS.tap.between);
      }
      sentWithinMs = Date.now() - heldAt;
      // the page speaks again once its thread is free; then a little longer: a touch that arrives late is counted too
      await waitFor(
        "the cold page's word of its touches",
        FIXTURE_HOLD_MS + 10_000,
        () => at(cold),
        (r) => r !== null && r.held != null && (r.touchLog ?? []).length >= 4,
      );
      await sleep(1_200);
    }
    const coldSaid = at(cold);
    const tapsCold: FirstLoadSeen["tapsCold"] = {
      view: coldSaid?.view ?? null,
      held: d.fixture.asked("/held") - held0,
      sentWithinMs,
      hold: coldSaid?.held ?? null,
      log: coldSaid?.touchLog ?? [],
      at: coldSaid?.touchAt ?? [],
    };
    said.tapsCold = tapsCold;
    problems.push(...judgeTapsCold(tapsCold));
    await done();

    // ── TIDY (PT-5b3): a pane in hand on a page that tidies its own address; put down; at rest; the window reloaded ────
    const photo = (p: Pane): Promise<{ still: boolean; bytes: number; rested: boolean } | null> =>
      js(PHOTO(p.key));
    const stillOf = (p: Pane): Promise<StillSaid | null> =>
      js<StillSaid | null>(`globalThis.__vfDesk.pageStill(${JSON.stringify(p.key)})`);
    d.fixture.gate(false);
    const tidyPane = await lay("/gate?p=t&tidy=1", x0 + 2 * step, y2);
    await frame([tidyPane]);
    await waitFor(
      "the tidying pane's load waiting at the gate",
      FIRST_ROWS.withinMs,
      () => d.fixture.gated().waiting,
      (n) => n >= 1,
    );
    // in hand BEFORE its first frame (in hand no still is taken by the clock: the put-down's is the one)
    await pickUp(tidyPane);
    d.fixture.gate(true);
    await waitFor(
      "the tidying page live in hand",
      FIRST_ROWS.withinMs,
      () => face(tidyPane),
      (f) => f !== null && f.state === "live" && f.presented >= 1,
    );
    await waitFor(
      "the tidying page's word",
      FIRST_ROWS.withinMs,
      () => d.fixture.reportAt("/gate?p=t&tidy=1"),
      (r) => r !== null,
    );
    await sleep(400);
    const tidyBefore = await face(tidyPane);
    d.fixture.tidy("/gate?p=t");
    const tidyAfter = await waitFor(
      "the page's address tidied",
      10_000,
      () => face(tidyPane),
      (f) => f !== null && f.address?.endsWith("/gate?p=t") === true,
    );
    const tidyUrl = await waitFor(
      "the document following the page's own move",
      10_000,
      async () =>
        (
          await js<{ key: string | null; props: Record<string, string | undefined> }[]>(
            `globalThis.__vfDesk.objects(${JSON.stringify(PANE.type)})`,
          )
        ).find((r) => r.key === tidyPane.key)?.props.url ?? null,
      (u) => u?.endsWith("/gate?p=t") === true,
    );
    const takenWas = (await stillOf(tidyPane))?.takenAt ?? 0;
    await done();
    // (the guard read again at the put-down: no frame since the tidy through the take)
    const tidyDown = await face(tidyPane);
    const tidyKept = await waitFor(
      "the put-down's still on the shelf",
      15_000,
      () => stillOf(tidyPane),
      (st) => st !== null && st.takenAt > takenWas,
    );
    // to rest: another pane seen, this one out of view, the cap at one
    await frame([cold]);
    await js("globalThis.__vfDesk.liveCap(1)");
    const tidyRest = await waitFor(
      "the tidied pane at rest, its page gone from main",
      FIRST_ROWS.withinMs,
      async () => ({ f: await photo(tidyPane), pages: d.pages(`${origin}/gate?p=t`).length }),
      (v) => v.f?.rested === true && v.pages === 0,
    );
    d.fixture.gate(false);
    const tidyReloaded = await d.reload();
    h = paneHands(d);
    await sleep(600);
    await frame([tidyPane]);
    const tidyShown = await waitFor(
      "the pane on its still, its load waiting at the gate",
      FIRST_ROWS.withinMs,
      async () => ({
        f: await face(tidyPane),
        p: await photo(tidyPane),
        waiting: d.fixture.gated().waiting,
      }),
      (v) => v.p?.still === true && (v.p?.bytes ?? 0) > 0 && v.waiting >= 1,
    );
    await sleep(500);
    const tidyPage = await pageOf(tidyPane);
    await shoot("pt-5b3-tidy-after-reload.png");
    d.fixture.gate(true);
    const tidyOpened = await waitFor(
      "the tidied page live again",
      FIRST_ROWS.withinMs,
      () => face(tidyPane),
      (f) => f !== null && f.state === "live" && f.presented >= 1,
    );
    const tidy: FirstLoadSeen["tidy"] = {
      before: tidyBefore,
      after: tidyAfter,
      down: tidyDown,
      url: tidyUrl,
      kept: tidyKept,
      rested: tidyRest.f?.rested === true && tidyRest.pages === 0,
      reloaded: tidyReloaded,
      waiting: tidyShown.waiting,
      shown: tidyShown.f,
      still: tidyShown.p?.still === true,
      bytes: tidyShown.p?.bytes ?? 0,
      page: tidyPage,
      opened: tidyOpened,
    };
    said.tidy = tidy;
    problems.push(...judgeTidy(tidy));
  } catch (error) {
    // a step that cannot go on ends the rows — never what the rows before it found (they are said with it)
    problems.push(`PT-5b2 FIRST: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    d.fixture.setPlaying(false);
    d.fixture.gate(true);
    say(`SMOKE_CANVAS_FIRST ${JSON.stringify(said)}`);
    try {
      if ((await js<number | null>("globalThis.__vfDesk.held()?.entity ?? null")) !== null)
        await done();
      // (a short grace BEFORE the panes go: their pages go with them, never a minute into the rows after these)
      await js("globalThis.__vfDesk.liveGrace(300)");
      for (const row of await rowsNow())
        if (row.key !== null && laid.has(row.key))
          await js(`globalThis.__vfFieldSmoke.removeWidget(${JSON.stringify(String(row.entity))})`);
      await sleep(900);
      await js("globalThis.__vfDesk.liveGrace(null)");
      await js("globalThis.__vfDesk.liveCap(6)");
      await js("globalThis.__vfFieldSmoke.frame([])");
    } catch {
      /* a row that cannot go on ends the rows, never what the earlier rows found */
    }
    const after = await h.census().catch(() => -1);
    if (after !== before)
      problems.push(
        `CLEARED: ${after} panes on the board after the first-load rows, not the ${before} found`,
      );
    say(`SMOKE_CANVAS_FIRST_CLEARED ${JSON.stringify({ before, after })}`);
    await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient)})`).catch(() => undefined);
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(themeWas)})`).catch(() => undefined);
  }
  return problems;
}
