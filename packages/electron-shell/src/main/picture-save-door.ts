import { basename, dirname, extname } from "node:path";
import {
  PICTURE_SAVE_EXTENSIONS,
  type PictureSaveRefusal,
  type PictureSaveResult,
  PictureSaveResult as PictureSaveResultSchema,
  type PictureSaveType,
  pictureSaveTypeOf,
  SHELL_PICTURE_AUDIT_ACTIONS,
  SHELL_PICTURE_SAVE,
} from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";

// Item 578 (2026-11-19) — A PRINT'S PICTURE SAVED WHERE THE PERSON CHOOSES (DESIGN.md §8 "The bar grown": Download…).
// A print's bytes live in the window's own store, and a page may not write the person's disk, so the save is main's:
// the page hands over the picture's bytes and NOTHING else, and main alone names the file and, through its own save
// panel, the place.
//
// Pure, so it is pinned without Electron, like the clipboard's doors:
//  · only a window THIS shell registered may ask: a stranger is warned, audited `denied` and thrown at, and a
//    request that is not bytes throws the same way; no panel opens for either;
//  · bytes over `SHELL_PICTURE_SAVE.MAX_BYTES` are refused whole with their size, before anything else is read;
//  · the format is read off the bytes against the closed list (`pictureSaveTypeOf`), never taken from the page: bytes
//    that open as none of them are refused, so the door writes pictures and nothing else;
//  · the NAME is main's own, "Picture" and the day with the format's extension: a print keeps no name, and none comes
//    from the page, so there is nothing of the page's to sanitize;
//  · the PLACE is the panel's answer alone: it opens at the folder this door last saved to in this run, else wherever
//    the caller's panel starts (Downloads). A name the person typed without the format's extension is given it, and is
//    then written only where no file stands, because the panel asked about the name it was shown, not this one;
//  · ONE panel at a time: a second ask while one is open is refused `busy`;
//  · the answer names the folder by its own name, for the status line, never a path;
//  · every answer and every refusal is audited: the bytes' count, the format and the saved file's own name, never the
//    picture and never the folder. Best-effort and never awaited, as the clipboard read's is: a save is the person's
//    own act on their own picture and does not wait on fieldd, and a failed append is the caller's warn line.
// The ipcMain wiring lives in ipc.ts, like every other door's; the panel and the write are the caller's.

/** What main's panel is asked to show: the name it proposes, the folder it opens at (null: the caller's own start,
 * Downloads), and the extensions the format's name may end in. */
export interface PictureSaveProposal {
  readonly name: string;
  readonly folder: string | null;
  readonly extensions: readonly string[];
}

/** What the log is told of a refusal beside its reason: the bytes' count, and a failure's cause (`causeOf`: a code
 * or a class name, never a message). */
export interface PictureSaveRefusalDetail {
  readonly bytes?: number;
  readonly error?: string;
}

export interface PictureSaveDoorOptions<Sender extends { readonly id: number }> {
  readonly owns: (sender: Sender) => boolean;
  /** main's own save panel over the sender's window: the path the person chose, or null when they closed it */
  readonly choose: (sender: Sender, proposal: PictureSaveProposal) => Promise<string | null>;
  /** write the picture: `replace` where the panel asked about this very name, `new` only where no file stands */
  readonly write: (path: string, bytes: Uint8Array, how: "replace" | "new") => Promise<void>;
  /** the person's own day, as `YYYY-MM-DD` */
  readonly today: () => string;
  readonly audit: (record: AuditAppendV1) => Promise<void>;
  readonly operationId: () => string;
  readonly onRefused?: (
    sender: Sender,
    reason: PictureSaveRefusal | "unregistered",
    detail?: PictureSaveRefusalDetail,
  ) => void;
  readonly onAuditFailed?: (error: unknown) => void;
}

export type PictureSaveDoor<Sender extends { readonly id: number }> = (
  sender: Sender,
  raw: unknown,
) => Promise<PictureSaveResult>;

/** The name main proposes: "Picture", the day, the format's own extension. PURE. */
export function pictureSaveName(day: string, type: PictureSaveType): string {
  return `Picture ${day}.${PICTURE_SAVE_EXTENSIONS[type][0]}`;
}

/** A day as the person's own calendar says it, `YYYY-MM-DD`: the name's day is theirs, not UTC's. PURE. */
export function localDay(at: Date): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

/** Where a chosen path is written: as chosen when its name ends in one of the format's extensions (the panel asked
 * before replacing it), else with the format's extension added, and then only where no file stands. PURE. */
