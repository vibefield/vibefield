import type { CodeIdentity } from "@vibefield/trust";

// OB custody, C1 (CUSTODY-SPEC §1, §7; EL7-PLAN §3) — which of the two levels this boot runs at. It is decided from
// what the BUILD is and never from what the disk holds, so there is nothing on disk to delete that downgrades it:
//   · `sealed` — a packaged shell on macOS whose own signature carries a team and the hardened runtime (trust's
//     `ownIdentity`). The shell keeps one root under the OS keystore and hands each daemon pair its secrets.
//   · `files` — every other build: a dev run, a smoke, an unsigned or ad-hoc package, not macOS. Today's files, byte
//     for byte, and no keystore is ever made.
// A `sealed` build whose keystore does not answer stays `sealed` and starts nothing (root.ts); it never becomes
// `files`. Asked once per boot, before the first supervisor is built. Pure: the three facts arrive as arguments.

export type ResolvedCustodyLevel =
  | { readonly level: "files" }
  | {
      readonly level: "sealed";
      /** the shell's own code identity: what a child must share before it is handed anything */
      readonly own: CodeIdentity;
    };

export interface CustodyLevelFacts {
  readonly platform: NodeJS.Platform;
  /** Electron's `app.isPackaged` */
  readonly packaged: boolean;
  /** trust's `ownIdentity`: asked only of a packaged build on macOS, so a dev run never runs the tool behind it */
  ownIdentity(): Promise<CodeIdentity | null>;
}

/** trust's `childIsOurs` and `processIsOurs`, as custody calls them: whether the process at `pid` is the binary
 * `expect.identifier` names, signed by `own`'s team, under the hardened runtime. */
export type CodeIdentityCheck = (
  pid: number,
  own: CodeIdentity,
  expect: { readonly identifier: string },
) => Promise<boolean>;

const FILES: ResolvedCustodyLevel = Object.freeze({ level: "files" });

export async function resolveCustodyLevel(facts: CustodyLevelFacts): Promise<ResolvedCustodyLevel> {
  if (facts.platform !== "darwin" || !facts.packaged) return FILES;
  let own: CodeIdentity | null;
  try {
    own = await facts.ownIdentity();
  } catch {
    // an identity that could not be asked is no identity
    own = null;
  }
  return own === null ? FILES : { level: "sealed", own };
}
