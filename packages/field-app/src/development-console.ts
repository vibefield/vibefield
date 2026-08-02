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
}

export function emitGodviewDeckMarker(facts: GodviewDeckFacts): void {
  console.log(`GODVIEW_DECK ${JSON.stringify(facts)}`);
}
