import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import {
  ScreenshotStillBytesRequest,
  ScreenshotStillKeptRequest,
  screenshotStillUrl,
} from "@vibefield/contracts";
import type { StillRefusal, StillResolution } from "./still-protocol";

// A RETAINED STILL'S BYTES (HN-D7; DESIGN.md §8 "The hand", where cards go) — what the desk prints
// when a snapshot is played onto it. The still scheme shows a still in an `<img>` and never lets
// script read its pixels (`supportFetchAPI: false`, an origin of its own — still-protocol.ts); a
// print is made from the pixels, so this door hands them over under the scheme's and Quick Look's
// authority: the page names a basename, never a path, and main finds it in the tool's own retained
// list (`resolveStill` — a lookup in the ring, not a look at the disk).
//
// The file is then judged by WHAT IS OPENED, never by its path: opened without following a symlink
// at it, its handle `fstat`ed — a regular file within the cap — and read from that same handle
// (`withStill`). A path checked and then opened again is a window a same-uid process (EL7) can
// swap a symlink, a FIFO, a device or a huge file through. A still the ring has let go, a file gone
// from the disk, a symlink planted where the helper wrote it, anything not a regular file: null.
//
// EL2 keeps bytes off the daemons' planes: fieldd's JSON-RPC, and Node between the daemons. This is
// the renderer↔main IPC door, where the bytes travel by structured clone, and they are the
// person's own screenshot, already theirs to show. One still is one screen's worth of PNG, read
// whole, as the scheme streams it to an `<img>`.
//
// Its twin asks only whether a still is still KEPT (HN-4): a snapshot's card played onto a pane
// pastes the still's path, and a path the ring has let go names nothing. The same lookup and the
// same handle, judged and closed; nothing is read.

/** Why a still's bytes were not handed over, or a still is not kept: the ring's refusals (a bad
 * name, one not retained), or what was opened — nothing at the path, not a regular file (a symlink
 * there, a FIFO, a directory, a device), past the cap, or a read that failed. */
export type StillBytesRefusal = StillRefusal | "too-large" | "unreadable";

/** What an opened still came to: the answer of what was done with its handle, or why not. */
export type StillOpened<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: StillBytesRefusal };

/** The most a still may weigh. One screen's PNG is far below it, so a file past it is not the
 * still the helper wrote — and main never holds it whole to find out. */
export const STILL_BYTES_CAP = 64 * 1024 * 1024;

/** Read only; never through a symlink at the path (O_NOFOLLOW); never waiting on a FIFO's writer
 * (O_NONBLOCK opens one at once, and the regular-file check then refuses it). Windows defines
 * neither flag, and has no FIFO to wait on. */
const STILL_OPEN_FLAGS =
  constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** An open that failed, in the door's words: nothing at the path, or what is there is not the
 * regular file the helper wrote — a symlink (O_NOFOLLOW's ELOOP; EMLINK on the BSDs), a directory
 * (EISDIR where opening one fails). */
function openRefusal(cause: unknown): StillBytesRefusal {
  const code = (cause as { readonly code?: unknown } | null)?.code;
  if (code === "ENOENT") return "missing-file";
  if (code === "ELOOP" || code === "EMLINK" || code === "EISDIR") return "not-a-file";
  return "unreadable";
}

/** Open a retained still's path and judge WHAT WAS OPENED: `fstat` on that handle, a regular file
 * within the cap. `use` is handed the handle and the size it measured; the handle is closed after,
 * whatever happens. Never throws: every failure is a refusal with its reason. */
export async function withStill<T>(
  path: string,
  use: (handle: FileHandle, size: number) => Promise<T>,
  cap = STILL_BYTES_CAP,
): Promise<StillOpened<T>> {
  let handle: FileHandle;
  try {
    handle = await open(path, STILL_OPEN_FLAGS);
  } catch (cause) {
    return { ok: false, reason: openRefusal(cause) };
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { ok: false, reason: "not-a-file" };
    if (stat.size > cap) return { ok: false, reason: "too-large" };
    return { ok: true, value: await use(handle, stat.size) };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Exactly `size` bytes from the start of an open still: a file that changed under the read is not
 * the still that was measured. */
async function readExactly(handle: FileHandle, size: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(size);
  let read = 0;
  while (read < size) {
    const { bytesRead } = await handle.read(bytes, read, size - read, read);
    if (bytesRead === 0) break;
    read += bytesRead;
  }
  if (read !== size) throw new Error("screenshot still: changed while it was read");
  return bytes;
}

/** A retained still's bytes, read from the handle it was judged by. */
export function readStill(path: string, cap = STILL_BYTES_CAP): Promise<StillOpened<Uint8Array>> {
  return withStill(path, (handle, size) => readExactly(handle, size), cap);
}

/** Whether a retained still's path opens to the still: a regular file within the cap, judged by
 * its handle, which is then closed; nothing is read. */
export function checkStill(path: string, cap = STILL_BYTES_CAP): Promise<StillOpened<true>> {
  return withStill(path, async () => true as const, cap);
}

export function createScreenshotStillBytesDoor<Sender>(options: {
  owns: (sender: Sender) => boolean;
  /** The ring's lookup: the retained path a still's name answers to (`resolveStill`), no disk. */
  find: (url: string) => StillResolution;
  /** The still at that path, read from its own handle (`readStill`). */
  read: (path: string) => Promise<StillOpened<Uint8Array>>;
  onRefused?: (reason: StillBytesRefusal) => void;
}): (sender: Sender, raw: unknown) => Promise<Uint8Array | null> {
  return async (sender, raw) => {
    if (!options.owns(sender)) throw new Error("screenshot still refused: unregistered sender");
    const { name } = ScreenshotStillBytesRequest.parse(raw);
    const still = options.find(screenshotStillUrl(name));
    const read = still.ok ? await options.read(still.path) : still;
    if (read.ok) return read.value;
    options.onRefused?.(read.reason);
    return null;
  };
}

/** HN-4 — whether one still is still kept: the bytes door's sender check and lookup, and its handle
 * judged the same way (`checkStill`), answered as a boolean. A stranger or a malformed name throws,
 * as there. */
export function createScreenshotStillKeptDoor<Sender>(options: {
  owns: (sender: Sender) => boolean;
  /** The ring's lookup, as the bytes door's. */
  find: (url: string) => StillResolution;
  /** The still at that path, judged by its own handle (`checkStill`). */
  check: (path: string) => Promise<StillOpened<true>>;
  onRefused?: (reason: StillBytesRefusal) => void;
}): (sender: Sender, raw: unknown) => Promise<boolean> {
  return async (sender, raw) => {
    if (!options.owns(sender)) throw new Error("screenshot still refused: unregistered sender");
    const { name } = ScreenshotStillKeptRequest.parse(raw);
    const still = options.find(screenshotStillUrl(name));
    const checked = still.ok ? await options.check(still.path) : still;
    if (!checked.ok) options.onRefused?.(checked.reason);
    return checked.ok;
  };
}
