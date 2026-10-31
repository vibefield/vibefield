/** High-rate diagnostic markers are opt-in; smoke and perf runs enable them
 * through their renderer mode. Ordinary development and production stay quiet.
 * Exported for a witness that would otherwise measure for nobody (the deck's
 * wrapper, `godview/deck-wrapper-witness.ts`). */
export function godviewMarkersEnabled(): boolean {
  if (typeof location === "undefined") return false;
  const params = new URLSearchParams(location.search);
  return (
    params.get("mode") === "smoke-godview" ||
    params.get("mode") === "terminal-perf-lab" ||
    params.get("godviewMarkers") === "1"
  );
}

/** Explicit smoke/development console adapter. Production evidence uses the
 * renderer MessagePort; this marker remains solely because the headless canvas
 * smoke harness observes renderer console output as its pass condition.
 *
 * `stagedPlugins` is P8-D2's law made checkable (P8b-3): `plugins` counts what
 * REGISTERED, which a dev-bundled fallback satisfies just as well as the real
 * loader, so the census alone cannot tell the two paths apart. This field can —
 * it is the number that came through fieldd's approval, the import map, and the
 * plugin origin, and the canvas smoke asserts on it. */
export function emitCanvasReadyMarker(
  widgetTypes: number,
  plugins: number,
  stagedPlugins: number,
  runtime?: object,
): void {
  console.log(`CANVAS_READY ${JSON.stringify({ widgetTypes, plugins, stagedPlugins, runtime })}`);
  canvasReadySaid = true;
  for (const say of afterCanvasReady.splice(0)) say();
}

// The desk's markers (DK-3; r6b risk 2: CANVAS_READY proves only the registry — it fires before the
// mount and before the document — so `smoke:canvas` passed with a dead desk). DESK_READY is the
// DRAWING fact: the adapter and the device acquired, the passes compiled (`onStatus` ready) AND the
// first frame presented (`perf().frames ≥ 1`, its GPU work done) — and it is said AFTER CANVAS_READY,
// whichever lands first, so a harness reads the two in one order. DESK_UNAVAILABLE is the other
// verdict: the stage shows the unavailable card (a GPU-less run — the smokes' mode — a lost device,
// a board from before the desk), with the words it shows.
let canvasReadySaid = false;
const afterCanvasReady: (() => void)[] = [];

export interface DeskReadyFacts {
  /** The document generation and the desk's own mount within it. */
  readonly generation: number;
  readonly mount: number;
  /** The mount's boot, ms since the mount (ICE I25 `perf().boot`). */
  readonly boot: {
    readonly device?: number;
    readonly compiled?: number;
    readonly presented?: number;
  };
  readonly frames: number;
}

export function emitDeskReadyMarker(facts: DeskReadyFacts): void {
  const say = (): void => console.log(`DESK_READY ${JSON.stringify(facts)}`);
  if (canvasReadySaid) say();
  else afterCanvasReady.push(say);
}

export interface DeskUnavailableFacts {
  readonly kind: string;
  readonly title: string;
  /** ICE's message, verbatim (absent for a board refused before any desk). */
  readonly message?: string;
  readonly reload: boolean;
}

export function emitDeskUnavailableMarker(facts: DeskUnavailableFacts): void {
  const say = (): void => console.log(`DESK_UNAVAILABLE ${JSON.stringify(facts)}`);
  if (canvasReadySaid) say();
  else afterCanvasReady.push(say);
}

/** DK-5 — the relaunch heal (field/desk/desk-gpu.ts), by its rule since DK-9: a desk whose device
 * never arrived at boot is mounted again after `afterMs`, before any card — said with what failed and
 * which of its kind's retries this is (`attempt` of `of`: a missing adapter 3, a refused device 1). */
export interface DeskRetryFacts {
  readonly generation: number;
  readonly mount: number;
  readonly kind: string;
  readonly message?: string;
  readonly attempt: number;
  readonly of: number;
  readonly afterMs: number;
}

export function emitDeskRetryMarker(facts: DeskRetryFacts): void {
  const say = (): void => console.log(`DESK_RETRY ${JSON.stringify(facts)}`);
  if (canvasReadySaid) say();
  else afterCanvasReady.push(say);
}

/** Test seam: CANVAS_READY not yet said, nothing waiting on it. */
export function resetDeskMarkersForTest(): void {
  canvasReadySaid = false;
  afterCanvasReady.length = 0;
}

/** What the Godview deck currently IS, as one line per settled change.
 *
 * The same bargain CANVAS_READY struck: a headless harness has no other way to
 * ask a page what it drew, and panes are a renderer fact — the floor can prove
 * a session exists but not that a deck is showing it. Emitted from the deck's
 * state, never from the harness's wishes, so a line that never comes is a
 * failure the smoke reports rather than a hang it papers over. */
