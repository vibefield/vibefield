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
//
// SIZE (D6). The cell reads its control leg capped at
// MAX_CONTROL_MESSAGE_BYTES, and an oversize frame is a READ ERROR there that
// tears the leg down, so no larger message is ever handed to the runtime. A
// paste that does not fit one message rides as `paste-part`s, which the cell
// reassembles into ONE engine paste (the contract's rules) — `encodeInputs`
// plans them, and only where `pasteParts` says the activation's leg echoed
// `paste-parts`. The pinned runtime's seam, `encodeInput`, carries exactly one
// message per operation, so through it such a paste is refused. A refusal for
// size is REPORTED (`onRefused`) so the person is told: the runtime itself says
// nothing about a null (its `#sendRoutedInput` returns false, and `paste`
// drops that answer), so this encoder is the only side that knows. It reports
// in the person's own measure — the text's UTF-8, the size Finder gives the
// file it was copied from — never the message's: a message spends two bytes on
// a tab or a quote and six on a control character, so its size is no number a
// person can check.
import type {
  RoutedTerminalInputContext,
  RoutedTerminalInputOperation,
} from "@vibecook/ghosttea-react";
import { SendInput, type SendInputOp, TERMINAL_PIPELINE, tagTpMessage } from "@vibefield/contracts";

/** A UTF-16 surrogate with no partner: it has no UTF-8 form. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Text as the PTY can take it. `JSON.stringify` writes a lone surrogate as a
 * `\udXXX` escape, the cell's serde refuses that escape when it reads a Rust
 * `String`, and `handle_text` makes the refusal a PROTOCOL close of the whole
 * control leg — every activation on it, for one stray code unit in a paste.
 * The PTY is fed UTF-8, where a lone surrogate is U+FFFD (`TextEncoder` makes
 * it the same), so that is the faithful projection, not an invented one. */
function wellFormed(text: string): string {
  return text.replace(LONE_SURROGATE, "\uFFFD");
}

function encodeOp(operation: RoutedTerminalInputOperation): SendInputOp | null {
  switch (operation.kind) {
    case "text":
      return { kind: "text", text: wellFormed(operation.text) };
    case "paste":
      return { kind: "paste", text: wellFormed(operation.text) };
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
      // (a null makes the runtime send nothing) rather than ship a guess.
      return null;
  }
}

type WireMessage = Readonly<Record<string, unknown>>;

const utf8 = new TextEncoder();

/** The control characters `JSON.stringify` writes as a two-byte escape
 * (backspace, tab, newline, form feed, return); the rest of C0 take six. */
const SHORT_ESCAPES: ReadonlySet<number> = new Set([0x08, 0x09, 0x0a, 0x0c, 0x0d]);

/** The UTF-8 bytes `JSON.stringify` spends on one code point inside a string:
 * a quote or a backslash is escaped in two, a C0 control in two or six, and
 * everything else is its own UTF-8 (DEL and the line separators are not
 * escaped). Text reaching here is well-formed: there is no lone surrogate. */
function jsonBytes(codePoint: number): number {
  if (codePoint === 0x22 || codePoint === 0x5c) return 2;
  if (codePoint < 0x20) return SHORT_ESCAPES.has(codePoint) ? 2 : 6;
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x1_0000) return 3;
  return 4;
}

/** The UTF-8 bytes of one code point. */
function utf8Width(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x1_0000) return 3;
  return 4;
}

/** The UTF-8 bytes of well-formed text — the size the PTY is handed. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index) ?? 0;
    bytes += utf8Width(codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return bytes;
}

/** What a text weighs against one message's room for it. */
interface TextWeight {
  /** Its own UTF-8 — the size a person can check. */
  readonly bytes: number;
  /** What a message spends on it as a JSON string body, its quotes aside. */
  readonly json: number;
  /** The own UTF-8 of its longest prefix, cut between code points, whose body
   * spends at most the room: the most of THIS text one message carries. */
  readonly fits: number;
}

/** `text` weighed against `room` bytes of JSON string body — counted in one
 * pass, never built: a paste can be far larger than any message, and
 * stringifying it whole only to learn that would copy it twice. */
