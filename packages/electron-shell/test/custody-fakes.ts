// OB custody (C1) — what the custody rows stand on instead of the machine: a keystore that is a few lines of
// arithmetic, a derivation that is one hash, and a VibeField root under the OS temp dir. No row here reaches a real
// keychain, runs codesign, or reads a real data dir.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { LAYOUT } from "@vibefield/contracts";
import type { AuditAppendV1 } from "@vibefield/contracts/diagnostics";
import type { CodeIdentity } from "@vibefield/trust";
import type { Keystore } from "../src/main/custody/keystore";
import { tempDir } from "./temp-dir";

/** The shell's own code identity in a row: a team's signature under the hardened runtime. */
export const OWN: CodeIdentity = { team: "ABCDE12345", hardened: true };

/** Thirty-two bytes a row can look for on disk: 1, 2, 3 … 32. */
export const PLAIN_ROOT = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));

/** `randomBytes` for a row that needs to know the root it will find: a copy each time, because a root that is
 * replaced is wiped. */
export const drawsPlainRoot = (size: number): Buffer => Buffer.from(PLAIN_ROOT.subarray(0, size));

export interface FakeKeystore extends Keystore {
  /** false: the keystore does not answer (`available()` says so, and `wrap` and `unwrap` throw) */
  answers: boolean;
  /** false: it says it is there and then will not wrap */
  wraps: boolean;
  /** false: it says it is there, wraps, and opens NOTHING, its own bytes included: a keychain that is locked */
  opens: boolean;
  /** true: what it opens is not what was wrapped */
  garbles: boolean;
  /** how often each call was made */
  readonly asked: { available: number; wrap: number; unwrap: number };
}

/** A keystore with a key of its own. What it wraps is marked with that key and scrambled, so a row can tell wrapped
 * bytes from plain ones, and one keystore's bytes from another's: a second `fakeKeystore("other")` will not unwrap
 * them, as a keystore whose key changed would not. */
export function fakeKeystore(key = "first"): FakeKeystore {
  const mark = Buffer.from(`fake-keystore:${key}:`, "utf8");
  const scramble = (bytes: Buffer): Buffer => Buffer.from(bytes.map((byte) => byte ^ 0xa5));
  const asked = { available: 0, wrap: 0, unwrap: 0 };
  const keystore: FakeKeystore = {
    answers: true,
    wraps: true,
    opens: true,
    garbles: false,
    asked,
    available: () => {
      asked.available += 1;
      return keystore.answers;
    },
    wrap: (plain) => {
      asked.wrap += 1;
      if (!keystore.answers || !keystore.wraps) throw new Error("the fake keystore will not wrap");
      return Buffer.concat([mark, scramble(plain)]);
    },
    unwrap: (wrapped) => {
      asked.unwrap += 1;
      if (!keystore.answers) throw new Error("the fake keystore does not answer");
      // one error for a locked keychain and for a wrong key: the caller cannot tell them apart by it
      if (!keystore.opens) throw new Error("the fake keystore could not open these bytes");
      if (!wrapped.subarray(0, mark.length).equals(mark)) {
        throw new Error("the fake keystore could not open these bytes");
      }
      const plain = scramble(wrapped.subarray(mark.length));
      return keystore.garbles ? Buffer.from(plain.map((byte) => byte ^ 0xff)) : plain;
    },
  };
  return keystore;
}

/** `randomBytes` for a row that must tell one draw from the next: the first is all 1s, the second all 2s. */
export function drawsCounted(): (size: number) => Buffer {
  let drawn = 0;
  return (size) => {
    drawn += 1;
    return Buffer.alloc(size, drawn);
  };
}

/** A derivation for the rows: 64 hex characters that differ whenever the root, the label or the context does. The
 * real recipe is trust's `deriveCustody`, which one provider row names. */
export function fakeDerive(root: Buffer, label: string, context: string): string {
  return createHash("sha256")
    .update(root)
    .update("\0")
    .update(label, "utf8")
    .update("\0")
    .update(context, "utf8")
    .digest("hex");
}

/** A VibeField root with one user root per `fuid`, as `users/<fuid>` under it. Real paths, so a row's expectation
 * of a derived secret's context is the path it holds. `users` is the roster main hands custody: each user's id
 * (`user-<fuid>`) beside their root. `logRoot` is the platform log root, a folder of its own (each pair's logs are
 * under `users/<fuid>` of it). Removed when the row ends. */
export function vibefieldTree(fuids: readonly number[] = [1]): {
  root: string;
  userRoots: string[];
  users: { userId: string; root: string }[];
  logRoot: string;
} {
  const root = realpathSync(tempDir("vf-custody-"));
  const userRoots = fuids.map((fuid) => {
    const userRoot = join(root, ...LAYOUT.USERS_DIR, String(fuid));
    mkdirSync(userRoot, { recursive: true });
    return userRoot;
  });
  const users = fuids.map((fuid, index) => ({
    userId: `user-${fuid}`,
    root: userRoots[index] as string,
  }));
  return { root, userRoots, users, logRoot: realpathSync(tempDir("vf-custody-logs-")) };
}

/** Every file under `dir`, as sorted paths: what a row compares to say "nothing was written". */
export function filesBelow(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    })
    .sort();
}

export interface LoggedLine {
  readonly level: "info" | "warn";
  readonly event: string;
  readonly message: string;
  readonly attrs: Readonly<Record<string, unknown>> | undefined;
}

/** Main's own log, kept: every reading of the root and every older pair is said there at once. */
export function keptLog(): {
  lines: LoggedLine[];
  info(event: string, message: string, attrs?: Readonly<Record<string, unknown>>): void;
  warn(event: string, message: string, attrs?: Readonly<Record<string, unknown>>): void;
} {
  const lines: LoggedLine[] = [];
  return {
    lines,
    info: (event, message, attrs) => void lines.push({ level: "info", event, message, attrs }),
    warn: (event, message, attrs) => void lines.push({ level: "warn", event, message, attrs }),
  };
}

/** A pair as a row's start hands it back: what the audit trail is appended through. */
export interface FakePair {
  readonly pair: string;
}

/** fieldd's `audit.append`, kept: which pair each record was appended through, in the order they arrived. */
export function keptTrail(): {
  appended: { through: FakePair; record: AuditAppendV1 }[];
  /** true: the door refuses every append, as a fieldd that does not know the action would */
  refuses: boolean;
  audit(through: FakePair, record: AuditAppendV1): Promise<void>;
} {
  const appended: { through: FakePair; record: AuditAppendV1 }[] = [];
  const trail = {
    appended,
    refuses: false,
    audit: async (through: FakePair, record: AuditAppendV1): Promise<void> => {
      if (trail.refuses) throw new Error("the shell may append only registered actions");
      appended.push({ through, record });
    },
  };
  return trail;
}
