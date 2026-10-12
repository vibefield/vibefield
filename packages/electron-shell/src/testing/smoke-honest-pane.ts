// PT-5a — THE PAGE'S HONEST LIFE, IN THE PRODUCT (smoke:canvas; the PORTALS brief PT-5a §2): a browser pane laid as PT-1's rows
// lay it, pointed at the smoke's own fixture (testing/live-fixture.ts), and LIVED WITH — its bar pressed where there is nowhere
// to go, its page asking for what a page may not have, hidden, parked, deleted and brought back, its address refusing, its
// process killed. Judged by what the PAGE says came of it (the fixture's word with each ask), the door's face rows and the
// head's own word, the bar's own attributes, main's word on the page's sound and the app's windows, and the pixels of the
// page's area — a face, never a hash:
//   BAR          — a fresh page: ‹ is `aria-disabled`, and its press and ⌘[ send nothing (the page where it was, the pane in
//                  hand); after a link's click ‹ is live; during a slow load ↻ reads Stop and its press stops the load (the
//                  fixture counts the load given up, never answered); stopped, it reads Reload;
//   POPUP        — a `target=_blank` link and a `window.open` each send the SAME pane there: no window opens (the app's
//                  windows, the desk's pages and its panes as many as before), and `window.open` answers null;
//   ALERT        — a page that calls `alert`, `confirm` and `prompt` KEEPS RUNNING: its word after them arrives — the alert
//                  returned, the confirm answered false, the prompt null — and no window was raised;
//   PICKER       — a press on an `<input type=file>` raises no panel: the input hears `cancel`, the app's windows and its
//                  focused window are as they were;
//   DOWNLOAD     — a download is cancelled and the head SAYS so for a moment, then its address again;
//   CARET        — (ruling 9, a measurement) a held page with a focused field: the frames that arrive a second and what the
//                  desk submits for each;
//   FAVICON-ONCE — a hover across the page's link, its field and its ground moves the page's cursor (each a summary of its
//                  state) and the favicon's bytes arrive 0 more times;
//   HEARD        — the page plays a tone (30 Hz, a whisper): in hand and at rest in view it is audible and NOT muted; panned
//                  off the view it is muted, and heard again panned back; deleted, it is muted at once though its page is
//                  kept; undone, the same page is heard again;
//   PARKED       — the desk under a cover: no frame arrives from the animating page and it is muted; the cover down, both
//                  return;
//   FAIL         — an address that refuses its connection: the face says so — its film carries the words' ink (and nothing
//                  of the page before, nor a white error page) at rest and in hand; at rest a point of its page is the
//                  pane itself (no part), in hand its "Try again" capsule is a control (the window's cursor a pointer over it, and not over the
//                  film beside it); the head keeps the address that was ASKED for; the address opened and the capsule
//                  pressed, the page loads;
//   STOPPED      — the page's process killed: the face says it stopped, its address kept; ↻ loads it again — a new page at
//                  the same address.
// Then the pane is deleted (⌫) and the board is as found. `--honest-pane` beside `--smoke-canvas` runs these rows alone after
// the boot's (the author's loop).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURE_HUE,
  type FixtureActId,
  type FixtureActs,
  type FixtureReport,
} from "./live-fixture";
import { BARE_FOR, layPane, PANE, pageRegion, paneHands, paneToMiddle } from "./smoke-browser-pane";
import type { LiveRowsDriver } from "./smoke-live-pane";
import { CURRENT_AT, type HeldFrameSeen, pageOnWindow } from "./smoke-use-pane";

/** The flag beside `--smoke-canvas` that runs these rows alone after the boot's (the author's loop). */
export const HONEST_FLAG = "--honest-pane";

/** The rows' numbers. */
export const HONEST_ROWS = {
  /** how long a page's word is waited for (its report rides an ask every quarter second) */
  withinMs: 20_000,
  /** how long a page that must NOT move is listened to */
  quietMs: 1_500,
  /**
   * A notice in the page's area: a pixel of the words' INK is light and grey (its luma at least `inkLuma`, its channels
   * within `inkSpread`), one of the FILM dark (its luma at most `filmLuma`), one of the fixture's ground its HUE. A face
   * has ink — a few words' worth, never a page of it (a white error page is all ink) — over film, and none of the hue.
   */
  notice: {
    inkLuma: 140,
    inkSpread: 48,
    filmLuma: 96,
    minInk: 0.0015,
    maxInk: 0.2,
    minFilm: 0.6,
    maxHue: 0.02,
  },
  /** CARET: how long the held page is watched (ms), and the most frames a second a resting field's caret may cost */
  caretMs: 4_000,
  caretMaxFps: 6,
  /** HEARD: how soon after its delete a page must be silent (ms) — the pane's ghost fades, then its face closes */
  silentWithinMs: 2_500,
  /** PARKED: how long the page is watched under the cover and after it (ms) */
  parkWatchMs: 1_500,
  /** DOWNLOAD: the most the head may go on saying it (ms) — the pane's `REFUSAL_SAY_MS` and a frame's slack */
  saidWithinMs: 6_000,
} as const;

/** A held tool as the bar shows it. */
export interface ToolSeen {
  readonly disabled: boolean;
  readonly label: string | null;
}

/** The app's windows as main counts them — and WHICH they are (their ids): a row that says "no window more" reads the
 * windows that were not there before, never the count alone. (PT-5b: an earlier row set's page, kept by the pool's grace
 * for a minute after its pane went, is a window too — its leaving in the middle of POPUP made a count of 5 a 4, and the
 * row red, with no window raised; and a count that stands may hide one that left beside one that came.) */
export interface WindowsSeen {
  readonly count: number;
  readonly focused: number | null;
  readonly ids: readonly number[];
}

/** The windows in `after` that `before` did not have. */
export const windowsRaised = (before: WindowsSeen, after: WindowsSeen): number =>
  after.ids.filter((id) => !before.ids.includes(id)).length;

/** A page's sound as main reads its WebContents. */
export interface SoundSeen {
  readonly muted: boolean;
  readonly audible: boolean;
}

/** The pixels of a page's area, classified. */
export interface NoticePixels {
  readonly px: number;
  readonly ink: number;
  readonly film: number;
  readonly hue: number;
}

/** A failed face as the door and the head say it, and its pixels. */
export interface FailedFaceSeen {
  readonly state: string | null;
  readonly reason: string | null;
  readonly veiled: boolean | null;
  /** the face's address (its words) and what the head prints */
  readonly address: string | null;
  readonly display: string | null;
  readonly pixels: NoticePixels | null;
}