export interface GodviewDeckFacts {
  active: boolean;
  panes: number;
  sessions: number;
  sessionIds: readonly string[];
  rendererBackend: string;
  /** Product-pool progress, exposed so a zero-pane smoke failure distinguishes
   * acquisition, roster, and workspace mounting without leaking placement. */
  poolPhase: "cold" | "warming" | "warm" | "spent" | "opening" | "dormant" | "open" | "failed";
  rosterState: "unread" | "observed" | "unobserved" | "unavailable";
  error?: string;
  /** GT-5c: WHICH plane refused. `fieldd` means the control plane alone — the
   * ticket mint — while field-native and its PTYs are untouched and outliving
   * it; `transport` means the bridge or the floor. The distinction is the
   * two-plane law, and reporting a fieldd death as a dead shell said the
   * opposite of what had happened. Present exactly when `error` is. */
  errorPlane?: "transport" | "fieldd";
  /** GT-3: present ONLY while the restore consent face is up, carrying the
   * counts it is showing. Absent is the assertion the smoke needs as much as
   * present is — "no prompt appeared" is a claim about a face that is not
   * there, and a field that only ever appears when it should makes both
   * directions checkable. */
  /** LR (2026-10-15) — the window's restore question while it stands: the
   * agents a restore resumes, the deck's dead shell panes, the bare shells
   * that are not coming back (the curtain's numbers). */
  consent?: { agents: number; shells: number; unplaced: number };
  /** GT-3: which panes are showing an ENDED session. The floor can prove a
   * session died; only the renderer can prove the pane admitted it. */
  exitedSessionIds?: readonly string[];
  /** GT-3: the pane the deck's own affordances act on. The kill chip names no
   * session on screen — it says "this session", because the active pane is what
   * every workspace hotkey already means — so a harness driving it has to be
   * told which one that is rather than guessing from the DOM. */
  activeSessionId?: string;
  /** GT-3v: the glass, as structure rather than pixels. `paneBackgroundAlpha`
   * is the alpha the RENDERER was handed for its pane ground — below 1 is the
   * whole claim of this slice, and it is checkable without reading a frame.
   * `themeName` is the active light/dark mode's choice and is null for that
   * mode's built-in Godview palette. Whether the result LOOKS right is James's
   * eye; that a non-opaque background reached the renderer is a fact a harness
   * can hold. */
  glass: { paneBackgroundAlpha: number; opacityCells: boolean; themeName: string | null };
  /** GT-3f: the viewer's shader, as the renderer was told it. `shaderEffect` is
   * null exactly when the deck passed NO `effects` prop — the two states
   * coincide by construction (nothing selected ⇒ nothing sent), which is what
   * lets one field prove both that a selection arrived and that an empty one
   * never overrides the floor's own configuration. Whether the CRT curve looks
   * right is James's eye; that the id reached the renderer is a fact.
   * GT-7: `shaderEffects` is the whole stack in the order the renderer runs it
   * (empty exactly when `shaderEffect` is null); `shaderEffect` stays its head
   * so a harness written before the stack still reads. */
  effects: { shaderEffect: string | null; shaderEffects: string[]; animate: boolean };
  /** Pane content-size commits. Frame geometry animates with fixed terminal
   * dimensions; a completed gesture releases the content box once. Physical
   * regressions separately observe canvas identity and content resizes. */
  zoom: { phase: "idle" | "entering" | "zoomed" | "leaving"; commits: number };
  /** Round 3 — the wrapper around the terminals, as the window's stage
   * measures it (`godview/deck-wrapper-witness.ts`): the state it draws, its
   * top edge in CSS pixels from the stage's top, and `bodyResizes` — how many
   * times the box the terminals fill (`.vf-godview-terminal-deck-body`) has
   * changed size since the stage mounted. The count only grows, as
   * `zoom.commits` does: a move the product makes is held to exactly one.
   * `raisedBy: "lab"` (W7) — a lab's call (the markers' own seam,
   * `godview/deck-state.ts`) brought the terminals up from away; kept while they
   * stay up or maximized, gone when they go away. Absent for a deck in no
   * stage that measures it. */
  wrapper?: {
    state: "away" | "up" | "maximized";
    top: number;
    bodyResizes: number;
    raisedBy?: "lab";
  };
}

export function emitGodviewDeckMarker(facts: GodviewDeckFacts): void {
  if (!godviewMarkersEnabled()) return;
  console.log(`GODVIEW_DECK ${JSON.stringify(facts)}`);
}

