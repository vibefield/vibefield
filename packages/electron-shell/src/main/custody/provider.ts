import { realpathSync } from "node:fs";
import { CUSTODY, type CustodyHandoff } from "@vibefield/contracts";
import {
  type CodeIdentity,
  childIsOurs,
  deriveCustody,
  FIELDD_SIGNING_IDENTIFIER,
} from "@vibefield/trust";
import type { CodeIdentityCheck } from "./level";

// OB custody, C1 — ONE user root's custody, as the supervisor is handed it at the `sealed`
// level. Nothing but the shell's root is stored anywhere: each of a user root's three secrets is derived from it
// (trust's `deriveCustody`: HKDF, one label per secret, the user root's real path as the context), made when it is
// asked for and dropped. So each user of an install has secrets of its own, a secret is never one user's at another's
// door, and a root that was unavailable at one ask and ready at the next derives at that next ask.
//
//   · `handoff()` — the line the supervisor writes on a spawned fieldd's stdin. Never argv, never env, never a file,
//     never a log: nothing here logs, and the caller must not.
//   · `verifyChild(pid)` — the supervisor's name for the check it awaits BEFORE it writes that line: trust's
//     `childIsOurs`, asked ALWAYS with fieldd's signing identifier ("our team, hardened" is true of every binary the
//     team signs, and only one of them is fieldd), and only about a child the supervisor spawned and has not reaped.
//     It adds no wait of its own: how long a spawn may wait for it is the supervisor's.
//     What a `true` does NOT say: it is about the image at that pid at the moment it is asked, and no more. So
//     this stops a wrong binary that stays itself (item 288, named here; whether anything stops more is not decided
//     here).
//   · `noted(marks)` — what the supervisor heard on fieldd's marks stream. The highest value per name is kept in
//     memory and rides the NEXT hand-off as `expect`, so a store put back older than a survivor remembers reads as
//     stale. The shell is one of a mark's two survivors (the floor is the other); a mark dies with both.
//   · `shellSecret()` — the shell's own pairing secret, for an adopt-only probe that spawns nothing (the quit gate's
//     look at a resident pair). It is the hand-off's `shell`; it is never sent to anyone, only MAC'd with.

const MARK_NAME = new RegExp(CUSTODY.MARK_NAME, "u");

export interface CustodyProvider {
  handoff(): CustodyHandoff;
  verifyChild(pid: number): Promise<boolean>;
  noted(marks: Readonly<Record<string, number>>): void;
  shellSecret(): string;
}

export interface CustodyProviderOptions {
  /** The shell's root, read at EACH use (it may be unavailable at one ask and ready at the next). Throws while it
   * is not ready, and that refusal is the provider's: nothing is derived from a root that is not there. */
  root(): Buffer;
  readonly userRoot: string;
  /** the shell's own code identity (level.ts) */
  readonly own: CodeIdentity;
  /** trust's `deriveCustody` unless a test injects its own */
  readonly derive?: ((root: Buffer, label: string, context: string) => string) | undefined;
  /** trust's `childIsOurs` unless a test injects its own */
  readonly isOurChild?: CodeIdentityCheck | undefined;
  /** `realpathSync` unless a test injects its own */
  readonly realpath?: ((path: string) => string) | undefined;
}

export function createCustodyProvider(options: CustodyProviderOptions): CustodyProvider {
  const derive = options.derive ?? deriveCustody;
  const isOurChild: CodeIdentityCheck =
    options.isOurChild ?? ((pid, own, expect) => childIsOurs(pid, own, expect));
  const realpath: (path: string) => string = options.realpath ?? ((path) => realpathSync(path));
  /** the highest value heard per mark name, for this user root, for the life of this shell */
  const marks = new Map<string, number>();

  /** One secret, made now. The context is the user root's REAL path, so a link to the root and the root derive the
   * same secrets, and two roots never do. */
  const secrets = (): ((label: string) => string) => {
    const root = options.root();
    const context = realpath(options.userRoot);
    return (label) => derive(root, label, context);
  };

  return {
    handoff: () => {
      const secret = secrets();
      return {
        v: 1,
        shell: secret(CUSTODY.LABELS.shell),
        pairing: secret(CUSTODY.LABELS.pairing),
        records: secret(CUSTODY.LABELS.records),
        // absent when the shell remembers none (custody.ts in contracts)
        ...(marks.size > 0 ? { expect: Object.fromEntries(marks) } : {}),
      };
    },
    // a `true` is about the image at that pid when it is asked: it stops a wrong binary that stays itself, and says
    // nothing of who else holds the pipe (the header's words; item 288)
    verifyChild: (pid) => isOurChild(pid, options.own, { identifier: FIELDD_SIGNING_IDENTIFIER }),
    noted: (heard) => {
      // what a stream said never throws here, and nothing is kept that a hand-off could not carry back: a name off
      // the registry's pattern, a value that is not a count, or one name more than the floor itself would hold
      if (typeof heard !== "object" || heard === null) return;
      for (const [name, value] of Object.entries(heard)) {
        if (!MARK_NAME.test(name) || !Number.isSafeInteger(value) || value < 0) continue;
        const held = marks.get(name);
        if (held === undefined && marks.size >= CUSTODY.MARKS_MAX) continue;
        if (held === undefined || value > held) marks.set(name, value);
      }
    },
    shellSecret: () => secrets()(CUSTODY.LABELS.shell),
  };
}
