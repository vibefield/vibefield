import type { FrameView } from "@vibefield/contracts";
import { type ReactElement, useLayoutEffect, useRef, useState } from "react";
import { type AtList, type AtMini, atDefaultHot, atList } from "../frame/at-list";
import { AtMenuView, ComposerLineView } from "../frame/ComposerLine";
import type { DraftPart, LineAim } from "../frame/draft";
import type { LinePane, LineViewDoor } from "../frame/line-door";
import { ViewsTrackView } from "../frame/ViewsTrack";
import type { ViewKeys } from "../frame/views";
import { ClipboardStore } from "../hud/edge-tray/clipboard-store";

// The line's fixture ADAPTER (One Frame FR-2; docs/UI_SYSTEM.md): the shipping
// line — `ComposerLineView`, @'s `AtMenuView`, the views track at its left end
// — on fixture state, one plate per state the page's §03 plates draw for the
// composer. What it replaces is only what a host supplies: the panes Godview
// lends the line, the clipboard's stills, and the draft a person would have
// typed. The markup and the CSS are the product's.

/** The states the line's plates show: at rest, typing (a chip in the
 * sentence), @ open, aimed, Objects out, an object in hand (the create faint —
 * DK-13, R14), Godview's create, History's. */
export const LINE_STATES = [
  "rest",
  "typing",
  "at",
  "aimed",
  "objects",
  "held",
  "gv",
  "hx",
] as const;
export type LineState = (typeof LINE_STATES)[number];

export const LINE_STATE_LABEL: Record<LineState, string> = {
  rest: "At rest",
  typing: "Typing",
  at: "@ open",
  aimed: "Aimed",
  objects: "Objects open",
  held: "In hand — Put it down first",
  gv: "Godview",
  hx: "History",
};

const VIEW_OF: Record<LineState, FrameView> = {
  rest: "canvas",
  typing: "canvas",
  at: "canvas",
  aimed: "canvas",
  objects: "canvas",
  held: "canvas",
  gv: "godview",
  hx: "history",
};

/** A fixture still: an SVG drawn here, so a thumbnail shows a real image
 * without a screenshot on disk (the product's come through the shell's
 * `vibefield-still://` scheme, which the catalog does not have). */
export function lineFixtureStill(label: string, hue: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue} 70% 62%)'/><stop offset='1' stop-color='hsl(${hue + 30} 70% 40%)'/></linearGradient></defs>` +
    `<rect width='96' height='96' fill='url(#g)'/>` +
    `<rect x='14' y='20' width='68' height='44' rx='6' fill='rgba(255,255,255,0.28)'/>` +
    `<title>${label}</title></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The panes the fixture deck shows — the page's own three, nearest first. */
export const FIXTURE_PANES: readonly LinePane[] = [
  { sessionId: "s-vibe", name: "vibe-field", runs: "Claude Code", state: "working", active: true },
  { sessionId: "s-rosetta", name: "rosetta", runs: "Codex", state: "idle", active: false },
  { sessionId: "s-billing", name: "billing-api", runs: "Codex", state: "blocked", active: false },
];

export const FIXTURE_CLIPBOARD: readonly AtMini[] = [
  { id: "c1", label: "1440 × 900", path: "/stills/1.png", url: lineFixtureStill("swarm", 214) },
  { id: "c2", label: "820 × 512", path: "/stills/2.png", url: lineFixtureStill("terminal", 28) },
  { id: "c3", label: "1200 × 750", path: "/stills/3.png", url: lineFixtureStill("note", 48) },
];

/** What Godview lends the line, in fixture: three panes on screen, a new
 * terminal that opens, a paste that lands, a resumed session that mounts. */
export const FIXTURE_LINE_DOOR: LineViewDoor = {
  panes: FIXTURE_PANES,
  onScreen: true,
  newTerminal: async () => ({ state: "opened" }),
  paste: () => true,
  canPlace: true,
  place: async () => ({ state: "opened" }),
};

/** The fixture clipboard as a store the live line reads, newest first. */
export function fixtureClipboardStore(): ClipboardStore {
  const store = new ClipboardStore(() => Date.UTC(2026, 9, 3, 15, 4));
  for (const mini of [...FIXTURE_CLIPBOARD].reverse()) {
    const [width, height] = mini.label.split(" × ").map(Number);
    store.addCapture({
      status: "ok",
      path: mini.path,
      width: width ?? 1,
      height: height ?? 1,
      scale: 2,
      displayId: 1,
      bounds: { x: 0, y: 0, width: width ?? 1, height: height ?? 1 },
    });
  }
  return store;
}

/** The still a fixture path shows (the live line's `screenshotStillUrl`). */
export function fixtureStillUrl(path: string): string {
  return FIXTURE_CLIPBOARD.find((mini) => mini.path === path)?.url ?? lineFixtureStill(path, 200);
}

const TYPING: readonly DraftPart[] = [
  { kind: "text", text: "Compare " },
  {
    kind: "chip",
    chip: { id: "fx-chip", kind: "capture", label: "1440 × 900", path: "/stills/1.png" },
  },
  { kind: "text", text: " with the deck and say what moved" },
];

const AIM: LineAim = { sessionId: "s-vibe", name: "vibe-field" };

/** @'s list as the page draws it: nothing typed after the @ yet. */
export function fixtureAtList(view: FrameView): AtList {
  return atList({
    view,
    panes: FIXTURE_PANES,
    clipboard: FIXTURE_CLIPBOARD,
    canCapture: true,
    query: "",
  });
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
  const list = state === "at" ? fixtureAtList(view) : null;
  const seed: readonly DraftPart[] =
    state === "typing" ? TYPING : state === "at" ? [{ kind: "text", text: "@" }] : [];
  // @'s list grows from the @ it was typed at, 10 before it — measured as the
  // controller measures it, here off the plate the line stands in.
  const plateRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [atLeft, setAtLeft] = useState(0);
  useLayoutEffect(() => {
    const plate = plateRef.current;
    const editor = editorRef.current;
    if (state !== "at" || plate === null || editor === null) return;
    setAtLeft(
      Math.max(
        8,
        Math.round(editor.getBoundingClientRect().left - plate.getBoundingClientRect().left - 10),
      ),
    );
  }, [state]);
  return (
    <div ref={plateRef} className="vf-ds-line-plate" data-state={state} data-keys={keys}>
      {state === "objects" ? <div className="vf-ds-line-plate-dim" aria-hidden /> : null}
      <ComposerLineView
        view={view}
        keys={keys}
        track={<ViewsTrackView view={view} keys={keys} />}
        objectsOpen={state === "objects"}
        createHeld={state === "held"}
        createWaits={view === "history" ? "choose a session first" : null}
        aim={state === "aimed" ? AIM : null}
        seed={seed}
        revision={1}
        blank={seed.length === 0}
        canSend={state === "typing"}
        atOpen={list !== null}
        editorRef={editorRef}
      />
      {list === null ? null : <AtMenuView list={list} hot={atDefaultHot(list)} left={atLeft} />}
    </div>
  );
}