/** W7 — the lab's call (the markers' own seam, `godview/deck-state.ts`) never
 * throws to the lab: a throw inside it is said here, one line. What came
 * of a call that went through is the deck's own trail above — the restore
 * question (`consent`), a fault (`error`), the rise (`wrapper.raisedBy`). */
export function emitGodviewDeckLabMarker(facts: { up: "threw"; reason: string }): void {
  if (!godviewMarkersEnabled()) return;
  console.log(`GODVIEW_DECK_LAB ${JSON.stringify(facts)}`);
}

/**
 * G23's direct-path witness for the production smoke.
 *
 * `presentationReady` is stronger than a mounted canvas: Ghosttea sets it only
 * after the frames worker has applied the routed scene and both the worker and
 * cell lease dimensions agree. `inputAllowed` adds the control-leg authority.
 * No route, endpoint, grant, or placement crosses this observation.
 */
export interface GodviewDirectTerminalFacts {
  sessionId: string;
  activationId: string;
  phase: string;
  presentationReady: boolean;
  inputAllowed: boolean;
  /** Safe activation diagnostics for a failed production proof. These name
   * protocol state only; tickets, endpoints and grants never enter the marker. */
  unavailableReason?: string;
  controlAttached?: boolean;
  framesAttached?: boolean;
  framesOutcome?: string;
  framesState?: string;
  protocolReason?: string;
}

export function emitGodviewDirectTerminalMarker(facts: GodviewDirectTerminalFacts): void {
  console.log(`GODVIEW_DIRECT_TERMINAL ${JSON.stringify(facts)}`);
}

/** AR-7: one run of the fold, as the monitor stage received it (`runs`). */
export interface GodviewMonitorRunFacts {
  run: string;
  /** puppeteer's provider id, open (AR-L1) */
  provider: string;
  /** the floor session the run's PTY is — the pane join's own key — when a
   * pane of THIS device can show it; absent for a run hosted in none */
  terminal?: string;
  /** design-04's provenance word: `app` for a run our doors started (the
   * stage's SPAWN, a resume), `user-shell` for a name typed at a pane's prompt
   * (open; a row without it reads `app`) */
  spawnedBy: string;
  /** fieldd's one derived status word */
  status: string;
  /** the fold holds the run as an EXITED row (MF-1f: its process ended while
   * its pane is still on the floor) */
  exited: boolean;
  /** the provider has said something about the run (a monitor mirror) — what
   * the pane frame's mark and readout are drawn from */
  observed: boolean;
  /** the stage DRAWS it: a body in the swarm (a run that is not alive is not) */
  drawn: boolean;
}

/** What the Godview MONITOR currently is (GT-3m) — the deck marker's sibling,
 * for the stage above it.
 *
 * A separate line rather than a field on the deck's, because the two have
 * different lifetimes and the difference is the point: the deck stays mounted
 * while the overlay is closed, the monitor does not (PF6). A monitor marker is
 * therefore evidence that the stage EXISTS at the moment it was printed, which a
 * field on a still-mounted deck's line could never be. */
