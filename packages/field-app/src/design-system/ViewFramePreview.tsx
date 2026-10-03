import type { FrameView } from "@vibefield/contracts";
import { SegmentedControl } from "@vibefield/design-kit/primitives";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { defaultCanvasGridConfig, type MagnetGridGlyph } from "../field/canvas-appearance";
import { Composer } from "../frame/Composer";
import { ComposerLineView } from "../frame/ComposerLine";
import type { LineSurface } from "../frame/line-surface";
import {
  type CoverState,
  coverAfter,
  coverAt,
  HistoryPlaceholderView,
  ViewCoverView,
} from "../frame/ViewCover";
import { type ViewKeyPress, ViewsTrackView } from "../frame/ViewsTrack";
import type { ViewKeys } from "../frame/views";
import { WidgetTrayFrame } from "../hud/WidgetTray";
import { FIXTURE_LINE_DOOR, fixtureClipboardStore, fixtureStillUrl } from "./ComposerLinePreview";
import { GodviewPreview } from "./GodviewPreview";
import { InfiniteCanvasGroundPreview } from "./InfiniteCanvasGroundPreview";

// The view frame's fixture ADAPTER (One Frame FR-1, FR-2; docs/UI_SYSTEM.md):
// the shipping views — the line with the views track at its left end, the
// cover, History's room — on fixture state. What it replaces is only what a
// host supplies: the window's view (main's owner, here a local value), the
// keys' timing (the controller's, here the state controls), the line's open
// surface (FieldView's owner, here a local value) and what Godview lends the
// line (a fixture door). The line itself runs on its REAL controller, so the
// draft takes typing, @ opens its list and send says what it did. The markup
// and the CSS are the product's.

/** The states the One Frame page's Chrome & Composer plates show for the
 * frame (`data-state`): at rest on the canvas, ⌘ held, Godview, History, and
 * ⌘4's note — each in the catalog's light and dark. */
export const FRAME_STATES = ["rest", "cmd", "gv", "hx", "note"] as const;
export type FrameState = (typeof FRAME_STATES)[number];

const STATE_LABEL: Record<FrameState, string> = {
  rest: "At rest",
  cmd: "⌘ held",
  gv: "Godview",
  hx: "History",
  note: "⌘4 waits",
};

const VIEW_OF: Record<FrameState, FrameView> = {
  rest: "canvas",
  cmd: "canvas",
  gv: "godview",
  hx: "history",
  note: "canvas",
};

/** One state of the track, at the line's left end — the page's §04 plates,
 * which crop the line there. */
export function ViewsTrackSpecimen({
  state,
  keys = "mac",
}: {
  state: FrameState;
  keys?: ViewKeys;
}): ReactElement {
  // The note lives 1.4s and goes, as it does in the product; on a plate it is
  // said again every 1.6s — the controller's timing in fixture — so the state
  // can be looked at rather than caught.
  const [said, setSaid] = useState(1);
  useEffect(() => {
    if (state !== "note") return;
    const timer = window.setInterval(() => setSaid((count) => count + 1), 1_600);
    return () => window.clearInterval(timer);
  }, [state]);
  return (
    <div className="vf-ds-views-plate" data-state={state}>
      <div className="vf-ds-line-stage">
        <ComposerLineView
          view={VIEW_OF[state]}
          keys={keys}
          createWaits={VIEW_OF[state] === "history" ? "choose a session first" : null}
          track={
            <ViewsTrackView
              view={VIEW_OF[state]}
              keys={keys}
              held={state === "cmd"}
              note={state === "note" ? said : null}
            />
          }
        />
      </div>
    </div>
  );
}

/** The whole frame over a field: the cover rising, swapping and lowering on
 * the shipping CSS, the track above it, the keys' states on a control. */
