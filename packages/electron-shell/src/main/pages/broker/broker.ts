// EY-1 (2026-11-19) — THE PAGES BROKER: an agent's call on a page, from fieldd's pages room to the
// run's one engine (BU-20). Per call, in order:
// 1. The page's binding. None, or an epoch or revision other than the one the run was granted,
//    answers `gone` and ends the grant, except that a page at rest (the desk's cap hibernated its
//    producer: no window, so no binding) answers `parked`. A bound page is never parked; a held
//    page answers `held`.
// 2. The run's queue. The engine runs one command at a time, so a run's calls go one by one. A
//    slot is let go only when the engine has answered, never when the call was answered early.
// 3. The grant. The page is handed to the run's client on the bridge, and leased in the windows,
//    BEFORE the engine starts: an engine that connects with no granted page makes a pane.
// 4. The call's window opens.
// 5. The engine, inside that window. Started if the run has none, then launched over its socket
//    with `cdpUrl` = the run's keyed URL, armed for this launch alone (EY-S2-01B). That is the only
//    place a key is minted. A spent key presented again on the run's route (the race) revokes the
//    route, stops the engine and closes the window, and the call is refused. Then the engine is
//    switched to the call's page, by the bridge's target id, when its active tab is another
//    (BU-20). Then the command goes, exactly as checked, under the broker's own id.
//    Errata (2026-11-24, the first live run): steps 4 and 5 stood the other way round, with "the
//    call is refused before any window opens" for a race. The pinned engine sends the page two
//    commands as it connects and its launch waits for them, so a launch with no window open always
//    failed. The lab launched inside the first call's window; so does this. What it costs: a client
//    that wins a race for the key has the call's window on the run's own signed-out page until the
//    launch answers and the race is seen. A page with the person's sign-ins must not inherit that.
// 6. The window closes. The answer is, in order: how the window closed (a hold, an expiry, the
//    grant's end), then the first refusal the bridge made inside it, then `done` with the
//    engine's reply.
// The engine off the bridge (2026-11-24). The bridge is the wall, so the broker sends a command only
// to an engine that is on it: the launch's key has an epoch, kept on the run, and before each send
// (and before an answer is taken as done) the broker asks whether a connection that spent that key
// still stands. One that does not, the bridge's word that the run's connection closed, and the
// supervisor's word that the engine exited each answer the call in flight UNAVAILABLE
// `engine-starting`, never done, and leave nothing launched: the next call starts and launches
// another. An engine that left the bridge while its process lives is ended (`replace`), and its
// route revoked. So is one that leaves PAGES_HUNG_CALLS calls in a row unanswered.
// Errata (2026-11-24, an act the engine may have done): "each answer the call in flight UNAVAILABLE
// `engine-starting`" was so for every call, and the room words that state as still starting, try
// again. An act whose own command the engine was already handed may have happened, so it answers
// UNAVAILABLE `no-answer` (contracts: an act whose answer never came), which the room words as look
// before you try again. A read, and an act whose command never went, keep `engine-starting`.
// The same death is also seen as the engine's socket closing before a whole reply (the exchange's
// `outcome-unknown`), before or after the exit is heard: such an act is `no-answer` by that way too.
// A hold answers the call in flight `held` at once, and its command is never sent again. A call
// past its deadline, or cancelled, answers TIMEOUT and drains the page. Main's own errors are
// kinds with fixed messages; `state` names what happened, for the log and pages' UNAVAILABLE
// states. The log holds durations, sizes and states, never a value, a URL or a key.
// Some calls main answers itself, and never sends to the engine:
// - the run form's `close` ends the run (its grants, its route, its engine); its `tab_list` lists
//   the run's pages from main's own grants, with the page of its last call as `current`; its
//   `rebind {from}` moves a resumed run's pages to its new key;
// - the page form's `close` ends that page for the run: its grant ends, and a pane the run made is
//   closed by the pane store; a page from the desk is only let go.
// The endpoint's `giveBack` (7f): an agent that closes a page the person handed it gives the page
// back. The run's grant ends, the page stays open, and the run's next answer names it in
// `givenBack`. It is decided at once, never in the run's turn: the call whose engine sent the
// close still holds that turn, and the page's grant ends when that call has its answer.
// A run's own panes (7b, 2026-11-19): a tab its engine opens inside an act window, the run form's
// open with no page, and a pop-up its page opens while an act window stands on it. Each is refused
// in order (the address, the run's cap, the desk's room), made in main's custody in the run's own
// session, waited for until a window binds it, then granted, and named in `made` on the run's next
// answer. A refused pop-up is counted in `capped` there; a pane the run closes, in `closed`.
// Errata (S1, 2026-11-24): "until a window binds it" read as the desk's window adopting the page, and
// no desk window can before the run is told of it (fieldd places a pane only from `made`). The
// binding waited for is the page's OWN: custody starts a made page with no desk window attached
// (held for its run), and its window's birth registers it. Once an answer names the page, custody
// is told (`named`) and keeps it for its run past the adopt grace.
// What a run is owed (2026-11-24). A made pane main closes before any answer named it is named in
// neither `made` nor `closed`: the run never heard of it (one helper, at every place main closes a
// made pane). A made pane custody lets go has its grant ended at custody's word, so no later close
// finds a stale grant and owes the pane in `givenBack` as if a person had handed it. Why no pane
// was made is custody's own word, in custody's order (its window, its desk, its cap): the broker
// asked the desk's room first, and a desk with no window has no room, so a missing window was
// answered desk-full. And the run form's open names its pane at the address it was opened at,
// not the about:blank it is made at before the engine takes it there.
// The engine's allow list (2026-11-24). A command passes when its action is on its form's list
// (contracts' PAGES_DAEMON_ACTIONS; on the run form, SHELL_SURFACES_RUN_ACTIONS too) and every argument
// is that action's own (broker/commands.ts, held to what fieldd's rows send). Anything else is
// PRECONDITION_FAILED `not-allowed` with a warn line, before the page is read, a pane is made, a
// window opens or an engine starts. `launch` stays the broker's alone by its own word. Main's own
// actions never reach the engine on either form: `close`, and `tab_list`, which a page-form call
// used to get from the engine itself, target ids and all. Until this day the broker refused only
// `launch` and sent every key a command carried.
// A still (BU-12, MT-D10; 2026-11-24). A `screenshot` is the engine's own, one frame, written as a file
// in the folder fieldd names on the call for the run; the answer names the file and its bytes never
// cross (EL2). Main judges the folder before the page is granted (core/still-folder.ts: its shape,
// then each part by `lstat`: no link, ours or root's above, the folder itself ours and 0700), mints
// the file's name from 128 random bits, checks the name is free just before the send, and sends the
// engine that path with PNG forced and every other place or format taken out. After the engine's
// answer it opens what was written, never through a link, and judges it by its handle (a regular
// file of ours with one link, within PAGES_STILL_MAX_BYTES, a PNG, at the very path sent). A folder
// main will not take is PRECONDITION_FAILED `still-folder` (fieldd's to fix), a file it will not take
// is UNAVAILABLE `bad-answer` (or RESOURCE_EXHAUSTED `output-too-large`), each with a warn line by
// why; and a file no answer names (refused, or its call answered held or timed out) is removed.
// Until this day main read no folder and the guard had no caller: no still was ever answered.
// A made page's window (BU-19; 2026-11-24): a tab or a pop-up made while a call's window stands shares
// that window, of its kind, until the call ends (`windows.adopt`), so what the engine sends its new
// tab while it is made is admitted, and a refusal on it is the call's. Until this day nothing called
// the adopt, and the new page had no window. A page made after its call ended has none; the run's
// next call on it opens one. The call's end closes every window of the call (`closeCall`).
// The run form's `tab_new` (2026-11-24) is ONE pane, made by main at its address and answered by
// main; the engine is asked nothing. Before, main made a pane to carry the engine's own `tab_new`,
// which made a second, and the blank one was answered.
// An ended run's open (2026-11-24). Custody ends a run at the run form's `close` and makes it no page
// after. That refusal, and the broker's own while the run's end is under way, were answered
// `no-window`, which the room words as no VibeField window being open. The run form's open is now
// answered UNAVAILABLE `engine-stopped` (the run's engine has stopped, and main starts none for it),
// with a warn line: fieldd's room sends the run form's close only at the run's true end, so a call
// from that run after it is fieldd's to explain. A tab and a pop-up keep the bridge's and the count's
// own words (`no-window`, `capped.noWindow`, whose contract names a run that ended first).
// A new page and the engine (2026-11-24, the second live run). Errata: "A page made after its call ended
// has none; the run's next call on it opens one" (a made page's window, above) left out what the engine
// does meanwhile. The pinned engine attaches to a page the bridge tells it of in its next drain: first
// thing in its next command, or on its 100 ms tick while it is idle, whichever comes first. It keeps the
// page only if its first enable passes the wall. Refused (no window stood on the page), the event is
// spent, the engine never holds the page, and its `tab_switch` to it fails: every later call on the page
// answered `loading`, until the run's engine was replaced. Two things answer it:
// - The run form's `tab_new`, with the run's engine launched, goes on its new pane as the run form's open
//   does: one read of the engine's own (`url`) in the call's own window, opened in the same turn as the
//   page's grant, so the engine's attach and first enable fall inside it. Its outcome is not the tab's:
//   the pane is made, and answered so. With no engine launched nothing is told, and nothing is asked:
//   an engine lists every page of its run when it joins the bridge.
// - Any call whose page the engine's own list lacks asks the bridge to say the page to the engine again
//   (`introduce`), inside the call's window, and lists again: the engine's drain attaches to it there. So
//   a page whose first telling fell outside a window (a pop-up bound after its call ended, a tab made
//   while another call held the run's turn) is the engine's from the run's next call on it.
// A run's own page that answers parked or gone (2026-11-24). Errata to step 1 above: "answers `gone`
// and ends the grant" left a page the run MADE in neither its grants nor its moved set, so a rebind
// closed it as a page still waited for, the run's list left it out, and a run's end did not name it.
// Such a page is the run's still, and goes to the moved set: listed, carried by a rebind, named at the
// run's end, and granted again at the run's next call on it. That holds for a page at rest and for one
// whose lease moved (the desk woke it: it answers gone once, and the room keeps it for one more call).
// A made page with no binding that is not at rest has no producer: gone for good, or starting again.
// Main cannot tell which, so it follows the room, which forgets a page at its second gone running: at
// the first the page is kept, at the second main closes it for its run and names it in `closed`, so
// no page stands and counts against a run that can no longer name it. A call that is answered between
// the two starts the count again. A made page custody no longer holds at all is closed for the run at
// once. A page the run did not make is never closed by a gone.
// Whose page it is (2026-11-24). Errata: "a pane the run made is closed by the pane store" was decided
// by custody's record alone (`panes.made`), and custody drops that record without a word when the
// window that adopted the page lets it go. The page form's close, a client's give-back and the run's
// end then took the page for one a person had handed, and owed it in `givenBack`. The broker's own
// record decides first: every page it made for the run, kept until that page is closed for the run or
// custody says it went. Custody's word is still read, for a page made before the record (a rebind's).
// A fieldd that was replaced (2026-11-24). A run is of the fieldd that named it, and the room that
// would send a run's end went with that fieldd. Main ends custody's runs then, and each of those in
// the broker through the run form's close. A run that made no page was the broker's alone: custody
// named it to nobody, so it kept its grants, its route and its engine until the app quit. `endEveryRun`
// ends every run the broker holds as the run form's close ends one, each in its own turn and all at
// once. What a run was owed is dropped: no room is left to hear it, and the same run id named again
// is a new run. A run whose turn does not come by the bound (a call still holds its engine) is not
// ended under that call; it is counted `unended` and said.
// The idle reap's clock (2026-11-24). The engine ends itself when it has had no command for its own
// bound (PAGES_ENGINE_IDLE_TIMEOUT_MS, twice main's), and main's reap is there to come first. The reap
// was re-armed for its whole bound at every call's end, a call main answered before the engine had a
// command among them (the page form's close, a refused window, a still's folder refused). A run that
// kept making such calls sent its engine nothing and held the reap off until the engine ended itself,
// an exit main had not asked for. The reap now counts from the engine's last command of main's (sent,
// or answered): a call the engine never saw leaves the reap where it was, and one that ends past the
// bound is followed by the reap at once. A run with no engine launched keeps the whole bound from its
// last call, as before: nothing of it can end by itself, and that reap is also what lets a run whose
// engine was stopped for exiting too often start one again.

