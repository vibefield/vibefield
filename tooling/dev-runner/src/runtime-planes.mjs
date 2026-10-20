import { join } from "node:path";
import { rendererArtifactsOf, serviceModulesOf } from "./critical-changes.mjs";

// The restart classes: each plane's files are what its identity hashes
// (cli.mjs `buildIdentity`). A rebuilt shell-plane file restarts Electron alone
// and the new shell adopts the running pair; a rebuilt daemon-plane file bounces
// the pair. A file the daemon runs that neither list names moves no identity,
// so a rebuild of it alone stages nothing new and restarts nothing.

export function shellPlaneInputs(paths) {
  return [paths.mainOutput, paths.preloadOutput, paths.studioPreloadOutput];
}

export function daemonPlaneInputs(paths, pluginProjects) {
  return [
    paths.fielddOutput,
    paths.serviceHarnessOutput,
    paths.fielddWasm,
    paths.agentShimOutput,
    // FS-1a — the files worker runs with the daemon: a rebuilt worker bounces the pair
    paths.filesHostOutput,
    paths.milleNativeOutput,
    paths.nativeOutput,
    // TC-S2 — the cell the floor spawns beside itself: a rebuilt cell bounces the pair
    paths.cellOutput,
    // F1 — and its freeway host, the same way
    paths.freewayOutput,
    ...pluginProjects.flatMap((project) => [
      join(paths.repoRoot, project.manifestFile),
      ...rendererArtifactsOf(project).map((artifact) => join(paths.repoRoot, artifact)),
      ...serviceModulesOf(project).map((module) => join(paths.repoRoot, module)),
    ]),
  ];
}
