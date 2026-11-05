// CP-4a2a (CP-D8; 4A2-Q1 (a)) — a run's flow host, the child's ENTRY (`flows-host` role). fieldd starts one per run, as
// its OWN executable re-run in this role: the development bundle `flows-host.cjs` under the runtime fieldd runs under,
// or the packaged single executable with `--vibefield-role=flows-host` (bin.ts). Its environment is PATH alone and its
// one door is its IPC pipe (protocol.ts).
//
// SKELETON (the red, commit 5): it does nothing, and leaves.

/** Run the host: called by the bundle's own top level, and by bin.ts in the packaged executable's `flows-host`
 * role. */
export function runFlowsHost(): void {}