import { randomUUID } from "node:crypto";
import {
  LiveSurfaceUrlV1,
  PAGES_MADE_DEVICE_SCALE,
  PAGES_MADE_VIEWPORT,
  PAGES_RUN_PANES_MAX,
  type ShellSurfacesControlParams,
  type ShellSurfacesControlRefusalFact,
  type ShellSurfacesControlResult,
  type ShellSurfacesMadePane,
  SURFACE_AUTHORITY_LIMITS,
} from "@vibefield/contracts";
import {
  folderShape,
  judgeFolder,
  judgeWritten,
  mintStillName,
  STILL_HEAD_BYTES,
  STILL_NAME_RANDOM_BYTES,
  type StillAnswer,
  type StillEntryFacts,
  type StillFileFacts,
  type StillRefusal,
  stillCommand,
  stillPath,
} from "../core/still-folder";
import {
  BRIDGE_REFUSAL_FACT,
  type BridgeRefusal,
  type CallRefusal,
  type CallWindow,
  type PageClass,
  type PageLease,
  WINDOW_CLOSE_FACT,
  type Windows,
} from "../core/types";
import { refusedCommand } from "./commands";
import {
  type DaemonExchangeOptions,
  daemonRequestId,
  exchangeDaemon,
  type PagesDaemonCommand,
  type PagesDaemonExchange,
} from "./daemon-client";
import { daemonOptions, type EngineLease, type PagesEngineSupervisor } from "./engine-supervisor";

/** The broker answers this long before the call's deadline, so main's reply still reaches fieldd
 * in time. */
export const PAGES_ANSWER_MARGIN_MS = 500;
/** How long a page drains after a call that timed out (provisional: EY-1's desk row measures
 * it). */
export const PAGES_DRAIN_MS = 2_000;
/** An engine idle this long is stopped; the run's next call starts another (provisional, as
 * above). */
export const PAGES_IDLE_REAP_MS = 300_000;
/** An engine that leaves this many calls in a row unanswered by their deadlines is hung: it is ended
 * and the run's next call starts another (provisional, as above). A slow page can cost one. */
export const PAGES_HUNG_CALLS = 2;
/** Actions the engine never gets from a call: an agent's `launch` could point the engine anywhere,
 * and the engine's own `close` ends the daemon. A `close` is main's (the run's or a page's end). */
export const BROKER_OWNED_ACTIONS: readonly string[] = Object.freeze(["launch", "close"]);
/** EY-1 (7b, 2026-11-19): how often a made page's wait asks whether a window has bound it: a
 * bounded poll inside the call's own deadline, which custody's word that the page went ends. */
export const PAGES_MADE_POLL_MS = 25;
/** How long a pop-up's page is waited for: custody's adopt grace (ADOPT_GRACE_MS), past which
 * it lets an unadopted page go. */
export const PAGES_POPUP_WAIT_MS = 30_000;
/** How many times a call says its page to the engine again when the engine's list lacks it
 * (2026-11-24). The bridge's word and the broker's next command reach the engine by two sockets, so
 * the list may be asked before the word is read: the second and third come a poll later. */
export const PAGES_INTRODUCE_TRIES = 3;

export type PagesBrokerErrorKind =
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "PRECONDITION_FAILED"
  | "RESOURCE_EXHAUSTED";

/** A call main cannot answer with a fact. `kind` is what shell-provider sends on, with its fixed
 * message; `state` is the log's, and pages' UNAVAILABLE state where it is one. */
export class PagesBrokerError extends Error {
  readonly kind: PagesBrokerErrorKind;
  readonly state: string;
  constructor(kind: PagesBrokerErrorKind, state: string) {
    super(`pages: ${state}`);
    this.kind = kind;
    this.state = state;
  }
}

/** The page 1g puts on a binding: whether the person holds it, and each edge of the hold. */
export interface PagesHeldPage {
  readonly held: boolean;
  onHeld(listener: (held: boolean) => void): () => void;
  /** EY-1 (7b, 2026-11-19): the page's pop-up policy while a run's act window stands on it; null
   * clears it. Absent: the page takes none, and its pop-ups get the guard's own answer. */
  popups?(policy: PagesPopups | null): void;
}

/** EY-1 (7b): a page's pop-ups, decided at once on the run's state; an allowed one is opened as the
 * run's own pane. A `deny` is dropped by the guard, telling nothing. */
export interface PagesPopups {
  decide(url: string): "allow" | "deny";
  open(url: string): void;
}

/** EY-1 (7b): a page's first size and density. */
export interface PagesView {
  readonly logicalViewport: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor: number;
}

/** A page's control binding as main's registry holds it (browser-control-target.ts). */
export interface PagesBinding {
  readonly producerEpoch: number;
  readonly controlBindingRevision: number;
  readonly page: PagesHeldPage;
}

export interface PagesTargetsPort {
  lookup(surfaceId: string): PagesBinding | null;
  /** Whether the page is at rest: the desk's cap hibernated its producer, so it has no window and
   * no binding. */
  parked(surfaceId: string): boolean;
  /** The page's url and title from its producer's state, or null when it has none. EY-1 (1e,
   * 2026-11-19): read only by the run-form `tab_list`, over the calling run's own pages; during
   * a person's hold it gives the address and title as they stood when the hold began. */
  describe(surfaceId: string): { readonly url: string; readonly title: string } | null;
  /** EY-1 (7b, 2026-11-19): the page's class by its profile, "signed-in" for the desk's persistent
   * profile; null for a surface with no browser page. */
  pageClass(surfaceId: string): PageClass | null;
  /** EY-1 (7b): the page's size and density, which a tab or pop-up it opens takes; absent or null:
   * PAGES_MADE_VIEWPORT's */
  view?(surfaceId: string): PagesView | null;
}

/** The run's own panes (BU-19). Told when a run lets a page go, the store closes the pane if the
 * run made it; a page from the desk is not its to close. */
export interface PagesPanesPort {
  pageClosed(run: string, surfaceId: string): Promise<void>;
  /** Whether the run made the page: a made pane is closed, never given back. */
  made(run: string, surfaceId: string): boolean;
  /** A resumed run's panes follow it to its new key; false: custody kept them under the old one. */
  runRebound(from: string, to: string): boolean;
}

/** EY-1 (7b, 2026-11-19): why a run's new pane was not made (the endpoint's MAKE_REFUSALS). */
export type PagesMakeRefusal =
  | "outside-window"
  | "no-window"
  | "run-full"
  | "desk-full"
  | "address";

export type PagesMakeAnswer =
  | { readonly ok: true; readonly pageId: string; readonly targetId: string }
  | { readonly ok: false; readonly refused: PagesMakeRefusal };

/** How a made page went before a window adopted it (custody's LiveSurfaceMadeGone). `failed` (2026-11-24) is a
 * page that could not start or crashed: the desk may well be open, so it is never said as "no window". */
export type PagesMadeGone = "grace" | "declined" | "run-end" | "failed";

/** What a run's new page is made of: its run, its address, how it came, and its size. */
export interface PagesMakeOrder extends PagesView {
  readonly run: string;
  readonly url: string;
  readonly by: ShellSurfacesMadePane["by"];
}

/** Custody's own refusals of a make: no product window; no room on the desk; or (2026-11-24) the
 * run has ended in custody, which is never a window's fault. */
export type PagesMakeOutcome =
  | { readonly ok: true; readonly surfaceId: string }
  | { readonly ok: false; readonly refused: "no-window" | "desk-full" | "run-ended" };

/** EY-1 (7b): custody's half of a run's own panes (main's live-surface authority). */
export interface PagesMakerPort {
  /** a page for the run in its own session, held until a window adopts it; refused in custody's
   * own order: the run ended, no window, no room on the desk. The broker asks nothing of the desk
   * before it (2026-11-24): a desk with no window has no room, and the word was the desk's. */
  make(o: PagesMakeOrder): PagesMakeOutcome;
  /** the one address rule a run's page opens at (the browser surface's top-level rule) */
  addressAllowed(url: string): boolean;
  /** the run has ended: custody lets its held pages go, and clears its session after its last */
  runEnded(run: string): void;
  /** EY-1 (S1, 2026-11-24): an answer naming the page in `made` is on its way to the run: the run uses the page
   * from now, so custody holds it for its run and its adopt grace no longer ends it. Absent: custody keeps its
   * grace. */
  named?(run: string, surfaceId: string): void;
}

/** The bridge as the broker drives it (the endpoint's run routes and grants). */
export interface PagesBridgePort {
  /** The run's route, added if it has none (again after a revoke). */
  addRun(run: string): void;
  /** Mints the run's ONE key for this launch: its keyed URL goes to the launch and nowhere else. */
  arm(run: string): { readonly url: string; readonly epoch: number };
  /** Whether a spent key was presented again on the run's route (the race). */
  raced(run: string): boolean;
  revokeRun(run: string): Promise<void>;
  /** Hands the page to the run's client, answering the target id the engine sees it by. A page it
   * will not grant (one granted already, say) is a refusal, never a throw. */
  grant(run: string, surfaceId: string, lease: PageLease): Promise<PagesGrantAnswer>;
  endGrant(run: string, surfaceId: string): Promise<void>;
  /** Says a granted page to the run's client again (2026-11-24): for a page the engine's own list
   * lacks, asked inside a call's window on it. How many of the run's connections were told; 0 when
   * none listens for targets, and then nothing is waited for. */
  introduce(run: string, surfaceId: string): number;
  /** The refusals the bridge made inside the call's window, in order. */
  refusals(callId: string): readonly CallRefusal[];
}

export type PagesGrantAnswer =
  | { readonly ok: true; readonly targetId: string }
  | { readonly ok: false; readonly refused: string };

/** A still's disk as the broker reads it (2026-11-24): each answer a fact for core/still-folder.ts to
 * judge. The product's is node's fs (broker/index.ts); a row's is a fake. */
export interface PagesStillsPort {
  /** the uid main runs as: a still's folder and its file are its own */
  readonly uid: number;
  /** random bytes for a still's name */
  random(bytes: number): Uint8Array;
  /** what `lstat` says of a path, never followed through a link; null when nothing is there */
  lstat(path: string): Promise<StillEntryFacts | null>;
  /** the file at a path, opened read-only and never through a link: what `fstat` says of the
   * handle, and its first `bytes` bytes when it is a regular file; null when nothing opens so */
  opened(
    path: string,
    bytes: number,
  ): Promise<{ readonly facts: StillFileFacts; readonly head: Uint8Array } | null>;
  /** removes what stands at a name main minted, for a still no answer names; its failure is nothing */
  remove(path: string): Promise<void>;
}

/** The run's engine on the bridge (2026-11-24): main's keyring, as the broker reads it. */
export interface PagesLinkPort {
  /** Whether a connection that spent the key of `epoch` on the run's route still stands. A route
   * revoked and added again counts its epochs afresh, and only its own connections are read. */
  liveAt(run: string, epoch: number): boolean;
}

/** Why a page is not given back: the person holds it; the run holds no grant of it (a second
 * giveBack meets this too); or the run made it, and a made pane is closed, never given back. */
export type PagesGiveBackRefusal = "held" | "not-granted" | "made";

export type PagesGiveBackAnswer =
  | { readonly ok: true }
  | { readonly ok: false; readonly refused: PagesGiveBackRefusal };

export type PagesWindowsPort = Pick<
  Windows,
  | "lease"
  | "unlease"
  | "open"
  | "adopt"
  | "close"
  | "closeCall"
  | "hold"
  | "putDown"
  | "drain"
  | "drained"
  | "history"
  | "state"
>;

export type PagesEnginesPort = Pick<
  PagesEngineSupervisor,
  "ensure" | "stop" | "replace" | "stopAll" | "stats" | "onExit"
>;

export interface PagesBrokerDeps {
  readonly targets: PagesTargetsPort;
  readonly bridge: PagesBridgePort;
  /** the engine's own connection on the bridge, asked before each send (2026-11-24) */
  readonly link: PagesLinkPort;
  readonly windows: PagesWindowsPort;
  readonly engines: PagesEnginesPort;
  readonly panes?: PagesPanesPort;
  /** EY-1 (7b): absent, a run makes no pane (`no-window`) */
  readonly maker?: PagesMakerPort;
  /** a still's disk (2026-11-24); absent, no folder can be judged and every still is refused */
  readonly stills?: PagesStillsPort;
  readonly madePollMs?: number;
  readonly popupWaitMs?: number;
  readonly exchange?: typeof exchangeDaemon;
  readonly connect?: DaemonExchangeOptions["connect"];
  readonly now?: () => number;
  readonly newCallId?: () => string;
  readonly marginMs?: number;
  readonly drainMs?: number;
  readonly idleReapMs?: number;
  /** Durations, sizes and states only. */
  readonly log?: (event: string, fields: Readonly<Record<string, number | string>>) => void;
  /** A call main's own wall refused that fieldd's room should have: its event, run and surface,
   * never an address, a title or a path. */
  readonly warn?: (event: string, fields: Readonly<Record<string, number | string>>) => void;
}

