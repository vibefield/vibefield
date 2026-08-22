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

export type StrayKind = "electron" | "floor" | "cell" | "fieldd";

export interface StrayProcess {
  readonly pid: number;
  readonly kind: StrayKind;
  readonly command: string;
}

/** Suffixes under the worktree root, with the role each one plays.
 *
 * `electron` is FIRST because it is the one that took the machine down: the
 * leak was 45 lab Electron PARENTS, each still holding its detached floor and
 * that floor's cells. A reaper that knew only about daemons would have reported
 * a clean machine while 45 apps sat on it. The path is the pnpm-installed
 * binary inside this worktree's own `node_modules`, so it names lab Electrons
 * and can never reach another worktree's or a packaged VibeField. */
export const ELECTRON_SUFFIX = "/node_modules/.pnpm/";

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
    let classified = false;
    for (const pattern of STRAY_PATTERNS) {
      const path = `${repoRoot}${pattern.suffix}`;
      // Rule 2: RUN, not mentioned.
      const executed = tokens[0] === path || (tokens[1] === path && RUNTIME.test(tokens[0] ?? ""));
      if (executed) {
        strays.push({ pid, kind: pattern.kind, command: command.slice(0, 120) });
        classified = true;
        break;
      }
    }
    if (classified) continue;

    // The lab's Electron, checked AFTER the script patterns and not before —
    // because fieldd itself runs as `<this worktree's electron> …/fieldd/dist/bin.cjs`,
    // so an electron-first rule swallowed it and reported a daemon as an app.
    // (Caught by the two rows in `reap.test.ts` that already pinned fieldd's
    // classification and the reap order.) argv[0] must BE the binary, for the
    // same reason every other rule requires a run position: a process that
    // merely names it is not it. Prefix-matched because the electron version
    // sits in the middle of the path, and scoped to this worktree's own
    // `node_modules`, so it can never reach a sibling worktree or a packaged
    // VibeField.
    const argv0 = tokens[0] ?? "";
    if (
      argv0.startsWith(`${repoRoot}${ELECTRON_SUFFIX}`) &&
      /\/(?:Electron|electron)$/u.test(argv0)
    ) {
      strays.push({ pid, kind: "electron", command: command.slice(0, 120) });
    }
  }
  return strays;
}

/** The order a reap must signal in: fieldd first so nothing respawns behind the
 * kill, then the floor it supervises, then any cell that outlived it. */
/** ELECTRON first: it is the parent, and killing it stops it spawning anything
 * else while the rest are being taken down. Then fieldd so nothing respawns
 * behind the kill, then the floor it supervises, then any cell that outlived
 * both. */
export const REAP_ORDER: readonly StrayKind[] = ["electron", "fieldd", "floor", "cell"];

export function orderForReaping(strays: readonly StrayProcess[]): StrayProcess[] {
  return REAP_ORDER.flatMap((kind) => strays.filter((stray) => stray.kind === kind));
}
