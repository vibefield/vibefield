// WHICH PROCESSES BELONG TO THIS WORKTREE — TP-S0c, pure.
//
// field-native is spawned DETACHED and outlives its parent by design (the
// two-plane law). That is the product's guarantee and it is also why a harness
// that forgets to stop what it started leaks a whole floor: its cells, its
// shells, and one pty per session. The lab did exactly that for fifteen runs and
// put this machine at 527 ptys against `kern.tty.ptmx_max = 511` — a SYSTEM-WIDE
// ceiling, so every terminal test, every godview smoke and every new shell on
// the box started failing, for everyone.
//
// The lab now tears down properly; the reaper is the second line of defence for
// what teardown cannot reach (a hard kill, a crash before `finally`, a daemon
// that outlasts the dispose bound).
//
// THIS FILE IS SEPARATE FROM THE CLI SO IT CAN BE TESTED. A function that
// chooses SIGKILL targets is the last place to rely on "it looked right when I
// ran it": the rows in `reap.test.ts` are the decoys that would have been killed
// by the first version.
//
// TWO RULES, and both are narrowing:
//
//  1. ABSOLUTE PATH PREFIX. Every candidate must carry this worktree's own
//     absolute path. That alone excludes every sibling worktree and James's own
//     checkout — a matcher keyed on `field-native` would be a fleet-wide kill
//     switch.
//  2. EXECUTABLE POSITION. The path must be the thing being RUN, not merely
//     mentioned. The first version used `command.includes(path)`, which would
//     have killed a shell running `grep /…/vf-s0c/target/debug/field-native`
//     for saying the name.

export type StrayKind = "floor" | "cell" | "fieldd";

export interface StrayProcess {
  readonly pid: number;
  readonly kind: StrayKind;
  readonly command: string;
}

/** Suffixes under the worktree root, with the role each one plays. */
export const STRAY_PATTERNS: readonly { kind: StrayKind; suffix: string }[] = [
  { kind: "fieldd", suffix: "/packages/fieldd/dist/bin.cjs" },
  { kind: "floor", suffix: "/target/debug/field-native" },
  { kind: "cell", suffix: "/target/debug/field-terminal-host" },
];

/** argv[0]s that run a script given as argv[1] — the shape fieldd has, since it
 * runs as `<electron> <repoRoot>/packages/fieldd/dist/bin.cjs`. */
const RUNTIME = /(?:^|\/)(?:node|electron|Electron)$/u;

/**
 * Parse `ps -axwwo pid=,command=` output into this worktree's strays.
 *
 * `exclude` is the caller's own pid and its parent: `ps` shows the node running
 * the driver and whatever shell wrapped it, and both carry the repo path.
 *
 * Token splitting on whitespace is imprecise for paths containing spaces. This
 * repo's path has none, and a path that did would simply fail to match — the
 * reaper would report nothing rather than kill the wrong thing, which is the
 * correct direction for this function to fail in.
 */
export function findStrays(
  psOutput: string,
  repoRoot: string,
  exclude: readonly number[] = [],
): StrayProcess[] {
  const excluded = new Set(exclude);
  const strays: StrayProcess[] = [];
  for (const line of psOutput.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    if (match === null) continue;
    const [, rawPid, command] = match as unknown as [string, string, string];
    // Rule 1: this worktree, and no other.
    if (!command.includes(`${repoRoot}/`)) continue;
    const pid = Number(rawPid);
    if (excluded.has(pid)) continue;
    const tokens = command.split(/\s+/u).filter((token) => token !== "");
    for (const pattern of STRAY_PATTERNS) {
      const path = `${repoRoot}${pattern.suffix}`;
      // Rule 2: RUN, not mentioned.
      const executed = tokens[0] === path || (tokens[1] === path && RUNTIME.test(tokens[0] ?? ""));
      if (executed) {
        strays.push({ pid, kind: pattern.kind, command: command.slice(0, 120) });
        break;
      }
    }
  }
  return strays;
}

/** The order a reap must signal in: fieldd first so nothing respawns behind the
 * kill, then the floor it supervises, then any cell that outlived it. */
export const REAP_ORDER: readonly StrayKind[] = ["fieldd", "floor", "cell"];

export function orderForReaping(strays: readonly StrayProcess[]): StrayProcess[] {
  return REAP_ORDER.flatMap((kind) => strays.filter((stray) => stray.kind === kind));
}