export function ViewFramePreview({
  magnetGridGlyph,
  dark,
}: {
  magnetGridGlyph: MagnetGridGlyph;
  dark: boolean;
}): ReactElement {
  const [state, setState] = useState<FrameState>("rest");
  const [keys, setKeys] = useState<"Mac" | "Windows">("Mac");
  const [view, setView] = useState<FrameView>("canvas");
  const [shown, setShown] = useState<FrameView>("canvas");
  const [cover, setCover] = useState<CoverState>(() => coverAt("canvas"));
  const [press, setPress] = useState<ViewKeyPress | null>(null);
  const [note, setNote] = useState<number | null>(null);
  const [surface, setSurface] = useState<LineSurface | null>(null);
  const [clipboard] = useState(fixtureClipboardStore);
  const grid = useMemo(
    () => defaultCanvasGridConfig(dark, magnetGridGlyph),
    [dark, magnetGridGlyph],
  );

  // The owner, in fixture: the window moves as soon as it is asked.
  if (shown !== view) {
    setShown(view);
    setCover(coverAfter(cover, shown, view));
  }

  useEffect(() => {
    if (note === null) return;
    const timer = window.setTimeout(() => setNote(null), 1_400);
    return () => window.clearTimeout(timer);
  }, [note]);

  const choose = (next: FrameState): void => {
    setState(next);
    if (next === "note") {
      setNote((seq) => (seq ?? 0) + 1);
      return;
    }
    const target = VIEW_OF[next];
    setPress((last) => ({ seq: (last?.seq ?? 0) + 1, moved: target !== view }));
    setView(target);
  };

  return (
    <div className="vf-ds-frame-preview">
      <div className="vf-ds-frame-controls">
        <SegmentedControl
          options={FRAME_STATES.map((entry) => STATE_LABEL[entry])}
          value={STATE_LABEL[state]}
          onChange={(label) => {
            const next = FRAME_STATES.find((entry) => STATE_LABEL[entry] === label);
            if (next !== undefined) choose(next);
          }}
          label="Frame state"
        />
        <SegmentedControl
          options={["Mac", "Windows"] as const}
          value={keys}
          onChange={setKeys}
          label="Keys"
        />
      </div>
      <div
        className="vf-ds-frame-stage"
        data-state={state}
        data-covered={view === "canvas" ? "false" : "true"}
      >
        <InfiniteCanvasGroundPreview
          grid={grid}
          background="var(--vf-canvas-bg)"
          className="vf-ds-stage-ground"
          interactive={false}
          label="Production canvas ground under the frame's cover"
        />
        <div className="vf-ds-stage-card card-a" />
        <div className="vf-ds-stage-card card-b" />
        <ViewCoverView
          view={view}
          content={cover.content}
          motion={cover.motion}
          godview={<GodviewPreview />}
          history={<HistoryPlaceholderView />}
        />
        <WidgetTrayFrame
          open={surface === "objects"}
          onOpenChange={(open) => setSurface(open ? "objects" : null)}
        >
          <div className="vf-ds-widget-tiles">
            <span className="vf-ds-line-tile">Note</span>
            <span className="vf-ds-line-tile">Terminal</span>
            <span className="vf-ds-line-tile">Folder</span>
          </div>
        </WidgetTrayFrame>
        <Composer
          view={view}
          keys={keys === "Mac" ? "mac" : "other"}
          surface={surface}
          onSurfaceChange={setSurface}
          godview={FIXTURE_LINE_DOOR}
          clipboard={clipboard}
          host={{ screenshotStillUrl: fixtureStillUrl }}
          writeClipboard={async () => undefined}
          bindKeys={false}
          track={
            <ViewsTrackView
              view={view}
              keys={keys === "Mac" ? "mac" : "other"}
              held={state === "cmd"}
              press={press}
              note={note}
              onSelect={(asked) => {
                if (asked === "assistant") choose("note");
                else choose(asked === "canvas" ? "rest" : asked === "godview" ? "gv" : "hx");
              }}
            />
          }
        />
      </div>
    </div>
  );
}
