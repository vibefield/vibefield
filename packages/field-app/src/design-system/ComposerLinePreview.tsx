import type { FrameView } from "@vibefield/contracts";
import { type ReactElement, useEffect, useState } from "react";
import { ComposerLineView, type LineNote } from "../frame/ComposerLine";
import {
  inputRefusalNote,
  type LinePane,
  type LineViewDoor,
  newTerminalNote,
} from "../frame/line-door";
import { SNAPSHOT_NO_DOOR } from "../frame/line-model";
import { ViewsTrackView } from "../frame/ViewsTrack";
import type { ViewKeys } from "../frame/views";
import type { RoutedInputRefusal } from "../terminal/pool";

// The line's fixture ADAPTER (One Frame FR-2; LN-D1; docs/UI_SYSTEM.md): the
// shipping line — `ComposerLineView`, the views track at its left end — on
// fixture state, one plate per state the Cards in Hand page draws for the
// shortened line. What it replaces is only what a host supplies: the panes
// Godview lends the line, whether a capture door is here and whether a capture
// is in flight, and what the frame said last. The markup and the CSS are the
// product's.

/** The states the line's plates show: at rest; the snapshot under the pointer,
 * in flight (the tool up) and waiting on a host with no capture door; Objects
 * out; an object in hand (the create faint — DK-13, R14); Godview's create and
 * History's; and the note at its two anchors — a new terminal said over the
 * create, and a paste too large for its pane (D6) said from the line's left. */
export const LINE_STATES = [
  "rest",
  "snap-hover",
  "snap-on",
  "snap-waits",
  "objects",
  "held",
  "gv",
  "hx",
  "opened",
  "refused",
] as const;
export type LineState = (typeof LINE_STATES)[number];

const VIEW_OF: Record<LineState, FrameView> = {
  rest: "canvas",
  "snap-hover": "canvas",
  "snap-on": "canvas",
  "snap-waits": "canvas",
  objects: "canvas",
  held: "canvas",
  gv: "godview",
  hx: "history",
  opened: "godview",
  refused: "godview",
};

/** The panes the fixture deck shows — the page's own three, nearest first. */
export const FIXTURE_PANES: readonly LinePane[] = [
  {
    paneId: "p-vibe",
    sessionId: "s-vibe",
    name: "vibe-field",
    runs: "Claude Code",
    state: "working",
    active: true,
  },
  {
    paneId: "p-rosetta",
    sessionId: "s-rosetta",
    name: "rosetta",
    runs: "Codex",
    state: "idle",
    active: false,
  },
  {
    paneId: "p-billing",
    sessionId: "s-billing",
    name: "billing-api",
    runs: "Codex",
    state: "blocked",
    active: false,
  },
];

/** D6 — what a pane's terminal answers a ⌘V too large for it, in fixture: a
 * 300 KB paste of plain text, of which one message carries 261 KB. The words
 * are the product's own (`inputRefusalNote`), never a copy of them. */
export const FIXTURE_REFUSAL: RoutedInputRefusal = {
  sessionId: "s-vibe",
  kind: "paste",
  bytes: 300_000,
  limitBytes: 261_958,
};

/** What Godview lends the line, in fixture: three panes on screen, a new
 * terminal that opens, a paste that lands, a resumed session that mounts, a
 * running one shown. */
export const FIXTURE_LINE_DOOR: LineViewDoor = {
  panes: FIXTURE_PANES,
  onScreen: true,
  newTerminal: async () => ({ state: "opened" }),
  pasteInto: () => true,
  whenInputOpen: async () => true,
  canPlace: true,
  place: async () => ({ state: "opened" }),
  reveal: async () => ({ state: "opened" }),
};

/** What the frame says on a plate, in the product's own words. */
function noteOf(state: LineState, seq: number): LineNote | null {
  if (state === "opened") {
    return { seq, text: newTerminalNote({ state: "opened" }), at: "create" };
  }
  if (state === "refused") {
    return { seq, text: inputRefusalNote(FIXTURE_REFUSAL, FIXTURE_PANES[0]?.name), at: "line" };
  }
  return null;
}

/** One state of the line, at its place at a plate's foot. */
export function ComposerLinePlate({
  state,
  keys = "mac",
}: {
  state: LineState;
  keys?: ViewKeys;
}): ReactElement {
  const view = VIEW_OF[state];
  // A note lives 2.4s and goes, as in the product; on its plate it is said
  // again every 2.6s, so the state can be looked at rather than caught.
  const [said, setSaid] = useState(1);
  useEffect(() => {
    if (state !== "opened" && state !== "refused") return;
    const timer = window.setInterval(() => setSaid((count) => count + 1), 2_600);
    return () => window.clearInterval(timer);
  }, [state]);
  return (
    <div className="vf-ds-line-plate" data-state={state} data-keys={keys}>
      <ComposerLineView
        view={view}
        keys={keys}
        track={<ViewsTrackView view={view} keys={keys} />}
        objectsOpen={state === "objects"}
        createHeld={state === "held"}
        createWaits={view === "history" ? "choose a session first" : null}
        snapshotWaits={state === "snap-waits" ? SNAPSHOT_NO_DOOR : null}
        snapshotOn={state === "snap-on"}
        snapshotHot={state === "snap-hover"}
        note={noteOf(state, said)}
      />
    </div>
  );
}