function weigh(text: string, room: number): TextWeight {
  let bytes = 0;
  let json = 0;
  let fits = 0;
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index) ?? 0;
    bytes += utf8Width(codePoint);
    json += jsonBytes(codePoint);
    if (json <= room) fits = bytes;
    index += codePoint > 0xffff ? 2 : 1;
  }
  return { bytes, json, fits };
}

/** `text` cut into the fewest parts whose JSON string bodies each spend at
 * most `budget` bytes, always BETWEEN code points: a surrogate pair is never
 * split, so every part is well-formed on its own. */
function splitForJson(text: string, budget: number): string[] {
  const parts: string[] = [];
  let start = 0;
  let spent = 0;
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index) ?? 0;
    const bytes = jsonBytes(codePoint);
    if (spent + bytes > budget && index > start) {
      parts.push(text.slice(start, index));
      start = index;
      spent = 0;
    }
    spent += bytes;
    index += codePoint > 0xffff ? 2 : 1;
  }
  parts.push(text.slice(start));
  return parts;
}

/** The size the cell's reader measures: the UTF-8 bytes of the exact JSON the
 * runtime sends (UTF-16 length undercounts multi-byte text). */
function wireBytes(message: WireMessage): number {
  return utf8.encode(JSON.stringify(message)).length;
}

/** A paste or typed text refused for its size — the person is told, never
 * only dropped (the pool hands it to the line). Both sizes are the TEXT's own
 * UTF-8, the measure a person can check, and `limitBytes` is always below
 * `bytes`. The other refusals (an unknown kind, a full ledger, a spent counter)
 * are this build's own faults and stay closed without words. */
export interface RoutedInputRefusal {
  readonly sessionId: string;
  /** What was refused: a paste (⌘V, the line's send) or typed text. */
  readonly kind: "paste" | "text";
  /** The text's own UTF-8 size. */
  readonly bytes: number;
  /** The most of THIS text that rides, in the same measure: where it had to be
   * one message, its longest prefix whose message fits (so its tabs, quotes and
   * control characters are counted as the message spends them); for a paste in
   * parts, `MAX_PASTE_BYTES` (0 where an envelope leaves a part no room). */
  readonly limitBytes: number;
}

export interface RoutedInputEncoderOptions {
  /** The owning routed host's admitted-session ceiling. No implicit eviction:
   * evicting a live entry could restart its sequence and replay input. */
  readonly maxTrackedSessions: number;
  /** Told of each paste or typed text refused for its size, synchronously,
   * before the encoder answers null — the one place the refusal is known. */
  readonly onRefused?: (refusal: RoutedInputRefusal) => void;
  /** Whether `encodeInputs` may send a paste as parts for this context: its
   * activation's control leg was accepted with `paste-parts`. Asked only of a
   * paste too large for one message. Absent: never. */
  readonly pasteParts?: (context: RoutedTerminalInputContext) => boolean;
}

export interface RoutedInputEncoder {
  /** The `GhostteaRoutedHost.encodeInput` implementation: ONE message per
   * operation, which is all the pinned runtime's seam carries, so a paste too
   * large for one message is refused here. This is an arrow function and can
   * be installed directly as `host.encodeInput`. */
  readonly encodeInput: (context: RoutedTerminalInputContext) => WireMessage | null;
  /** One operation's whole encoding, in send order: its one message, or — for
   * a paste too large for one, where `pasteParts` allows — its `paste-part`s,
   * their sequences consecutive. A runtime sends them all, in this order, or
   * none. Null when refused, exactly as `encodeInput`. */
  readonly encodeInputs: (context: RoutedTerminalInputContext) => readonly WireMessage[] | null;
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
  // The cell reads with tungstenite capped at this, and an oversize frame is a
  // READ ERROR there — it would tear down the control leg (every activation on
  // it), not drop one message. No message past it is ever handed out.
  const maxMessageBytes = TERMINAL_PIPELINE.MAX_CONTROL_MESSAGE_BYTES;

  const sessions = new Map<string, SessionInputSequence>();
  let disposed = false;

  const refuse = (
    sessionId: string,
    kind: RoutedInputRefusal["kind"],
    bytes: number,
    limitBytes: number,
  ): null => {
    options.onRefused?.({ sessionId, kind, bytes, limitBytes });
    return null;
  };

