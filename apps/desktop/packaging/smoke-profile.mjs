import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// DK-5 — a smoke's OWN Electron profile: minted fresh under the OS temp, handed to
// Electron as `--user-data-dir`, and removed by the process that minted it once
// Electron has exited (Chromium writes the profile until its process is gone, so
// only a parent can remove it whole). The app's shared profile is never touched;
// `packages/electron-shell/src/main/smoke-profile.ts` says why, and mints one itself
// for a smoke started without this.

/** Same prefix main mints under (`SMOKE_PROFILE_PREFIX`). */
export const SMOKE_PROFILE_PREFIX = "vf-smoke-profile-";

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
