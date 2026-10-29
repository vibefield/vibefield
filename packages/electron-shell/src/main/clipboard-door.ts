import {
  type ClipboardReadRefusal,
  ClipboardReadRequest,
  type ClipboardReadResult,
  ClipboardReadResult as ClipboardReadResultSchema,
  type ClipboardWriteImageRefusal,
  type ClipboardWriteImageResult,
  ClipboardWriteImageResult as ClipboardWriteImageResultSchema,
  SHELL_CLIPBOARD,
  SHELL_CLIPBOARD_AUDIT_ACTIONS,
  utf8ByteLength,
} from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";

// Item 102 (2026-10-29) — the clipboard's READ door, main's half of design-03
// §5.1's `shell.clipboard.*` for the product window. A paste in the deck or the
// sign-in terminal reads the system clipboard HERE: the shell session grants no
// Chromium permission (ESP §7.4), so the page's own `navigator.clipboard` read
// is denied by law, and the grant set stays empty.
//
// Pure, so it is pinned without Electron, like the screenshot door's policy:
//  · only a window THIS shell registered may ask (a stranger is warned, audited
//    `denied`, and the clipboard is never read);
//  · only while that window and its page are focused: a paste is the chord of
//    the person in front of the window, and a page reading the clipboard from
//    behind is the EL7 adversary's move;
//  · text over `SHELL_CLIPBOARD.READ_MAX_BYTES` is refused whole with its size,
//    never cut: half a paste into a shell is a different command;
//  · every answer and every refusal is audited, with the bytes and the page's id
//    and never the text, best-effort and never awaited: a paste is the person's
//    own chord in their own window and does not wait on fieldd, and a failed
//    append is the caller's warn line.
// The ipcMain wiring lives in ipc.ts, like every other door's.

export interface ClipboardDoorOptions<Sender extends { readonly id: number }> {
  readonly owns: (sender: Sender) => boolean;
  /** the sender's window AND its page hold the focus */
  readonly focused: (sender: Sender) => boolean;
  readonly read: () => string;
  readonly audit: (record: AuditAppendV1) => Promise<void>;
  readonly operationId: () => string;
  readonly onRefused?: (
    sender: Sender,
    reason: ClipboardReadRefusal | "unregistered",
    bytes?: number,
  ) => void;
  readonly onAuditFailed?: (error: unknown) => void;
}

export type ClipboardDoor<Sender extends { readonly id: number }> = (
  sender: Sender,
  raw: unknown,
) => Promise<ClipboardReadResult>;

const REASON_CODES = {
  unregistered: "UNREGISTERED_SENDER",
  unfocused: "UNFOCUSED",
  "too-large": "TOO_LARGE",
} as const satisfies Record<ClipboardReadRefusal | "unregistered", string>;

export function createClipboardDoor<Sender extends { readonly id: number }>(
  options: ClipboardDoorOptions<Sender>,
): ClipboardDoor<Sender> {
  const audit = (
    sender: Sender,
    refusal: ClipboardReadRefusal | "unregistered" | null,
    bytes?: number,
  ): void => {
    const record: AuditAppendV1 = {
      action: SHELL_CLIPBOARD_AUDIT_ACTIONS.READ,
      target: { kind: "clipboard", id: "system" },
      phase: "outcome",
      outcome: refusal === null ? "succeeded" : "denied",
      ...(refusal === null ? {} : { reasonCode: REASON_CODES[refusal] }),
      operationId: options.operationId(),
      attrs: { webContentsId: sender.id, ...(bytes === undefined ? {} : { bytes }) },
    };
    try {
      options.audit(record).catch((error: unknown) => options.onAuditFailed?.(error));
    } catch (error) {
      options.onAuditFailed?.(error);
    }
  };
  const refuse = (
    sender: Sender,
    reason: ClipboardReadRefusal,
    bytes?: number,
  ): ClipboardReadResult => {
    options.onRefused?.(sender, reason, bytes);
    audit(sender, reason, bytes);
    return ClipboardReadResultSchema.parse({
      status: "refused",
      reason,
      ...(bytes === undefined ? {} : { bytes }),
    });
  };
  return async (sender, raw) => {
    if (!options.owns(sender)) {
      options.onRefused?.(sender, "unregistered");
      audit(sender, "unregistered");
      throw new Error("clipboard read refused: unregistered sender");
    }
    ClipboardReadRequest.parse(raw);
    if (!options.focused(sender)) return refuse(sender, "unfocused");
    const text = options.read();
    const bytes = utf8ByteLength(text);
    if (bytes > SHELL_CLIPBOARD.READ_MAX_BYTES) return refuse(sender, "too-large", bytes);
    const result = ClipboardReadResultSchema.parse({ status: "read", text });
    audit(sender, null, bytes);
    return result;
  };
}