export interface PagesBroker {
  control(
    p: ShellSurfacesControlParams,
    ctx: { readonly signal: AbortSignal; readonly deadlineAt: number },
  ): Promise<ShellSurfacesControlResult>;
  /** An agent's close of a page the person handed the run (the endpoint, on its close of the
   * page's target). Answered at once: the call whose engine sent the close holds the run's turn. */
  giveBack(run: string, surfaceId: string): PagesGiveBackAnswer;
  /** EY-1 (7b, 2026-11-19): the endpoint's new pane for the run: a tab its engine opens inside the
   * act window of the call `callId`, from that call's page. Answered at once, as giveBack is. */
  make(o: {
    readonly runKey: string;
    readonly callId: string;
    readonly url: string;
  }): Promise<PagesMakeAnswer>;
  /** EY-1 (7b): the endpoint's close of a pane the run made; a page it did not make is untouched */
  closeMade(run: string, surfaceId: string): Promise<void>;
  /** EY-1 (7b): custody let a page made for the run go before any window adopted it */
  madeGone(run: string, surfaceId: string, why: PagesMadeGone): void;
  /** The bridge's word (2026-11-24) that a connection on the run's route closed, said once the
   * keyring has let it go. The broker reads for itself whether it was its engine's. */
  bridgeClosed(run: string): void;
  /** Ends every run the broker holds, as the run form's close ends one (2026-11-24, a fieldd that
   * was replaced): how many it held, and how many of those did not end by `deadlineAt` because a
   * call still held their turn. */
  endEveryRun(deadlineAt: number): Promise<{ runs: number; unended: number }>;
  stop(reason: "quit" | "shell-exit"): Promise<void>;
  stats(): { engines: number; starts: number; exits: number; raced: number; calls: number };
}

interface Grant {
  readonly surfaceId: string;
  readonly lease: PageLease;
  readonly targetId: string;
  readonly unsubscribe: () => void;
  /** given back: its grant ends when the call holding its window has its answer */
  givenBack: boolean;
  /** EY-1 (7b): a made pane its client closed while a call held its window: its grant ends, and
   * custody closes it, when that call has its answer */
  closing: boolean;
}

interface Run {
  readonly key: string;
  tail: Promise<void>;
  /** the engine generation launched with a key; 0: none */
  launched: number;
  /** the epoch of the key that launch armed, which the engine's connection spent; 0 with none */
  armed: number;
  /** the calls in a row the launched engine left unanswered by their deadlines */
  unanswered: number;
  /** when main last sent the run's engine a command, or had its answer: where the engine counts
   * its own idle time from, and so the reap */
  engineAt: number;
  readonly grants: Map<string, Grant>;
  /** a resumed run's pages, each granted again at this run's first call on it */
  readonly moved: Set<string>;
  /** the page of the run's last page call */
  current: string | null;
  /** EY-1 (7b): the panes made for the run, waiting for a window or granted. The broker's own
   * record of whose they are (2026-11-24): a pane stays in it until it is closed for the run or
   * custody says it went, whatever custody's record says meanwhile. */
  readonly made: Set<string>;
  /** the run's own pages whose last call answered gone: a second gone running closes the page */
  readonly gone: Set<string>;
  /** the pop-ups its policy allowed that are not made or refused yet */
  pending: number;
  busy: number;
  reap: ReturnType<typeof setTimeout> | null;
}

/** A refused pop-up's reason, as `capped` counts it. */
type CappedWhy = "runFull" | "deskFull" | "address" | "noWindow";

/** A made page's wait: bound by a window, gone by custody's word, or past its deadline. */
type Bound =
  | { readonly kind: "bound"; readonly binding: PagesBinding }
  | { readonly kind: "gone"; readonly why: PagesMadeGone }
  | { readonly kind: "deadline" }
  | { readonly kind: "cancelled" };

/** Why the broker made no pane: the endpoint's five words, and two more (2026-11-24) that only the run form's
 * open is told as themselves: the run's own end, and a page that failed to start. */
type MakeRefused = PagesMakeRefusal | "run-ended" | "failed";

type MadeAnswer =
  | { readonly ok: true; readonly pageId: string; readonly targetId: string }
  | { readonly ok: false; readonly refused: MakeRefused };

/** A refused pop-up's count, by the make's word. A run that ended first is `noWindow`, as that
 * count's contract says (ShellSurfacesCapped). */
const CAPPED_BY: Readonly<Record<MakeRefused, CappedWhy>> = {
  "outside-window": "noWindow",
  "no-window": "noWindow",
  "run-ended": "noWindow",
  // a pop-up whose page failed to start: the count has no word nearer than this one
  failed: "noWindow",
  "run-full": "runFull",
  "desk-full": "deskFull",
  address: "address",
};

/** The size of a pane made with no page to open it from. */
const MADE_VIEW: PagesView = {
  logicalViewport: PAGES_MADE_VIEWPORT,
  deviceScaleFactor: PAGES_MADE_DEVICE_SCALE,
};

/** Why a still's folder or file was refused: the guard's own words, and the broker's four (the call
 * named no folder; main has no disk to read one; the minted name was taken; the engine said it wrote
 * and nothing opens there is `not-a-file`). */
type NoStill = StillRefusal | "no-folder" | "no-disk" | "name-taken";

type Outcome =
  | {
      readonly kind: "reply";
      readonly exchange: PagesDaemonExchange;
      /** the still this call's screenshot wrote, judged */
      readonly still?: StillAnswer;
    }
  /** the screenshot's still was refused: before the send (its name was taken), or as written */
  | { readonly kind: "no-still"; readonly reason: NoStill }
  | { readonly kind: "no-switch" }
  | { readonly kind: "held" }
  /** the engine left the bridge, or exited, under the call */
  | { readonly kind: "engine-gone" }
  | { readonly kind: "deadline" }
  | { readonly kind: "cancelled" };

/** A command as the broker sends it, before its id. */
type Outgoing = { readonly action: string; readonly [field: string]: unknown };

/** A part of a still's folder that is not there: no directory, so the guard refuses it. */
const NO_ENTRY: StillEntryFacts = Object.freeze({ kind: "other", uid: -1, mode: 0 });

const refused = (fact: ShellSurfacesControlRefusalFact): ShellSurfacesControlResult => ({
  status: "refused",
  fact,
});

/** The engine's active tab's target id, from `tab_list`'s reply (browser.rs:1755-1771 at
 * v0.41.0). */
export function activeTargetOf(data: unknown): string | null {
  const tabs = (data as { tabs?: unknown } | null)?.tabs;
  if (!Array.isArray(tabs)) return null;
  for (const tab of tabs) {
    const t = tab as { active?: unknown; targetId?: unknown } | null;
    if (t?.active === true && typeof t.targetId === "string") return t.targetId;
  }
  return null;
}

/** Whether the engine holds a tab by this target id, from `tab_list`'s reply. */
export function listsTarget(data: unknown, targetId: string): boolean {
  const tabs = (data as { tabs?: unknown } | null)?.tabs;
  if (!Array.isArray(tabs)) return false;
  return tabs.some((tab) => (tab as { targetId?: unknown } | null)?.targetId === targetId);
}

export class PagesBrokerCore implements PagesBroker {
  readonly #deps: PagesBrokerDeps;
  readonly #runs = new Map<string, Run>();
  /** the call in flight on each page: its id, how to answer it early, its deadline and signal */
  readonly #inFlight = new Map<
    string,
    {
      run: Run;
      callId: string;
      settle: (o: Outcome) => void;
      answerBy: number;
      signal: AbortSignal;
    }
  >();
  /** each run's given-back pages, owed to its next answer */
  readonly #givenBack = new Map<string, string[]>();
  /** EY-1 (7b): each run's own panes made and closed, and its pop-ups refused, owed to its next
   * answer */
  readonly #madeOwed = new Map<string, ShellSurfacesMadePane[]>();
  readonly #closedOwed = new Map<string, string[]>();
  readonly #capped = new Map<string, Partial<Record<CappedWhy, number>>>();
  /** a made page's wait, which custody's word that the page went ends */
  readonly #waits = new Map<string, (why: PagesMadeGone) => void>();
  /** the pop-up policy standing on each page in an act window, and how to end it */
  readonly #policies = new Map<string, () => void>();
  /** EY-1 (7b): the runs whose end is under way: no pane is made for one, and no call starts it */
  readonly #ending = new Set<string>();
  #stopped = false;
  #raced = 0;
  #calls = 0;
  readonly #offExit: () => void;

  constructor(deps: PagesBrokerDeps) {
    this.#deps = deps;
    // an engine's exit is the supervisor's to see and the broker's to hear, from its first engine on
    this.#offExit = deps.engines.onExit((run, generation) => this.#engineExited(run, generation));
  }

  async control(
    p: ShellSurfacesControlParams,
    ctx: { readonly signal: AbortSignal; readonly deadlineAt: number },
  ): Promise<ShellSurfacesControlResult> {
    return this.#carried(p.run, await this.#control(p, ctx));
  }

