import { useOps, useWidgetProps, type WidgetComponentProps } from "@vibecook/ice/react";
import type { ProductSessionRosterItem } from "@vibefield/contracts";
import { CardShell, UiButton, UnavailableState } from "@vibefield/design-kit";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { TerminalMirrorSurface } from "../mirror";
import {
  isSessionUnavailable,
  refreshTerminalRoster,
  terminalSessionAvailability,
  useTerminalPool,
} from "../pool";
import { TERMINAL_MIRROR_TYPE } from "./manifest";
import { SessionPickerView } from "./SessionPickerView";
import "./mirror-widget.css";

// THE BUILT-IN TERMINAL MIRROR WIDGET (TP-S2b-widget; TPv3 §17 mark 21 = (a)).
//
// This is the CONTROLLER half. It owns exactly three things — the durable
// address, the roster read, and which face is showing — and it renders two
// production views underneath: `TerminalMirrorSurface` (the watch-only mirror
// TP-S2 landed, unchanged by this slice) and `SessionPickerView` (controller-
// free, so the catalog can mount it with fixture rows).
//
// WHAT THE WIDGET FORM ADDS TO TP-R4a, AND WHAT IT DELIBERATELY DOES NOT.
// The five watch-only layers all live in the surface and its facade; a widget
// cannot weaken them and this one does not try to strengthen them either. What
// the widget form CAN newly get wrong is the canvas's own input plumbing, so
// two lines here are load-bearing by omission:
//
//   - the contribution declares NO `keyboard` interaction (manifest.ts) — a
//     widget with `keyboard: "exclusive"` stands the engine keymap down while a
//     node inside it holds focus, which would be arranging for keys to reach a
//     card that must never take input focus;
//   - the mirror subtree carries NO `data-canvas-interactive` — every pointer
//     event over the mirror belongs to the canvas (drag the card, wheel to
//     zoom), which is also what makes the surface's `pointer-events: none`
//     the whole story rather than half of it.
//
// The PICKER is the one interactive part, and it is interactive about the
// DOCUMENT (it writes a durable prop), never about the terminal: it holds no
// runtime, sends nothing, and the only thing a click there can do is change
// which session id this card carries.
//
// THE CAMERA IS NOT WIRED, ON PURPOSE. `TerminalMirrorSurface` takes
// `cameraScale`/`cameraSettled` for a host that scales the widget's own BOX and
// wants the re-raster deferred to gesture end. The ICE canvas is not such a
// host: its content plane IS the camera transform, so a card's layout box is in
// world units and never changes with zoom. Passing the camera here would apply
// the scale a second time on top of the plane's — a visible bug, not a
// refinement. `culled` is left undefined for the same family of reason: the
// widget self-observes with an IntersectionObserver against the VISUAL rect,
// which already accounts for the plane's transform, and is right in the canvas,
// a panel and the bench alike.

interface MirrorWidgetProps extends Record<string, unknown> {
  sessionId: string;
  label: string;
}

/** One roster read per window while a picker is open, not one per card. The
 * pool publishes its answer to every subscriber, so the second picker on a
 * board should watch the first one's read land rather than start its own. */
let rosterReadInFlight: Promise<unknown> | null = null;

function readRosterOnce(): void {
  if (rosterReadInFlight !== null) return;
  rosterReadInFlight = refreshTerminalRoster().finally(() => {
    rosterReadInFlight = null;
  });
}

export function TerminalMirrorWidget({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<MirrorWidgetProps>(world, entity, TERMINAL_MIRROR_TYPE);
  const ops = useOps();
  const sessionId = props?.sessionId ?? "";
  const label = props?.label ?? "";

  // The pool snapshot is this component's ONLY terminal read, and it is a
  // subscription: `terminalSessionAvailability` below is module state, so it is
  // only safe to read during render because every publish re-renders us.
  const pool = useTerminalPool();
  const [asking, setAsking] = useState(false);

  const picking = sessionId === "";
  useEffect(() => {
    // Ask once, when a card with no address is showing its picker and nobody
    // has looked yet. `unread` is the only state worth an unprompted read:
    // `observed` is an answer, and `unobserved`/`unavailable` are answers too —
    // re-asking them on a timer would be a poll nobody requested.
    if (!picking || pool.rosterState !== "unread") return;
    readRosterOnce();
  }, [picking, pool.rosterState]);

  const refresh = useCallback(() => {
    setAsking(true);
    void refreshTerminalRoster().finally(() => setAsking(false));
  }, []);

  const pick = useCallback(
    (item: ProductSessionRosterItem) => {
      // The durable write, and the whole of it: an id and the name the user
      // chose it by. Persistence is every other widget's — props in the doc.
      ops.setWidgetProps(entity, {
        sessionId: item.sessionId,
        label: item.title ?? item.sessionId,
      });
    },
    [entity, ops],
  );

  const unbind = useCallback(() => {
    ops.setWidgetProps(entity, { sessionId: "", label: "" });
  }, [entity, ops]);

  // TPv3 §15's S1 row in the widget: a session this window's bridge cannot
  // serve gets the SPEC'S OWN honest state, naming the reason, rather than the
  // "no session here" the surface would otherwise infer from an absent id.
  //
  // Read plainly during render, NOT memoized. The value depends on module state
  // this component does not pass as an argument, so a memo would need `pool` as
  // a dependency it never reads — a lie to the linter that also happens to be
  // slower. `useTerminalPool` above is the subscription that makes reading it
  // here correct: every publish re-renders us, and this line re-runs.
  const availability = picking ? null : terminalSessionAvailability(sessionId);
  const unavailable = availability !== null && isSessionUnavailable(availability);

  return (
    <CardShell world={world} entity={entity}>
      <div
        className="vf-terminal-mirror-widget"
        data-face={picking ? "picker" : unavailable ? "unavailable" : "mirror"}
      >
        {picking ? (
          <SessionPickerView
            items={pool.roster}
            state={pool.rosterState}
            onPick={pick}
            onRefresh={refresh}
            busy={asking}
          />
        ) : unavailable ? (
          <div className="vf-terminal-mirror-widget-face">
            <UnavailableState
              compact
              title={label === "" ? sessionId : label}
              description={
                availability.reason === "other-cell"
                  ? "this session lives in a cell this window is not connected to — it is running, just not showable here yet"
                  : "the direct transport has not landed for this session yet"
              }
            />
            <span data-canvas-interactive="">
              <UiButton onClick={unbind}>watch something else</UiButton>
            </span>
          </div>
        ) : (
          <>
            <TerminalMirrorSurface sessionId={sessionId} {...(label === "" ? {} : { label })} />
            {/* The way back. A card bound to a session that has since exited
                would otherwise be stuck on a dead address forever, which is the
                one honest-state failure a mirror can still commit. */}
            <span className="vf-terminal-mirror-widget-unbind" data-canvas-interactive="">
              <UiButton onClick={unbind} title="Watch a different session">
                change
              </UiButton>
            </span>
          </>
        )}
      </div>
    </CardShell>
  );
}
