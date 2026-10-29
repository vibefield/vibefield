import {
  type ClipboardReadRefusal,
  ClipboardReadRequest,
  type ClipboardReadResult,
  ClipboardReadResult as ClipboardReadResultSchema,
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