export interface GodviewMonitorFacts {
  /** Which view is on the stage. `swarm` is the registry's default. */
  viewId: string;
  /** Rows the stage is showing, and how many of them an agent has claimed. */
  agents: number;
  agentBacked: number;
  /** AR-3: the local half of the field is fieldd's fold, and the chip counts
   * what the daemon reports — null when there are no managed agents (quiet is
   * the honesty when there are no facts). GT-D13's mock label, which this
   * replaced, said the rows were invented; nothing on the stage is invented
   * any more, and a harness that finds the word "mock" here has found a
   * regression. */
  localClaim: string | null;
  /** The split, counted (GT-D17, AR-3): how many rows each source put on the
   * stage — managed agents from the fold, the deck's unclaimed panes, the
   * mesh's sessions. */
  localAgents: number;
  terminals: number;
  /**
   * The local field's honest state: `no-door` (no deck, so nobody asked
   * fieldd), `live` (the fold answered — zero rows then means nothing is
   * running here), `unavailable` (the subscription failed; `localReason`
   * carries fieldd's own words).
   */
  localState: string;
  localReason?: string;
  /** Other desktops' runs on the stage (DS-3: off the mesh board). */
  remoteSessions: number;
  /** The other desktops behind those rows. */
  remoteHosts: number;
  /**
   * The remote field's honest state, which is the fact a harness needs BEFORE
   * it can judge an empty mesh: `no-door` (no deck, so nobody was asked),
   * `serving` (the board answered — zero rows then means no other desktop is
   * running anything, or this desktop is alone), and `unavailable` (the board
   * could not be read, and `remoteReason` carries fieldd's own words). Without
   * it, "no peers" and "never asked" are the same empty line. *DS-3
   * (2026-09-30):* the words are the mesh board's now; they were ghosttea's
   * host poll's, which under the routed runtime only ever said `unavailable`.
   */
  remoteState: string;
  remoteReason?: string;
  /**
   * Where the swarm's physics is actually running (GT-3c, GT-D16): `worker` is
   * the slice's whole point, `inline` is the honest fallback for a renderer that
   * could not start one, `none` is any view that has no physics at all.
   *
   * It is on the marker because a fallback is INVISIBLE otherwise — a swarm
   * simulated on the main thread looks exactly like a swarm simulated off it,
   * and the difference is the entire slice. The smoke asserts `worker` on the
   * swarm view, which turns a silent regression into a failed row. Since MV-5
   * the worker is the view's own (MV-D7) and the word is its `report`.
   */
  swarmPhysics: string;
  /** AR-5: what the swarm is painting with — `webgpu`, `unavailable` (the
   * honest line on the stage), or `starting` before the device answered; `none`
   * when the swarm is not the mounted view. The view's `report` since MV-5. */
  swarmRenderer: string;
  /** AR-5: the tiles the usage column is showing (one per account the door
   * reported, whatever its state); `-1` while no column is mounted. A count,
   * not a judgement: an empty batch is the ordinary answer of a fresh daemon. */
  usageTiles: number;
  /** AR-S5: the chosen profile's id — `all` while every profile is shown or
   * there is no choice to make — and how many rows it leaves on the stage
   * unreceded. (P2: the profiles are chosen in search's Live now, GV-D3; the
   * find sheet's `findSheet` left with the sheet — the Peek is the frame's.) */
  profileTab: string;
  shownAgents: number;
  /**
   * TL: the record's past as this stage lends it to the mounted view
   * (`capabilities.history`) — the lent object's own state, or `absent` while
   * nothing is lent: the view declares no `history`, the first answer has not
   * come, or this desktop keeps no record (the door's NOT_FOUND `no-record`).
   * `endedLanes` counts the ended runs in it, after the scope row's desktop
   * narrowed them; 0 while nothing is lent. Read off what the host lends, never
   * off the view's DOM (MV-5's rule): a view that drew nothing for a lent past
   * and a host that lent none are different failures.
   */
  history: "absent" | "complete" | "partial" | "unavailable";
  endedLanes: number;
  /**
   * AR-7: the fold's rows, one per run, as this stage received them — every
   * row, drawn or not. The counts above say how many; this says WHICH, and
   * whose pane and whose doing each is. A run typed at a pane's prompt must
   * appear here with its row, body and pane, and
   * when it ends its row must LEAVE — never stay behind as an exited one. The
   * damage gate the counts ride is not enough for that claim: an exited row is
   * dropped from the drawn rows, so only the fold's own rows can tell "left"
   * from "held as exited".
   */
  runs: GodviewMonitorRunFacts[];
}

export function emitGodviewMonitorMarker(facts: GodviewMonitorFacts): void {
  if (!godviewMarkersEnabled()) return;
  console.log(`GODVIEW_MONITOR ${JSON.stringify(facts)}`);
}

/** One view key the frame claimed (One Frame FR-1, FC-D4): which key, the
 * view it names, the view the window was in, and what the frame did with it.
 *
 * The delivery probe's ear at the FRAME. A chord can be caught and change
 * nothing a harness can see — ⌘2 inside Godview, ⌘4 while the Assistant waits —
 * so the frame says what it heard, and the probe sets that beside the pane's
 * own ear (which must stay deaf) and the view the window ends in. Emitted from
 * the frame's own handler, never from a harness's wishes, and only in the
 * godview smoke's modes. */
export interface ViewKeyFacts {
  key: string;
  view: string;
  from: string;
  /** "moved": the frame asked for another view; "stayed": the window was
   * already there; "waits": the view is not built (its note said so). */
  outcome: "moved" | "stayed" | "waits";
}

export function emitViewKeyMarker(facts: ViewKeyFacts): void {
  if (!godviewMarkersEnabled()) return;
  console.log(`VIEW_KEY ${JSON.stringify(facts)}`);
}

/** One key the LINE took for its create (One Frame FR-2, §11): B on Canvas,
 * ⌘T in Godview and in History (HN-7). The delivery probe's ear at the line, in
 * VIEW_KEY's form — said from the line's own handler, so a key that never
 * arrived says nothing, which is what the probe from a focused pane reads B's
 * silence by. */
