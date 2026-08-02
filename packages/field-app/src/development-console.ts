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
}

export function emitGodviewDeckMarker(facts: GodviewDeckFacts): void {
  console.log(`GODVIEW_DECK ${JSON.stringify(facts)}`);
}
