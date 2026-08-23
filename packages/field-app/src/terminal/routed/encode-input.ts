// TP-S3-input — the renderer half of the input verb (spec §5.4). Ghosttea's
// routed runtime supplies activation/lease context and a PER-VIEW counter, then
// sends whatever `encodeInput` returns raw over the control leg. The cell maps
// one activation to one engine view, however, so the wire counter must be shared
// by every DOM view of that activation. This encoder owns that projection.
//
// The ledger is deliberately bounded and lifecycle-aware: one entry per
// admitted session, reset on a new activation, explicitly releasable at session
// or activation teardown, and fail-closed at capacity or counter exhaustion.
// Unknown/invalid operations also stay closed. The G23 production host owns one
// encoder for its admitted-session scope and calls the release methods from the
// matching lifecycle inverses.
//
// The operation mapping PROJECTS: `TerminalKeyEvent.location`/`timestamp` are
// renderer-side metadata the engine does not take and the wire does not carry;
// a missing `unshiftedCodepoint` becomes 0 (ghosttea's own serde default,
// mirrored by the contract). The cell supplies every fence coordinate it owns
// (view, client, attachment epoch) from its activation table — nothing here can
// widen authority.
import type {
  RoutedTerminalInputContext,
  RoutedTerminalInputOperation,
} from "@vibecook/ghosttea-react";
import { SendInput, type SendInputOp, TERMINAL_PIPELINE, tagTpMessage } from "@vibefield/contracts";

function encodeOp(operation: RoutedTerminalInputOperation): SendInputOp | null {
  switch (operation.kind) {
    case "text":
      return { kind: "text", text: operation.text };
    case "paste":
      return { kind: "paste", text: operation.text };
    case "key": {
      const e = operation.event;
      return {
        kind: "key",
        key: {
          type: e.type,
          key: e.key,
          code: e.code,
          repeat: e.repeat,
          shift: e.shift,
          control: e.control,
          alt: e.alt,
          meta: e.meta,
          unshiftedCodepoint: e.unshiftedCodepoint ?? 0,
        },
      };
    }
    case "mouse": {
      const e = operation.event;
      return {
        kind: "mouse",
        mouse: {
          action: e.action,
          button: e.button,
          x: e.x,
          y: e.y,
          screenWidth: e.screenWidth,
          screenHeight: e.screenHeight,
          cellWidth: e.cellWidth,
          cellHeight: e.cellHeight,
          paddingLeft: e.paddingLeft,
          paddingTop: e.paddingTop,
          shift: e.shift,
          control: e.control,
          alt: e.alt,
          meta: e.meta,
        },
      };
    }
    case "scroll":
      return { kind: "scroll", rows: operation.rows };
    case "scroll-to":
      return { kind: "scroll-to", row: operation.row };
    case "interrupt":
      return { kind: "interrupt" };
    default:
      // A future operation kind this build cannot encode: stay CLOSED for it
      // (the runtime treats null as unencodable) rather than ship a guess.
      return null;
  }
}

export interface RoutedInputEncoderOptions {
  /** The owning routed host's admitted-session ceiling. No implicit eviction:
   * evicting a live entry could restart its sequence and replay input. */
  readonly maxTrackedSessions: number;
}

export interface RoutedInputEncoder {
  /** The `GhostteaRoutedHost.encodeInput` implementation. This is an arrow
   * function and can be installed directly as `host.encodeInput`. */
  readonly encodeInput: (
    context: RoutedTerminalInputContext,
  ) => Readonly<Record<string, unknown>> | null;
  /** Release only if this activation is still current. Safe against a late
   * teardown inverse from an activation that has already been replaced. */
  readonly releaseActivation: (sessionId: string, activationId: string) => void;
  /** Release the final session lifecycle (unregister/terminate). */
  readonly releaseSession: (sessionId: string) => void;
  /** Close the owner scope and clear all retained sequence state. */
  readonly dispose: () => void;
}

interface SessionInputSequence {
  readonly activationId: string;
  readonly lastSequence: number;
}

/** Build the activation-scoped `SendInput` encoder for one routed-host scope.
 * Ghosttea's `context.inputSequence` is intentionally not copied: it is scoped
 * to a DOM view, while the cell's engine fence is scoped to the activation. */
export function createRoutedInputEncoder(options: RoutedInputEncoderOptions): RoutedInputEncoder {
  const maxTrackedSessions = options.maxTrackedSessions;
  if (!Number.isSafeInteger(maxTrackedSessions) || maxTrackedSessions <= 0) {
    throw new RangeError("maxTrackedSessions must be a positive safe integer");
  }

  const sessions = new Map<string, SessionInputSequence>();
  let disposed = false;

  const encodeInput: RoutedInputEncoder["encodeInput"] = (context) => {
    if (disposed) return null;

    const op = encodeOp(context.operation);
    if (op === null) return null;

    const previous = sessions.get(context.sessionId);
    if (previous === undefined && sessions.size >= maxTrackedSessions) return null;

    const lastSequence =
      previous?.activationId === context.activationId ? previous.lastSequence : 0;
    if (lastSequence >= Number.MAX_SAFE_INTEGER) return null;
    const inputSequence = lastSequence + 1;

    const parsed = SendInput.safeParse({
      sessionId: context.sessionId,
      activationId: context.activationId,
      leaseEpoch: context.leaseEpoch,
      inputSequence,
      op,
    });
    if (!parsed.success) return null;

    // The cell reads with tungstenite capped at MAX_CONTROL_MESSAGE_BYTES, and
    // an oversize frame is a READ ERROR there — it would tear down the control
    // leg (every activation on it), not drop one message. Refuse it here on the
    // only side that can prevent the loss, measuring the UTF-8 BYTES of the
    // exact JSON the runtime will send (UTF-16 length undercounts multi-byte
    // text). Refusal spends no sequence and surfaces as the runtime's ordinary
    // `routed-input-suppressed` path.
    const message = tagTpMessage("SendInput", parsed.data);
    if (
      new TextEncoder().encode(JSON.stringify(message)).length >
      TERMINAL_PIPELINE.MAX_CONTROL_MESSAGE_BYTES
    ) {
      return null;
    }

    // Commit only after the whole wire body validates. A malformed operation
    // cannot allocate a session slot or spend a sequence number.
    sessions.set(context.sessionId, {
      activationId: context.activationId,
      lastSequence: inputSequence,
    });
    return message;
  };

  return {
    encodeInput,
    releaseActivation: (sessionId, activationId) => {
      if (sessions.get(sessionId)?.activationId === activationId) sessions.delete(sessionId);
    },
    releaseSession: (sessionId) => {
      sessions.delete(sessionId);
    },
    dispose: () => {
      disposed = true;
      sessions.clear();
    },
  };
}
