import type { FlowRead } from "@vibefield/contracts";

// CP-4a1 (step0-cp4.md §5.1 commit 5; CP4-Q3 (a), CP4-S4) — the static read: what a flow's bytes say, read with acorn
// and never run. CP-4a1 (red): a skeleton; it reads nothing and refuses nothing.

/** Read a flow's bytes without running them. CP-4a1 (red): an empty read. */
export function readFlow(_source: Uint8Array | string): FlowRead {
  return { calls: [], gates: [], unlisted: false, refusals: [] };
}
