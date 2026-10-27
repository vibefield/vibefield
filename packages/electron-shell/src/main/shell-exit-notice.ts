import type { ManagerExitRecord, ShellExitRecord } from "@vibefield/contracts";

// AL-7 (`draft/thinking-app-lifecycle.md` §8.1) — the one notification an UNPLANNED exit earns, in DESIGN.md §9's
// voice: what happened and when, what survived in numbers, and what to do next only when there is something to do (a
// crash report to read). A planned exit says nothing. Pure: main composes the time and asks the crash manager whether
// a report belongs to this exit; the tests read the words.
//
// AL-8a (§8.3.1) — a fieldd that crashed while the floor kept its sessions is said the same way, in fieldd's own name
// (DESIGN.md names it to the person), and when the shell crashed too, ONE notice covers both: never two.

export interface ShellExitNotice {
  readonly title: string;
  readonly body: string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

function kept(sessions: number | null): string {
  return sessions === null
    ? "Its terminal service kept running."
    : sessions === 0
      ? "No terminal sessions were running."
      : `${sessions} terminal ${plural(sessions, "session", "sessions")} kept running.`;
}

export function shellExitNotice(
  record: ShellExitRecord | null,
  managerExit: ManagerExitRecord | null,
  options: { readonly time: (at: number) => string; readonly crashReport: boolean },
): ShellExitNotice | null {
  if (record !== null && !record.planned) {
    const body =
      managerExit === null ? kept(record.sessions) : `${kept(record.sessions)} Fieldd stopped too.`;
    return {
      title: `VibeField quit unexpectedly at ${options.time(record.at)}`,
      body: options.crashReport ? `${body} Click to see the crash report.` : body,
    };
  }
  if (managerExit === null) return null;
  return {
    title: `Fieldd stopped unexpectedly at ${options.time(managerExit.at)}`,
    body: kept(managerExit.sessions),
  };
}
