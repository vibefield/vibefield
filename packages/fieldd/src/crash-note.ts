import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// VT-4a (track VT, 2026-11-24) — FIELDD'S CRASH NOTE: nothing dies silently. An error nobody caught ends fieldd,
// and until now the only trace of it was Node's own print on a stderr that has no reader once the shell is gone.
// The structured log cannot say it either: its writer is asynchronous, and the process is ending.
//
// So the error is written to one small file, synchronously, in the same turn the runtime reports it, and the NEXT
// fieldd reads it at boot, says it in its log (`fieldd.lifecycle.previous_crash`) and removes it. The floor's cells
// keep a crumb the same way (`field-native/src/cell.rs`).
//
// It only watches. `uncaughtExceptionMonitor` is told of the error before the runtime acts on it and changes
// nothing of what happens next: fieldd still ends as it always did, with Node's own print and exit code. A promise
// nobody handled reaches the same event (its origin says so).
//
// The note is the error's name, its message and its stack, bounded, in a file of this user's own data root (0600).
// It is this device's and is never sent anywhere.

/** How much of a message and of a stack the note keeps, in characters. */
export const CRASH_NOTE_MESSAGE_MAX = 2_000;
export const CRASH_NOTE_STACK_MAX = 16_000;

export interface CrashNote {
  v: 1;
  /** unix ms, the wall clock a log record's `time` reads */
  at: number;
  pid: number;
  /** the boot it ended, as that boot's log records name it */
  bootId: string;
  /** `uncaughtException` or `unhandledRejection`, the runtime's own word */
  origin: string;
  name: string;
  message: string;
  stack: string;
}

const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more)`;

/** The note for an error nobody caught. Anything can be thrown, so nothing of its shape is trusted. */
export function crashNoteOf(
  error: unknown,
  origin: string,
  who: { at: number; pid: number; bootId: string },
): CrashNote {
  const read = (key: "name" | "message" | "stack"): string => {
    try {
      const value = (error as Record<string, unknown> | null | undefined)?.[key];
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  };
  let said = read("message");
  if (said === "") {
    try {
      said = typeof error === "string" ? error : String(error);
    } catch {
      said = "an error that could not be said";
    }
  }
  return {
    v: 1,
    at: who.at,
    pid: who.pid,
    bootId: who.bootId,
    origin: cut(origin, 64),
    name: cut(read("name") || "Error", 128),
    message: cut(said, CRASH_NOTE_MESSAGE_MAX),
    stack: cut(read("stack"), CRASH_NOTE_STACK_MAX),
  };
}

/** Read the note a previous fieldd left, and remove it: it is said once. Null when there is none, or when what is
 * there is not a note (it is removed all the same, so a broken file is not read at every boot). */
export function takeCrashNote(path: string): CrashNote | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    unlinkSync(path);
  } catch {
    // a note that cannot be removed is said again at the next boot, which is better than not said
  }
  try {
    const raw = JSON.parse(text) as Partial<CrashNote> | null;
    if (
      raw === null ||
      typeof raw !== "object" ||
      raw.v !== 1 ||
      typeof raw.at !== "number" ||
      typeof raw.pid !== "number" ||
      typeof raw.origin !== "string" ||
      typeof raw.name !== "string" ||
      typeof raw.message !== "string" ||
      typeof raw.stack !== "string"
    ) {
      return null;
    }
    return {
      v: 1,
      at: raw.at,
      pid: raw.pid,
      bootId: typeof raw.bootId === "string" ? cut(raw.bootId, 128) : "",
      origin: cut(raw.origin, 64),
      name: cut(raw.name, 128),
      message: cut(raw.message, CRASH_NOTE_MESSAGE_MAX),
      stack: cut(raw.stack, CRASH_NOTE_STACK_MAX),
    };
  } catch {
    return null;
  }
}

/** Write the note, in this turn. Never throws: the process is ending, and the error that ends it is the one that
 * matters. */
export function writeCrashNote(path: string, note: CrashNote): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const partial = `${path}.${note.pid}.tmp`;
    writeFileSync(partial, JSON.stringify(note), { mode: 0o600 });
    renameSync(partial, path);
  } catch {
    // no note is kept; Node's own print still stands on stderr
  }
}

// One watcher a process, whatever boots in it. fieldd is one daemon a process; a test boots many in one, and each
// would otherwise add a listener that outlives it.
let target: { path: string; bootId: string } | null = null;
let watching = false;

/** Keep a note at `path` if this process ends on an error nobody caught. Returns how to stop keeping it (a daemon
 * that stopped cleanly keeps none). */
export function keepCrashNote(path: string, bootId: string): () => void {
  const mine = { path, bootId };
  target = mine;
  if (!watching) {
    watching = true;
    process.on("uncaughtExceptionMonitor", (error, origin) => {
      const now = target;
      if (now === null) return;
      writeCrashNote(
        now.path,
        crashNoteOf(error, origin, { at: Date.now(), pid: process.pid, bootId: now.bootId }),
      );
    });
  }
  return () => {
    if (target === mine) target = null;
  };
}
