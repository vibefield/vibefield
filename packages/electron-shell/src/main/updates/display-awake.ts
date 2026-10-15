// WP12d (L3b-ii, `build-wp12-updater.md` §12 B4; EDP-34) — the safe window's display clause: does some process hold the
// display awake (a call, a presentation, a video, a screen share)? macOS answers in `pmset -g assertions`, whose
// system-wide section counts `PreventUserIdleDisplaySleep` — the assertion an app takes to keep the screen on (a
// browser's wake lock, a conferencing app). `InternalPreventDisplaySleep` is powerd's own display-off delay, not a
// process holding the screen, so it is not read. Anything that is not a clean answer — another platform, an error, no
// answer inside the bound, an unrecognised format — is `unknown`, which the predicate reads as CLOSED.

import { execFile } from "node:child_process";

/** How long the reader waits for `pmset`. */
export const PMSET_BOUND_MS = 2_000;

/** The system-wide count of `PreventUserIdleDisplaySleep`: held when above zero; `unknown` when the line is absent. */
export function parseDisplayHeldAwake(text: string): boolean | "unknown" {
  const systemWide = text.split(/\n(?=Listed by owning process:)/)[0] ?? "";
  if (!/Assertion status system-wide:/.test(systemWide)) return "unknown";
  const match = systemWide.match(/^[ \t]*PreventUserIdleDisplaySleep[ \t]+(\d+)[ \t]*$/m);
  if (match === null) return "unknown";
  return Number(match[1]) > 0;
}

/** The reader: `/usr/bin/pmset -g assertions`, bounded; off macOS, or on any failure, `unknown`. */
export function readDisplayHeldAwake(
  platform: NodeJS.Platform = process.platform,
  run: (file: string, args: readonly string[], timeoutMs: number) => Promise<string> = (
    file,
    args,
    timeoutMs,
  ) =>
    new Promise((resolve, reject) => {
      execFile(file, [...args], { timeout: timeoutMs, encoding: "utf8" }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    }),
): Promise<boolean | "unknown"> {
  if (platform !== "darwin") return Promise.resolve("unknown");
  return run("/usr/bin/pmset", ["-g", "assertions"], PMSET_BOUND_MS)
    .then(parseDisplayHeldAwake)
    .catch((): "unknown" => "unknown");
}
