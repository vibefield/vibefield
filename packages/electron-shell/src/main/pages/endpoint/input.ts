// EY-1 (2026-11-19) — AN AGENT'S INPUT ON A DESK PAGE (track EY; the endpoint's input step). The engine reads a page
// in CSS pixels; on the page's main target CDP takes an input's point in the view's own pixels, which the owner draws
// at the capture scale in force (1 under a call window's pin). So a point method's point on the PAGE session goes
// through the port's `viewImagePoint`, the one home the owner's own hand takes its point from, and the two cannot
// drift: a mouse's x and y, each touch point's, and a gesture's origin. A wheel's deltas and a gesture's distances
// and factors are never scaled. A CHILD session's point is the frame's own target's, and passes as it came.
//
// Key-like input (a key, inserted text, a composition) goes to whichever frame holds the focus. So it is refused on a
// child session, and on the page while a frame of another site holds the focus or may (a press's doubt until a
// document's word settles it): the agent's keys never reach a frame of another site. Its refusal is `forbidden`, its
// reason saying which. The first case's measure on the test Mac confirms this rule (a CSS centre lands at the scale,
// the unscaled point misses, a 200 px wheel scrolls 200).
//
// A KEY CARRIES NO EDIT COMMAND (2026-11-24). `Input.dispatchKeyEvent` takes `commands`, the editor commands Blink
// runs with the key (paste, copy, cut and the rest). They run with a key binding's standing: the clipboard is read
// and written without the session's permission handlers ever being asked, so `commands: ["paste"]` would put the
// person's clipboard into the agent's page. A key with any command is refused `forbidden`, whichever command it
// names; the pinned engine sends none (its key event has no such field). A key with no `commands`, or an empty list,
// passes as a key. What this does NOT close, by itself: where Blink maps a key chord to an edit command with no
// `commands` at all (not on macOS, where the browser sends them and a bare chord does nothing).

import type { BrowserAgentPort } from "../../live-surfaces/browser-electron-native";
import {
  BRIDGE_OK,
  type BridgeVerdict,
  type CdpCall,
  type CdpParams,
  POINT_METHODS,
  type SessionKind,
} from "../core/types";

/** Input that types: it goes to whichever frame holds the focus. */
export const KEY_LIKE_METHODS = [
  "Input.dispatchKeyEvent",
  "Input.insertText",
  "Input.imeSetComposition",
] as const;

const KEY_LIKE: ReadonlySet<string> = new Set<string>(KEY_LIKE_METHODS);
const POINTS: ReadonlySet<string> = new Set<string>(POINT_METHODS);

export interface AgentInput {
  readonly verdict: BridgeVerdict;
  readonly call: CdpCall;
}

const refused = (call: CdpCall, reason: string): AgentInput => ({
  verdict: { ok: false, code: "forbidden", reason },
  call,
});

/** Whether a key event names an edit command: anything in `commands` but nothing at all or an empty list. */
function carriesEditCommand(params: CdpParams): boolean {
  const commands = params["commands"];
  return commands !== undefined && !(Array.isArray(commands) && commands.length === 0);
}

function scaledPoint(params: CdpParams, port: BrowserAgentPort): CdpParams {
  const { x, y } = params;
  if (typeof x !== "number" || typeof y !== "number") return params;
  const at = port.viewImagePoint({ x, y });
  return { ...params, x: at.x, y: at.y };
}

/** One call of the agent's, on the session it came on: as it goes to the page, or refused. */
export function agentInput(o: {
  readonly call: CdpCall;
  readonly session: SessionKind;
  readonly port: BrowserAgentPort;
}): AgentInput {
  const { call, session, port } = o;
  if (KEY_LIKE.has(call.method)) {
    if (session === "child") {
      return refused(call, "key input goes to the page's own session, never a frame's");
    }
    if (call.method === "Input.dispatchKeyEvent" && carriesEditCommand(call.params)) {
      return refused(
        call,
        "a key carries no edit command: one may read or write the person's clipboard",
      );
    }
    if (port.framesHoldFocus()) {
      return refused(call, "a frame of another site holds the focus, or may");
    }
    return { verdict: BRIDGE_OK, call };
  }
  if (session !== "page" || !POINTS.has(call.method)) return { verdict: BRIDGE_OK, call };
  const params = call.params;
  if (call.method === "Input.dispatchTouchEvent") {
    const points = params["touchPoints"];
    if (!Array.isArray(points)) return { verdict: BRIDGE_OK, call };
    const touchPoints = points.map((point: unknown) =>
      point !== null && typeof point === "object" ? scaledPoint(point as CdpParams, port) : point,
    );
    return {
      verdict: BRIDGE_OK,
      call: { method: call.method, params: { ...params, touchPoints } },
    };
  }
  return { verdict: BRIDGE_OK, call: { method: call.method, params: scaledPoint(params, port) } };
}
