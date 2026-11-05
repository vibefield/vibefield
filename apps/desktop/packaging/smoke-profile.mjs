import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// DK-5 — a smoke's OWN Electron profile: minted fresh under the OS temp, handed to
// Electron as `--user-data-dir`, and removed by the process that minted it once
// Electron has exited (Chromium writes the profile until its process is gone, so
// only a parent can remove it whole). The app's shared profile is never touched;
// `packages/electron-shell/src/main/smoke-profile.ts` says why, and mints one itself
// for a smoke started without this.
//
// BP-1c (BP-D9 (a), `draft/thinking-browser-profile.md` §3·8) — a smoke's HOME (`mintSmokeHome`): ONE fresh directory
// under the short socket root that is both the run's Electron userData and its data root, as a packaged app's
// `appData/VibeField` is both. Main takes a handed home as the run's by its name, the run's mark naming it (`VF_SMOKE_RUN`,
// which run-smoke.mjs sets to the home's name) and its freshness (no `DATA_ROOT_MARKS` in it yet: main's
// `smokeHomeRefusal`), and roots the daemons in it (main/fieldd.ts `dataRoot`), so the desk browser's profiles
// (`<home>/users/<fuid>/browser/profiles`) lie inside userData, where Chromium writes their cookie database.
// `mintSmokeProfile` (the profile alone, under the OS temp) stays for the launchers whose runs keep the two apart: the
// first-run walks and the soaks.

/** Same prefix main mints under (`SMOKE_PROFILE_PREFIX`). */
export const SMOKE_PROFILE_PREFIX = "vf-smoke-profile-";

/** BP-1c — a smoke home's prefix (main's `SMOKE_HOME_PREFIX`; testing/smoke-daemons.ts `smokeHome` reads it). */
export const SMOKE_HOME_PREFIX = "vf-smoke-";

/** BP-1c — where a smoke home is minted: `/tmp` on Unix, whose short path keeps every daemon socket under the home
 * inside macOS's 104-byte sun_path (the OS temp is ~50 bytes long there already); the OS temp on Windows, which has
 * named pipes (main's `smokeHomeParent`, the same law as `dataRoot`'s). */
export function smokeHomeParent(platform = process.platform) {
  return platform === "win32" ? tmpdir() : "/tmp";
}

/** The entries by which a home says main kept its data root in it: the run's logs (main's first write, `logs/`) and the
 * users file (`users.json`). Chromium writes neither name in a userData. */
export const DATA_ROOT_MARKS = Object.freeze(["logs", "users.json"]);

export function mintSmokeProfile() {
  const dir = mkdtempSync(join(tmpdir(), SMOKE_PROFILE_PREFIX));
  return {
    dir,
    arg: `--user-data-dir=${dir}`,
    /** Remove the profile; true when it is gone. */
    remove() {
      rmSync(dir, { recursive: true, force: true });
      return !existsSync(dir);
    },
  };
}

/**
 * BP-1c — after Electron has exited, what becomes of a smoke HOME (Electron's profile and the run's data root in one
 * directory). The profile is the launcher's to remove (DK-5); the data root is main's to keep or remove (DK-18: a red run
 * keeps its logs and names them `SMOKE_HOME`; `smoke:profile`'s phase A keeps its root for phase B, `VF_SMOKE_KEEP_ROOT`).
 * So the home is KEPT whole when the run is red or asked to keep its root AND main's data root is still in it
 * (`DATA_ROOT_MARKS`), and removed whole otherwise: a green run's, or a run that never reached its data root. Answers
 * `{ userData, removed }`, with `kept` (why: `red` or `asked`) when kept. `fs` is the seam.
 */
export function settleSmokeHome(home, { code, keepRoot }, fs = { existsSync, rmSync }) {
  const holdsDataRoot = DATA_ROOT_MARKS.some((name) => fs.existsSync(join(home, name)));
  if (holdsDataRoot && (keepRoot || code !== 0)) {
    return { userData: home, removed: false, kept: keepRoot ? "asked" : "red" };
  }
  fs.rmSync(home, { recursive: true, force: true });
  return { userData: home, removed: !fs.existsSync(home) };
}

/** BP-1c — a smoke's HOME: minted fresh under the short root, handed as `--user-data-dir`, and settled once Electron has
 * exited (`settleSmokeHome`). Its name is the run's mark (`VF_SMOKE_RUN`). It is minted by its REAL path
 * (`/private/tmp/…` on macOS): the users package roots the run's users under the real path, so Electron's userData is
 * spelled as the data root is (main's `mintSmokeHome`). */
export function mintSmokeHome(parent = smokeHomeParent()) {
  const dir = mkdtempSync(join(realpathSync(parent), SMOKE_HOME_PREFIX));
  return {
    dir,
    arg: `--user-data-dir=${dir}`,
    /** What becomes of the home now that Electron has exited (`settleSmokeHome`). */
    settle(outcome) {
      return settleSmokeHome(dir, outcome);
    },
  };
}