  async #control(
    p: ShellSurfacesControlParams,
    ctx: { readonly signal: AbortSignal; readonly deadlineAt: number },
  ): Promise<ShellSurfacesControlResult> {
    if (this.#stopped) throw new PagesBrokerError("UNAVAILABLE", "engine-stopped");
    const action = p.command.action;
    const answerBy = ctx.deadlineAt - (this.#deps.marginMs ?? PAGES_ANSWER_MARGIN_MS);
    if (ctx.signal.aborted) throw new PagesBrokerError("TIMEOUT", "cancelled");
    if (answerBy <= this.#now()) throw new PagesBrokerError("TIMEOUT", "deadline");
    // the engine's own start (and its own close, which is no row's) is the broker's alone
    if (action !== "close" && BROKER_OWNED_ACTIONS.includes(action)) {
      throw new PagesBrokerError("PRECONDITION_FAILED", "broker-owned");
    }
    // The allow list (2026-11-24), before anything of the page or the run is read: fieldd's room builds
    // each command from named keys, and this is main's own wall behind it. The line says why and, for
    // an argument, the listed action it came on: never the key, never a value.
    const why = refusedCommand(p.surfaceId === undefined ? "run" : "page", p.command);
    if (why !== null) {
      this.#deps.warn?.("pages.broker.command_refused", {
        run: p.run,
        why,
        ...(why === "argument" ? { action } : {}),
      });
      throw new PagesBrokerError("PRECONDITION_FAILED", "not-allowed");
    }
    if (p.surfaceId === undefined) return this.#runForm(p, answerBy, ctx.signal);
    // EY-1 (7b, 2026-11-19): a page the person hands an agent opens to it at EY-5. Until then a
    // signed-in page is refused before anything of it is read, so the answer is one whatever its
    // state. fieldd's room refuses it first; this is main's own wall behind it.
    if (this.#deps.targets.pageClass(p.surfaceId) === "signed-in") {
      this.#deps.warn?.("pages.broker.signed_in_refused", { run: p.run, surfaceId: p.surfaceId });
      throw new PagesBrokerError("PRECONDITION_FAILED", "signed-in");
    }
    if (action === "close") return this.#closePage(p.run, p.surfaceId, answerBy, ctx.signal);
    // main's own on either form (2026-11-24): the run's pages from its grants, never the engine's list
    if (action === "tab_list") {
      return { status: "done", output: { success: true, data: this.#tabs(p.run) } };
    }
    return this.#pageCall(p, p.surfaceId, answerBy, ctx.signal);
  }

  /** A call on one page: its binding, the run's turn, then the call. */
  async #pageCall(
    p: ShellSurfacesControlParams,
    surfaceId: string,
    answerBy: number,
    signal: AbortSignal,
  ): Promise<ShellSurfacesControlResult> {
    const run = this.#run(p.run);
    const binding = this.#deps.targets.lookup(surfaceId);
    const granted = run.grants.get(surfaceId);
    if (binding === null || (granted !== undefined && moved(granted.lease, binding))) {
      if (granted !== undefined) await this.#endGrant(run, granted);
      // a page at rest has no binding and answers parked; one with no producer is gone
      const parked = binding === null && this.#deps.targets.parked(surfaceId);
      if (this.#own(run, surfaceId)) await this.#unbound(run, surfaceId, binding, parked);
      return refused(parked ? "parked" : "gone");
    }
    if (binding.page.held) return refused("held");
    this.#calls += 1;
    run.current = surfaceId;
    const answer = await this.#queued(run, answerBy, signal, (release) =>
      this.#call(run, surfaceId, binding, p, {
        answerBy,
        signal,
        release,
        seen: granted,
      }),
    );
    // an answered call ends a run of gones on the page, as it does in the room
    if (answer.status === "done") run.gone.delete(surfaceId);
    return answer;
  }

  /** A page the run made that answers parked or gone (2026-11-24): the run's still, or closed for it.
   * At rest, or bound again under another lease: kept in the moved set, so the run's list, a rebind
   * and the run's end see it, and the run's next call grants it again. With no binding and not at
   * rest: closed for the run at once when custody holds no page for the surface, else kept at its
   * first gone and closed at the second running. */
  async #unbound(
    run: Run,
    surfaceId: string,
    binding: PagesBinding | null,
    parked: boolean,
  ): Promise<void> {
    if (parked) {
      run.moved.add(surfaceId);
      return;
    }
    const first = !run.gone.has(surfaceId);
    const kept = binding !== null || this.#deps.targets.describe(surfaceId) !== null;
    if (kept && first) {
      run.gone.add(surfaceId);
      run.moved.add(surfaceId);
      return;
    }
    await this.closeMade(run.key, surfaceId);
  }

  /** The run form, answered by main. Any other run-level call opens the run a pane of its own
   * (BU-19) at about:blank, the size of a person's new pane, and goes on it in a window it holds
   * until it ends. */
  async #runForm(
    p: ShellSurfacesControlParams,
    answerBy: number,
    signal: AbortSignal,
  ): Promise<ShellSurfacesControlResult> {
    const action = p.command.action;
    if (action === "close") {
      await this.#endRun(p.run, answerBy, signal);
      // A run's end ends every hand of it in the room, named or not. Its answer names the handed
      // pages that fit (PAGES_RUN_PANES_MAX), as information; nothing past them is owed.
      const answer = this.#carried(p.run, { status: "done", output: { success: true } });
      this.#givenBack.delete(p.run);
      this.#madeOwed.delete(p.run);
      this.#closedOwed.delete(p.run);
      this.#capped.delete(p.run);
      return answer;
    }
    if (action === "tab_list") {
      return { status: "done", output: { success: true, data: this.#tabs(p.run) } };
    }
    if (action === "rebind") {
      await this.#rebind(p.run, p.command.from, answerBy, signal);
      return { status: "done", output: { success: true } };
    }
    if (action === "tab_new") {
      // ONE pane, at its address, made and answered by main (2026-11-24): the engine's own tab_new on
      // a pane made to carry it would make a second. The run's next call on the page takes the
      // engine to it, as it does for a pop-up; its label is the engine's own and is not kept.
      const asked = p.command.url;
      const url = typeof asked === "string" && asked !== "" ? asked : "about:blank";
      const tab = await this.#runPane(p.run, { url, by: "tab", answerBy, signal });
      const run = this.#runs.get(p.run);
      if (run !== undefined) run.current = tab;
      // The engine was told of the tab at its grant and attaches to it in its next drain (2026-11-24):
      // this call goes on the tab with one read of the engine's, so that drain falls inside the call's
      // own window. With no engine launched there is none to tell.
      if (run !== undefined && run.launched !== 0) await this.#met(p, tab, answerBy, signal);
      // cancelled while the engine met the tab, the answer would reach nobody: TIMEOUT, as an open's
      // does, and the pane stays owed to the run's next answer
      if (signal.aborted) throw new PagesBrokerError("TIMEOUT", "cancelled");
      return { status: "done", output: { success: true } };
    }
    // The pane is made blank and the engine takes it to the address; the run is told the address it
    // was opened at (2026-11-24), when it is one a made pane may be named at and main's rule makes a
    // page at. Otherwise about:blank, where it stands.
    const asked = action === "navigate" ? p.command.url : undefined;
    const named =
      typeof asked === "string" &&
      LiveSurfaceUrlV1.safeParse(asked).success &&
      this.#deps.maker?.addressAllowed(asked) === true
        ? asked
        : "about:blank";
    const pane = await this.#runPane(p.run, {
      url: "about:blank",
      named,
      by: "open",
      answerBy,
      signal,
    });
    return this.#pageCall(p, pane, answerBy, signal);
  }

  /** The run's engine meets a tab the run form's `tab_new` made (2026-11-24): a call on the tab, of the
   * making call's own kind, with one read of the engine's. Its window opens in the turn of the tab's
   * grant when the run's turn is free, and the engine's drain at that read attaches to the tab inside
   * it. Whatever the read answers is not the tab's: the pane is made and the run is told so, and a
   * tab the engine did not come to hold is said to it again at the run's next call on it. A cancel
   * from fieldd is the call's own, and its caller answers it. */
  async #met(
    p: ShellSurfacesControlParams,
    surfaceId: string,
    answerBy: number,
    signal: AbortSignal,
  ): Promise<void> {
    const read: ShellSurfacesControlParams = {
      run: p.run,
      surfaceId,
      window: p.window,
      command: { action: "url" },
    };
    await this.#pageCall(read, surfaceId, answerBy, signal).catch(() => undefined);
  }

  /** A pane the run form makes for the run, the size of a person's new pane: its surface, or the
   * call's error by why none was made. Cancelled while it was made, the pane goes. */
  async #runPane(
    key: string,
    o: {
      readonly url: string;
      /** the address the run is told the pane is at, when it is not the one it is made at */
      readonly named?: string;
      readonly by: "open" | "tab";
      readonly answerBy: number;
      readonly signal: AbortSignal;
    },
  ): Promise<string> {
    // the call's own pane is the first its answer names (2026-11-24): the room reads the first made
    // pane of a run-form open or tab as the page that call made, and a pop-up's pane owed from
    // before rode ahead of it
    const made = await this.#make(key, { ...o, view: MADE_VIEW, first: true });
    if (o.signal.aborted) {
      // cancelled while its pane was made: the pane goes, and nothing runs on it
      if (made.ok) await this.closeMade(key, made.pageId);
      throw new PagesBrokerError("TIMEOUT", "cancelled");
    }
    if (made.ok) return made.pageId;
    switch (made.refused) {
      case "run-ended":
        // main's own wall behind fieldd's room, which ends a run in main only at its true end
        this.#deps.warn?.("pages.broker.run_ended_refused", { run: key });
        throw new PagesBrokerError("UNAVAILABLE", "engine-stopped");
      case "failed":
        // the page could not start (a loaded machine does it) and a window may be open: said as a start that
        // has not finished, which is retryable and sends nobody to open a window they already have. A throw,
        // not an answer: panes owed from before stay owed to the call they belong to
        throw new PagesBrokerError("UNAVAILABLE", "engine-starting");
      case "no-window":
      case "outside-window":
        throw new PagesBrokerError("UNAVAILABLE", "no-window");
      case "address":
        // fieldd's room holds an address to its own rule first; this is main's rule behind it
        throw new PagesBrokerError("PRECONDITION_FAILED", "address");
      default:
        throw new PagesBrokerError("RESOURCE_EXHAUSTED", made.refused);
    }
  }

  async make(o: {
    readonly runKey: string;
    readonly callId: string;
    readonly url: string;
  }): Promise<PagesMakeAnswer> {
    // a tab opens from the page of the call that holds the act window, and takes its size, its
    // deadline and its signal
    let opener: string | null = null;
    let call: { readonly answerBy: number; readonly signal: AbortSignal } | null = null;
    for (const [surfaceId, flight] of this.#inFlight) {
      if (flight.callId !== o.callId) continue;
      opener = surfaceId;
      call = flight;
    }
    const granted = opener !== null && this.#runs.get(o.runKey)?.grants.has(opener) === true;
    if (opener === null || call === null || !granted) {
      return { ok: false, refused: "outside-window" };
    }
    const made = await this.#make(o.runKey, {
      url: o.url,
      by: "tab",
      answerBy: call.answerBy,
      signal: call.signal,
      view: this.#viewOf(opener),
      opener: { surfaceId: opener, callId: o.callId },
    });
    if (made.ok) return made;
    // the endpoint's five words: to a client, a run that has ended has no window to take its tab, and neither
    // has a page that failed to start
    return {
      ok: false,
      refused:
        made.refused === "run-ended" || made.refused === "failed" ? "no-window" : made.refused,
    };
  }

  async closeMade(key: string, surfaceId: string): Promise<void> {
    const run = this.#runs.get(key);
    if (run === undefined || !this.#own(run, surfaceId)) return;
    run.made.delete(surfaceId);
    run.moved.delete(surfaceId);
    run.gone.delete(surfaceId);
    if (run.current === surfaceId) run.current = null;
    this.#oweGone(key, surfaceId);
    const grant = run.grants.get(surfaceId);
    // a call holding the page's window ends the grant once it has its answer, so the call answers
    // as its engine did, never `gone`
    if (grant !== undefined && this.#inFlight.has(surfaceId)) {
      grant.closing = true;
      return;
    }
    if (grant !== undefined) await this.#endGrant(run, grant);
    await this.#deps.panes?.pageClosed(key, surfaceId).catch(() => undefined);
  }

  /** A made pane its client closed while a call held its window, once that call has its answer:
   * its grant ends, and custody closes it. */
  async #closeAfterCall(run: Run, grant: Grant): Promise<void> {
    if (run.grants.get(grant.surfaceId) !== grant) return;
    await this.#endGrant(run, grant);
    await this.#deps.panes?.pageClosed(run.key, grant.surfaceId).catch(() => undefined);
  }

  madeGone(run: string, surfaceId: string, why: PagesMadeGone): void {
    const wait = this.#waits.get(surfaceId);
    if (wait !== undefined) wait(why);
    const held = this.#runs.get(run);
    held?.made.delete(surfaceId);
    held?.gone.delete(surfaceId);
    // EY-1 (S1, 2026-11-24): a made page is bound, granted and owed to its run's next answer before any window has
    // it, so custody's grace can end it before that answer comes. The run is never told of a page that is gone: it
    // is no longer the run's current page, and its owed word goes with it. A pop-up's is counted as one no window
    // took in time, while main still holds its run.
    if (held?.current === surfaceId) held.current = null;
    // 2026-11-24: the page is custody's no more, so its grant ends here. Left standing, a later close
    // (the page form's, which fieldd sends to end the pane it placed, or the run's end) found a
    // grant custody no longer called made, and owed the page in givenBack as a person's. Under a
    // call that holds its window, the grant ends once the call has its answer, as for a client's
    // close.
    held?.moved.delete(surfaceId);
    const grant = held?.grants.get(surfaceId);
    if (held !== undefined && grant !== undefined) {
      if (this.#inFlight.has(surfaceId)) grant.closing = true;
      else void this.#endGrant(held, grant);
    }
    const pane = this.#dropMadeOwed(run, surfaceId);
    if (pane?.by === "popup" && this.#runs.has(run)) this.#cap(run, "noWindow");
  }

  /** EY-1 (7b): one path for every pane a run makes. Refused in order (the address, the run's
   * cap with its pending pop-ups, then custody's own: its window, its desk), made for the run's own
   * session, waited for until a window binds it (custody's word that it went, the call's cancel
   * and its deadline each end the wait, and past the deadline or a cancel the page goes), then
   * granted, while the run still stands. A pop-up's own pending place is not counted against it,
   * and passes into the made set at custody's make. */
  async #make(
    key: string,
    o: {
      readonly url: string;
      /** the address the run is told the pane is at, when it is not the one it is made at */
      readonly named?: string;
      /** owed ahead of the panes the run is already owed: the run form's own pane */
      readonly first?: boolean;
      readonly by: ShellSurfacesMadePane["by"];
      readonly answerBy: number;
      readonly view: PagesView;
      /** the call's own signal: its cancel ends the wait */
      readonly signal?: AbortSignal;
      /** a pop-up's pending place, given up once: at custody's make, or when the make settles */
      readonly placed?: () => void;
      /** BU-19: the page whose call made this one, and that call: the made page shares its window */
      readonly opener?: { readonly surfaceId: string; readonly callId: string };
    },
  ): Promise<MadeAnswer> {
    const maker = this.#deps.maker;
    if (maker === undefined || this.#stopped) return { ok: false, refused: "no-window" };
    if (this.#ending.has(key)) return { ok: false, refused: "run-ended" };
    if (!maker.addressAllowed(o.url)) return { ok: false, refused: "address" };
    const held = this.#runs.get(key);
    const others = (held?.pending ?? 0) - (o.placed === undefined ? 0 : 1);
    if ((held === undefined ? 0 : this.#madeCount(held)) + others >= PAGES_RUN_PANES_MAX) {
      return { ok: false, refused: "run-full" };
    }
    const made = maker.make({ run: key, url: o.url, by: o.by, ...o.view });
    if (!made.ok) return made;
    // the run is held from its first pane: a refusal before custody's make leaves no run behind
    const run = this.#run(key);
    const surfaceId = made.surfaceId;
    const startedAt = this.#now();
    run.made.add(surfaceId);
    // a pop-up's place passes into the made set, so it is never counted twice
    o.placed?.();
    const bound = await this.#bound(surfaceId, o.answerBy, o.signal);
    // the run ended or moved while its page was waited for: the page goes, and nothing is granted
    if (this.#runs.get(key) !== run || this.#stopped || this.#ending.has(key)) {
      run.made.delete(surfaceId);
      await this.#deps.panes?.pageClosed(key, surfaceId).catch(() => undefined);
      this.#deps.log?.("pages.made_refused", { by: o.by, why: "run-gone" });
      return { ok: false, refused: this.#stopped ? "no-window" : "run-ended" };
    }
    if (bound.kind !== "bound") {
      run.made.delete(surfaceId);
      // past the deadline, or cancelled, the page goes: no window's pane waits on a page no run uses
      if (bound.kind !== "gone") {
        await this.#deps.panes?.pageClosed(key, surfaceId).catch(() => undefined);
      }
      const why = bound.kind === "gone" ? bound.why : bound.kind;
      this.#deps.log?.("pages.made_refused", { by: o.by, why });
      const refused =
        why === "declined"
          ? "desk-full"
          : why === "run-end"
            ? "run-ended"
            : why === "failed"
              ? "failed"
              : "no-window";
      return { ok: false, refused };
    }
    let grant: Grant;
    try {
      grant = await this.#grant(run, surfaceId, bound.binding);
    } catch (error) {
      run.made.delete(surfaceId);
      await this.#deps.panes?.pageClosed(key, surfaceId).catch(() => undefined);
      throw error;
    }
    // the run ended while its grant was made: the grant ends, and the page goes
    if (this.#runs.get(key) !== run || this.#ending.has(key)) {
      run.made.delete(surfaceId);
      await this.#endGrant(run, grant);
      await this.#deps.panes?.pageClosed(key, surfaceId).catch(() => undefined);
      return { ok: false, refused: "run-ended" };
    }
    this.#oweMade(key, { surfaceId, url: o.named ?? o.url, by: o.by }, o.first === true);
    // BU-19 (2026-11-24): made while its call's window stands, the page shares it from before the make
    // answers, so the engine's next commands on its new tab are inside a window. A call that has
    // ended, or a page in the person's hand, gives none: the page stays leased, and the run's next
    // call on it opens its own.
    const window = o.opener === undefined ? "none" : this.#adopted(surfaceId, o.opener);
    this.#deps.log?.("pages.made", { by: o.by, ms: this.#now() - startedAt, window });
    return { ok: true, pageId: surfaceId, targetId: grant.targetId };
  }

  /** The made page's share of its making call's window: `call` when it has it, else why not. */
  #adopted(surfaceId: string, opener: { surfaceId: string; callId: string }): string {
    try {
      const verdict = this.#deps.windows.adopt(surfaceId, opener.surfaceId, opener.callId);
      return verdict.ok ? "call" : verdict.code;
    } catch {
      return "refused";
    }
  }

  /** The run's live made panes: those still waited for, and those custody still says are the run's.
   * Counted, never dropped here (2026-11-24): a pane custody let go without a word is no longer live,
   * and is still the run's own until it is closed for the run. */
  #madeCount(run: Run): number {
    let live = 0;
    for (const surfaceId of run.made) {
      if (this.#waits.has(surfaceId) || this.#made(run.key, surfaceId)) live += 1;
    }
    return live;
  }

  #viewOf(surfaceId: string): PagesView {
    return this.#deps.targets.view?.(surfaceId) ?? MADE_VIEW;
  }

  /** A made page's wait for its window's binding, asked every PAGES_MADE_POLL_MS until `until`,
   * or the call's cancel. */
  #bound(surfaceId: string, until: number, signal?: AbortSignal): Promise<Bound> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: () => void = () => undefined;
      const end = (answer: Bound) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.#waits.delete(surfaceId);
        resolve(answer);
      };
      onAbort = () => end({ kind: "cancelled" });
      this.#waits.set(surfaceId, (why) => end({ kind: "gone", why }));
      if (signal?.aborted === true) return end({ kind: "cancelled" });
      signal?.addEventListener("abort", onAbort, { once: true });
      const ask = () => {
        const binding = this.#deps.targets.lookup(surfaceId);
        if (binding !== null) return end({ kind: "bound", binding });
        const left = until - this.#now();
        if (left <= 0 || this.#stopped) return end({ kind: "deadline" });
        timer = setTimeout(ask, Math.min(left, this.#deps.madePollMs ?? PAGES_MADE_POLL_MS));
      };
      ask();
    });
  }

  /** A page's pop-ups while a run's act window stands on it: each decided at once on the run's
   * state (the address, its cap with the pop-ups still pending, the desk's room), a refusal
   * counted for the run's next answer; an allowed one is made as the run's own pane. Ended, it
   * allows nothing, and an open after its end is dropped. */
  #popupPolicy(
    run: Run,
    opener: string,
    callId: string,
  ): { readonly policy: PagesPopups; end(): void } {
    let live = true;
    // allowed and not opened yet: each holds a place in the run's count until it opens, or the
    // policy ends
    let allowed = 0;
    // a count for a run main no longer holds is dropped
    const cap = (why: CappedWhy) => {
      if (this.#runs.get(run.key) === run) this.#cap(run.key, why);
    };
    const policy: PagesPopups = {
      decide: (url) => {
        const maker = this.#deps.maker;
        if (!live || maker === undefined) return "deny";
        // the window and the desk are custody's to refuse at the make, in its own order, and the
        // pop-up is counted by that word (2026-11-24: the desk was asked here, before any window)
        const why: CappedWhy | null = !maker.addressAllowed(url)
          ? "address"
          : this.#madeCount(run) + run.pending >= PAGES_RUN_PANES_MAX
            ? "runFull"
            : null;
        if (why !== null) {
          cap(why);
          return "deny";
        }
        run.pending += 1;
        allowed += 1;
        return "allow";
      },
      open: (url) => {
        if (!live || allowed === 0) return;
        allowed -= 1;
        let placed = false;
        const release = () => {
          if (placed) return;
          placed = true;
          run.pending = Math.max(0, run.pending - 1);
        };
        const answerBy = this.#now() + (this.#deps.popupWaitMs ?? PAGES_POPUP_WAIT_MS);
        const view = this.#viewOf(opener);
        const made = { surfaceId: opener, callId };
        void this.#make(run.key, {
          url,
          by: "popup",
          answerBy,
          view,
          placed: release,
          opener: made,
        })
          .then(
            (made) => {
              if (!made.ok) cap(CAPPED_BY[made.refused]);
            },
            // a make that throws is a fault, not the pop-up's refusal: said, and counted nowhere
            (error: unknown) => {
              this.#deps.warn?.("pages.broker.popup_failed", { kind: kindOf(error) });
            },
          )
          .finally(release);
      },
    };
    return {
      policy,
      end: () => {
        live = false;
        run.pending = Math.max(0, run.pending - allowed);
        allowed = 0;
      },
    };
  }

  /** The run's pages: those it holds a grant of, and a resumed run's moved ones, as their producers
   * describe them. A page with no producer state is left out. */
  #tabs(key: string): {
    tabs: { surfaceId: string; url: string; title: string }[];
    current: string | null;
  } {
    const run = this.#runs.get(key);
    if (run === undefined) return { tabs: [], current: null };
    const tabs: { surfaceId: string; url: string; title: string }[] = [];
    for (const surfaceId of new Set([...run.grants.keys(), ...run.moved])) {
      const page = this.#deps.targets.describe(surfaceId);
      if (page !== null) tabs.push({ surfaceId, url: page.url, title: page.title });
    }
    return { tabs, current: run.current };
  }

  /** The page form's `close`: this page's end for this run, in the run's turn, with no engine
   * call. */
  async #closePage(
    key: string,
    surfaceId: string,
    answerBy: number,
    signal: AbortSignal,
  ): Promise<ShellSurfacesControlResult> {
    const run = this.#runs.get(key);
    if (run !== undefined) {
      await this.#queued(run, answerBy, signal, async (release) => {
        try {
          // the run's own by the broker's record, read before the moved set lets the page go
          const own = this.#own(run, surfaceId);
          const wasMoved = run.moved.delete(surfaceId);
          run.gone.delete(surfaceId);
          if (run.current === surfaceId) run.current = null;
          const grant = run.grants.get(surfaceId);
          // a handed page that leaves the run is named in givenBack; a made one is the store's, and
          // named in closed
          if (own) {
            run.made.delete(surfaceId);
            this.#oweGone(key, surfaceId);
          } else if (wasMoved || grant !== undefined) {
            this.#owe(key, surfaceId);
          }
          if (grant !== undefined) await this.#endGrant(run, grant);
        } finally {
          release();
        }
      });
    }
    await this.#deps.panes?.pageClosed(key, surfaceId).catch(() => undefined);
    return { status: "done", output: { success: true } };
  }

  /** A resumed run's rebind, refused unless `from` is a run main holds, other than this one, and
   * this run has no pages of its own yet: two live runs never merge. It runs in the OLD run's turn,
   * after that run's calls have had their engine's answers, and holds its guard again there: the
   * old route is revoked between calls, never under one. The old engine is stopped, so its key
   * dies with it; its pages move to this run, each granted again at this run's first call on it,
   * before this run's engine starts. */
  async #rebind(to: string, from: unknown, answerBy: number, signal: AbortSignal): Promise<void> {
    const old = typeof from === "string" && from !== to ? this.#runs.get(from) : undefined;
    const refuse = () => new PagesBrokerError("PRECONDITION_FAILED", "rebind-refused");
    if (old === undefined || this.#holds(to)) throw refuse();
    await this.#queued(old, answerBy, signal, async (release) => {
      try {
        if (this.#runs.get(old.key) !== old || this.#holds(to)) throw refuse();
        const pages = new Set([...old.grants.keys(), ...old.moved]);
        // a made page still waited for closes as the old run's; the run never saw it, so it is not
        // named
        const waiting = [...old.made].filter((surfaceId) => !pages.has(surfaceId));
        // the old key names no run before its waits end, as at a run's end: a wait ended here finds
        // its run gone, so a pop-up's page still waited for is counted on no answer
        if (this.#runs.get(old.key) === old) this.#runs.delete(old.key);
        for (const surfaceId of waiting) {
          this.#waits.get(surfaceId)?.("run-end");
          await this.#deps.panes?.pageClosed(old.key, surfaceId).catch(() => undefined);
        }
        await this.#teardown(old);
        const run = this.#run(to);
        for (const surfaceId of pages) run.moved.add(surfaceId);
        // what the old key gave back and never answered rides the new key's answers
        const owed = this.#givenBack.get(old.key);
        this.#givenBack.delete(old.key);
        if (owed !== undefined) {
          this.#givenBack.set(to, [...(this.#givenBack.get(to) ?? []), ...owed]);
        }
        run.current = old.current;
        this.#moveOwed(old.key, to);
        // custody moves the run's record to the new key; a key the same as the old was refused
        // above, so custody's refusal here is a real one
        const rebound = this.#deps.panes?.runRebound(old.key, to) ?? true;
        const known = [...old.made].filter((surfaceId) => pages.has(surfaceId));
        for (const surfaceId of known) {
          if (rebound) {
            run.made.add(surfaceId);
            continue;
          }
          // custody kept the record under the old id: the run's panes close as the old run's
          run.moved.delete(surfaceId);
          if (run.current === surfaceId) run.current = null;
          this.#oweGone(to, surfaceId);
          await this.#deps.panes?.pageClosed(old.key, surfaceId).catch(() => undefined);
        }
        // custody keeps no record of a run that made no pane, and refuses its move: nothing to say
        if (!rebound && known.length > 0) {
          this.#deps.warn?.("pages.broker.rebind_refused", { run: to });
        }
      } finally {
        release();
      }
    });
  }

  /** Whether the run holds pages of its own, or has a call in flight. */
  #holds(key: string): boolean {
    const run = this.#runs.get(key);
    return run !== undefined && (run.grants.size > 0 || run.moved.size > 0 || run.busy > 0);
  }

  giveBack(key: string, surfaceId: string): PagesGiveBackAnswer {
    const run = this.#runs.get(key);
    const grant = run?.grants.get(surfaceId);
    if (run === undefined || grant === undefined || grant.givenBack) {
      return { ok: false, refused: "not-granted" };
    }
    if (this.#own(run, surfaceId)) return { ok: false, refused: "made" };
    if (this.#deps.targets.lookup(surfaceId)?.page.held === true) {
      return { ok: false, refused: "held" };
    }
    grant.givenBack = true;
    if (run.current === surfaceId) run.current = null;
    // A call holding the page's window ends the grant itself once it has its answer, so the
    // window closes by the call's end and the call answers as its engine did, never `gone`.
    // With no call on the page, the grant ends here, outside the run's turn: another call may
    // hold that turn on another page, and this ends only this page's lease and grant.
    if (!this.#inFlight.has(surfaceId)) void this.#handBack(run, grant);
    return { ok: true };
  }

  /** A given-back page's grant ends, once, and the run's next answer owes it. */
  async #handBack(run: Run, grant: Grant): Promise<void> {
    if (run.grants.get(grant.surfaceId) !== grant) return;
    this.#owe(run.key, grant.surfaceId);
    await this.#endGrant(run, grant);
  }

  /** A handed page leaving the run, owed to the run's next answer in `givenBack`. */
  #owe(key: string, surfaceId: string): void {
    const owed = this.#givenBack.get(key) ?? [];
    owed.push(surfaceId);
    this.#givenBack.set(key, owed);
  }

  /** Whether custody says the run made the page. */
  #made(key: string, surfaceId: string): boolean {
    return this.#deps.panes?.made(key, surfaceId) === true;
  }

  /** Whether the page is the run's own: one main made for it, which is the pane store's to close and
   * is never given back. The broker's own record first (2026-11-24), then custody's word. */
  #own(run: Run, surfaceId: string): boolean {
    return run.made.has(surfaceId) || this.#made(run.key, surfaceId);
  }

  /** The run's owed given-back pages ride its next answer, whichever call that is, beside any
   * the answer names itself, at most PAGES_RUN_PANES_MAX in all; the rest wait for the answer
   * after. A thrown answer owes on. */
  #carried(key: string, result: ShellSurfacesControlResult): ShellSurfacesControlResult {
    let answer = result;
    const givenBack = take(this.#givenBack, key, result.givenBack);
    if (givenBack !== undefined) answer = { ...answer, givenBack };
    const made = take(this.#madeOwed, key, result.made);
    if (made !== undefined) {
      answer = { ...answer, made };
      // EY-1 (S1, 2026-11-24): the run is told of these panes with this answer and uses them from now. Custody hears
      // it, and holds each for its run past its adopt grace; its own fault never fails the run's answer
      for (const pane of made) {
        try {
          this.#deps.maker?.named?.(key, pane.surfaceId);
        } catch {
          // custody's grace stands for the pane
        }
      }
    }
    const closed = take(this.#closedOwed, key, result.closed);
    if (closed !== undefined) answer = { ...answer, closed };
    const capped = this.#capped.get(key);
    if (capped !== undefined) {
      this.#capped.delete(key);
      answer = { ...answer, capped };
    }
    return answer;
  }

  /** A made pane, owed to the run's next answer in the order made; `first`, ahead of the rest. */
  #oweMade(key: string, pane: ShellSurfacesMadePane, first = false): void {
    const owed = this.#madeOwed.get(key) ?? [];
    this.#madeOwed.set(key, first ? [pane, ...owed] : [...owed, pane]);
  }

  #oweClosed(key: string, surfaceId: string): void {
    this.#closedOwed.set(key, [...(this.#closedOwed.get(key) ?? []), surfaceId]);
  }

  /** A made pane's owed `made` word, taken back: the pane it named, or nothing when no word was
   * owed (an answer has named it, or it was never owed one). */
  #dropMadeOwed(key: string, surfaceId: string): ShellSurfacesMadePane | undefined {
    const owed = this.#madeOwed.get(key);
    const at = owed?.findIndex((pane) => pane.surfaceId === surfaceId) ?? -1;
    if (owed === undefined || at < 0) return undefined;
    const [pane] = owed.splice(at, 1);
    if (owed.length === 0) this.#madeOwed.delete(key);
    return pane;
  }

  /** A made pane main closes, on the run's next answer (2026-11-24): named in `closed` when an answer
   * has named it in `made`; when none has, its owed `made` goes and it is named in neither, so the
   * run is never told of a pane that is gone, nor told one closed that it never had. */
  #oweGone(key: string, surfaceId: string): void {
    if (this.#dropMadeOwed(key, surfaceId) === undefined) this.#oweClosed(key, surfaceId);
  }

  #cap(key: string, why: CappedWhy): void {
    const capped = this.#capped.get(key) ?? {};
    capped[why] = (capped[why] ?? 0) + 1;
    this.#capped.set(key, capped);
  }

  /** What a resumed run's old key owes, on its new key. */
  #moveOwed(from: string, to: string): void {
    for (const owed of [this.#madeOwed, this.#closedOwed] as Map<string, unknown[]>[]) {
      const old = owed.get(from);
      owed.delete(from);
      if (old !== undefined) owed.set(to, [...(owed.get(to) ?? []), ...old]);
    }
    const capped = this.#capped.get(from);
    this.#capped.delete(from);
    if (capped !== undefined) {
      const into = this.#capped.get(to) ?? {};
      for (const why of Object.keys(capped) as CappedWhy[]) {
        into[why] = (into[why] ?? 0) + (capped[why] ?? 0);
      }
      this.#capped.set(to, into);
    }
  }

  bridgeClosed(key: string): void {
    const run = this.#runs.get(key);
    // nothing launched: a route main revoked itself, or a socket of an engine already known gone
    if (run === undefined || run.launched === 0) return;
    // another connection of the run's (an older route's socket, closing late): the engine's stands
    if (this.#deps.link.liveAt(key, run.armed)) return;
    this.#offBridge(run, "bridge-closed");
  }

  /** The supervisor's word that an engine exited. Only the generation the run launched is its
   * engine; the exit is the supervisor's to count, and the engine is gone, so nothing is stopped. */
  #engineExited(key: string, generation: number): void {
    const run = this.#runs.get(key);
    if (run === undefined || run.launched !== generation) return;
    this.#unlaunch(run);
    this.#deps.log?.("pages.engine.gone", { why: "exit" });
    this.#failFlights(run);
  }

  /** The run's engine is not on the bridge (or hangs) while its process may live: nothing is
   * launched, the calls in flight fail, the route is revoked so no socket of it stands, and the
   * engine is ended with the run's count of exits kept. Once per launch. */
  #offBridge(run: Run, why: "bridge-closed" | "off-bridge" | "hung"): void {
    if (run.launched === 0) return;
    this.#unlaunch(run);
    this.#deps.log?.("pages.engine.gone", { why });
    this.#failFlights(run);
    void this.#deps.bridge.revokeRun(run.key).catch(() => undefined);
    void this.#deps.engines.replace(run.key).catch(() => undefined);
  }

  /** Nothing is launched for the run: its next call arms a key and launches. */
  #unlaunch(run: Run): void {
    run.launched = 0;
    run.armed = 0;
    run.unanswered = 0;
  }

  /** The calls in flight on the run's pages answer that their engine is gone. */
  #failFlights(run: Run): void {
    for (const flight of [...this.#inFlight.values()]) {
      if (flight.run === run) flight.settle({ kind: "engine-gone" });
    }
  }

  /** A call the engine left unanswered by its deadline; PAGES_HUNG_CALLS in a row end it. */
  #unansweredBy(run: Run): void {
    if (run.launched === 0) return;
    run.unanswered += 1;
    if (run.unanswered >= PAGES_HUNG_CALLS) this.#offBridge(run, "hung");
  }

  async endEveryRun(deadlineAt: number): Promise<{ runs: number; unended: number }> {
    const keys = [...this.#runs.keys()];
    if (keys.length === 0 || this.#stopped) return { runs: 0, unended: 0 };
    // main's own act, answered to nobody: no call's cancel ends it, and its bound is its own
    const never = new AbortController().signal;
    const ended = await Promise.all(
      keys.map(async (key) => {
        try {
          await this.#endRun(key, deadlineAt, never);
        } catch {
          // its turn did not come in time: a call still holds the run's engine, and is not cut off
          return false;
        }
        // no room is left to hear what the run was owed
        this.#givenBack.delete(key);
        this.#madeOwed.delete(key);
        this.#closedOwed.delete(key);
        this.#capped.delete(key);
        return true;
      }),
    );
    const unended = ended.filter((done) => !done).length;
    this.#deps.log?.("pages.broker.runs_ended", { runs: keys.length, unended });
    return { runs: keys.length, unended };
  }

  async stop(reason: "quit" | "shell-exit"): Promise<void> {
    this.#stopped = true;
    this.#offExit();
    const runs = [...this.#runs.values()];
    this.#runs.clear();
    this.#givenBack.clear();
    this.#madeOwed.clear();
    this.#closedOwed.clear();
    this.#capped.clear();
    for (const end of this.#policies.values()) end();
    this.#policies.clear();
    // every run at once: a quit waits for the slowest engine, never for their sum
    await Promise.all(runs.map((run) => this.#teardown(run)));
    const { unended } = await this.#deps.engines.stopAll();
    this.#deps.log?.("pages.broker.stop", { reason, runs: runs.length, unended });
  }

  stats(): { engines: number; starts: number; exits: number; raced: number; calls: number } {
    return { ...this.#deps.engines.stats(), raced: this.#raced, calls: this.#calls };
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)();
  }

  #run(key: string): Run {
    let run = this.#runs.get(key);
    // a run whose end is under way is never started again: its engine has stopped (2026-11-24: this
    // said no-window, of a run whose window stands)
    if (run === undefined && this.#ending.has(key)) {
      throw new PagesBrokerError("UNAVAILABLE", "engine-stopped");
    }
    if (run === undefined) {
      run = {
        key,
        tail: Promise.resolve(),
        launched: 0,
        armed: 0,
        unanswered: 0,
        engineAt: 0,
        grants: new Map(),
        moved: new Set(),
        current: null,
        busy: 0,
        reap: null,
        made: new Set(),
        gone: new Set(),
        pending: 0,
      };
      this.#runs.set(key, run);
    }
    return run;
  }

  /** Runs `task` in the run's turn. The slot passes on only when the task calls `release`: at once
   * if it throws before the engine has a command, else once the engine has answered. A call whose
   * deadline comes while it waits gives its turn up as soon as the turn comes. */
  async #queued<T>(
    run: Run,
    answerBy: number,
    signal: AbortSignal,
    task: (release: () => void) => Promise<T>,
  ): Promise<T> {
    const previous = run.tail;
    let free: () => void = () => undefined;
    run.tail = new Promise<void>((resolve) => {
      free = resolve;
    });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      run.busy -= 1;
      free();
      this.#scheduleReap(run);
    };
    run.busy += 1;
    if (run.reap !== null) clearTimeout(run.reap);
    run.reap = null;
    const turn = await waitFor(previous, answerBy - this.#now(), signal);
    if (turn !== "ready") {
      void previous.then(release);
      throw new PagesBrokerError("TIMEOUT", turn);
    }
    return task(release);
  }

  async #call(
    run: Run,
    surfaceId: string,
    binding: PagesBinding,
    p: ShellSurfacesControlParams,
    o: {
      readonly answerBy: number;
      readonly signal: AbortSignal;
      readonly release: () => void;
      /** the run's grant of the page when the call came, before its turn */
      readonly seen: Grant | undefined;
    },
  ): Promise<ShellSurfacesControlResult> {
    const startedAt = this.#now();
    const callId = (this.#deps.newCallId ?? randomUUID)();
    let grant: Grant;
    let engine: EngineLease;
    /** a screenshot's folder, judged, and its disk; null for any other command */
    let stillIn: { readonly folder: string; readonly disk: PagesStillsPort } | null = null;
    // the path a still was sent to be written at, while no answer names the file there; assigned as
    // the engine works, in a callback of its own, so typed by assertion (as `unheld` below is)
    let unnamed = null as string | null;
    // whether the engine was handed this call's own command (never the list or the switch before it);
    // assigned as the engine works, so typed by assertion, as `unnamed` is
    let handed = false as boolean;
    // Until the engine has a command, every way out lets the run's slot go.
    try {
      // given back while this call waited for its turn: the page is no longer the run's, and
      // this call, admitted before, never grants it again
      if (o.seen?.givenBack === true || run.grants.get(surfaceId)?.givenBack === true) {
        o.release();
        return refused("gone");
      }
      // a still's folder is judged before the page is granted, a window opens or an engine starts
      if (p.command.action === "screenshot") stillIn = await this.#stillFolder(run, p.folder);
      grant = await this.#grant(run, surfaceId, binding);
      // The window opens BEFORE the launch (2026-11-24, the first live run): the pinned engine enables the
      // page and runs a script on it as it connects, and its launch answers only when those have; with no
      // window open the bridge refused both and every first call failed. A launch that fails, or a race,
      // closes the window it rode.
      const opened = this.#deps.windows.open(surfaceId, {
        kind: p.window,
        callId,
        action: p.command.action,
        bindingRevision: grant.lease.bindingRevision,
      });
      if (!opened.ok) {
        o.release();
        return refusalAnswer(opened) ?? refused("loading");
      }
      try {
        engine = await this.#launched(run, o.answerBy);
        if (this.#deps.bridge.raced(run.key)) await this.#race(run);
      } catch (error) {
        this.#deps.windows.close(surfaceId, callId);
        throw error;
      }
    } catch (error) {
      o.release();
      throw error;
    }
    let settle: (outcome: Outcome) => void = () => undefined;
    const decided = new Promise<Outcome>((resolve) => {
      settle = resolve;
    });
    this.#inFlight.set(surfaceId, {
      run,
      callId,
      settle,
      answerBy: o.answerBy,
      signal: o.signal,
    });
    // Expiry is lazy in the windows, so the broker closes the window at its own deadline: its pin
    // goes then, though no further call comes. The call still answers at its own end.
    const expiresAt = this.#deps.windows.state(surfaceId).window?.expiresAt;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    if (expiresAt !== undefined) {
      const ms = Math.max(0, expiresAt - this.#now());
      expiry = setTimeout(() => this.#deps.windows.closeCall(callId), ms);
      expiry.unref?.();
    }
    const send = (command: Outgoing) =>
      this.#toEngine(
        run,
        engine.socketPath,
        { ...command, id: daemonRequestId(this.#deps.now) },
        o.answerBy,
      );
    // The engine this call launched, or found launched, is on the bridge by the connection that spent
    // the key of this epoch (2026-11-24). Asked before each send: an engine that is off the bridge is
    // joined to something else, which gets no command of the run's and whose answer is not the page's.
    const armed = run.armed;
    const onBridge = (): boolean => this.#deps.link.liveAt(run.key, armed);
    const gone: Outcome = { kind: "engine-gone" };
    const work = (async (): Promise<Outcome> => {
      if (!onBridge()) return gone;
      let list = await send({ action: "tab_list" });
      if (!list.ok) return { kind: "reply", exchange: list };
      if (!list.reply.success) return { kind: "no-switch" };
      // The engine does not hold the page (2026-11-24): its first telling of it fell outside a window,
      // and its enable was refused. Said again inside this call's window, the engine's drain at the next
      // list attaches to it. A run with no client to tell is not waited for: the switch below answers.
      // The word goes on the bridge's socket and the list on the engine's own, so each telling is given a
      // moment to arrive before the list asks again; a list sent at once missed it, and the page was
      // said two or three times (2026-11-24).
      let said = 0;
      while (!listsTarget(list.reply.data, grant.targetId) && said < PAGES_INTRODUCE_TRIES) {
        if (!onBridge()) return gone;
        if (this.#deps.bridge.introduce(run.key, surfaceId) === 0) break;
        said += 1;
        await pause(this.#deps.madePollMs ?? PAGES_MADE_POLL_MS);
        if (!onBridge()) return gone;
        list = await send({ action: "tab_list" });
        if (!list.ok) return { kind: "reply", exchange: list };
        if (!list.reply.success) return { kind: "no-switch" };
      }
      if (said > 0) {
        const held = listsTarget(list.reply.data, grant.targetId) ? "yes" : "no";
        this.#deps.log?.("pages.engine.introduced", { tries: said, held });
      }
      if (activeTargetOf(list.reply.data) !== grant.targetId) {
        if (!onBridge()) return gone;
        const switched = await send({ action: "tab_switch", tabId: grant.targetId });
        if (!switched.ok) return { kind: "reply", exchange: switched };
        if (!switched.reply.success) return { kind: "no-switch" };
      }
      if (!onBridge()) return gone;
      if (stillIn === null) {
        handed = true;
        const exchange = await send({ ...p.command });
        // an answer from an engine that left the bridge while it worked is never taken as the page's
        if (exchange.ok && !onBridge()) return gone;
        return { kind: "reply", exchange };
      }
      // A still: the name is main's, minted now and free now; the engine is sent that path alone.
      const { folder, disk } = stillIn;
      const path = stillPath(folder, mintStillName(disk.random(STILL_NAME_RANDOM_BYTES)));
      if ((await disk.lstat(path)) !== null) return { kind: "no-still", reason: "name-taken" };
      if (!onBridge()) return gone;
      unnamed = path;
      handed = true;
      const exchange = await send(stillCommand(p.command, path));
      if (exchange.ok && !onBridge()) return gone;
      if (!exchange.ok || !exchange.reply.success) return { kind: "reply", exchange };
      const data = exchange.reply.data as { path?: unknown; changed?: unknown } | null | undefined;
      // with ifChanged, a page that has not changed is answered with no file, and none was written
      if (data?.path === undefined && data?.changed === false) {
        unnamed = null;
        return { kind: "reply", exchange };
      }
      // the engine answered another place than the one it was sent: what stands there is not read
      if (data?.path !== path) return { kind: "no-still", reason: "answered-path" };
      const written = await disk.opened(path, STILL_HEAD_BYTES);
      if (written === null) return { kind: "no-still", reason: "not-a-file" };
      const judged = judgeWritten({ ...written, sent: path, answered: data.path, uid: disk.uid });
      if (!judged.ok) return { kind: "no-still", reason: judged.reason };
      return { kind: "reply", exchange, still: judged.still };
    })();
    void work.then(settle, () => settle({ kind: "reply", exchange: lostExchange }));
    void work.finally(o.release).catch(() => undefined);
    // A still's file that no answer names goes once the engine has done with it, whenever that is: the
    // person's hold answered the call (BU-9: no still is taken while they hold the page), its deadline
    // passed, or main refused what was written. Read when the engine has done, since a command not
    // yet sent when the call was answered is sent all the same.
    const dropUnnamed = (): void => {
      if (stillIn === null) return;
      const { disk } = stillIn;
      void work
        .then(
          () => undefined,
          () => undefined,
        )
        .then(() => (unnamed === null ? undefined : disk.remove(unnamed)))
        .catch(() => undefined);
    };
    const timer = setTimeout(() => settle({ kind: "deadline" }), o.answerBy - this.#now());
    const onAbort = () => settle({ kind: "cancelled" });
    o.signal.addEventListener("abort", onAbort, { once: true });
    // EY-1 (7b): while the act window stands, the page's pop-ups are the run's own panes. A binding
    // the page gets mid-window (a remake) takes the policy again, and a hold on whichever page bears
    // it ends it; the window's end takes it off, whatever happens on the way.
    const popups = p.window === "act" ? this.#popupPolicy(run, surfaceId, callId) : null;
    let bearer = binding;
    let watch: ReturnType<typeof setInterval> | undefined;
    // assigned by the watch below, in its own callback: typed by assertion, so the compiler does not
    // read it as null for good at the way out
    let unheld = null as (() => void) | null;
    const endHere = () => {
      popups?.end();
      bearer.page.popups?.(null);
    };
    let outcome: Outcome;
    let reached = false;
    try {
      if (popups !== null) {
        this.#policies.set(surfaceId, endHere);
        watch = setInterval(() => {
          try {
            const now = this.#deps.targets.lookup(surfaceId);
            const same = now !== null && now.page === bearer.page && !moved(leaseOf(bearer), now);
            if (now === null || same) return;
            // the old page keeps no ended policy, which would deny its every pop-up
            bearer.page.popups?.(null);
            bearer = now;
            unheld?.();
            unheld = null;
            // a page already held takes none: the hold ends the policy
            if (now.page.held) {
              endHere();
              return;
            }
            unheld = now.page.onHeld((held) => {
              if (held) endHere();
            });
            now.page.popups?.(popups.policy);
          } catch {
            // a page that throws on taking it: the window's policy ends, and no remake takes it
            clearInterval(watch);
            popups.end();
          }
        }, this.#deps.madePollMs ?? PAGES_MADE_POLL_MS);
        watch.unref?.();
        binding.page.popups?.(popups.policy);
      }
      outcome = await decided;
      reached = true;
    } finally {
      clearInterval(watch);
      unheld?.();
      if (popups !== null) {
        if (this.#policies.get(surfaceId) === endHere) this.#policies.delete(surfaceId);
        endHere();
      }
      clearTimeout(timer);
      clearTimeout(expiry);
      o.signal.removeEventListener("abort", onAbort);
      if (this.#inFlight.get(surfaceId)?.callId === callId) this.#inFlight.delete(surfaceId);
      // a throw on the way out: no window of the call outlives it, no still of it stays, and a pane
      // its client closed under this call still closes
      if (!reached) this.#deps.windows.closeCall(callId);
      if (!reached) dropUnnamed();
      if (!reached && grant.closing) await this.#closeAfterCall(run, grant);
    }
    // found off the bridge by this call's own asking: the engine is ended as the bridge's word ends it
    if (outcome.kind === "engine-gone" && run.launched !== 0 && run.armed === armed) {
      this.#offBridge(run, "off-bridge");
    }
    let answer: ShellSurfacesControlResult;
    try {
      answer = this.#answer(run, surfaceId, callId, outcome, work, handed && p.window === "act");
    } catch (error) {
      dropUnnamed();
      // given back while this call held its window: its grant ends now, owed to the next answer
      if (grant.givenBack) await this.#handBack(run, grant);
      if (grant.closing) await this.#closeAfterCall(run, grant);
      throw error;
    } finally {
      // BU-19 (2026-11-24): a page this call made shared its window, and loses it with the call
      this.#deps.windows.closeCall(callId);
      this.#deps.log?.("pages.call", {
        ms: this.#now() - startedAt,
        window: p.window,
        outcome: outcomeName(outcome),
      });
    }
    if (answer.still === undefined) dropUnnamed();
    // EY-1 (7b): closed by its client while this call held its window: the grant ends now, after the
    // call's own close, and custody closes the page
    if (grant.closing) await this.#closeAfterCall(run, grant);
    // Given back while this call held its window: the grant ends now, after the call's own close,
    // and this call's answer names the page, unless a close that came first already owed it.
    if (grant.givenBack && run.grants.get(surfaceId) === grant) {
      await this.#endGrant(run, grant);
      return { ...answer, givenBack: [surfaceId] };
    }
    return answer;
  }

  /** The call's answer from its outcome: how its window closed, then the first refusal fact, then
   * the engine's reply. `mayHaveActed`: the call is an act whose own command the engine was handed. */
  #answer(
    run: Run,
    surfaceId: string,
    callId: string,
    outcome: Outcome,
    work: Promise<Outcome>,
    mayHaveActed: boolean,
  ): ShellSurfacesControlResult {
    const windows = this.#deps.windows;
    // the engine's own part in the outcome, whatever the answer turns out to be: an exchange it
    // answered ends a run of unanswered calls, and a deadline it let pass adds to one
    if (outcome.kind === "reply" && outcome.exchange.ok) run.unanswered = 0;
    const unanswered =
      outcome.kind === "deadline" ||
      (outcome.kind === "reply" && !outcome.exchange.ok && outcome.exchange.failure === "timeout");
    if (outcome.kind === "held") return refused("held");
    if (outcome.kind === "engine-gone") {
      // the engine left the bridge or exited under the call: whatever it did or said is not known
      windows.close(surfaceId, callId);
      // An act the engine was handed may have happened (2026-11-24): `engine-starting` asks for
      // another try, which would be the act a second time. A read changed nothing, and an act whose
      // command never went did nothing, so each of those may be tried again.
      throw new PagesBrokerError("UNAVAILABLE", mayHaveActed ? "no-answer" : "engine-starting");
    }
    if (outcome.kind === "deadline" || outcome.kind === "cancelled") {
      windows.close(surfaceId, callId);
      this.#drain(surfaceId, callId, work);
      if (unanswered) this.#unansweredBy(run);
      throw new PagesBrokerError("TIMEOUT", outcome.kind);
    }
    const closed =
      windows.close(surfaceId, callId) ??
      windows.history(surfaceId).find((w) => w.callId === callId) ??
      null;
    const fact = closerFact(closed) ?? firstRefusal(this.#deps.bridge.refusals(callId));
    if (fact !== null) return fact;
    if (outcome.kind === "no-switch") return refused("loading");
    if (outcome.kind === "no-still") throw this.#noStill(run, outcome.reason);
    const exchange = outcome.exchange;
    if (!exchange.ok) {
      if (exchange.failure === "timeout") {
        this.#drain(surfaceId, callId, work);
        this.#unansweredBy(run);
        throw new PagesBrokerError("TIMEOUT", "deadline");
      }
      if (exchange.failure === "too-large") {
        throw new PagesBrokerError("RESOURCE_EXHAUSTED", "output-too-large");
      }
      // The act's line went out and no whole reply came back (2026-11-24): the engine's socket
      // closed, as it does when the engine dies, whose exit may be heard only after. The act may
      // have happened, and the exchange's own word is no pages state, so it would cross as a bare
      // UNAVAILABLE, worded as stopped, try again. `not-sent` is not this: the engine never saw it.
      if (mayHaveActed && exchange.failure === "outcome-unknown") {
        throw new PagesBrokerError("UNAVAILABLE", "no-answer");
      }
      throw new PagesBrokerError("UNAVAILABLE", exchange.failure);
    }
    const output = exchange.reply;
    const bytes = Buffer.byteLength(JSON.stringify(output), "utf8");
    this.#deps.log?.("pages.output", { bytes });
    if (bytes > SURFACE_AUTHORITY_LIMITS.CONTROL_OUTPUT_MAX_BYTES) {
      throw new PagesBrokerError("RESOURCE_EXHAUSTED", "output-too-large");
    }
    return outcome.still === undefined
      ? { status: "done", output }
      : { status: "done", output, still: { ...outcome.still } };
  }

  /** A still's folder, judged before anything of the call runs: its shape, then each part by `lstat`,
   * none followed through a link. Refused, the call is PRECONDITION_FAILED `still-folder`: the folder
   * is fieldd's to name and to keep its own, so a refusal here is main's wall behind fieldd's room. */
  async #stillFolder(
    run: Run,
    folder: string | undefined,
  ): Promise<{ readonly folder: string; readonly disk: PagesStillsPort }> {
    const disk = this.#deps.stills;
    if (disk === undefined) throw this.#noStill(run, "no-disk");
    if (folder === undefined) throw this.#noStill(run, "no-folder");
    const shape = folderShape(folder);
    if (!shape.ok) throw this.#noStill(run, shape.reason);
    const parts: StillEntryFacts[] = [];
    for (const prefix of shape.prefixes) parts.push((await disk.lstat(prefix)) ?? NO_ENTRY);
    const judged = judgeFolder(parts, disk.uid);
    if (!judged.ok) throw this.#noStill(run, judged.reason);
    return { folder, disk };
  }

  /** A still main will not take, said in a warn line by why (a word of the guard's or the broker's,
   * never a path), and the call's error. Before the engine wrote, the folder or the name is at fault
   * (`still-folder`). After, the file is: larger than a still may be is the call's output bound, and
   * anything else is an answer of the engine's that main could not take (`bad-answer`, the room's
   * words for an answer that could not be read). */
  #noStill(run: Run, reason: NoStill): PagesBrokerError {
    this.#deps.warn?.("pages.broker.still_refused", { run: run.key, reason });
    if (reason === "too-large")
      return new PagesBrokerError("RESOURCE_EXHAUSTED", "output-too-large");
    const written: readonly NoStill[] = [
      "answered-path",
      "not-a-file",
      "not-ours",
      "linked",
      "not-png",
    ];
    return written.includes(reason)
      ? new PagesBrokerError("UNAVAILABLE", "bad-answer")
      : new PagesBrokerError("PRECONDITION_FAILED", "still-folder");
  }

  #drain(surfaceId: string, callId: string, work: Promise<Outcome>): void {
    this.#deps.windows.drain(surfaceId, callId, { forMs: this.#deps.drainMs ?? PAGES_DRAIN_MS });
    void work.finally(() => this.#deps.windows.drained(surfaceId, callId)).catch(() => undefined);
  }

  /** The run's grant of the page: made once per binding, before any engine starts. */
  async #grant(run: Run, surfaceId: string, binding: PagesBinding): Promise<Grant> {
    const granted = run.grants.get(surfaceId);
    if (granted !== undefined) return granted;
    const lease: PageLease = {
      runKey: run.key,
      producerEpoch: binding.producerEpoch,
      bindingRevision: binding.controlBindingRevision,
    };
    this.#deps.bridge.addRun(run.key);
    let answer: PagesGrantAnswer;
    try {
      answer = await this.#deps.bridge.grant(run.key, surfaceId, lease);
    } catch {
      throw new PagesBrokerError("PRECONDITION_FAILED", "grant-refused");
    }
    if (!answer.ok) throw new PagesBrokerError("PRECONDITION_FAILED", "grant-refused");
    const targetId = answer.targetId;
    this.#deps.windows.lease(surfaceId, lease);
    const unsubscribe = binding.page.onHeld((held) => {
      if (held) this.#policies.get(surfaceId)?.();
      this.#held(surfaceId, held);
    });
    const grant: Grant = {
      surfaceId,
      lease,
      targetId,
      unsubscribe,
      givenBack: false,
      closing: false,
    };
    run.grants.set(surfaceId, grant);
    run.moved.delete(surfaceId);
    return grant;
  }

  /** The person's hand: a pick-up closes the page's window, and answers its call at once. The bridge's half goes
   * beside the windows' (2026-11-24): at the pick-up it undoes what the run's client left on the page (a route, extra
   * headers, an init script, a binding, the debugger), which is what frees a request paused under the hold; at the
   * put-down it sets them again. A bridge that keeps no journal has neither call. */
  #held(surfaceId: string, held: boolean): void {
    const bridge = this.#deps.bridge as PagesBridgePort &
      Partial<import("../core/types").BridgeHand>;
    if (!held) {
      this.#deps.windows.putDown(surfaceId);
      bridge.putDown?.(surfaceId);
      return;
    }
    const { closed } = this.#deps.windows.hold(surfaceId);
    bridge.hold?.(surfaceId);
    const flight = this.#inFlight.get(surfaceId);
    if (flight !== undefined && (closed === null || closed.callId === flight.callId)) {
      flight.settle({ kind: "held" });
    }
  }

  /** The run's engine, launched over its socket with a key armed for this launch alone. */
  async #launched(run: Run, answerBy: number): Promise<EngineLease> {
    const ensured = await this.#deps.engines.ensure(run.key);
    if (!ensured.ok) throw new PagesBrokerError("UNAVAILABLE", ensured.unavailable);
    const engine = ensured.engine;
    if (run.launched === engine.generation) return engine;
    // Nothing is launched until this launch answers (2026-11-24): the supervisor counts a run's
    // generations from one again once it has forgotten the run, so a number launched before says
    // nothing of this engine.
    this.#unlaunch(run);
    this.#deps.bridge.addRun(run.key);
    const key = this.#deps.bridge.arm(run.key);
    const launch = await this.#toEngine(
      run,
      engine.socketPath,
      {
        id: daemonRequestId(this.#deps.now),
        action: "launch",
        cdpUrl: key.url,
      },
      answerBy,
    );
    if (this.#deps.bridge.raced(run.key)) await this.#race(run);
    if (!launch.ok && launch.failure === "timeout") {
      // the engine may still connect on the spent key: it goes, and the next call starts afresh
      void this.#deps.engines.stop(run.key);
      throw new PagesBrokerError("TIMEOUT", "deadline");
    }
    if (!launch.ok || !launch.reply.success) {
      await this.#deps.engines.stop(run.key);
      throw new PagesBrokerError("UNAVAILABLE", "engine-starting");
    }
    run.launched = engine.generation;
    run.armed = key.epoch;
    return engine;
  }

  /** One command to the run's engine, and its answer. Both instants are kept (2026-11-24): the engine
   * counts its idle time from its last command, received or answered, and main's reap counts from the
   * same place. */
  async #toEngine(
    run: Run,
    socketPath: string,
    command: PagesDaemonCommand,
    answerBy: number,
  ): Promise<PagesDaemonExchange> {
    run.engineAt = this.#now();
    try {
      return await (this.#deps.exchange ?? exchangeDaemon)(
        socketPath,
        command,
        daemonOptions(answerBy, this.#deps),
      );
    } finally {
      run.engineAt = this.#now();
    }
  }

  /** A spent key presented again: the route is revoked and the engine stopped; the run's next call
   * starts both afresh. */
  async #race(run: Run): Promise<never> {
    this.#raced += 1;
    this.#deps.log?.("pages.race", { raced: this.#raced });
    this.#unlaunch(run);
    await this.#deps.bridge.revokeRun(run.key).catch(() => undefined);
    await this.#deps.engines.stop(run.key);
    throw new PagesBrokerError("UNAVAILABLE", "engine-starting");
  }

  async #endGrant(run: Run, grant: Grant): Promise<void> {
    run.grants.delete(grant.surfaceId);
    grant.unsubscribe();
    this.#deps.windows.unlease(grant.surfaceId);
    await this.#deps.bridge.endGrant(run.key, grant.surfaceId).catch(() => undefined);
  }

  /** The run's end (its run-level close), in the run's turn: grants, route and engine. */
  async #endRun(key: string, answerBy: number, signal: AbortSignal): Promise<void> {
    const run = this.#runs.get(key);
    if (run === undefined) return;
    await this.#queued(run, answerBy, signal, async (release) => {
      // ended meanwhile by another end of it (2026-11-24: the run form's close and main's end of every
      // run can both be asked): once is enough, and custody is told once
      if (this.#runs.get(key) !== run) {
        release();
        return;
      }
      // until custody has ended it, no pane is made for the run and no call starts it again
      this.#ending.add(key);
      try {
        if (this.#runs.get(key) === run) this.#runs.delete(key);
        const pages = new Set([...run.grants.keys(), ...run.moved]);
        // a made page still waited for: its wait ends now, and custody closes it with the rest;
        // the run never saw it, so it is not named
        const waiting = [...run.made].filter((surfaceId) => !pages.has(surfaceId));
        for (const surfaceId of waiting) this.#waits.get(surfaceId)?.("run-end");
        // a handed page that leaves the run is named in givenBack; a made one is the store's, and
        // named in closed
        for (const surfaceId of pages) {
          if (this.#own(run, surfaceId)) this.#oweGone(key, surfaceId);
          else this.#owe(key, surfaceId);
        }
        try {
          await this.#teardown(run);
        } finally {
          release();
        }
        // the run's end: a pane it made has no run to serve, and custody ends the run
        for (const surfaceId of [...pages, ...waiting]) {
          await this.#deps.panes?.pageClosed(key, surfaceId).catch(() => undefined);
        }
        this.#deps.maker?.runEnded(key);
      } finally {
        this.#ending.delete(key);
      }
    });
  }

  async #teardown(run: Run): Promise<void> {
    if (run.reap !== null) clearTimeout(run.reap);
    run.reap = null;
    for (const grant of [...run.grants.values()]) await this.#endGrant(run, grant);
    run.moved.clear();
    this.#unlaunch(run);
    await this.#deps.bridge.revokeRun(run.key).catch(() => undefined);
    await this.#deps.engines.stop(run.key);
  }

  /** Arms the run's idle reap, at the end of each of its calls. With an engine launched it counts
   * from the engine's last command, never from a call main answered itself (2026-11-24); with none,
   * from now. */
  #scheduleReap(run: Run): void {
    if (run.busy > 0 || this.#stopped || this.#runs.get(run.key) !== run) return;
    if (run.reap !== null) clearTimeout(run.reap);
    const idleMs = this.#deps.idleReapMs ?? PAGES_IDLE_REAP_MS;
    const wait = run.launched === 0 ? idleMs : Math.max(0, run.engineAt + idleMs - this.#now());
    run.reap = setTimeout(() => {
      run.reap = null;
      if (run.busy > 0 || this.#runs.get(run.key) !== run) return;
      this.#unlaunch(run);
      this.#deps.log?.("pages.engine.reaped", { idleMs });
      void this.#deps.engines.stop(run.key);
    }, wait);
    run.reap.unref?.();
  }
}

const lostExchange: PagesDaemonExchange = { ok: false, failure: "outcome-unknown" };

/** What a run owes its next answer, beside what the answer names itself: at most
 * PAGES_RUN_PANES_MAX in all, the rest for the answer after. Undefined when nothing is owed. */
function take<T>(
  owed: Map<string, T[]>,
  key: string,
  named: readonly T[] | undefined,
): T[] | undefined {
  const list = owed.get(key);
  if (list === undefined) return undefined;
  const now = named ?? [];
  const out = [...now, ...list.splice(0, PAGES_RUN_PANES_MAX - now.length)];
  if (list.length === 0) owed.delete(key);
  return out;
}

/** A binding's own epoch and revision, as a lease names them. */
function leaseOf(binding: PagesBinding): PageLease {
  return {
    runKey: "",
    producerEpoch: binding.producerEpoch,
    bindingRevision: binding.controlBindingRevision,
  };
}

/** An error's kind for a warn line: a broker error's own, else INTERNAL. */
function kindOf(error: unknown): string {
  return error instanceof PagesBrokerError ? error.kind : "INTERNAL";
}

function moved(lease: PageLease, binding: PagesBinding): boolean {
  return (
    lease.producerEpoch !== binding.producerEpoch ||
    lease.bindingRevision !== binding.controlBindingRevision
  );
}

function outcomeName(outcome: Outcome): string {
  return outcome.kind === "reply" && !outcome.exchange.ok ? outcome.exchange.failure : outcome.kind;
}

/** How the window closed, as a fact: null when the call itself closed it. */
function closerFact(closed: CallWindow | null): ShellSurfacesControlResult | null {
  if (closed === null) return refused("gone");
  const fact = WINDOW_CLOSE_FACT[closed.closedBy ?? "call-end"];
  return fact === null ? null : refused(fact);
}

/** A refusal's answer, as BRIDGE_REFUSAL_FACT makes it: null when it is no main fact. */
function refusalAnswer(r: BridgeRefusal | CallRefusal): ShellSurfacesControlResult | null {
  const fact = BRIDGE_REFUSAL_FACT[r.code];
  if (fact === null) return null;
  if (fact === "needs-you") {
    // a needs-you with no need is no fact main can give: the next refusal, or the reply, answers
    return r.need === undefined ? null : { status: "refused", fact: "needs-you", need: r.need };
  }
  return refused(fact);
}

function firstRefusal(refusals: readonly CallRefusal[]): ShellSurfacesControlResult | null {
  for (const r of refusals) {
    const answer = refusalAnswer(r);
    if (answer !== null) return answer;
  }
  return null;
}

/** A wait of `ms`, for a word still on its way to the engine. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

/** Waits for `p`, or the time left, or the signal: whichever comes first. */
function waitFor(
  p: Promise<void>,
  ms: number,
  signal: AbortSignal,
): Promise<"ready" | "deadline" | "cancelled"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("deadline"), Math.max(0, ms));
    const onAbort = () => resolve("cancelled");
    signal.addEventListener("abort", onAbort, { once: true });
    void p.then(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve("ready");
    });
  });
}
