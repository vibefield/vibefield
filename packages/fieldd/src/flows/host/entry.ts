import { runFlowsHost } from "./main";

// CP-4a2a — `dist/flows-host.cjs`'s entry (scripts/flows-host-build.mjs): the development runtime runs this bundle as a
// run's flow host. The packaged single executable reaches the same `runFlowsHost` through bin.ts's role argument.
runFlowsHost();
