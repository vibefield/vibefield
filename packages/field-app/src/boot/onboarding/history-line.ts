import type { IndexStatus } from "@vibefield/contracts/agent-index";
import {
  firstPassCounts,
  firstPassDone,
  historyBroughtIn,
  historyImporting,
} from "../../history/first-reading";
import type { OnboardingSetupPhase } from "./views/setting-up";

// Setting up's History line (track AO, AO-4b; DESIGN.md §8 "The Setup
// Assistant's agent chapter", AO-D4): History in the room's own words, so the
// room says the same thing when it opens. First "Finding your history", then
// "Discovering conversations · 1,215 files checked", then what the first pass
// found, with the conversations still reading in the background. Each is a
// fact the status reports (W4), never a bar of its own. Pure, so the catalog
// draws the pane's own line from a fixture status.

/** After the desk, how long Setting up waits for History's first pass before
 * it offers Start now (AO-D4). */
export const START_NOW_AFTER_MS = 8_000;

const count = (n: number, one: string, many: string): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Whether this status has History in it at all: something was brought in. */
export function historyToShow(status: IndexStatus | null | undefined): status is IndexStatus {
  return status !== null && status !== undefined && historyBroughtIn(status);
}

/** Whether Setting up still waits for History: its first pass is not done,
 * the index can do it, and the push has not said there is nothing to wait
 * for. Undefined (the first frame is coming) waits too, bounded like the rest. */
export function waitsForHistory(status: IndexStatus | null | undefined): boolean {
  if (status === undefined) return true;
  if (!historyToShow(status) || unavailable(status)) return false;
  return !firstPassDone(status);
}

function unavailable(status: IndexStatus): boolean {
  return status.phase === "failed" || status.phase === "stopped" || status.phase === "unconfigured";
}

/** History's line, as Setting up lists it. */
export function historySetupPhase(status: IndexStatus): OnboardingSetupPhase {
  const line = { key: "history", label: "History" } as const;
  if (unavailable(status))
    return { ...line, state: "waiting", detail: "History isn't available right now." };
  const { files, sessions, projects } = firstPassCounts(status);
  if (!firstPassDone(status))
    return {
      ...line,
      state: "live",
      detail:
        files > 0
          ? `Discovering conversations · ${count(files, "file", "files")} checked`
          : "Finding your history",
    };
  const found = `${count(sessions, "session", "sessions")} found${
    projects === null ? "" : ` in ${count(projects, "project", "projects")}`
  }`;
  return {
    ...line,
    state: "done",
    detail: historyImporting(status)
      ? `${found} · Reading conversations, in the background`
      : found,
  };
}