export interface LineKeyFacts {
  key: string;
  view: string;
  /** "opened" / "closed": Objects; "refused": Objects while an object is in hand (DK-13, R14); "new-terminal": the
   * view's New terminal was asked (the deck in Godview; History's door in History). */
  outcome: "opened" | "closed" | "refused" | "new-terminal";
}

export function emitLineKeyMarker(facts: LineKeyFacts): void {
  if (!godviewMarkersEnabled()) return;
  console.log(`LINE_KEY ${JSON.stringify(facts)}`);
}

/** One key the HEAD took for the zoom (One Frame FR-3, §6; DK-D24): ⌘+ ⌘− ⌘0
 * ⇧1 on Canvas. The delivery probe's ear at the head, in LINE_KEY's form —
 * said from the head's own handler, so a key a focused pane kept (its font
 * sizes) says nothing, which is what the probe reads that silence by. */
export interface ZoomKeyFacts {
  key: string;
  act: "in" | "out" | "fit" | "actual";
  view: string;
  /** The readout's percent before the act, and after it. */
  from: number;
  to: number;
}

export function emitZoomKeyMarker(facts: ZoomKeyFacts): void {
  if (!godviewMarkersEnabled()) return;
  console.log(`ZOOM_KEY ${JSON.stringify(facts)}`);
}

/** One Frame FR-4 (3b) — a View menu zoom item the head ANSWERED. Said from the
 * head's own handler, on Canvas only, so an item invoked under a cover says
 * nothing — the silence the godview smoke's row 11i reads, beside the page's
 * zoom factor, which no item may move any more. */
export interface ZoomMenuFacts {
  act: "in" | "out" | "actual";
  view: string;
  /** The readout's percent before the act, and after it. */
  from: number;
  to: number;
}

export function emitZoomMenuMarker(facts: ZoomMenuFacts): void {
  if (!godviewMarkersEnabled()) return;
  console.log(`ZOOM_MENU ${JSON.stringify(facts)}`);
}

/** What the first ⌘G cost, station by station (GT-3p, GT-D15.4).
 *
 * Published once per app life, when the first open reaches a presented frame.
 * The breakdown is the point: a total says the open got faster, and only the
 * phases say whether the cost was removed or merely moved somewhere the total
 * cannot see — which GT-D15.4 requires this slice to be able to prove.
 *
 * `warm` names the stations the prewarm had already passed, so the same line
 * reads honestly with the prewarm on and off. */
export interface GodviewColdOpenFacts {
  /** What time zero is (`ColdOpenReport.zero`): the terminals' first call
   * since round 3's W7 — Godview opens on the monitor alone — and the view's
   * open before it. A comparison across W7 must name it. */
  zero: "first-call";
  totalMs: number;
  phases: Record<string, number>;
  warm: readonly string[];
  /** Whether a warm transport was actually inherited by this open — which is
   * not the same as "prewarm was enabled": an open that arrives mid-warm takes
   * the cold path on purpose (`claimWarmTransport` never blocks). */
  prewarmed: boolean;
  /** The renderer the deck ended up on, live rather than assumed (GT-3f's
   * residual: the Settings shader section could not know this). */
  rendererBackend: string;
}

export function emitGodviewColdOpenMarker(facts: GodviewColdOpenFacts): void {
  console.log(`GODVIEW_COLD_OPEN ${JSON.stringify(facts)}`);
}

/** The perf lab's renderer bridge, announcing itself (TP-S0c).
 *
 * Here rather than in `perf/terminal-perf-lab.ts` because this module is the
 * one place harness markers live — it is the file `noConsole` exempts, and
 * exempting a second file would make "where do markers come from" a question
 * with two answers.
 *
 * ONE line, and only this line: everything else the lab reads it pulls over
 * `executeJavaScript`, because a `metrics` window carries four histograms and
 * twenty counters once a second and console marshalling would cost more than
 * the thing being measured. What a marker is good for is the arrival of a
 * capability — the rig waits for this instead of polling a global into
 * existence, so a renderer built without the lab fails legibly rather than
 * timing out.
 */
export function emitTerminalPerfLabMarker(): void {
  console.log(`TERMINAL_PERF_LAB ${JSON.stringify({ installed: true })}`);
}

/** MV-0 — the Godview perf lab's bridges arrived (`monitor/perf/lab-bridge.ts`):
 * the same shape and reason as the terminal perf lab's line above. */
export function emitGodviewPerfLabMarker(facts: { installed: boolean }): void {
  console.log(`GODVIEW_PERF_LAB ${JSON.stringify(facts)}`);
}
