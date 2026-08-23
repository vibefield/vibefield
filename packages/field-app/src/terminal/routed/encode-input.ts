// TP-S3-input — the renderer half of the input verb (spec §5.4). ghosttea-react's
// routed runtime computes the whole input context (activation, leaseEpoch, the
// monotonic per-view inputSequence, the operation) and sends whatever this
// function returns RAW over the control leg (`sendExtension` — upstream never
// invents a tag of its own; absent this hook, routed input stays closed with
// `routed-input-suppressed {wire-verb-unavailable}`). This module is pure so the
// G22/G23 integration slice can hand it to the routed host verbatim:
// `host.encodeInput = encodeRoutedInput`.
//
// The mapping PROJECTS: `TerminalKeyEvent.location`/`timestamp` are renderer-side
// metadata the engine does not take and the wire does not carry; a missing
// `unshiftedCodepoint` becomes 0 (ghosttea's own serde default, mirrored by the
// contract). The cell supplies every fence coordinate it owns (view, client,
// attachment epoch) from its activation table — nothing here can widen authority.
import type {
  RoutedTerminalInputContext,
  RoutedTerminalInputOperation,
} from "@vibecook/ghosttea-react";
import { type SendInput, type SendInputOp, tagTpMessage } from "@vibefield/contracts";

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

/** The `GhostteaRoutedHost.encodeInput` implementation: context → the tagged
 * `SendInput` wire message, or null for an operation this build cannot encode. */
export function encodeRoutedInput(
  context: RoutedTerminalInputContext,
): Readonly<Record<string, unknown>> | null {
  const op = encodeOp(context.operation);
  if (op === null) return null;
  const body: SendInput = {
    sessionId: context.sessionId,
    activationId: context.activationId,
    leaseEpoch: context.leaseEpoch,
    inputSequence: context.inputSequence,
    op,
  };
  return tagTpMessage("SendInput", body);
}