export function savedPathOf(
  chosen: string,
  type: PictureSaveType,
): { readonly path: string; readonly how: "replace" | "new" } {
  const extensions: readonly string[] = PICTURE_SAVE_EXTENSIONS[type];
  const ending = extname(chosen).slice(1).toLowerCase();
  return extensions.includes(ending)
    ? { path: chosen, how: "replace" }
    : { path: `${chosen}.${PICTURE_SAVE_EXTENSIONS[type][0]}`, how: "new" };
}

/** A failure's cause for the log: the system's own code where it has one (`EACCES`, `ENOSPC`), else the error's
 * class name, else "Error". NEVER its message: a file error's message carries the path it failed at, and nothing
 * here can tell which other message does. PURE. */
export function causeOf(error: unknown): string {
  const code = (error as { readonly code?: unknown } | null)?.code;
  if (typeof code === "string" && code !== "") return code.slice(0, 64);
  const name = error instanceof Error ? error.name : "";
  return name === "" ? "Error" : name.slice(0, 64);
}

type Outcome = NonNullable<AuditAppendV1["outcome"]>;

export function createPictureSaveDoor<Sender extends { readonly id: number }>(
  options: PictureSaveDoorOptions<Sender>,
): PictureSaveDoor<Sender> {
  /** the folder this door last saved to, in this run of the shell */
  let lastFolder: string | null = null;
  let open = false;

  const audit = (
    sender: Sender,
    outcome: Outcome,
    reasonCode: string | undefined,
    attrs: Record<string, string | number>,
  ): void => {
    const record: AuditAppendV1 = {
      action: SHELL_PICTURE_AUDIT_ACTIONS.SAVE,
      target: { kind: "picture", id: "desk-print" },
      phase: "outcome",
      outcome,
      ...(reasonCode === undefined ? {} : { reasonCode }),
      operationId: options.operationId(),
      attrs: { webContentsId: sender.id, ...attrs },
    };
    try {
      options.audit(record).catch((error: unknown) => options.onAuditFailed?.(error));
    } catch (error) {
      options.onAuditFailed?.(error);
    }
  };
  const refuse = (
    sender: Sender,
    reason: PictureSaveRefusal,
    said: { readonly outcome: Outcome; readonly code: string },
    attrs: Record<string, string | number>,
    detail: PictureSaveRefusalDetail,
  ): PictureSaveResult => {
    options.onRefused?.(sender, reason, detail);
    audit(sender, said.outcome, said.code, attrs);
    return PictureSaveResultSchema.parse({
      status: "refused",
      reason,
      ...(reason === "too-large" && detail.bytes !== undefined ? { bytes: detail.bytes } : {}),
    });
  };

  return async (sender, raw) => {
    if (!options.owns(sender)) {
      options.onRefused?.(sender, "unregistered");
      audit(sender, "denied", "UNREGISTERED_SENDER", {});
      throw new Error("picture save refused: unregistered sender");
    }
    if (!(raw instanceof Uint8Array)) {
      throw new Error("picture save refused: a picture is saved from the picture's bytes");
    }
    const bytes = raw.byteLength;
    if (bytes > SHELL_PICTURE_SAVE.MAX_BYTES) {
      const said = { outcome: "denied", code: "TOO_LARGE" } as const;
      return refuse(sender, "too-large", said, { bytes }, { bytes });
    }
    const type = pictureSaveTypeOf(raw);
    if (type === null) {
      const said = { outcome: "denied", code: "NOT_A_PICTURE" } as const;
      return refuse(sender, "not-a-picture", said, { bytes }, { bytes });
    }
    const attrs = { bytes, mediaType: type };
    if (open) {
      return refuse(sender, "busy", { outcome: "denied", code: "BUSY" }, attrs, { bytes });
    }
    open = true;
    try {
      let chosen: string | null;
      try {
        chosen = await options.choose(sender, {
          name: pictureSaveName(options.today(), type),
          folder: lastFolder,
          extensions: PICTURE_SAVE_EXTENSIONS[type],
        });
      } catch (error) {
        const said = { outcome: "failed", code: "DIALOG_FAILED" } as const;
        return refuse(sender, "failed", said, attrs, { bytes, error: causeOf(error) });
      }
      if (chosen === null) {
        audit(sender, "cancelled", "USER_CANCELLED", attrs);
        return PictureSaveResultSchema.parse({ status: "cancelled" });
      }
      const { path, how } = savedPathOf(chosen, type);
      try {
        await options.write(path, raw, how);
      } catch (error) {
        const said = { outcome: "failed", code: "WRITE_FAILED" } as const;
        return refuse(sender, "failed", said, attrs, { bytes, error: causeOf(error) });
      }
      lastFolder = dirname(path);
      audit(sender, "succeeded", undefined, { ...attrs, name: basename(path).slice(0, 255) });
      return PictureSaveResultSchema.parse({
        status: "saved",
        folder: basename(lastFolder).slice(0, 255),
      });
    } finally {
      open = false;
    }
  };
}
