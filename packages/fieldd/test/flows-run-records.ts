import { FLOW_LIMITS, type FlowJournalHead } from "@vibefield/contracts";
import type { FlowJournalHeadEntry } from "../src/flows/journal";
import type { FlowRecords, FlowRunStart } from "../src/flows/records";

// CP-4a2b (§13a slice 5; cp-landing 22:35Z and 22:37Z, option (b)) — a row's run begun in the flows store, the ONE place
// a test gets a run's start from. In the product the runs choose a run's record at its start and pass it whole
// (`FlowRecords.beginRun(entry, record)` requires it, D18). A row that only needs a journal takes these defaults here,
// so no product caller has one. Import-light: no host, no supervisor, no esbuild, and no `afterEach`.

/** The record a row's run starts with, unless the row says otherwise: no profiles, nothing called, nothing open. */
export const RUN_START: FlowRunStart = {
  scope: [],
  state: "starting",
  calls: 0,
  allowed: FLOW_LIMITS.CALLS_MAX,
  open: [],
  steps: [],
};

/** Begin `entry`'s run in `records`, its record `RUN_START` with the row's `overrides`. */
export function beganRun(
  records: FlowRecords,
  entry: FlowJournalHeadEntry,
  overrides: Partial<FlowRunStart> = {},
): FlowJournalHead {
  return records.beginRun(entry, { ...RUN_START, ...overrides });
}
