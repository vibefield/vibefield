import { join } from "node:path";
import { LAYOUT } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { AuditService } from "../audit-service";
import type { BrowseFacts } from "./browse-exports";
import { WorkspaceDoors } from "./doors";
import { chooseFilesHostLaunch, type FilesHostLaunch, ownFilesHostFacts } from "./launch";
import { RootsRegistry } from "./roots";
import { WorkspaceSessionAudit } from "./session-audit";
import {
  type FilesHostLaunchSpec,
  type FilesHostSessionEvent,
  FilesHostSupervisor,
  type FilesHostTimings,
} from "./supervisor";
import { WorkspaceTickets } from "./tickets";

// FS-1a — the files service as fieldd composes it: the roots registry, the
// worker's supervisor and the doors, built at boot and STARTED with the daemon
// once boot commits (FS-D11 (b)), stopped with it. daemon.ts registers the
// doors and feeds the registry its places; nothing else reaches in.

export interface WorkspaceServiceConfig {
  /** the user root (`FielddConfig.dataDir`) */
  dataDir: string;
  /** this desktop's device id, read at every answer */
  deviceId: () => string;
  /** `FielddConfig.filesHost`: absent = resolved from this process (the
   * bundle beside the daemon, or the packaged executable's role); `false` =
   * OFF (a test-only knob, L6 — never a user setting); a launch = a test's own
   * worker */
  filesHost?: false | FilesHostLaunch | undefined;
  /** the directory fieldd's bundle runs from (`__dirname` of bin.cjs) */
  bundleDir?: string | undefined;
  timings?: Partial<FilesHostTimings> | undefined;
  /** test seam: the browse enumerator's facts */
  browse?: (() => BrowseFacts) | undefined;
  /** test seam: the roots subscription's re-read cadence */
  rootsPollMs?: number | undefined;
  /** R6 — the ledger an attachment's life is written to (absent: unrecorded,
   * a unit test's service) */
  audit?: Pick<AuditService, "requiredSystem"> | undefined;
  logger: Logger;
}

export interface WorkspaceService {
  registry: RootsRegistry;
  supervisor: FilesHostSupervisor;
  doors: WorkspaceDoors;
  tickets: WorkspaceTickets;
  start(): void;
  stop(): Promise<void>;
}

export function launchSpecFor(config: WorkspaceServiceConfig): FilesHostLaunchSpec {
  if (config.filesHost === false) return { kind: "off" };
  if (config.filesHost !== undefined) return { kind: "launch", launch: config.filesHost };
  const choice = chooseFilesHostLaunch(ownFilesHostFacts(config.bundleDir));
  return choice.kind === "launch" ? choice : { kind: "unconfigured", reason: choice.reason };
}

export function createWorkspaceService(config: WorkspaceServiceConfig): WorkspaceService {
  const registry = new RootsRegistry({
    file: join(config.dataDir, ...LAYOUT.WORKSPACE_ROOTS_FILE),
    deviceId: config.deviceId,
    ...(config.browse !== undefined ? { browse: config.browse } : {}),
    logger: config.logger.child({ component: "workspace_roots" }),
  });
  const supervisor = new FilesHostSupervisor({
    launch: launchSpecFor(config),
    ...(config.timings !== undefined ? { timings: config.timings } : {}),
    logger: config.logger.child({ component: "files_host" }),
  });
  const doors = new WorkspaceDoors({
    registry,
    supervisor,
    ...(config.rootsPollMs !== undefined ? { rootsPollMs: config.rootsPollMs } : {}),
    logger: config.logger.child({ component: "workspace_doors" }),
  });
  const tickets = new WorkspaceTickets(registry, supervisor);
  const sessions =
    config.audit !== undefined
      ? new WorkspaceSessionAudit(
          config.audit,
          config.logger.child({ component: "workspace_sessions" }),
        )
      : null;
  const onSession = (event: FilesHostSessionEvent) => sessions?.record(event);
  supervisor.on("session", onSession);
  const unlisten = registry.onChange(() => {
    if (supervisor.health().phase !== "ready") return;
    void supervisor
      .request("retainRoots", {
        rootIds: registry
          .roots()
          .filter((root) => !root.missing)
          .map((root) => root.rootId),
      })
      .catch(() => undefined);
  });
  return {
    tickets,
    registry,
    supervisor,
    doors,
    start: () => supervisor.start(),
    stop: async () => {
      unlisten();
      doors.dispose();
      await supervisor.stop();
      // the sessions the stop ended are in the ledger before it closes
      await sessions?.drain();
      supervisor.off("session", onSession);
    },
  };
}