/** What the rows saw — the SMOKE_CANVAS_HONEST line, and what the judges read. */
export interface HonestSeen {
  readonly bar: {
    /** ‹ on a fresh page */
    readonly fresh: ToolSeen | null;
    /** after a press on it and ⌘[: where the page is, the navigations the desk sent meanwhile, the pane still in hand */
    readonly pressed: {
      readonly path: string | null;
      readonly navigations: number;
      readonly held: boolean;
    };
    /** ‹ after the link's click (the page at `/next`) */
    readonly after: ToolSeen | null;
    /** ↻ during the slow load, and after its press */
    readonly loading: ToolSeen | null;
    readonly stopped: ToolSeen | null;
    /** where the page is after the stop, and the slow address's asks */
    readonly path: string | null;
    readonly slow: { readonly asked: number; readonly answered: number; readonly aborted: number };
  };
  readonly popup: {
    /** where the `target=_blank` link left the pane's page, and `window.open`: its answer and where it left the page */
    readonly blank: string | null;
    readonly opened: string | null;
    readonly openedPath: string | null;
    /** the app's windows before and after (their count), and how many of those after were not there before */
    readonly windows: readonly [number, number];
    readonly raised: number;
    readonly faces: readonly [number, number];
    readonly panes: readonly [number, number];
  };
  readonly alert: {
    readonly alerts: number;
    readonly confirmed: boolean | null;
    /** undefined: the page said nothing of its prompt */
    readonly prompted: string | null | undefined;
    readonly windows: readonly [number, number];
    readonly raised: number;
  };
  readonly picker: {
    readonly cancels: number;
    readonly changes: number;
    readonly windows: readonly [number, number];
    readonly raised: number;
    readonly focused: readonly [number | null, number | null];
  };
  readonly download: {
    /** the refusal's serial on the face's row, what the head said, and how long until it said its address again (null: never) */
    readonly serial: number;
    readonly said: string | null;
    readonly unsaidMs: number | null;
    readonly path: string | null;
    readonly asked: number;
  };
  readonly caret: {
    readonly focused: string | null;
    readonly ms: number;
    /** frames the page's attachment told of, frames presented, the desk's queue submits, the engine's steps and the times
     * its loop went to sleep — over `ms` */
    readonly arrivals: number;
    readonly presented: number;
    readonly submits: number;
    readonly steps: number;
    readonly sleeps: number;
  };
  readonly faviconOnce: {
    /** times the favicon's bytes arrived on the page's port: before the hover and after it */
    readonly bytes: readonly [number, number];
    /** the page's cursors as the face said them over the hover, in order (repeats folded) */
    readonly cursors: readonly string[];
    readonly head: string | null;
  };
  readonly heard: {
    readonly tone: string | null;
    readonly held: SoundSeen | null;
    readonly rest: SoundSeen | null;
    readonly unseen: (SoundSeen & { readonly offScreen: boolean }) | null;
    readonly seenAgain: SoundSeen | null;
    /** after ⌫: the page's sound, how long until it was muted (null: never), and whether its page was still there */
    readonly deleted: (SoundSeen & { readonly ms: number | null }) | null;
    /** after the undo: its sound, and whether it is the SAME page (its memory's token) */
    readonly undone: (SoundSeen & { readonly samePage: boolean }) | null;
  };
  readonly parked: {
    readonly parked: boolean;
    /** before the cover: frames over the watch, muted; under it: the same and the wire's mode; after: the same */
    readonly before: { readonly frames: number; readonly muted: boolean | null };
    readonly under: {
      readonly frames: number;
      readonly muted: boolean | null;
      readonly wire: string | null;
    };
    readonly after: {
      readonly frames: number;
      readonly muted: boolean | null;
      readonly wire: string | null;
    };
  };
  readonly fail: {
    readonly host: string;
    /** at rest: the face, and the PART a point of its page picks ("" — the pane itself; null: nothing picked) */
    readonly rest: FailedFaceSeen;
    readonly restPart: string | null;
    /** in hand: the face; the window's cursor over the capsule and over the film beside it; ↻ on the bar */
    readonly held: FailedFaceSeen;
    readonly capsule: string | null;
    readonly film: string | null;
    readonly reload: ToolSeen | null;
    /** after the address opened and Try again pressed: the face's state, its texture shown, where the page is */
    readonly retried: {
      readonly state: string | null;
      readonly veiled: boolean | null;
      readonly path: string | null;
    };
  };
  readonly stopped: {
    readonly killed: boolean;
    readonly face: FailedFaceSeen;
    /** after ↻: the face's state, and whether the page at the address is a NEW one (its memory's token) */
    readonly recovered: { readonly state: string | null; readonly newPage: boolean };
  };
}

/** BAR: ‹ disabled on a fresh page and its press and chord nothing; live after a click; ↻ Stop while loading, and it stops. */
export function judgeBar(seen: HonestSeen["bar"]): string[] {
  const out: string[] = [];
  if (seen.fresh === null) out.push("BAR: the held bar has no ‹");
  else if (!seen.fresh.disabled)
    out.push("BAR: ‹ is not aria-disabled on a fresh page — the bar says there is somewhere to go");
  if (seen.pressed.path !== "/page")
    out.push(
      `BAR: after a press on the disabled ‹ and ⌘[ the page is at ${seen.pressed.path}, not where it was`,
    );
  if (seen.pressed.navigations !== 0)
    out.push(
      `BAR: the disabled ‹ and its chord sent ${seen.pressed.navigations} navigations — a disabled tool does nothing`,
    );
  if (!seen.pressed.held)
    out.push("BAR: the pane left the hand at the disabled ‹'s press or chord");
  if (seen.after === null || seen.after.disabled)
    out.push("BAR: ‹ is still disabled after the page went to its link — it never came live");
  if (seen.loading?.label !== "Stop")
    out.push(
      `BAR: during the slow load ↻ reads ${JSON.stringify(seen.loading?.label ?? null)}, not Stop`,
    );
  if (seen.stopped?.label !== "Reload")
    out.push(
      `BAR: after its press ↻ reads ${JSON.stringify(seen.stopped?.label ?? null)}, not Reload — the load was not stopped`,
    );
  if (seen.slow.asked < 1) out.push("BAR: the slow address was never asked for");
  if (seen.slow.answered !== 0 || seen.slow.aborted < 1)
    out.push(
      `BAR: the slow load was answered ${seen.slow.answered} times and given up ${seen.slow.aborted} — Stop did not stop it`,
    );
  if (seen.path !== "/acts")
    out.push(`BAR: after the stop the page is at ${seen.path}, not the page it was on`);
  return out;
}

/** POPUP: the same pane goes there; no window, no new page, no new pane; `window.open` answers null. */
export function judgePopup(seen: HonestSeen["popup"]): string[] {
  const out: string[] = [];
  if (seen.blank !== "/next")
    out.push(
      `POPUP: the target=_blank link left the pane's page at ${seen.blank}, not /next — the same pane did not go there`,
    );
  if (seen.opened !== "null")
    out.push(
      `POPUP: window.open answered ${JSON.stringify(seen.opened)}, not null — a page was given a window`,
    );
  if (seen.openedPath !== "/next?opened=1")
    out.push(`POPUP: window.open left the pane's page at ${seen.openedPath}, not /next?opened=1`);
  if (seen.raised !== 0)
    out.push(
      `POPUP: the app has ${seen.raised} windows it did not have before (${seen.windows[0]} then, ${seen.windows[1]} now)`,
    );
  if (seen.faces[1] !== seen.faces[0])
    out.push(`POPUP: ${seen.faces[1]} pages live on the desk, not the ${seen.faces[0]} before`);
  if (seen.panes[1] !== seen.panes[0])
    out.push(`POPUP: ${seen.panes[1]} panes on the board, not the ${seen.panes[0]} before`);
  return out;
}

/** ALERT: the page kept running past its dialogs — the alert returned, the confirm answered false, the prompt null. */
export function judgeAlert(seen: HonestSeen["alert"]): string[] {
  const out: string[] = [];
  if (seen.alerts < 1)
    out.push("ALERT: the page's word after its alert never came — it is blocked behind a dialog");
  if (seen.confirmed !== false)
    out.push(`ALERT: confirm answered ${seen.confirmed}, not false (cancelled)`);
  if (seen.prompted !== null)
    out.push(`ALERT: prompt answered ${JSON.stringify(seen.prompted)}, not null (cancelled)`);
  if (seen.raised !== 0)
    out.push(
      `ALERT: the app has ${seen.raised} windows it did not have before the dialogs (${seen.windows[0]} then, ${seen.windows[1]} now)`,
    );
  return out;
}

/** PICKER: the input heard `cancel` and nothing was chosen; the app's windows and its focused window as they were. */
export function judgePicker(seen: HonestSeen["picker"]): string[] {
  const out: string[] = [];
  if (seen.cancels < 1)
    out.push(
      "PICKER: the file input never heard `cancel` — its picker was not answered (a panel may be up)",
    );
  if (seen.changes !== 0) out.push(`PICKER: the file input changed ${seen.changes} times`);
  if (seen.raised !== 0)
    out.push(
      `PICKER: the app has ${seen.raised} windows it did not have before (${seen.windows[0]} then, ${seen.windows[1]} now)`,
    );
  if (seen.focused[1] !== seen.focused[0])
    out.push(
      `PICKER: the focused window is ${seen.focused[1]}, not ${seen.focused[0]} as before the press`,
    );
  return out;
}

