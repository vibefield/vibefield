import type { ShellExitRecord } from "@vibefield/contracts";

// AL-7 (`draft/thinking-app-lifecycle.md` §8.1) — the one notification an UNPLANNED exit earns, in DESIGN.md §9's
// voice: what happened and when, what survived in numbers, and what to do next only when there is something to do (a
// crash report to read). A planned exit says nothing. Pure: main composes the time and asks the crash manager whether
// a report belongs to this exit; the tests read the words.

export interface ShellExitNotice {
  readonly title: string;
  readonly body: string;
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export function shellExitNotice(
  record: ShellExitRecord,
  options: { readonly time: string; readonly crashReport: boolean },
): ShellExitNotice | null {
  if (record.planned) return null;
  const n = record.sessions;
  const kept =
    n === null
      ? "Its terminal service kept running."
      : n === 0
        ? "No terminal sessions were running."
        : `${n} terminal ${plural(n, "session", "sessions")} kept running.`;
  return {
    title: `VibeField quit unexpectedly at ${options.time}`,
    body: options.crashReport ? `${kept} Click to see the crash report.` : kept,
  };
}
