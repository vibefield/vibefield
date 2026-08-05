/** Explicit smoke/development console adapter. Production evidence uses the
 * renderer MessagePort; this marker remains solely because the headless canvas
 * smoke harness observes renderer console output as its pass condition. */
export function emitCanvasReadyMarker(widgetTypes: number, plugins: number): void {
  console.log(`CANVAS_READY {"widgetTypes":${widgetTypes},"plugins":${plugins}}`);
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
  error?: string;
  /** GT-3: present ONLY while the restore consent face is up, carrying the
   * counts it is showing. Absent is the assertion the smoke needs as much as
   * present is — "no prompt appeared" is a claim about a face that is not
   * there, and a field that only ever appears when it should makes both
   * directions checkable. */
  consent?: { saved: number; alive: number; dead: number };
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
   * right is James's eye; that the id reached the renderer is a fact. */
  effects: { shaderEffect: string | null; animate: boolean };
}

export function emitGodviewDeckMarker(facts: GodviewDeckFacts): void {
  console.log(`GODVIEW_DECK ${JSON.stringify(facts)}`);
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
  /** GT-D13's law, as a fact a harness can hold: the words on the stage saying
   * these agents are invented. Absent from this line would mean absent from the
   * screen — which is the failure it exists to catch.
   *
   * Since GT-D17 the sentence NARROWS when real rows join it (it starts naming
   * how many of the rows are invented), so a harness asserts what it means —
   * that the claim is present and scoped — rather than one fixed string. */
  mockLabel: string;
  /** The split, counted (GT-D17): how many rows each source put on the stage. */
  mockAgents: number;
  remoteSessions: number;
  /** Online peers behind those remote rows. */
  remoteHosts: number;
  /**
   * The remote field's honest state, which is the fact a harness needs BEFORE
   * it can judge an empty mesh: `no-door` (no deck, so nobody was asked),
   * `serving` (the floor answered — zero rows then means an empty mesh), and
   * `unavailable` (the ask failed, and `remoteReason` carries the floor's own
   * words). Without it, "no peers" and "never asked" are the same empty line.
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
   * swarm view, which turns a silent regression into a failed row.
   */
  swarmPhysics: string;
}

export function emitGodviewMonitorMarker(facts: GodviewMonitorFacts): void {
  console.log(`GODVIEW_MONITOR ${JSON.stringify(facts)}`);
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