/** DOWNLOAD: cancelled and said — the head says it, then its address again within its moment. */
export function judgeDownload(seen: HonestSeen["download"]): string[] {
  const out: string[] = [];
  if (seen.asked < 1) out.push("DOWNLOAD: the download was never asked for");
  if (seen.serial < 1)
    out.push("DOWNLOAD: the face's words carry no refusal — the page's download was not said");
  if (seen.said !== "Download blocked")
    out.push(`DOWNLOAD: the head said ${JSON.stringify(seen.said)}, not "Download blocked"`);
  if (seen.unsaidMs === null)
    out.push(
      `DOWNLOAD: the head went on saying it past ${HONEST_ROWS.saidWithinMs} ms — its address never came back`,
    );
  if (seen.path?.split("?")[0] !== "/acts")
    out.push(`DOWNLOAD: the page is at ${seen.path}, not the page that asked`);
  return out;
}

/** CARET (a measurement, with a ceiling): a focused field at rest in hand costs a caret's frames, one submit a frame. */
export function judgeCaret(seen: HonestSeen["caret"]): string[] {
  const out: string[] = [];
  if (seen.focused !== "field")
    out.push(`CARET: the page's focus is on "${seen.focused}", not its field`);
  const fps = seen.arrivals / Math.max(seen.ms / 1000, 1e-3);
  if (fps > HONEST_ROWS.caretMaxFps)
    out.push(
      `CARET: ${fps.toFixed(1)} frames a second arrive from a held page with a resting caret, over ${HONEST_ROWS.caretMaxFps}`,
    );
  // each frame that lands may cost the desk a frame of its own: its submits never outrun the steps it took
  if (seen.presented > 0 && seen.submits > 3 * Math.max(seen.steps, seen.presented))
    out.push(
      `CARET: ${seen.submits} submits for ${seen.presented} presented frames in ${seen.steps} steps — more than a frame's worth each`,
    );
  return out;
}

/** FAVICON-ONCE: the cursor moved (summaries crossed) and the favicon's bytes arrived no more. */
export function judgeFaviconOnce(seen: HonestSeen["faviconOnce"]): string[] {
  const out: string[] = [];
  if (seen.bytes[0] < 1)
    out.push("FAVICON-ONCE: the favicon's bytes never arrived at all — the row proved nothing");
  if (new Set(seen.cursors).size < 2)
    out.push(
      `FAVICON-ONCE: the page's cursor was ${JSON.stringify(seen.cursors)} over the hover — no summary of its state crossed, the row proved nothing`,
    );
  if (seen.bytes[1] !== seen.bytes[0])
    out.push(
      `FAVICON-ONCE: the favicon's bytes arrived ${seen.bytes[1] - seen.bytes[0]} more times over a hover — they ride the page's summaries`,
    );
  if (seen.head?.startsWith("icon:") !== true)
    out.push(
      `FAVICON-ONCE: the head says ${JSON.stringify(seen.head)}, not the page's own favicon`,
    );
  return out;
}

/** HEARD: audible and unmuted while seen live or held; muted unseen; muted at once when deleted, its page kept; heard again undone. */
export function judgeHeard(seen: HonestSeen["heard"]): string[] {
  const out: string[] = [];
  const heard = (s: SoundSeen | null): boolean => s?.audible === true && !s.muted;
  if (seen.tone !== "running")
    out.push(
      `HEARD: the page's tone is ${JSON.stringify(seen.tone)}, not running — the row proved nothing`,
    );
  if (!heard(seen.held))
    out.push(`HEARD: in hand the page is ${JSON.stringify(seen.held)} — not audible and unmuted`);
  if (!heard(seen.rest))
    out.push(
      `HEARD: at rest in view the page is ${JSON.stringify(seen.rest)} — not audible and unmuted`,
    );
  if (seen.unseen === null || !seen.unseen.offScreen)
    out.push("HEARD: the pane was never panned off the view — the row proved nothing");
  else if (!seen.unseen.muted) out.push("HEARD: panned off the view the page is NOT muted");
  if (!heard(seen.seenAgain))
    out.push(`HEARD: panned back the page is ${JSON.stringify(seen.seenAgain)} — not heard again`);
  if (seen.deleted === null)
    out.push("HEARD: the deleted pane's page was gone before it could be read");
  else if (seen.deleted.ms === null || !seen.deleted.muted)
    out.push(
      `HEARD: the deleted pane's page was not muted within ${HONEST_ROWS.silentWithinMs} ms — it is heard after its pane is gone`,
    );
  if (seen.undone === null || !heard(seen.undone))
    out.push(`HEARD: after the undo the page is ${JSON.stringify(seen.undone)} — not heard again`);
  else if (!seen.undone.samePage)
    out.push("HEARD: after the undo the pane shows ANOTHER page — the grace did not keep its own");
  return out;
}

/** PARKED: under the cover no frame arrives and the page is muted; the cover down, both return. */
export function judgeParked(seen: HonestSeen["parked"]): string[] {
  const out: string[] = [];
  if (seen.before.frames < 5)
    out.push(
      `PARKED: ${seen.before.frames} frames arrived from the animating page before the cover — the row proved nothing`,
    );
  if (!seen.parked) return [...out, "PARKED: the desk never parked under the cover"];
  if (seen.under.frames !== 0)
    out.push(`PARKED: ${seen.under.frames} frames arrived from the page while the desk was parked`);
  if (seen.under.muted !== true) out.push("PARKED: the page is not muted under the cover");
  if (seen.under.wire !== "paused")
    out.push(`PARKED: the page was asked ${seen.under.wire} under the cover, not paused`);
  if (seen.after.frames < 5)
    out.push(
      `PARKED: ${seen.after.frames} frames arrived after the cover came down — the page did not come back`,
    );
  if (seen.after.muted !== false)
    out.push("PARKED: the page is still muted after the cover came down");
  if (seen.after.wire !== "live")
    out.push(`PARKED: the page was asked ${seen.after.wire} after the cover came down, not live`);
  return out;
}

/** The shares of a notice's pixels, and whether they are a face's: ink over film, none of the page before. */
export function judgeNotice(row: string, p: NoticePixels | null): string[] {
  if (p === null || p.px === 0) return [`${row}: the page's area could not be read`];
  const out: string[] = [];
  const N = HONEST_ROWS.notice;
  const ink = p.ink / p.px;
  const film = p.film / p.px;
  const hue = p.hue / p.px;
  if (ink < N.minInk)
    out.push(
      `${row}: ${(ink * 100).toFixed(2)} % of the page's area is the words' ink, under ${N.minInk * 100} % — the film says nothing`,
    );
  if (ink > N.maxInk)
    out.push(
      `${row}: ${(ink * 100).toFixed(1)} % of the page's area is light — a page (the engine's own error page?), not a film with words`,
    );
  if (film < N.minFilm)
    out.push(
      `${row}: ${(film * 100).toFixed(1)} % of the page's area is the film, under ${N.minFilm * 100} %`,
    );
  if (hue > N.maxHue)
    out.push(
      `${row}: ${(hue * 100).toFixed(1)} % of the page's area is the fixture's hue — the page before the failure is still shown`,
    );
  return out;
}

/** A failed face: the state, the host's word for it, its texture hidden, the ASKED address kept — its words and the head's. */
function failed(row: string, f: FailedFaceSeen, word: string, host: string): string[] {
  const out: string[] = [];
  if (f.state !== "failed") out.push(`${row}: the face is ${f.state}, not failed`);
  if (f.reason === null || !(f.reason === word || f.reason.startsWith(`${word}: `)))
    out.push(`${row}: the face's reason is ${JSON.stringify(f.reason)}, not "${word}"`);
  if (f.veiled !== true)
    out.push(`${row}: the face's texture is not hidden — what the page last painted may be shown`);
  if (f.address === null || !f.address.includes(host) || f.address.startsWith("chrome-error"))
    out.push(
      `${row}: the face's address is ${JSON.stringify(f.address)}, not the one asked for (${host})`,
    );
  if (f.display !== host)
    out.push(
      `${row}: the head prints ${JSON.stringify(f.display)}, not the address asked for (${host})`,
    );
  return out;
}

