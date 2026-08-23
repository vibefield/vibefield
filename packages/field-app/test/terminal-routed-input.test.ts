// TP-S3-input — the renderer half of the input verb, drift-guarded against the
// contract. Ghosttea numbers input per DOM view; this helper must emit one
// monotonic sequence per activation because the cell maps that activation to
// one engine view.
import type { RoutedTerminalInputContext } from "@vibecook/ghosttea-react";
import { decodeTpMessage, SendInput, TP_LEG_INBOUND } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { createRoutedInputEncoder } from "../src/terminal/routed/encode-input";

const context = (
  operation: RoutedTerminalInputContext["operation"],
  overrides: Partial<RoutedTerminalInputContext> = {},
): RoutedTerminalInputContext => ({
  sessionId: "sess-1",
  viewId: "view-1",
  activationId: "act-1",
  leaseEpoch: 4,
  inputSequence: 9,
  operation,
  ...overrides,
});

const text = (value = "x"): RoutedTerminalInputContext["operation"] => ({
  kind: "text",
  text: value,
});

const sequenceOf = (message: Readonly<Record<string, unknown>> | null): number =>
  SendInput.parse(message).inputSequence;

describe("createRoutedInputEncoder — the SendInput wire encoding (spec §5.4)", () => {
  it("every operation kind encodes to a SendInput the contract accepts inbound on control", () => {
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 4 });
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
    for (const [index, op] of ops.entries()) {
      const message = encoder.encodeInput(context(op));
      expect(message, op.kind).not.toBeNull();
      const decoded = decodeTpMessage(message, TP_LEG_INBOUND.control);
      expect(decoded.ok, op.kind).toBe(true);
      if (!decoded.ok) continue;
      expect(decoded.type).toBe("SendInput");
      const body = SendInput.parse(decoded.body);
      expect(body.activationId).toBe("act-1");
      expect(body.leaseEpoch).toBe(4);
      expect(body.inputSequence).toBe(index + 1);
      expect(body.op.kind).toBe(op.kind);
    }
  });

  it("projects the key event: location/timestamp never reach the wire; a missing codepoint becomes 0", () => {
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1 });
    const message = encoder.encodeInput(
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

  it("projects every DOM view and remount onto one activation-scoped sequence", () => {
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1 });
    const messages = [
      encoder.encodeInput(context(text("a"), { viewId: "view-a", inputSequence: 1 })),
      encoder.encodeInput(context(text("b"), { viewId: "view-b", inputSequence: 1 })),
      encoder.encodeInput(context(text("c"), { viewId: "view-a-remount", inputSequence: 1 })),
    ];
    expect(messages.map(sequenceOf)).toEqual([1, 2, 3]);
  });

  it("resets at a new activation, not at a new renderer view", () => {
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1 });
    expect(sequenceOf(encoder.encodeInput(context(text())))).toBe(1);
    expect(sequenceOf(encoder.encodeInput(context(text(), { viewId: "view-2" })))).toBe(2);
    expect(
      sequenceOf(
        encoder.encodeInput(
          context(text(), { activationId: "act-2", viewId: "view-3", inputSequence: 500 }),
        ),
      ),
    ).toBe(1);
  });

  it("is bounded, releases by lifecycle, and a late old-activation inverse cannot erase the new one", () => {
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1 });
    expect(sequenceOf(encoder.encodeInput(context(text())))).toBe(1);
    expect(sequenceOf(encoder.encodeInput(context(text(), { activationId: "act-2" })))).toBe(1);

    encoder.releaseActivation("sess-1", "act-1");
    expect(encoder.encodeInput(context(text(), { sessionId: "sess-2" }))).toBeNull();

    encoder.releaseActivation("sess-1", "act-2");
    expect(sequenceOf(encoder.encodeInput(context(text(), { sessionId: "sess-2" })))).toBe(1);

    encoder.releaseSession("sess-2");
    expect(sequenceOf(encoder.encodeInput(context(text(), { sessionId: "sess-3" })))).toBe(1);

    encoder.dispose();
    expect(encoder.encodeInput(context(text(), { sessionId: "sess-3" }))).toBeNull();
  });

  it("invalid or unknown operations stay closed and do not allocate or spend a sequence", () => {
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1 });
    const unknown = { kind: "hyperdrive" } as unknown as RoutedTerminalInputContext["operation"];
    expect(encoder.encodeInput(context(unknown))).toBeNull();

    expect(
      encoder.encodeInput(
        context({
          kind: "mouse",
          event: {
            action: "motion",
            button: 256,
            x: 0,
            y: 0,
            screenWidth: 800,
            screenHeight: 600,
            cellWidth: 10,
            cellHeight: 20,
            paddingLeft: 0,
            paddingTop: 0,
            shift: false,
            control: false,
            alt: false,
            meta: false,
          },
        }),
      ),
    ).toBeNull();

    expect(sequenceOf(encoder.encodeInput(context(text(), { sessionId: "sess-2" })))).toBe(1);

    const existing = createRoutedInputEncoder({ maxTrackedSessions: 1 });
    expect(sequenceOf(existing.encodeInput(context(text())))).toBe(1);
    expect(
      existing.encodeInput(
        context({
          kind: "key",
          event: {
            type: "down",
            key: "x",
            code: "KeyX",
            location: 0,
            repeat: false,
            shift: false,
            control: false,
            alt: false,
            meta: false,
            timestamp: 0,
            unshiftedCodepoint: 0x1_0000_0000,
          },
        }),
      ),
    ).toBeNull();
    expect(sequenceOf(existing.encodeInput(context(text())))).toBe(2);
  });

  it("refuses an invalid capacity instead of creating an unbounded ledger", () => {
    expect(() => createRoutedInputEncoder({ maxTrackedSessions: 0 })).toThrow(RangeError);
    expect(() =>
      createRoutedInputEncoder({ maxTrackedSessions: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });

  it("refuses a message the cell's frame cap would reject — an oversize paste must not kill the leg", () => {
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1 });
    // Comfortably under the 262,144-byte cap: passes.
    expect(
      encoder.encodeInput(context({ kind: "paste", text: "a".repeat(200_000) })),
    ).not.toBeNull();
    // Over the cap: refused, and the refusal spends no sequence.
    expect(encoder.encodeInput(context({ kind: "paste", text: "b".repeat(300_000) }))).toBeNull();
    expect(sequenceOf(encoder.encodeInput(context(text())))).toBe(2);
  });

  it("measures UTF-8 bytes, not UTF-16 length — multi-byte text cannot sneak past the cap", () => {
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1 });
    // 90,000 astral emoji: 180,000 UTF-16 code units (under the cap) but
    // 360,000 UTF-8 bytes (over it). A length-based check would pass this and
    // the cell's read would tear down the control leg.
    const emoji = "\u{1F4A5}".repeat(90_000);
    expect(emoji.length).toBeLessThan(262_144);
    expect(encoder.encodeInput(context({ kind: "paste", text: emoji }))).toBeNull();
    expect(sequenceOf(encoder.encodeInput(context(text())))).toBe(1);
  });
});
