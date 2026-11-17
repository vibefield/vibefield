import { randomBytes as systemRandomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { LAYOUT } from "@vibefield/contracts";
import type { Keystore } from "./keystore";

// OB custody, C1 (EL7-PLAN §3.2; CUSTODY-SPEC §7.1, v0.11) — the shell's ONE secret: a 32-byte root, kept at
// LAYOUT.CUSTODY_KEY only as the OS keystore wrapped it. Nothing else is stored; every user root's secrets are
// derived from it (provider.ts). An agent in a pane can read the file and learns nothing: it opens under a key the OS
// releases to the signed shell alone.
//
// A reading answers one of two things, and never a third that waits for a person:
//   · `ready` — the kept key opened (`opened`); or none was kept (`made-absent`), or the one kept did not open
//     (`made-unopenable`), and a new root was made BY ITSELF.
//   · `unavailable` — the keystore does not answer, or did not carry test bytes out and back, or the new root could
//     not be wrapped or kept. Nothing is made, nothing is renamed, and no pair may start.
// Never a fall back to custody's `files` level: a process running as the person may be able to make the keychain not
// answer, and a fall back would be a downgrade it could force.
//
// The round trip is what stands between a locked keychain and a lost root. The keystore gives one error for a
// keychain that is locked, one that is slow and a key that is wrong, so "the kept key did not open" proves nothing by
// itself. Before a root is made, 32 fresh test bytes are wrapped and opened in the same reading: only a keystore that
// works now, and still does not open the kept key, has it renewed. (That the three errors are alike is read from the
// manuals, not measured.)
//
// A key that did not open is never overwritten in place and never removed: it is renamed to `custody.key.unopened`
// beside the new one, ONE kept, the newest. Nothing on disk is consulted to decide any of this: no user root is
// looked through for what an older root may have sealed. What follows a root made in this boot (the older pair it
// can no longer reach) is old-pair.ts's.

export const CUSTODY_ROOT_BYTES = 32;
/** A wrapped root is a few dozen bytes; anything much larger at the key's path is not one, and is not read. */
const KEY_FILE_MAX_BYTES = 4096;

/** ‹pending item 280› — what a pair's start is refused with while the root is `unavailable`: ONE constant, in the
 * register a failed start already has, and carried by a plain Error. A window's bootstrap is refused through the
 * path any failed start takes, and today's splash shows that rejection as it came, class name and all: so this
 * names nothing of what is underneath, and neither may the class of whatever carries it. */
export const FIELDD_NOT_STARTED = "fieldd was not started";

export type CustodyRootState = "ready" | "unavailable";

export type CustodyUnavailableCause =
  /** `available()` said no */
  | "keystore-unavailable"
  /** test bytes did not come back as they went out: nothing was made and nothing was renamed */
  | "roundtrip-failed"
  /** the round trip held and the keystore then would not wrap the root */
  | "wrap-failed"
  /** the wrapped root could not be kept on disk */
  | "write-failed";

export type CustodyRootReading =
  | { readonly outcome: "opened" | "made-absent" | "made-unopenable" }
  | { readonly outcome: "unavailable"; readonly cause: CustodyUnavailableCause };

export interface CustodyRootOptions {
  /** the VibeField root, above the user roots: LAYOUT.CUSTODY_KEY is joined under it */
  readonly vibefieldRoot: string;
  readonly keystore: Keystore;
  /** `node:crypto`'s unless a test needs to know the bytes it will find: the test bytes are drawn before the root */
  readonly randomBytes?: ((size: number) => Buffer) | undefined;
}

export interface CustodyRoot {
  readonly state: CustodyRootState;
  /** what the latest reading found */
  readonly reading: CustodyRootReading;
  /** The root's 32 bytes, for a derivation made now and dropped. Throws, with FIELDD_NOT_STARTED, unless `ready`.
   * The buffer is the root's own: read it at each use, never keep it. */
  bytes(): Buffer;
  /** The reading again, from the top. A root that is `ready` is never read again: its reading stands. */
  read(): CustodyRootReading;
}

export function custodyKeyPath(vibefieldRoot: string): string {
  return join(vibefieldRoot, ...LAYOUT.CUSTODY_KEY);
}

/** The kept key's bytes; `null` when no file is there; `"unreadable"` when something is there that is not a small
 * regular file this process can read. A link is not followed: a link put where the key was is not the key. */
function readKeptKey(path: string): Buffer | null | "unreadable" {
  let fd: number;
  try {
    // O_NOFOLLOW is absent on Windows, where this level never runs
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "unreadable";
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > KEY_FILE_MAX_BYTES) return "unreadable";
    return readFileSync(fd);
  } catch {
    return "unreadable";
  } finally {
    closeSync(fd);
  }
}