/** FAIL: the refusing address is a failed face — at rest the pane, in hand a film with words and a Try again part — and Try again loads it. */
export function judgeFail(seen: HonestSeen["fail"]): string[] {
  const out = [
    ...failed("FAIL (at rest)", seen.rest, "connection-refused", seen.host),
    ...failed("FAIL (in hand)", seen.held, "connection-refused", seen.host),
    ...judgeNotice("FAIL (at rest)", seen.rest.pixels),
    ...judgeNotice("FAIL (in hand)", seen.held.pixels),
  ];
  if (seen.restPart !== "")
    out.push(
      `FAIL: at rest a point of the failed page picks ${JSON.stringify(seen.restPart)}, not the pane itself (no part)`,
    );
  if (seen.capsule !== "pointer")
    out.push(
      `FAIL: in hand the cursor over the notice's capsule is ${JSON.stringify(seen.capsule)}, not a pointer — Try again is not a part`,
    );
  if (seen.film === null || seen.film === "pointer")
    out.push(
      `FAIL: in hand the cursor over the film beside the capsule is ${JSON.stringify(seen.film)} — the film is not the pane's own glass`,
    );
  if (seen.reload === null || seen.reload.disabled)
    out.push("FAIL: the bar's ↻ is disabled on a page that can be tried again");
  if (seen.retried.state !== "live")
    out.push(`FAIL: after Try again the face is ${seen.retried.state}, not live`);
  if (seen.retried.veiled !== false)
    out.push("FAIL: after Try again the face's texture is still hidden");
  if (seen.retried.path !== "/revived")
    out.push(
      `FAIL: after Try again the page is at ${seen.retried.path}, not the address that was asked for`,
    );
  return out;
}

