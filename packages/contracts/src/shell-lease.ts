import { z } from "zod";

// AL-7 (`draft/thinking-app-lifecycle.md` §8.1; James ruled 2026-10-27 08:10Z) — the shell lease. A shell CLAIMS the
// lease on its `shell-main` connection (`system.shell.attach`); a probe that only says hello — the supervisor's
// adoption, the quit gate's look at another user's pair — never does, so it can never read as a shell leaving. A shell
// that leaves on purpose says why BEFORE it closes (`system.shell.leave`); one that is simply gone — a crash, a Force
// Quit, a signal from outside — left UNPLANNED. When the last lease holder goes, fieldd records how
// (`ShellExitRecord`, at `LAYOUT.SHELL_EXIT`, so the record outlives fieldd too), and the next attach hands it over
// once. A person's quit needs no verb of its own: it stops fieldd through `system.shutdown {reason: "quit"}` (AL-2).
// TS-only: fieldd and the shell are its two sides; nothing native reads it.

/** Why a shell leaves on purpose while the pair keeps running: a person's quit that left a pair it could not read
 * (AL-3's unknown census), the dev runner's restart (or any signal-driven exit that leaves the pairs), a user switched
 * away, an update whose release leaves the floor's bytes alone. */
export const ShellLeaveReason = z.enum(["quit", "restart", "user-switch", "update"]);
export type ShellLeaveReason = z.infer<typeof ShellLeaveReason>;

/** AL-5 (AL-D8) — the argument fieldd relaunches the app with after an UNPLANNED exit that left live sessions: the
 * shell comes up in the menu bar alone (no window, no Dock icon), its status item the one presence, and says what
 * happened (`system.shell.attach`'s record). Both sides read it from here. */
export const SHELL_BACKGROUND_RELAUNCH_ARG = "--background-relaunch";

/** `system.shell.leave` — scope `native.admin`, local only, and only a `shell-main` principal may say it. */
export const SystemShellLeaveParams = z.object({ why: ShellLeaveReason }).passthrough();
export type SystemShellLeaveParams = z.infer<typeof SystemShellLeaveParams>;

export const SystemShellLeaveResult = z.object({ noted: z.boolean() }).passthrough();
export type SystemShellLeaveResult = z.infer<typeof SystemShellLeaveResult>;

/** How the last shell left this pair. `planned` = it said why first; otherwise it was gone (a crash, a Force Quit, a
 * signal). `sessions` is the floor's live count when it left, `null` when the census could not be read then. */
export const ShellExitRecord = z
  .object({
    planned: z.boolean(),
    why: ShellLeaveReason.optional(),
    /** epoch millis */
    at: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative().nullable(),
  })
  .passthrough();
export type ShellExitRecord = z.infer<typeof ShellExitRecord>;

/** `system.shell.attach` — this connection holds the lease from now on, and the answer carries the record of how the
 * LAST lease holder left, ONCE: the next attach answers `lastExit: null`, so a shell says a crash once, never at every
 * launch. Same scope and principal rule as `system.shell.leave`. */
export const SystemShellAttachResult = z
  .object({ lastExit: ShellExitRecord.nullable() })
  .passthrough();
export type SystemShellAttachResult = z.infer<typeof SystemShellAttachResult>;