  /** One SendInput exactly as the wire carries it; null when the contract
   * refuses the body. */
  const wire = (
    context: RoutedTerminalInputContext,
    inputSequence: number,
    op: SendInputOp,
  ): WireMessage | null => {
    const parsed = SendInput.safeParse({
      sessionId: context.sessionId,
      activationId: context.activationId,
      leaseEpoch: context.leaseEpoch,
      inputSequence,
      op,
    });
    return parsed.success ? tagTpMessage("SendInput", parsed.data) : null;
  };

  /** A paste too large for one message, as its parts — or its refusal when the
   * whole is past what the cell reassembles. */
  const planParts = (
    context: RoutedTerminalInputContext,
    lastSequence: number,
    text: string,
  ): WireMessage[] | null => {
    const bytes = utf8Bytes(text);
    if (bytes > TERMINAL_PIPELINE.MAX_PASTE_BYTES) {
      return refuse(context.sessionId, "paste", bytes, TERMINAL_PIPELINE.MAX_PASTE_BYTES);
    }
    // The envelope at its widest — the largest sequence and index a part can
    // name, and `false` — so every part fits whatever its place.
    const widest = wire(context, Number.MAX_SAFE_INTEGER, {
      kind: "paste-part",
      index: 0xffff_ffff,
      last: false,
      text: "",
    });
    if (widest === null) return null;
    const budget = maxMessageBytes - wireBytes(widest);
    // An envelope this wide leaves no room for even one escaped character: no
    // part could carry any of it.
    if (budget < 6) return refuse(context.sessionId, "paste", bytes, 0);
    const texts = splitForJson(text, budget);
    if (lastSequence > Number.MAX_SAFE_INTEGER - texts.length) return null;
    const parts: WireMessage[] = [];
    for (const [index, part] of texts.entries()) {
      const message = wire(context, lastSequence + 1 + index, {
        kind: "paste-part",
        index,
        last: index === texts.length - 1,
        text: part,
      });
      if (message === null) return null;
      // The budget makes this impossible; the measure is still the authority.
      // A disagreement is the count's fault — this build's, closed as its other
      // faults are: no number the line could say of it would be true.
      if (wireBytes(message) > maxMessageBytes) return null;
      parts.push(message);
    }
    return parts;
  };

  const encode = (
    context: RoutedTerminalInputContext,
    mayPart: () => boolean,
  ): WireMessage[] | null => {
    if (disposed) return null;

    const op = encodeOp(context.operation);
    if (op === null) return null;

    const previous = sessions.get(context.sessionId);
    if (previous === undefined && sessions.size >= maxTrackedSessions) return null;

    const lastSequence =
      previous?.activationId === context.activationId ? previous.lastSequence : 0;
    if (lastSequence >= Number.MAX_SAFE_INTEGER) return null;

    let messages: WireMessage[] | null;
    if (op.kind === "text" || op.kind === "paste") {
      // The size a person chose: weighed BEFORE the message is built, against
      // the room the envelope (built exactly, with an empty text) leaves it.
      const envelope = wire(context, lastSequence + 1, { ...op, text: "" });
      if (envelope === null) return null;
      const room = maxMessageBytes - wireBytes(envelope);
      const weight = weigh(op.text, room);
      if (weight.json <= room) {
        const message = wire(context, lastSequence + 1, op);
        // The count makes an oversize message impossible; the measure is still
        // the authority, and a disagreement is this build's fault (above).
        if (message === null || wireBytes(message) > maxMessageBytes) return null;
        messages = [message];
      } else if (op.kind === "paste" && mayPart()) {
        messages = planParts(context, lastSequence, op.text);
      } else {
        return refuse(context.sessionId, op.kind, weight.bytes, weight.fits);
      }
    } else {
      const message = wire(context, lastSequence + 1, op);
      // No other kind carries a size a person chose: past the cap it is this
      // build's fault, and closed without words.
      if (message === null || wireBytes(message) > maxMessageBytes) return null;
      messages = [message];
    }
    if (messages === null) return null;

    // Commit only after the whole wire body validates. A malformed or refused
    // operation cannot allocate a session slot or spend a sequence number.
    sessions.set(context.sessionId, {
      activationId: context.activationId,
      lastSequence: lastSequence + messages.length,
    });
    return messages;
  };

  return {
    encodeInput: (context) => encode(context, () => false)?.[0] ?? null,
    encodeInputs: (context) => encode(context, () => options.pasteParts?.(context) === true),
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
