import type { FlowJournalHead } from "@vibefield/contracts";
import type { FlowJournalHeadEntry } from "../src/flows/journal";
import type { FlowRecords } from "../src/flows/records";

// CP-4a2b (§13a slice 5; cp-landing 22:37Z, option (b)) — a row's run begun in the flows store, the ONE place a test
// gets a run's start from. In the product, the runs choose a run's record at its start and pass it whole. A row that
// only needs a journal begins one here, so no row writes a run record of its own and no product caller has a
// default. Import-light: no host, no supervisor, no esbuild, and no `afterEach`.

/** Begin `entry`'s run in `records`, as a row's journal needs it. */
export function beganRun(records: FlowRecords, entry: FlowJournalHeadEntry): FlowJournalHead {
  return records.beginRun(entry);
}