// HN-5 (2026-10-29) — the clipboard's PICTURE WRITE, the read's other half: a copy's
// picture (the desk's Copy of a selection) goes on the system clipboard HERE, for the
// read's reason — the shell session grants no Chromium permission (ESP §7.4), so the
// page's own `navigator.clipboard.write` is denied by law. A copy's words keep the
// host's copy door (`copyText`, main/index.ts), a program's OSC 52 among them.
//
// Pure, and the read's shape:
//  · only a window THIS shell registered may write: a stranger is warned and thrown at,
//    and nothing is decoded; a request that is not a picture's bytes throws the same
//    way, as the read's malformed request does (no product window sends one: the
//    preload checks before it sends);
//  · only while that window and its page are focused, the read's rule: a page writing
//    from behind would replace what the person copied in another app;
//  · bytes over `SHELL_CLIPBOARD.WRITE_IMAGE_MAX_BYTES` are refused whole with their
//    size and never decoded; bytes that decode to no picture are refused, and nothing
//    is written;
//  · no audit row: a copy is the person's own act on their own clipboard, and the
//    words' door keeps none either (LC-13).

export interface ClipboardImageDoorOptions<Sender extends { readonly id: number }, Picture> {
  readonly owns: (sender: Sender) => boolean;
  /** the sender's window AND its page hold the focus */
  readonly focused: (sender: Sender) => boolean;
  /** the PNG as a picture (main: `nativeImage.createFromBuffer`), null when it holds none */
  readonly decode: (png: Uint8Array) => Picture | null;
  /** the picture onto the system clipboard (main: `clipboard.writeImage`) */
  readonly write: (image: Picture) => void;
  /** A marked smoke run's record (R-T 4, main's `harnessPictures`): the picture's size kept IN
   * PLACE of the write — the pasteboard is the person's — after every check a write passes. */
  readonly keep?: (bytes: number) => void;
  readonly onRefused?: (
    sender: Sender,
    reason: ClipboardWriteImageRefusal | "unregistered",
    bytes?: number,
  ) => void;
}

export type ClipboardImageDoor<Sender extends { readonly id: number }> = (
  sender: Sender,
  raw: unknown,
) => Promise<ClipboardWriteImageResult>;

/** A picture's bytes as the page sends them: a Uint8Array (a Buffer is one) over a plain
 * ArrayBuffer — told by its tag, never `instanceof`, as the preload tells a still's bytes
 * (`isStillBytes`), so they read the same whichever realm made them. */
function isPngBytes(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === "[object Uint8Array]" &&
    Object.prototype.toString.call(value.buffer) === "[object ArrayBuffer]"
  );
}

export function createClipboardImageDoor<Sender extends { readonly id: number }, Picture>(
  options: ClipboardImageDoorOptions<Sender, Picture>,
): ClipboardImageDoor<Sender> {
  const refuse = (
    sender: Sender,
    reason: ClipboardWriteImageRefusal,
    bytes?: number,
  ): ClipboardWriteImageResult => {
    options.onRefused?.(sender, reason, bytes);
    return ClipboardWriteImageResultSchema.parse({
      status: "refused",
      reason,
      ...(bytes === undefined ? {} : { bytes }),
    });
  };
  return async (sender, raw) => {
    if (!options.owns(sender)) {
      options.onRefused?.(sender, "unregistered");
      throw new Error("clipboard write refused: unregistered sender");
    }
    if (!isPngBytes(raw)) throw new Error("clipboard write refused: not a picture's bytes");
    if (!options.focused(sender)) return refuse(sender, "unfocused");
    const bytes = raw.byteLength;
    if (bytes > SHELL_CLIPBOARD.WRITE_IMAGE_MAX_BYTES) return refuse(sender, "too-large", bytes);
    let image: Picture | null;
    try {
      image = options.decode(raw);
    } catch {
      image = null; // a decoder that throws on these bytes found no picture in them
    }
    if (image === null) return refuse(sender, "not-an-image", bytes);
    if (options.keep !== undefined) options.keep(bytes);
    else options.write(image);
    return ClipboardWriteImageResultSchema.parse({ status: "written" });
  };
}