/** STOPPED: the killed page is said to have stopped, its address kept, its film worded; ↻ loads a new page there. */
export function judgeStopped(seen: HonestSeen["stopped"], host: string): string[] {
  const out: string[] = [];
  if (!seen.killed)
    return ["STOPPED: the page's process could not be found to kill — the row proved nothing"];
  out.push(
    ...failed("STOPPED", seen.face, "stopped", host),
    ...judgeNotice("STOPPED", seen.face.pixels),
  );
  if (seen.recovered.state !== "live")
    out.push(`STOPPED: after ↻ the face is ${seen.recovered.state}, not live`);
  if (!seen.recovered.newPage)
    out.push("STOPPED: after ↻ no NEW page spoke at the address — the page was not loaded again");
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The rows' driver: PT-2's, and main's own word on a page — its sound, its process — and on the app's windows. */
export interface HonestRowsDriver extends LiveRowsDriver {
  /** The sound of the page whose address begins with `prefix` (an offscreen WebContents main finds by it); null: none such. */
  pageSound(prefix: string): SoundSeen | null;
  /** The renderer process of that page KILLED (the test's hook); false: none such. */
  killPage(prefix: string): boolean;
  /** The app's windows now (a page's own offscreen one among them), and the focused one's id. */
  windows(): WindowsSeen;
}

/** A face's row by its key, off the door. */
const FACE_ROW = (key: string): string =>
  `((globalThis.__vfDesk.live()?.faces ?? []).find((f) => f.key === ${JSON.stringify(key)}) ?? null)`;

/** The pixel classifier, as source: 1 the words' ink, 2 the film, 3 the fixture's hue, 0 anything else. The renderer runs it
 * over a capture (a bitmap never crosses) and the rows' units run the same text. */
export const NOTICE_CLASSIFY = `((r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (Math.abs(r - ${FIXTURE_HUE.r}) < 40 && Math.abs(g - ${FIXTURE_HUE.g}) < 40 && Math.abs(b - ${FIXTURE_HUE.b}) < 48) return 3;
  if (l >= ${HONEST_ROWS.notice.inkLuma} && max - min <= ${HONEST_ROWS.notice.inkSpread}) return 1;
  if (l <= ${HONEST_ROWS.notice.filmLuma}) return 2;
  return 0;
})`;

/** A region of the desk captured without the marks, its pixels classified. */
const NOTICE_PIXELS = (rect: {
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
  const classify = ${NOTICE_CLASSIFY};
  const n = [0, 0, 0, 0];
  for (let i = 0; i < b.length; i += 4) n[classify(b[i], b[i + 1], b[i + 2])] += 1;
  return { px: w * h, ink: n[1], film: n[2], hue: n[3] };
})()`;

/** The page's area of a pane in hand, desk CSS px, a little in from its edges: the open extent is the page and the head — as
 * wide as the page, ending at its foot — so the page is what stands under the head. */
export function heldPageArea(
  f: Pick<HeldFrameSeen, "cx" | "cy" | "hx" | "hy">,
  view: readonly [number, number],
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const k = (2 * f.hx) / view[0];
  const h = view[1] * k;
  const inset = 0.04;
  return {
    x: Math.round(f.cx - f.hx + 2 * f.hx * inset),
    y: Math.round(f.cy + f.hy - h + h * inset),
    width: Math.max(1, Math.round(2 * f.hx * (1 - 2 * inset))),
    height: Math.max(1, Math.round(h * (1 - 2 * inset))),
  };
}

/**
 * The notice's "Try again" capsule on a page `view` CSS px: its centre and half extents — the pane's own layout, said here
 * again on its own (plugins/browser-pane/src/notice.ts `noticeLayout`: the rows press where the pane draws, and the window's
 * cursor says whether a part is there).
 */
export function noticeCapsule(view: readonly [number, number]): {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
} {
  const [W, H] = view;
  const unit = Math.min(Math.max(W / 24, 14), 26);
  const small = Math.round(unit * 0.76);
  const line = small * 1.45;
  const hy = small * 1.3;
  const tall = unit + small * 1.9 + line + small * 2.5 + hy;
  const top = Math.max(H * 0.42 - tall / 2, small);
  return { cx: W / 2, cy: top + unit + small * 1.9 + line + small * 2.5, hx: small * 4.4, hy };
}

/** PT-5a's rows (above). Returns the problems, each in words. */
export async function honestPaneRows(d: HonestRowsDriver): Promise<string[]> {
  const { say, win } = d;
  const h = paneHands(d);
  const { js, until, press, move, key, drag, census, rows } = h;
  const problems: string[] = [];
  const said: Partial<Record<keyof HonestSeen, unknown>> = {};
  const ambient = await js<string>("globalThis.__vfDesk.ambient()");
  const themeWas = await js<string>("globalThis.__vfDesk.theme()");
  await h.theme("light");
  await js(`globalThis.__vfDesk.ambient("still")`);
  d.fixture.setPlaying(false);
  const before = await census();
  const panes: number[] = [];
  const ACTS = "/acts";
  /** The acts page as the pane is at it now: its path (PT-5d: a return to it is the page's own ‹ — ruling 5 writes it). */
  let actsPath: string = ACTS;
  /** M7 H12: the acts page's visits by an address of its own (`?visit=N`) */
  let visits = 0;
  let paneKey = "";

  const report = (): FixtureReport | null => d.fixture.report();
  const acts = (): FixtureActs | null => d.fixture.reportAt(actsPath)?.acts ?? null;
  /** The page's word that `ok` accepts, waited for; the last one it said (logged) if none does in time. */
  const hear = async (
    label: string,
    ok: (r: FixtureReport) => boolean,
    from: () => FixtureReport | null = report,
    withinMs: number = HONEST_ROWS.withinMs,
  ): Promise<FixtureReport | null> => {
    const deadline = Date.now() + withinMs;
    while (Date.now() < deadline) {
      const r = from();
      if (r !== null && ok(r)) return r;
      await sleep(100);
    }
    say(`SMOKE_CANVAS_HONEST_UNHEARD ${JSON.stringify({ label, last: from() })}`);
    return null;
  };
  const atActs = (): FixtureReport | null => d.fixture.reportAt(actsPath);
  const held = (): Promise<number | null> =>
    js<number | null>("globalThis.__vfDesk.held()?.entity ?? null");
  const heldFrame = (): Promise<HeldFrameSeen | null> =>
    js<HeldFrameSeen | null>("globalThis.__vfDesk.held()?.frame ?? null");
  const headOf = (
    e: number,
  ): Promise<{ display?: string; favicon?: string | null; saying?: string } | null> =>
    js(`globalThis.__vfDesk.local(${JSON.stringify(PANE.type)})?.said?.(${e}) ?? null`);
  /** The face's row as these rows read it (a failed face's state carries its `retry` — a function crosses no bridge). */
  interface FaceRow {
    readonly state: { readonly is: string; readonly reason: string | null };
    readonly info: { readonly address: string | null; readonly cursor: string | null };
    readonly wire: { readonly mode: string | null } | null;
    readonly arrivals: number;
    readonly presented: number;
    readonly veiled: boolean;
    readonly refused: number;
    readonly faviconBytes: number;
  }
  const face = (): Promise<FaceRow | null> =>
    js<FaceRow | null>(`(() => {
      const f = ${FACE_ROW(paneKey)};
      return f === null ? null : {
        state: { is: f.state.is, reason: f.state.reason ?? null },
        info: { address: f.info?.address ?? null, cursor: f.info?.cursor ?? null },
        wire: f.wire === null ? null : { mode: f.wire.mode ?? null },
        arrivals: f.arrivals, presented: f.presented, veiled: f.veiled, refused: f.refused, faviconBytes: f.faviconBytes,
      };
    })()`);
  const liveStats = (): Promise<{ navigations: number } | null> =>
    js("globalThis.__vfDesk.live()?.stats ?? null");
  const faces = (): Promise<number> =>
    js<number>("(globalThis.__vfDesk.live()?.faces ?? []).length");
  /** The camera once it holds still (a put-down flies home): two reads 250 ms apart, the same. */
  const settledCamera = async (): Promise<void> => {
    let last = "";
    for (let i = 0; i < 24; i += 1) {
      const now = JSON.stringify(await js("globalThis.__vfDesk.camera()"));
      if (now === last) return;
      last = now;
      await sleep(250);
    }
  };
  /** The pane now: its entity by its durable key (an undo may bring it back as another). */
  const paneNow = async (): Promise<number | null> =>
    (await rows()).find((r) => r.key === paneKey)?.entity ?? null;
  /** The pane's middle at rest on the window — its rect off the door, through the camera. */
  const middleOf = async (e: number): Promise<{ x: number; y: number } | null> => {
    const r = (await rows()).find((x) => x.entity === e)?.rect;
    if (r === undefined) return null;
    const c = await js<{ x: number; y: number; zoom: number }>("globalThis.__vfDesk.camera()");
    const at = await h.deskAt();
    return {
      x: at.left + (r.x + r.w / 2 - c.x) * c.zoom,
      y: at.top + (r.y + r.h / 2 - c.y) * c.zoom,
    };
  };
  /** Is the pane's rect wholly off the desk's view? */
  const offView = async (e: number): Promise<boolean> => {
    const r = (await rows()).find((x) => x.entity === e)?.rect;
    if (r === undefined) return true;
    const c = await js<{ x: number; y: number; zoom: number }>("globalThis.__vfDesk.camera()");
    const v = await js<{ w: number; h: number }>(
      `(() => { const b = document.querySelector("[data-desk]").getBoundingClientRect(); return { w: b.width, h: b.height }; })()`,
    );
    const x0 = (r.x - c.x) * c.zoom;
    const x1 = (r.x + r.w - c.x) * c.zoom;
    const y0 = (r.y - c.y) * c.zoom;
    const y1 = (r.y + r.h - c.y) * c.zoom;
    return x1 < -40 || x0 > v.w + 40 || y1 < -40 || y0 > v.h + 40;
  };
  /** The view of the page in hand: what its last word says, else a laptop's. */
  const viewOf = (): readonly [number, number] => report()?.view ?? [1280, 800];
  /** A point of the page (its CSS px) on the window, the pane in hand. */
  const onPagePx = async (px: number, py: number): Promise<{ x: number; y: number }> => {
    const f = await heldFrame();
    if (f === null) throw new Error("no page in hand to point at");
    return pageOnWindow(f, viewOf(), await h.deskAt(), px, py);
  };
  /** The centre of one of `/acts`'s controls on the window, as the page says where it stands. */
  const onAct = async (id: FixtureActId): Promise<{ x: number; y: number }> => {
    const box = acts()?.parts[id];
    if (box === undefined) throw new Error(`the page said nothing of its "${id}"`);
    return onPagePx(box.x + box.w / 2, box.y + box.h / 2);
  };
  /** The pane selected at rest: a press on its middle, the selection bar over it. */
  const select = async (e: number): Promise<void> => {
    await settledCamera();
    const at = await middleOf(e);
    if (at === null) throw new Error("the pane left the board");
    await press(at);
    await until("the pane selected", 10_000, "(globalThis.__vfDesk.anchor()?.count ?? 0) === 1");
    await sleep(300);
  };
  /** The pane picked up: selected, ⏎, in hand, settled. */
  const pickUp = async (e: number): Promise<void> => {
    await select(e);
    await key("Return");
    await until("the pane in hand", 10_000, `globalThis.__vfDesk.held()?.entity === ${e}`);
    await until(
      "the pick-up settled",
      10_000,
      "globalThis.__vfDesk.held()?.frame?.settled === true",
    );
    await sleep(400);
  };
  /** The held bar's Done: the pane put down by the hand's own act. */
  const done = async (): Promise<void> => {
    await h.pressSelector('[data-selection-bar] [data-act="done"]');
    await until("the pane put down by Done", 5_000, "globalThis.__vfDesk.held() === null");
    await settledCamera();
  };
  /** A held tool as the bar shows it. */
  const tool = (id: string): Promise<ToolSeen | null> =>
    js<ToolSeen | null>(`(() => {
      const row = document.querySelector('[data-selection-bar] [data-face-row="hand"]');
      const el = [...(row?.querySelectorAll("[data-tool]") ?? [])].find((t) => t.getAttribute("data-tool") === ${JSON.stringify(id)});
      return el === undefined ? null : { disabled: el.getAttribute("aria-disabled") === "true", label: el.getAttribute("aria-label") };
    })()`);
  /** A held tool's state waited for (the bar repaints with the anchor). */
  const toolIs = async (
    id: string,
    ok: (t: ToolSeen) => boolean,
    ms = 5_000,
  ): Promise<ToolSeen | null> => {
    const deadline = Date.now() + ms;
    let last: ToolSeen | null = null;
    while (Date.now() < deadline) {
      last = await tool(id);
      if (last !== null && ok(last)) return last;
      await sleep(80);
    }
    return last;
  };
  /** A press on the held bar's tool. */
  const pressTool = async (id: string): Promise<void> => {
    const p = await js<{ x: number; y: number } | null>(`(() => {
      const row = document.querySelector('[data-selection-bar] [data-face-row="hand"]');
      const el = [...(row?.querySelectorAll("[data-tool]") ?? [])].find((t) => t.getAttribute("data-tool") === ${JSON.stringify(id)});
      if (el === undefined) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (p === null) throw new Error(`the held bar has no ${id}`);
    await press(p);
  };
  /** What a window point picks on the desk (its part). */
  const partAt = async (at: { x: number; y: number }): Promise<string | null> => {
    const off = await h.deskAt();
    return js<string | null>(
      `globalThis.__vfDesk.pick({ x: ${at.x - off.left}, y: ${at.y - off.top} })?.part ?? null`,
    );
  };
  /** The window's cursor at a point, the pointer moved there — waited for until `ok` (the last one read if it never is). */
  const cursorAt = async (
    at: { x: number; y: number },
    ok: (cursor: string) => boolean,
    ms: number,
  ): Promise<string | null> => {
    move(at.x - 6, at.y);
    await sleep(80);
    move(at.x, at.y);
    const read = (): Promise<string | null> =>
      js<string | null>(
        `(() => { const el = document.elementFromPoint(${Math.round(at.x)}, ${Math.round(at.y)}); return el === null ? null : getComputedStyle(el).cursor; })()`,
      );
    const deadline = Date.now() + ms;
    await sleep(250);
    let c = await read();
    while ((c === null || !ok(c)) && Date.now() < deadline) {
      await sleep(100);
      c = await read();
    }
    return c;
  };
  const shoot = async (name: string): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await win.capturePage()).toPNG());
  };
  /** The view panned by a drag on the bare mat. */
  const pan = async (dx: number, dy: number): Promise<void> => {
    const off = await h.deskAt();
    const mat = await js<{ x: number; y: number } | null>(BARE_FOR(dx, dy));
    if (mat === null) throw new Error("no bare mat to pan the desk from");
    const from = { x: off.left + mat.x, y: off.top + mat.y };
    await drag(from, { x: from.x + dx, y: from.y + dy }, 8, 300);
    await sleep(500);
  };
  /** The view panned by drags on the bare mat until the pane's middle stands in the window. */
  const bringBack = async (e: number): Promise<void> => {
    const view = await js<{ w: number; h: number }>("({ w: innerWidth, h: innerHeight })");
    for (let i = 0; i < 16; i += 1) {
      const at = await middleOf(e);
      if (at === null) return;
      const by = { dx: view.w / 2 - at.x, dy: view.h * 0.5 - at.y };
      if (Math.hypot(by.dx, by.dy) < 120) return;
      await pan(Math.max(-500, Math.min(500, by.dx)), Math.max(-300, Math.min(300, by.dy)));
    }
  };
  /** Main's word on the page's sound, waited for until `ok` (the last word if it never is). */
  const sound = async (
    prefix: string,
    ok: (s: SoundSeen) => boolean,
    ms = 6_000,
  ): Promise<SoundSeen | null> => {
    const deadline = Date.now() + ms;
    let last = d.pageSound(prefix);
    while (Date.now() < deadline) {
      last = d.pageSound(prefix);
      if (last !== null && ok(last)) return last;
      await sleep(60);
    }
    return last;
  };
  /** Frames the page's attachment told of over `ms`. */
  const framesOver = async (ms: number): Promise<number> => {
    const a = (await face())?.arrivals ?? 0;
    await sleep(ms);
    return ((await face())?.arrivals ?? 0) - a;
  };
  /** A failed face as the door and the head say it, with the pixels of `area` (desk CSS px) if one is given. */
  const failedFace = async (
    e: number,
    area?: { x: number; y: number; width: number; height: number },
  ): Promise<FailedFaceSeen> => {
    const f = await face();
    return {
      state: f?.state.is ?? null,
      reason: f?.state.reason ?? null,
      veiled: f?.veiled ?? null,
      address: f?.info.address ?? null,
      display: (await headOf(e))?.display ?? null,
      pixels: area === undefined ? null : await js<NoticePixels | null>(NOTICE_PIXELS(area)),
    };
  };
  const stateIs = (is: string, ms = 20_000): Promise<void> =>
    until(`the face ${is}`, ms, `${FACE_ROW(paneKey)}?.state?.is === ${JSON.stringify(is)}`).catch(
      () => undefined,
    );
  /** PT-5c2 (F7): the face shows the page as it stands — a frame of the document NOW, so the hand's input goes (the desk
   * sends nothing through a frame of a document the page has left): a press after a navigation waits for it. PT-5d (G6):
   * at the address just sent to (`CURRENT_AT`). */
  const current = (label: string, address: string): Promise<void> =>
    until(label, 10_000, CURRENT_AT(paneKey, address));

  try {
    // ── the pane laid alone on clear ground, at actual size, brought to the middle, pointed at the fixture, live ───────
    const at = await layPane(h, before, (e) => {
      panes.push(e);
    });
    if (at.pane === undefined) throw new Error("no new pane on the board after the take");
    let e = at.pane;
    await paneToMiddle(h, e, at);
    await settledCamera();
    const key0 = (await rows()).find((r) => r.entity === e)?.key;
    if (key0 === undefined || key0 === null)
      throw new Error("the door gives the pane no durable key");
    paneKey = key0;
    const goTo = async (url: string): Promise<void> => {
      if (
        !(await js<boolean>(
          `globalThis.__vfDesk.writeProps(${e}, { url: ${JSON.stringify(url)} })`,
        ))
      )
        throw new Error(`the door could not point the pane at ${url}`);
    };
    await goTo(d.fixture.url);
    try {
      await until(
        "the page live on the face",
        30_000,
        `(() => { const f = ${FACE_ROW(paneKey)}; return f !== null && f.state.is === "live" && f.presented >= 1; })()`,
      );
    } catch (error) {
      say(
        `SMOKE_CANVAS_HONEST_FACE ${JSON.stringify({ live: await js("globalThis.__vfDesk.live()") })}`,
      );
      throw error;
    }
    if ((await hear("the page's first word", (r) => r.path === "/page")) === null)
      throw new Error("the fixture page never spoke");

    // ── BAR: a fresh page's ‹ is disabled and does nothing; live after a click; ↻ is Stop while a page loads ─────────
    await pickUp(e);
    const fresh = await toolIs("back", (t) => t.disabled, 3_000);
    const sent0 = (await liveStats())?.navigations ?? 0;
    await pressTool("back");
    await key("[", [process.platform === "darwin" ? "meta" : "control"]);
    await sleep(HONEST_ROWS.quietMs);
    const pressed: HonestSeen["bar"]["pressed"] = {
      path: report()?.path ?? null,
      navigations: ((await liveStats())?.navigations ?? 0) - sent0,
      held: (await held()) === e,
    };
    const link = report()?.parts.link;
    if (link === undefined) throw new Error("the page said nothing of its link");
    await press(await onPagePx(link.x + link.w / 2, link.y + link.h / 2));
    await hear("the page at /next", (r) => r.path === "/next");
    const after = await toolIs("back", (t) => !t.disabled);
    // the page of what a page may ask for; from it, the slow address — and Stop
    await goTo(d.fixture.origin + ACTS);
    if ((await hear("the acts page", (r) => r.acts !== undefined, atActs)) === null)
      throw new Error("the acts page never spoke");
    await hear("the acts page the page in hand", (r) => r.path === ACTS);
    await current("the acts page's frame on the face", d.fixture.origin + ACTS);
    await sleep(600);
    await press(await onAct("slow"));
    const loading = await toolIs("reload", (t) => t.label === "Stop");
    await shoot("pt-5a-bar-stop.png");
    await pressTool("reload");
    const stopped = await toolIs("reload", (t) => t.label === "Reload");
    await sleep(HONEST_ROWS.quietMs);
    const bar: HonestSeen["bar"] = {
      fresh,
      pressed,
      after,
      loading,
      stopped,
      path: report()?.path ?? null,
      slow: d.fixture.slow(),
    };
    said.bar = bar;
    problems.push(...judgeBar(bar));

    // ── POPUP: a target=_blank link, then window.open — the same pane goes there; no window, no page, no pane more ────
    /** Back at the acts page by the page's OWN ‹ — PT-5d (ruling 5): a page that goes back by itself is WRITTEN (the
     * document's wait for its page ends when the page arrives). (PT-5a returned by a fresh address of its own, `?visit=N`:
     * a page the document had sent to the acts page that went to `/next` by its own link was never written there, and
     * the document kept the acts page — PT-5a's finding 6.) */
    const toActs = async (): Promise<void> => {
      await pressTool("back");
      // (PT-5d, M7 H12: ‹ lands at the acts page only where the row before left the page at an address after it — one that
      // left it at the acts page itself, or nowhere, goes elsewhere: then the acts page by an address of its own, the
      // visit's query, so that a row gone wrong strands none after it)
      const back = await hear(
        "the acts page again, by ‹",
        (r) => r.path === actsPath && r.acts !== undefined,
        report,
        HONEST_ROWS.quietMs * 4,
      );
      if (back === null) {
        visits += 1;
        actsPath = `${ACTS}?visit=${visits}`;
        say(`SMOKE_CANVAS_HONEST_TO_ACTS ${JSON.stringify({ by: "address", at: actsPath })}`);
        await goTo(d.fixture.origin + actsPath);
        await hear("the acts page again", (r) => r.path === actsPath && r.acts !== undefined);
      }
      await current("the acts page's frame on the face again", d.fixture.origin + actsPath);
      await sleep(600);
    };
    const windows0 = d.windows();
    const faces0 = await faces();
    const panes0 = await census();
    await press(await onAct("popup"));
    const blank = await hear("the pane at the link's address", (r) => r.path === "/next");
    await toActs();
    await press(await onAct("open"));
    const opened = await hear(
      "the pane where window.open asked",
      (r) => r.path === "/next?opened=1",
    );
    const windows1 = d.windows();
    const popup: HonestSeen["popup"] = {
      blank: blank?.path ?? report()?.path ?? null,
      opened: acts()?.opened ?? null,
      openedPath: opened?.path ?? report()?.path ?? null,
      windows: [windows0.count, windows1.count],
      raised: windowsRaised(windows0, windows1),
      faces: [faces0, await faces()],
      panes: [panes0, await census()],
    };
    said.popup = popup;
    problems.push(...judgePopup(popup));
    await toActs();

    // ── ALERT: alert, confirm and prompt — the page's word after them arrives ─────────────────────────────────────────
    const windowsA = d.windows();
    const alerts0 = acts()?.alerts ?? 0;
    await press(await onAct("alert"));
    await hear("the page past its alert", (r) => (r.acts?.alerts ?? 0) > alerts0, atActs, 10_000);
    const now = acts();
    const windowsA1 = d.windows();
    const alert: HonestSeen["alert"] = {
      alerts: (now?.alerts ?? 0) - alerts0,
      confirmed: now?.confirmed ?? null,
      prompted: now === null ? undefined : now.prompted,
      windows: [windowsA.count, windowsA1.count],
      raised: windowsRaised(windowsA, windowsA1),
    };
    said.alert = alert;
    problems.push(...judgeAlert(alert));

    // ── PICKER: a press on the file input — cancelled, no panel ───────────────────────────────────────────────────────
    const windowsP = d.windows();
    const cancels0 = acts()?.cancels ?? 0;
    await press(await onAct("file"));
    await hear(
      "the file input cancelled",
      (r) => (r.acts?.cancels ?? 0) > cancels0,
      atActs,
      10_000,
    );
    await sleep(500);
    const windowsP1 = d.windows();
    const picker: HonestSeen["picker"] = {
      cancels: (acts()?.cancels ?? 0) - cancels0,
      changes: acts()?.changes ?? 0,
      windows: [windowsP.count, windowsP1.count],
      raised: windowsRaised(windowsP, windowsP1),
      focused: [windowsP.focused, windowsP1.focused],
    };
    said.picker = picker;
    problems.push(...judgePicker(picker));

    // ── DOWNLOAD: cancelled, and the head says so for a moment ────────────────────────────────────────────────────────
    const files0 = d.fixture.files();
    await press(await onAct("download"));
    await until(
      "the head saying the download",
      8_000,
      `globalThis.__vfDesk.local(${JSON.stringify(PANE.type)})?.said?.(${e})?.saying !== undefined`,
    ).catch(() => undefined);
    const saidAt = Date.now();
    const headSaid = (await headOf(e))?.saying ?? null;
    await shoot("pt-5a-download-said.png");
    let unsaidMs: number | null = null;
    while (Date.now() - saidAt < HONEST_ROWS.saidWithinMs) {
      if ((await headOf(e))?.saying === undefined) {
        unsaidMs = Date.now() - saidAt;
        break;
      }
      await sleep(100);
    }
    const download: HonestSeen["download"] = {
      serial: (await face())?.refused ?? 0,
      said: headSaid,
      unsaidMs,
      path: report()?.path ?? null,
      asked: d.fixture.files() - files0,
    };
    said.download = download;
    problems.push(...judgeDownload(download));

    // ── FAVICON-ONCE: a hover across the link, the field and the ground — the cursor moves, the bytes do not ──────────
    await until(
      "the head saying the page's favicon",
      10_000,
      `String(globalThis.__vfDesk.local(${JSON.stringify(PANE.type)})?.said?.(${e})?.favicon ?? "").startsWith("icon:")`,
    ).catch(() => undefined);
    const bytes0 = (await face())?.faviconBytes ?? 0;
    const cursors: string[] = [];
    const ground = await onPagePx(viewOf()[0] * 0.5, viewOf()[1] * 0.9);
    for (let round = 0; round < 2; round += 1)
      for (const point of [await onAct("popup"), await onAct("field"), ground]) {
        move(point.x, point.y);
        await sleep(450);
        const c = (await face())?.info.cursor ?? "";
        if (cursors.at(-1) !== c) cursors.push(c);
      }
    const faviconOnce: HonestSeen["faviconOnce"] = {
      bytes: [bytes0, (await face())?.faviconBytes ?? 0],
      cursors,
      head: (await headOf(e))?.favicon ?? null,
    };
    said.faviconOnce = faviconOnce;
    problems.push(...judgeFaviconOnce(faviconOnce));

    // ── CARET: the field focused, the page otherwise still — the frames that arrive and what the desk submits ─────────
    await press(await onAct("field"));
    await hear("the field focused", (r) => r.focused === "field", atActs, 10_000);
    move(ground.x, ground.y);
    await sleep(1_500);
    const read = async (): Promise<{
      arrivals: number;
      presented: number;
      submits: number;
      steps: number;
      sleeps: number;
    }> => ({
      arrivals: (await face())?.arrivals ?? 0,
      presented: (await face())?.presented ?? 0,
      submits: (await js<number | null>("globalThis.__vfDesk.submits()?.total ?? null")) ?? 0,
      steps: await js<number>("globalThis.__vfDesk.rest().steps"),
      sleeps: await js<number>("globalThis.__vfDesk.rest().sleeps"),
    });
    const c0 = await read();
    const t0 = Date.now();
    await sleep(HONEST_ROWS.caretMs);
    const c1 = await read();
    const caret: HonestSeen["caret"] = {
      focused: atActs()?.focused ?? null,
      ms: Date.now() - t0,
      arrivals: c1.arrivals - c0.arrivals,
      presented: c1.presented - c0.presented,
      submits: c1.submits - c0.submits,
      steps: c1.steps - c0.steps,
      sleeps: c1.sleeps - c0.sleeps,
    };
    // why the desk is awake between the page's frames: its loop's own word (what is due, and what woke it)
    say(
      `SMOKE_CANVAS_HONEST_CARET_REST ${JSON.stringify(await js("(() => { const r = globalThis.__vfDesk.rest(); return { asleep: r.asleep, due: r.due, wakes: r.wakes, timed: r.timed }; })()"))}`,
    );
    said.caret = caret;
    problems.push(...judgeCaret(caret));

    // ── HEARD: the tone — in hand, at rest, off the view, back, deleted, undone ───────────────────────────────────────
    const prefix = d.fixture.origin + ACTS;
    await press(await onAct("tone"));
    const toned = await hear("the tone running", (r) => r.acts?.tone === "running", atActs, 10_000);
    const tokenTone = atActs()?.token ?? "";
    const heardHeld = await sound(prefix, (s) => s.audible && !s.muted);
    await done();
    const heardRest = await sound(prefix, (s) => s.audible && !s.muted);
    const view = await js<{ w: number; h: number }>("({ w: innerWidth, h: innerHeight })");
    const pans: number[] = [];
    for (let i = 0; i < 5 && !(await offView(e)); i += 1) {
      const dx = -Math.round(view.w * 0.45);
      await pan(dx, 0);
      pans.push(dx);
    }
    const offScreen = await offView(e);
    const unseenSound = await sound(prefix, (s) => s.muted);
    for (const dx of pans.reverse()) await pan(-dx, 0);
    await bringBack(e);
    await settledCamera();
    const seenAgain = await sound(prefix, (s) => s.audible && !s.muted);

    // ── PARKED: the animating page under a cover — no frame, muted; the cover down, both back ─────────────────────────
    d.fixture.setPlaying(true);
    await sleep(900);
    const parkedBefore = {
      frames: await framesOver(HONEST_ROWS.parkWatchMs),
      muted: d.pageSound(prefix)?.muted ?? null,
    };
    await js(`globalThis.vibefield.view.set("history")`);
    const park = await js<{ parked: boolean }>("globalThis.__vfDesk.whenParked(10000)");
    await sleep(600);
    const under = {
      frames: await framesOver(HONEST_ROWS.parkWatchMs),
      muted: d.pageSound(prefix)?.muted ?? null,
      wire: (await face())?.wire?.mode ?? null,
    };
    await js(`globalThis.vibefield.view.set("canvas")`);
    await until(
      "the canvas view again",
      10_000,
      `document.querySelector(".vf-cover")?.getAttribute("data-cover") === "down"`,
    ).catch(() => undefined);
    await sound(prefix, (s) => !s.muted);
    await sleep(600);
    const parked: HonestSeen["parked"] = {
      parked: park.parked,
      before: parkedBefore,
      under,
      after: {
        frames: await framesOver(HONEST_ROWS.parkWatchMs),
        muted: d.pageSound(prefix)?.muted ?? null,
        wire: (await face())?.wire?.mode ?? null,
      },
    };
    d.fixture.setPlaying(false);
    said.parked = parked;
    problems.push(...judgeParked(parked));

    // (HEARD, its end) deleted: muted at once, its page kept; undone: the same page heard again
    await select(e);
    const deletedAt = Date.now();
    await key("Backspace");
    let mutedMs: number | null = null;
    let deletedSound = d.pageSound(prefix);
    while (Date.now() - deletedAt < HONEST_ROWS.silentWithinMs) {
      deletedSound = d.pageSound(prefix);
      if (deletedSound === null || deletedSound.muted) {
        if (deletedSound !== null) mutedMs = Date.now() - deletedAt;
        break;
      }
      await sleep(25);
    }
    await until(
      "the pane deleted",
      5_000,
      `(globalThis.__vfDesk.census()[${JSON.stringify(PANE.type)}] ?? 0) === ${before}`,
    ).catch(() => undefined);
    await sleep(400);
    await h.undoKey();
    await until(
      "the pane back by the undo",
      10_000,
      `(globalThis.__vfDesk.census()[${JSON.stringify(PANE.type)}] ?? 0) === ${before + 1}`,
    ).catch(() => undefined);
    const back = await paneNow();
    if (back === null) throw new Error("the undo did not bring the pane back");
    if (back !== e) panes.push(back);
    e = back;
    const undoneSound = await sound(prefix, (s) => s.audible && !s.muted, 12_000);
    await sleep(600);
    const heard: HonestSeen["heard"] = {
      tone: toned?.acts?.tone ?? acts()?.tone ?? null,
      held: heardHeld,
      rest: heardRest,
      unseen: unseenSound === null ? null : { ...unseenSound, offScreen },
      seenAgain,
      deleted: deletedSound === null ? null : { ...deletedSound, ms: mutedMs },
      undone:
        undoneSound === null
          ? null
          : { ...undoneSound, samePage: tokenTone !== "" && atActs()?.token === tokenTone },
    };
    said.heard = heard;
    problems.push(...judgeHeard(heard));

    // ── FAIL: an address that refuses — the face at rest and in hand; opened, Try again loads it ──────────────────────
    const refusing = await d.fixture.refusing();
    await goTo(refusing.url);
    await stateIs("failed");
    await sleep(700);
    await select(e);
    const frame = await h.frame();
    const rect = (await rows()).find((r) => r.entity === e)?.rect;
    const off = await h.deskAt();
    let restArea: { x: number; y: number; width: number; height: number } | undefined;
    let restPart: string | null = null;
    if (frame !== null && rect !== undefined) {
      const p = pageRegion(frame, rect);
      restArea = {
        x: Math.floor(p.x0),
        y: Math.floor(p.y0),
        width: Math.ceil(p.x1 - p.x0),
        height: Math.ceil(p.y1 - p.y0),
      };
      restPart = await partAt({
        x: off.left + (p.x0 + p.x1) / 2,
        y: off.top + (p.y0 + p.y1) / 2,
      });
    }
    const failRest = await failedFace(e, restArea);
    await shoot("pt-5a-fail-at-rest.png");
    await pickUp(e);
    await sleep(500);
    const f = await heldFrame();
    const viewF: readonly [number, number] = [1280, 800];
    const failHeld = await failedFace(e, f === null ? undefined : heldPageArea(f, viewF));
    await shoot("pt-5a-fail-in-hand.png");
    // the capsule where the pane draws it; the window's cursor says whether a part is there (a control's pointer) — and
    // that the film beside it is none
    const cap = noticeCapsule(viewF);
    const capsuleAt = f === null ? null : pageOnWindow(f, viewF, off, cap.cx, cap.cy);
    const filmAt =
      f === null ? null : pageOnWindow(f, viewF, off, cap.cx - cap.hx * 2.2, cap.cy + cap.hy * 4);
    const failTool = await tool("reload");
    const film = filmAt === null ? null : await cursorAt(filmAt, (c) => c !== "pointer", 1_200);
    const capsule =
      capsuleAt === null ? null : await cursorAt(capsuleAt, (c) => c === "pointer", 4_000);
    await refusing.open();
    if (capsuleAt !== null) await press(capsuleAt);
    const revived = await hear(
      "the page at the address that refused",
      (r) => r.path === "/revived",
      () => d.fixture.reportAt("/revived"),
    );
    await until(
      "the face live again, its texture shown",
      20_000,
      `(() => { const f = ${FACE_ROW(paneKey)}; return f !== null && f.state.is === "live" && f.veiled === false; })()`,
    ).catch(() => undefined);
    const fail: HonestSeen["fail"] = {
      host: refusing.host,
      rest: failRest,
      restPart,
      held: failHeld,
      capsule,
      film,
      reload: failTool,
      retried: {
        state: (await face())?.state.is ?? null,
        veiled: (await face())?.veiled ?? null,
        path: revived?.path ?? null,
      },
    };
    said.fail = fail;
    problems.push(...judgeFail(fail));

    // ── STOPPED: the page's process killed — said, its address kept; ↻ loads it again ─────────────────────────────────
    const tokenBefore = d.fixture.reportAt("/revived")?.token ?? "";
    const killed = d.killPage(`http://${refusing.host}/`);
    await stateIs("failed");
    await sleep(900);
    const f2 = await heldFrame();
    const stoppedFace = await failedFace(e, f2 === null ? undefined : heldPageArea(f2, viewF));
    await shoot("pt-5a-stopped-in-hand.png");
    await pressTool("reload");
    const again = await hear(
      "a new page at the address",
      (r) => r.path === "/revived" && r.token !== tokenBefore,
      () => d.fixture.reportAt("/revived"),
    );
    await stateIs("live");
    const stoppedSeen: HonestSeen["stopped"] = {
      killed,
      face: stoppedFace,
      recovered: { state: (await face())?.state.is ?? null, newPage: again !== null },
    };
    said.stopped = stoppedSeen;
    problems.push(...judgeStopped(stoppedSeen, refusing.host));
  } catch (error) {
    // a step that cannot go on ends the rows — never what the rows before it found (they are said with it)
    problems.push(`PT-5a HONEST: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    d.fixture.setPlaying(false);
    say(`SMOKE_CANVAS_HONEST ${JSON.stringify(said)}`);
    try {
      await js(`globalThis.vibefield.view.set("canvas")`);
      if ((await held()) !== null) await done();
      await h.theme("light");
      const still = paneKey === "" ? null : await paneNow();
      for (const pane of new Set([...(still === null ? [] : [still]), ...[...panes].reverse()])) {
        await key("Escape");
        await bringBack(pane);
        await settledCamera();
        const at = await middleOf(pane);
        if (at === null) continue;
        await press(at);
        await sleep(300);
        if ((await js<number>("globalThis.__vfDesk.anchor()?.count ?? 0")) === 1)
          await key("Backspace");
        await sleep(500);
      }
    } catch {
      /* a row that cannot go on ends the rows, never what the earlier rows found */
    }
    const after = await census();
    if (after !== before)
      problems.push(
        `CLEARED: ${after} panes on the board after the honest rows, not the ${before} found`,
      );
    say(`SMOKE_CANVAS_HONEST_CLEARED ${JSON.stringify({ before, after })}`);
    await js(`globalThis.__vfDesk.ambient(${JSON.stringify(ambient)})`);
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(themeWas)})`);
  }
  return problems;
}