/** A new wrapped root, kept: written beside the key's path (0600 in a 0700 folder), what was at that path renamed
 * aside if anything was, and the new one renamed into place. A reader sees the old key, no key or the new one, never
 * part of either. A failure leaves nothing beside the key that this wrote. */
function keepRenewed(path: string, wrapped: Buffer, present: boolean): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const beside = join(
    dir,
    `.${basename(path)}.${process.pid}.${systemRandomBytes(6).toString("hex")}.tmp`,
  );
  try {
    const fd = openSync(beside, "wx", 0o600);
    try {
      writeFileSync(fd, wrapped);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (present) {
      try {
        // over an earlier one: ONE is kept. A link is renamed as a link, never followed
        renameSync(path, `${path}.unopened`);
      } catch (error) {
        // gone since it was read: there is nothing to keep aside
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    renameSync(beside, path);
  } catch (error) {
    rmSync(beside, { force: true });
    throw error;
  }
}

export function openCustodyRoot(options: CustodyRootOptions): CustodyRoot {
  const path = custodyKeyPath(options.vibefieldRoot);
  const random = options.randomBytes ?? systemRandomBytes;
  let root: Buffer | null = null;
  let reading: CustodyRootReading = { outcome: "unavailable", cause: "keystore-unavailable" };

  const unavailable = (cause: CustodyUnavailableCause): CustodyRootReading => {
    root = null;
    reading = { outcome: "unavailable", cause };
    return reading;
  };

  const ready = (
    bytes: Buffer,
    outcome: "opened" | "made-absent" | "made-unopenable",
  ): CustodyRootReading => {
    root = bytes;
    reading = { outcome };
    return reading;
  };

  /** The kept key, opened: 32 bytes, or `null` for anything else it opened to and for a keystore that threw. */
  const opened = (kept: Buffer): Buffer | null => {
    let plain: Buffer;
    try {
      // through the keystore object each time: it is the caller's, and may be a different one's method by now
      plain = options.keystore.unwrap(kept);
    } catch {
      return null;
    }
    if (plain.length === CUSTODY_ROOT_BYTES) return plain;
    plain.fill(0);
    return null;
  };

  /** Whether the keystore, now, carries 32 fresh test bytes out and back unchanged. */
  const roundTrips = (): boolean => {
    const sent = random(CUSTODY_ROOT_BYTES);
    try {
      const back = options.keystore.unwrap(options.keystore.wrap(sent));
      const same = back.length === sent.length && back.equals(sent);
      back.fill(0);
      return same;
    } catch {
      return false;
    } finally {
      sent.fill(0);
    }
  };

  const read = (): CustodyRootReading => {
    // A root that is held is handed back and NOTHING is asked: a root that became ready never goes back. Custody's
    // gate rests on this line: it lets only a person's ask read an unavailable root again, and that is enough only
    // because `unavailable` is reachable before the first ready reading and never after (the one place that clears
    // a root, `unavailable(…)` above, is called below this line alone). A road by which a ready root went back would
    // be a new question for that rule.
    if (root !== null) return reading;
    let answers = false;
    try {
      answers = options.keystore.available();
    } catch {
      answers = false;
    }
    if (!answers) return unavailable("keystore-unavailable");

    const kept = readKeptKey(path);
    if (kept !== null && kept !== "unreadable") {
      const plain = opened(kept);
      if (plain !== null) return ready(plain, "opened");
    }
    // absent, or present and not opening (a link, a folder, an oversized file and a key that would not open are all
    // that): the keystore proves itself in this same reading before anything is made
    const present = kept !== null;
    if (!roundTrips()) return unavailable("roundtrip-failed");

    const plain = random(CUSTODY_ROOT_BYTES);
    let wrapped: Buffer;
    try {
      wrapped = options.keystore.wrap(plain);
    } catch {
      plain.fill(0);
      return unavailable("wrap-failed");
    }
    try {
      keepRenewed(path, wrapped, present);
    } catch {
      plain.fill(0);
      return unavailable("write-failed");
    }
    return ready(plain, present ? "made-unopenable" : "made-absent");
  };

  read();
  return {
    get state() {
      return root === null ? "unavailable" : "ready";
    },
    get reading() {
      return reading;
    },
    bytes: () => {
      if (root === null) throw new Error(FIELDD_NOT_STARTED);
      return root;
    },
    read,
  };
}
