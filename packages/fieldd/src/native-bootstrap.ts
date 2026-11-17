import type { Writable } from "node:stream";
import { CUSTODY, type NativeBootstrap } from "@vibefield/contracts";
import {
  type CodeIdentity,
  childIsOurs,
  type ExpectedCode,
  FIELD_NATIVE_SIGNING_IDENTIFIER,
  ownIdentity,
} from "@vibefield/trust";

// OB custody (C3; contracts mgmt.ts `NativeBootstrap`, registries.ts `CUSTODY`) — how a `sealed` fieldd spawns its
// floor.
//
// At `files` field-native makes LAYOUT.PAIRING_FILE and fieldd reads it; every process of the same user can read it
// too, and whoever does may say the floor's hello (EL7). A fieldd handed custody hands the floor its pairing instead:
// it spawns the floor with a piped stdin and `FIELD_NATIVE_CUSTODY=stdin` (a flag, not a secret), writes ONE line,
// `{"v":1,"pairing":…}`, and closes the pipe. Nothing of the secret rides the environment or an argument, and the
// floor then never creates the file. The D8 handshake itself is unchanged: only where the secret comes from.
//
// C6's seam is here: a verifier, when one is configured, is asked whether the child is ours BEFORE anything is
// written to it. A child fieldd spawned and has not reaped cannot change pid, so the answer is about that child's
// image and no other process's. A child it refuses is ended and never written to.
// *Corrected 2026-11-10 (item 288): this said "the check is sound for this pid". The
// answer is about the right process, at the moment of asking; what a yes does not say is at `floorVerifier`.*
//
// The hand has ONE budget (`CUSTODY.CHILD_CHECK_BUDGET_MS`): everything between the spawn
// and the write. The verifier is up to three runs of a tool, and the floor waits only so long for its line
// (`CUSTODY.HANDOFF_WAIT_MS`, longer than the budget by a margin a contracts row holds). So a check that has not
// answered inside the budget is a refusal like any other: the child is ended and never written to, and an answer
// that comes later is not listened to. A line that IS written is written to a child still waiting for it.
//
// And C6's verifier is here (`floorVerifier`): the one `bin.ts` hands every sealed spawn.
// The check itself (the code signature's, asked of macOS's own tool) is `packages/trust`'s; this file asks its two
// questions in order and turns every doubt into a refusal. This module is loaded only by a fieldd that was handed
// custody (`bin.ts` imports it behind the hand-off), so at `files` nothing of trust's is loaded or asked.
//
// The secret never enters a log, an error or an outcome here: an outcome is one word.

/** The slice of a spawned child the hand needs. `node:child_process`'s `ChildProcess` is one. */
export interface BootstrapChild {
  readonly pid?: number | undefined;
  readonly stdin: Writable | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  unref(): void;
}

/** How the floor is spawned under `sealed`: its stdin a pipe and nothing else of its stdio changed from the `files`
 * spawn (stdout has no protocol; stderr is the one-shot emergency fallback, inherited). */
export interface SealedSpawnOptions {
  env: NodeJS.ProcessEnv;
  detached: true;
  stdio: ["pipe", "ignore", "inherit"];
}

/** `spawn`, as much of it as this needs. A seam so a row can answer a child of its own. */
export type SpawnBootstrapChild = (
  file: string,
  args: readonly string[],
  options: SealedSpawnOptions,
) => BootstrapChild;

export interface SealedNativeSpawn {
  /** the floor's binary */
  bin: string;
  /** the floor's environment as its caller composed it: `bin.ts`'s ONE composition, the same for the boot's spawn
   * and for every respawn (TC-D1). The flag is added here. */
  env: NodeJS.ProcessEnv;
  /** the floor's pairing secret for this user root (`FielddCustody.pairing`): 64 hex characters */
  pairing: string;
  /** C6 — is the child this pid names ours? Awaited before the line is written, for no longer than
   * `CUSTODY.CHILD_CHECK_BUDGET_MS`; `false`, a throw, or no answer inside the budget ends the child and hands it
   * nothing. Absent, the line is written at once. */
  verifyNativeChild?: (pid: number) => Promise<boolean>;
  spawn: SpawnBootstrapChild;
}

/** How one hand ended, in a word a log may keep:
 *   · `handed` — the child holds its line and its stdin is closed;
 *   · `child-not-ours` — the verifier refused it, or did not answer inside the budget: it was ended, and never
 *     written to;
 *   · `no-child` — the spawn made no process, or one with no pipe: nobody to hand anything to;
 *   · `write-failed` — the child was gone before it read (the pipe's own error). */
export type NativeBootstrapOutcome = "handed" | "child-not-ours" | "no-child" | "write-failed";

export interface SealedNativeSpawned {
  /** the child's pid, or undefined when the spawn made no process: `FielddConfig.nativeSpawner`'s own answer */
  pid: number | undefined;
  /** how the hand ended. It never rejects: a refusal is an answer. */
  handed: Promise<NativeBootstrapOutcome>;
}

