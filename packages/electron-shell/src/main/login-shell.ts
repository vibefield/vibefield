import { homedir, userInfo } from "node:os";

// The user's shell and home, which only main can read (GT-D10).
//
// Since the workspace owns pane births, its `platform.defaultShell` and
// `initialCwd` are what every pane is spawned with — so these two values ARE
// the product's shell policy, and a sandboxed renderer cannot see either one.
// Main resolves them and answers them on the terminal connect.
//
// ghosttea desktop resolves the same thing in its preload (apps/desktop/src/
// preload/index.ts:34) as `SHELL ?? "/bin/zsh"`. This adds one rung: a GUI app
// on macOS is not always launched from a shell, and `SHELL` can be absent in
// exactly that case — the passwd entry still knows, so it is asked before the
// constant is. The constant remains, because a passwd entry can be empty too
// and an honest guess beats an exception.

/** What a pane is born with. Both fields are always answerable: the ladder
 * below ends in a constant rather than an error. */
export interface ShellIdentity {
  /** absolute path to the user's real login shell — never `/bin/sh` */
  defaultShell: string;
  /** `$HOME`, which becomes the workspace's `initialCwd` */
  home: string;
}

/** The last-resort shells, per platform. macOS has shipped zsh as the default
 * since Catalina and Linux distributions overwhelmingly ship it or bash; either
 * way this rung is reached only when both the environment and the passwd entry
 * are silent, which is rarer than it is impossible. */
const FALLBACK_SHELL = "/bin/zsh";
const FALLBACK_COMSPEC = "powershell.exe";

const nonEmpty = (value: string | undefined | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed !== "" ? trimmed : undefined;
};

/** The resolution, with its two inputs injected so the ladder is testable
 * without mutating `process.env` or owning a second passwd entry. */
export function resolveShellIdentity(
  env: NodeJS.ProcessEnv,
  info: { shell?: string | null; homedir: string },
  platform: NodeJS.Platform,
): ShellIdentity {
  const home = nonEmpty(info.homedir) ?? nonEmpty(env["HOME"]) ?? "/";
  if (platform === "win32") {
    return { defaultShell: nonEmpty(env["COMSPEC"]) ?? FALLBACK_COMSPEC, home };
  }
  return {
    defaultShell: nonEmpty(env["SHELL"]) ?? nonEmpty(info.shell) ?? FALLBACK_SHELL,
    home,
  };
}

/** Memoized: the answer cannot change under a running app (a shell chosen in
 * System Settings takes effect at the next login), and re-reading the passwd
 * database on every window's connect would be a syscall spent on a constant. */
let cached: ShellIdentity | undefined;

export function shellIdentity(): ShellIdentity {
  if (cached === undefined) {
    // `userInfo()` types `shell` as `string | null` and answers null on
    // platforms without a passwd entry — Windows among them, where the branch
    // above never reads it anyway.
    cached = resolveShellIdentity(
      process.env,
      { shell: userInfo().shell, homedir: homedir() },
      process.platform,
    );
  }
  return cached;
}
