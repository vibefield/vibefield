// TP-S3-input — the renderer half of the input verb, drift-guarded against the
// contract. Ghosttea numbers input per DOM view; this helper must emit one
// monotonic sequence per activation because the cell maps that activation to
// one engine view.
import type { RoutedTerminalInputContext } from "@vibecook/ghosttea-react";
import {
  decodeTpMessage,
  SendInput,
  TERMINAL_PIPELINE,
  TP_LEG_INBOUND,
  tagTpMessage,
} from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createRoutedInputEncoder,
  type RoutedInputRefusal,
} from "../src/terminal/routed/encode-input";

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

  it("sends a lone surrogate as U+FFFD, never an escape the cell's reader closes the leg on", () => {
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1 });
    // A high surrogate with no partner, a low one with none, and a real pair
    // (U+1F4A5) between them, which must arrive untouched.
    const broken = "a\uD83Db\uDCA5c\u{1F4A5}d\uD83D";
    for (const kind of ["paste", "text"] as const) {
      const message = encoder.encodeInput(context({ kind, text: broken }));
      const op = SendInput.parse(message).op;
      expect(op.kind).toBe(kind);
      if (op.kind !== "paste" && op.kind !== "text") throw new Error(kind);
      expect(op.text).toBe("a\uFFFDb\uFFFDc\u{1F4A5}d\uFFFD");
      // what the leg carries is well-formed: no surrogate escape at all
      expect(JSON.stringify(message)).not.toMatch(/\\ud[89a-f]/i);
    }
    // well-formed text is sent as it is, byte for byte
    const fine = "naïve 日本 \u{1F4A5}";
    const op = SendInput.parse(encoder.encodeInput(context({ kind: "paste", text: fine }))).op;
    expect(op).toMatchObject({ kind: "paste", text: fine });
  });
});

