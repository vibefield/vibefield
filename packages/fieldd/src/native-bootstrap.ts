import type { Writable } from "node:stream";
import { CUSTODY, type NativeBootstrap } from "@vibefield/contracts";

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
// written to it. A child fieldd spawned and has not reaped cannot change pid, so the check is sound for this pid and
// for no other. A child it refuses is ended and never written to. The verifier itself (the code signature's check)
// is `packages/trust`'s; this file only awaits it.
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
  /** C6 — is the child this pid names ours? Awaited before the line is written; `false`, or a throw, ends the child
   * and hands it nothing. Absent, the line is written at once. */
  verifyNativeChild?: (pid: number) => Promise<boolean>;
  spawn: SpawnBootstrapChild;
}

/** How one hand ended, in a word a log may keep:
 *   · `handed` — the child holds its line and its stdin is closed;
 *   · `child-not-ours` — the verifier refused it: it was ended, and never written to;
 *   · `no-child` — the spawn made no process, or one with no pipe: nobody to hand anything to;
 *   · `write-failed` — the child was gone before it read (the pipe's own error). */
export type NativeBootstrapOutcome = "handed" | "child-not-ours" | "no-child" | "write-failed";

export interface SealedNativeSpawned {
  /** the child's pid, or undefined when the spawn made no process: `FielddConfig.nativeSpawner`'s own answer */
  pid: number | undefined;
  /** how the hand ended. It never rejects: a refusal is an answer. */
  handed: Promise<NativeBootstrapOutcome>;
}

/** Spawn the floor to be handed its pairing, and hand it. The spawn answers at once, as the `files` spawn does; the
 * hand settles after the verifier (if any) and the write. */
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

/** Hand a spawned floor its bootstrap line: the verifier first when there is one, then one line of JSON, a newline,
 * and the end of its stdin. Never rejects. */
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
    let ours = false;
    try {
      ours = await verifyNativeChild(pid);
    } catch {
      // a verifier that could not say is a child that is not known to be ours
    }
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
