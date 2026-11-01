import type { ShellLastExit } from "@vibefield/contracts";

// AL-12 (`draft/thinking-app-lifecycle.md` §8.1, AL-7's owed line) — Settings → Diagnostics' "Last exit": how a shell
// last left this pair, in DESIGN.md §9's "The quit's words". One sentence: what happened and when, then what it ended
// or what kept running, in numbers. The unplanned exit says it as the next launch's notice does
// (electron-shell's `shell-exit-notice.ts`); an unread count is never said as zero. Pure: the section composes the time.

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function kept(sessions: number | null): string {
  return sessions === null
    ? "Its terminal service kept running."
    : sessions === 0
      ? "No terminal sessions were running."
      : `${sessions} terminal ${plural(sessions, "session", "sessions")} kept running.`;
}

function ended(what: string, sessions: number | null): string {
  if (sessions === null) return `${what}.`;
  if (sessions === 0) return `${what}. No terminal sessions were running.`;
  return `${what} and ended ${sessions} terminal ${plural(sessions, "session", "sessions")}.`;
}

/** `when` says the moment as the section reads it ("on Oct 30 at 10:42"). */
export function lastExitWords(record: ShellLastExit | null, when: (at: number) => string): string {
  if (record === null) return "No exit recorded yet.";
  const at = when(record.at);
  if (!record.planned) return `VibeField quit unexpectedly ${at}. ${kept(record.sessions)}`;
  switch (record.stopped) {
    case "quit":
      return ended(`VibeField quit ${at}`, record.sessions);
    case "update":
      return ended(`VibeField restarted to update ${at}`, record.sessions);
    case "logout":
      return ended(`VibeField quit as you logged out ${at}`, record.sessions);
    case "idle":
      return `The terminal service stopped on its own ${at}, with no session running.`;
    case undefined:
      break;
  }
  switch (record.why) {
    case "quit":
      return `VibeField quit ${at}. It couldn't check for running sessions, so its terminal service kept running.`;
    case "update":
      return `VibeField restarted to update ${at}. ${kept(record.sessions)}`;
    case "user-switch":
      return `VibeField switched to another user ${at}. ${kept(record.sessions)}`;
    case "restart":
      return `VibeField restarted ${at}. ${kept(record.sessions)}`;
    case undefined:
      return `VibeField quit ${at}. ${kept(record.sessions)}`;
  }
}

/** "on Oct 30 at 10:42", in the person's locale. */
export function lastExitWhen(at: number): string {
  const date = new Date(at);
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `on ${day} at ${time}`;
}