/** C6 — the verifier a fieldd handed custody gives `spawnSealedNative`: is the child this pid names OUR floor?
 * Both questions are `@vibefield/trust`'s (whose code this process is; whether a child is the binary named, of the
 * same team, under the hardened runtime), each asked of macOS's own tool.
 *
 *   · fieldd's own identity is asked once for the life of the verifier, WHEN IT IS MADE (§2.4 "v0.21"), and
 *     `bin.ts` makes one per process, before any floor is spawned: the boot's spawn and every respawn share it,
 *     and the hand's one budget is spent on the child's check alone. So a fieldd handed custody asks this at every
 *     boot, also when its floor is already alive and nothing is spawned.
 *   · Each child is asked about ALWAYS with the floor's signing identifier. "Our team, hardened" is true of every
 *     binary the team signs, and only one of them is the floor.
 *   · A fieldd that cannot say whose code it is itself (not macOS, no team, not hardened) refuses every child,
 *     exactly as a `false`: there is no unverified hand and no fall back to the file. It does not ask again later
 *     for a better answer.
 *
 * It takes NOTHING from its caller, on purpose: a parameter here would be a seam a row could fake and production
 * could leave unbound. Its rows run fieldd's real entry and stand in only for the tool below trust
 * (custody-boot.test.ts). It resolves `true` only on trust's own `true`.
 *
 * What a `true` does NOT say: it is about the image at that pid at the moment it is asked, and no more. So this
 * stops a wrong binary that stays what it is (item 288, named here; whether anything stops more is not decided
 * here). */
export function floorVerifier(): (pid: number) => Promise<boolean> {
  // asked NOW, not at the first child. Trust answers null for every doubt and does not throw; were it ever to, that
  // is one more doubt, held here as a null so that no rejection is left for nobody to hear.
  const own: Promise<CodeIdentity | null> = ownIdentity().catch(() => null);
  const floors: ExpectedCode = { identifier: FIELD_NATIVE_SIGNING_IDENTIFIER };
  return async (pid) => {
    const identity = await own;
    if (identity === null) return false;
    return await childIsOurs(pid, identity, floors);
  };
}

type ChildVerifier = (pid: number) => Promise<boolean>;

/** The verifier's word on the child, or `false` once `CUSTODY.CHILD_CHECK_BUDGET_MS` has passed since this was
 * called (§2.4 "v0.21"). The first word settles it and nothing after is heard: a verifier that answers past the
 * budget is not listened to. A verifier that throws, rejects, or answers anything but `true` is a `false`. Never
 * rejects. The timer is not unref'd: ending a child nobody answered for is this hand's to do, and it holds the
 * process no longer than the budget. */
function oursInsideBudget(verify: ChildVerifier, pid: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), CUSTODY.CHILD_CHECK_BUDGET_MS);
    const settle = (ours: boolean): void => {
      clearTimeout(timer);
      resolve(ours);
    };
    // asked inside a promise's own turn, so a verifier that throws before it answers is a rejection like any other
    const asked = new Promise<boolean>((answer) => answer(verify(pid)));
    void asked.then((ours) => settle(ours === true), () => settle(false));
  });
}

/** Spawn the floor to be handed its pairing, and hand it. The spawn answers at once, as the `files` spawn does; the
 * hand settles after the verifier (if any) and the write, or at the budget. The hand begins in the turn of the
 * spawn, so its budget is counted from the spawn. */
export function spawnSealedNative(opts: SealedNativeSpawn): SealedNativeSpawned {
  const child = opts.spawn(opts.bin, [], {
    env: { ...opts.env, [CUSTODY.NATIVE_ENV]: CUSTODY.STDIN },
    // the native plane outlives this fieldd, exactly as at `files`
    detached: true,
    stdio: ["pipe", "ignore", "inherit"],
  });
  child.unref();
  return {
    pid: child.pid,
    handed: handNativeBootstrap(child, opts.pairing, opts.verifyNativeChild),
  };
}

/** Hand a spawned floor its bootstrap line: the verifier first when there is one, inside the hand's one budget, then
 * one line of JSON, a newline, and the end of its stdin. Never rejects. */
export async function handNativeBootstrap(
  child: BootstrapChild,
  pairing: string,
  verifyNativeChild?: (pid: number) => Promise<boolean>,
): Promise<NativeBootstrapOutcome> {
  const { pid, stdin } = child;
  if (pid === undefined || stdin === null) {
    stdin?.destroy();
    return "no-child";
  }
  // A write to a pipe whose reader has gone fails on the stream, later: with no listener that `error` would end
  // this process. Heard from here on, whatever happens below.
  let failed = false;
  stdin.on("error", () => {
    failed = true;
  });
  if (verifyNativeChild !== undefined) {
    // a verifier that could not say, or did not say in time, is a child that is not known to be ours
    const ours = await oursInsideBudget(verifyNativeChild, pid);
    if (!ours) {
      // by the pid this process spawned and has not reaped, and nothing was written to it
      child.kill("SIGKILL");
      stdin.destroy();
      return "child-not-ours";
    }
  }
  if (failed) return "write-failed";
  const line: NativeBootstrap = { v: 1, pairing };
  return await new Promise<NativeBootstrapOutcome>((resolve) => {
    stdin.once("error", () => resolve("write-failed"));
    // `end`'s callback is told the stream's error when there was one, and may hear of it before the listener above
    stdin.end(`${JSON.stringify(line)}\n`, (error?: Error | null) => {
      resolve(error || failed ? "write-failed" : "handed");
    });
  });
}
