// TP-S3-input — the renderer half of the input verb, drift-guarded against the
// contract: every operation ghosttea-react can hand `encodeInput` must come out
// as a `SendInput` the cell's schema accepts on the control leg, and nothing
// renderer-only (location, timestamp) may leak onto the wire.
import type { RoutedTerminalInputContext } from "@vibecook/ghosttea-react";
import { decodeTpMessage, SendInput, TP_LEG_INBOUND } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { encodeRoutedInput } from "../src/terminal/routed/encode-input";

const context = (
  operation: RoutedTerminalInputContext["operation"],
): RoutedTerminalInputContext => ({
  sessionId: "sess-1",
  viewId: "view-1",
  activationId: "act-1",
  leaseEpoch: 4,
  inputSequence: 9,
  operation,
});

describe("encodeRoutedInput — the SendInput wire encoding (spec §5.4)", () => {
  it("every operation kind encodes to a SendInput the contract accepts inbound on control", () => {
    const ops: RoutedTerminalInputContext["operation"][] = [
      { kind: "text", text: "ls\n" },
      { kind: "paste", text: "multi\nline" },
      {
        kind: "key",
        event: {
          type: "down",
          key: "Enter",
          code: "Enter",
          location: 0,
          repeat: false,
          shift: false,
          control: false,
          alt: false,
          meta: false,
          timestamp: 123.4,
          unshiftedCodepoint: 13,
        },
      },
      {
        kind: "mouse",
        event: {
          action: "press",
          button: 0,
          x: 10.5,
          y: 20.25,
          screenWidth: 800,
          screenHeight: 600,
          cellWidth: 10,
          cellHeight: 20,
          paddingLeft: 8,
          paddingTop: 8,
          shift: false,
          control: true,
          alt: false,
          meta: false,
        },
      },
      { kind: "scroll", rows: -3 },
      { kind: "scroll-to", row: 120 },
      { kind: "interrupt" },
    ];
    for (const op of ops) {
      const message = encodeRoutedInput(context(op));
      expect(message, op.kind).not.toBeNull();
      const decoded = decodeTpMessage(message, TP_LEG_INBOUND.control);
      expect(decoded.ok, op.kind).toBe(true);
      if (!decoded.ok) continue;
      expect(decoded.type).toBe("SendInput");
      const body = SendInput.parse(decoded.body);
      expect(body.activationId).toBe("act-1");
      expect(body.leaseEpoch).toBe(4);
      expect(body.inputSequence).toBe(9);
      expect(body.op.kind).toBe(op.kind);
    }
  });

  it("projects the key event: location/timestamp never reach the wire; a missing codepoint becomes 0", () => {
    const message = encodeRoutedInput(
      context({
        kind: "key",
        event: {
          type: "up",
          key: "a",
          code: "KeyA",
          location: 3,
          repeat: true,
          shift: true,
          control: false,
          alt: false,
          meta: false,
          timestamp: 99,
        },
      }),
    );
    expect(message).not.toBeNull();
    const op = (message as { op: { kind: string; key: Record<string, unknown> } }).op;
    expect(op.key["location"]).toBeUndefined();
    expect(op.key["timestamp"]).toBeUndefined();
    expect(op.key["unshiftedCodepoint"]).toBe(0);
    expect(op.key["repeat"]).toBe(true);
    expect(op.key["type"]).toBe("up");
  });

  it("an operation kind this build cannot encode stays closed (null), never a guess", () => {
    const unknown = {
      kind: "hyperdrive",
    } as unknown as RoutedTerminalInputContext["operation"];
    expect(encodeRoutedInput(context(unknown))).toBeNull();
  });
});