// D6 — a paste whose one message would pass the cell's read cap. Through the
// pinned runtime's one-message seam it is REFUSED, and the refusal is reported
// for the person (the runtime itself says nothing about a null); where the leg
// negotiated `paste-parts` it rides as parts the cell joins into ONE engine paste.
describe("a paste larger than one control message (D6)", () => {
  const CAP = TERMINAL_PIPELINE.MAX_CONTROL_MESSAGE_BYTES;
  const wireBytes = (message: Readonly<Record<string, unknown>>): number =>
    new TextEncoder().encode(JSON.stringify(message)).length;
  /** Text that spends every kind of escape: a quote, a backslash, a newline, a
   * tab, a C0 control (six bytes), two- and three-byte UTF-8 and an astral pair. */
  const JSONISH = '{"k": "a\\b",\n\t\u0001é日\u{1F4A5}}';
  const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  const recording = () => {
    const refusals: RoutedInputRefusal[] = [];
    return { refusals, onRefused: (refusal: RoutedInputRefusal) => refusals.push(refusal) };
  };

  it("refuses it through the one-message seam, and says its own size and how much of it fits", () => {
    const { refusals, onRefused } = recording();
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1, onRefused });
    // Escape-heavy text whose OWN size is under the cap and whose message is
    // over it: the case where the message's size is no number a person can check.
    const big = JSONISH.repeat(9_000);
    const ownBytes = (value: string): number => new TextEncoder().encode(value).length;
    const message = (value: string) =>
      tagTpMessage("SendInput", {
        sessionId: "sess-1",
        activationId: "act-1",
        leaseEpoch: 4,
        inputSequence: 1,
        op: { kind: "paste", text: value },
      });
    expect(ownBytes(big)).toBeLessThan(CAP);
    expect(wireBytes(message(big))).toBeGreaterThan(CAP);
    expect(encoder.encodeInput(context({ kind: "paste", text: big }))).toBeNull();
    // The most of it that fits, found by BUILDING messages — never the
    // encoder's count — over its code points: the longest prefix whose one
    // message is inside the cap.
    const points = Array.from(big);
    let fit = 0;
    let over = points.length;
    while (over - fit > 1) {
      const mid = Math.floor((fit + over) / 2);
      if (wireBytes(message(points.slice(0, mid).join(""))) <= CAP) fit = mid;
      else over = mid;
    }
    // both in the text's own UTF-8: the size Finder gives, and what of it fits
    expect(refusals).toEqual([
      {
        sessionId: "sess-1",
        kind: "paste",
        bytes: ownBytes(big),
        limitBytes: ownBytes(points.slice(0, fit).join("")),
      },
    ]);
    expect(refusals[0]?.limitBytes).toBeLessThan(refusals[0]?.bytes ?? 0);
  });

  it("a refusal spends nothing: no ledger slot, no sequence", () => {
    const { refusals, onRefused } = recording();
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1, onRefused });
    expect(encoder.encodeInput(context({ kind: "paste", text: "x".repeat(CAP) }))).toBeNull();
    expect(refusals).toHaveLength(1);
    // the one slot is still free for another session, which starts at 1
    expect(sequenceOf(encoder.encodeInput(context(text(), { sessionId: "sess-2" })))).toBe(1);
  });

  it("a paste that fits stays ONE paste op, and the leg is not even asked about parts", () => {
    const pasteParts = vi.fn(() => true);
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1, pasteParts });
    const messages = encoder.encodeInputs(context({ kind: "paste", text: JSONISH }));
    expect(messages).toHaveLength(1);
    expect(SendInput.parse(messages?.[0]).op).toMatchObject({ kind: "paste", text: JSONISH });
    expect(pasteParts).not.toHaveBeenCalled();
  });

  it("where the leg negotiated parts, it rides as consecutive paste-parts, whole when joined", () => {
    const { refusals, onRefused } = recording();
    const pasteParts = vi.fn(() => true);
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1, onRefused, pasteParts });
    const big = JSONISH.repeat(30_000);
    const messages = encoder.encodeInputs(context({ kind: "paste", text: big }));
    expect(refusals).toEqual([]);
    expect(pasteParts).toHaveBeenCalledWith(expect.objectContaining({ activationId: "act-1" }));
    expect(messages).not.toBeNull();
    const parts = messages ?? [];
    expect(parts.length).toBeGreaterThan(2);
    const texts: string[] = [];
    for (const [index, message] of parts.entries()) {
      // each one a SendInput the control leg takes, inside the cell's read cap
      expect(decodeTpMessage(message, TP_LEG_INBOUND.control).ok).toBe(true);
      expect(wireBytes(message)).toBeLessThanOrEqual(CAP);
      const body = SendInput.parse(message);
      expect(body.inputSequence).toBe(index + 1);
      expect(body.op).toMatchObject({
        kind: "paste-part",
        index,
        last: index === parts.length - 1,
      });
      if (body.op.kind !== "paste-part") throw new Error("kind");
      // cut between code points: no part begins or ends inside a pair
      expect(LONE.test(body.op.text)).toBe(false);
      texts.push(body.op.text);
    }
    expect(texts.join("")).toBe(big);
    // the next input follows the last part on the same activation's sequence
    expect(sequenceOf(encoder.encodeInput(context(text())))).toBe(parts.length + 1);
  });

  it("where the leg did not negotiate parts, encodeInputs refuses as the one-message seam does", () => {
    const { refusals, onRefused } = recording();
    const pasteParts = vi.fn(() => false);
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1, onRefused, pasteParts });
    expect(encoder.encodeInputs(context({ kind: "paste", text: "y".repeat(CAP) }))).toBeNull();
    expect(pasteParts).toHaveBeenCalledTimes(1);
    // plain text: what fits is the cap less the envelope, in its own bytes
    expect(refusals).toMatchObject([{ kind: "paste", bytes: CAP }]);
    expect(refusals[0]?.limitBytes).toBeLessThan(CAP);
    expect(refusals[0]?.limitBytes).toBeGreaterThan(CAP - 1_024);
  });

  it("a paste past MAX_PASTE_BYTES is refused even with parts — its own UTF-8 size said", () => {
    const { refusals, onRefused } = recording();
    const encoder = createRoutedInputEncoder({
      maxTrackedSessions: 1,
      onRefused,
      pasteParts: () => true,
    });
    const huge = "é".repeat(TERMINAL_PIPELINE.MAX_PASTE_BYTES / 2 + 1);
    expect(encoder.encodeInputs(context({ kind: "paste", text: huge }))).toBeNull();
    expect(refusals).toEqual([
      {
        sessionId: "sess-1",
        kind: "paste",
        bytes: TERMINAL_PIPELINE.MAX_PASTE_BYTES + 2,
        limitBytes: TERMINAL_PIPELINE.MAX_PASTE_BYTES,
      },
    ]);
    expect(sequenceOf(encoder.encodeInput(context(text())))).toBe(1);
  });

  it("typed text too large for one message is refused in words too, and never parted", () => {
    const { refusals, onRefused } = recording();
    const pasteParts = vi.fn(() => true);
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1, onRefused, pasteParts });
    expect(encoder.encodeInputs(context({ kind: "text", text: "z".repeat(CAP) }))).toBeNull();
    expect(pasteParts).not.toHaveBeenCalled();
    expect(refusals).toMatchObject([{ kind: "text", bytes: CAP }]);
    expect(refusals[0]?.limitBytes).toBeLessThan(CAP);
  });

  it("keys and the other kinds never speak a refusal: their size is no person's choice", () => {
    const { refusals, onRefused } = recording();
    const encoder = createRoutedInputEncoder({ maxTrackedSessions: 1, onRefused });
    const key = {
      type: "down" as const,
      key: "k".repeat(CAP),
      code: "KeyK",
      location: 0,
      repeat: false,
      shift: false,
      control: false,
      alt: false,
      meta: false,
      timestamp: 0,
    };
    expect(encoder.encodeInput(context({ kind: "key", event: key }))).toBeNull();
    expect(refusals).toEqual([]);
  });
});
