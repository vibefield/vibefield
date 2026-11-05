import { isMainThread, workerData } from "node:worker_threads";
import { FLOW_WORKER_ROLE, runFlowsHost } from "./main";
import { type FlowWorkerData, runFlowWorker } from "./worker";

// CP-4a2a — `dist/flows-host.cjs`'s entry (scripts/flows-host-build.mjs), ONE bundle for both of the host's threads
// (4A2-Q7 (b)). Loaded as a process's main script (the development runtime runs it; the packaged executable's
// `flows-host` role loads it from beside itself, bin.ts), it is the host's own thread, and it starts the run's worker
// from this same file: `__filename` is the bundle's path on disk in both builds, so the worker is loaded by Node's own
// file loader, never from the executable's blob. Loaded as that worker (its workerData names the role), it runs the
// script.
const data = workerData as (FlowWorkerData & { readonly role?: unknown }) | null;
if (isMainThread) runFlowsHost(__filename);
else if (data?.role === FLOW_WORKER_ROLE) runFlowWorker(data);
