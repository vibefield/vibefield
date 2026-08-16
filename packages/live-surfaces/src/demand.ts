import type { LiveSurfaceDemandV1 } from "@vibefield/contracts";

export type LiveSurfaceDemandUpdateKind = "accepted" | "duplicate" | "stale";

export interface LiveSurfaceDemandUpdate {
  readonly kind: LiveSurfaceDemandUpdateKind;
  readonly current: LiveSurfaceDemandV1;
}

export class LiveSurfaceDemandConflictError extends Error {
  constructor(readonly revision: number) {
    super(`live surface demand revision ${revision} was reused with different content`);
    this.name = "LiveSurfaceDemandConflictError";
  }
}

function copyDemand(demand: LiveSurfaceDemandV1): LiveSurfaceDemandV1 {
  const targetRasterSize = demand.targetRasterSize;
  return {
    revision: demand.revision,
    mode: demand.mode,
    targetFps: demand.targetFps,
    ...(targetRasterSize === undefined
      ? {}
      : {
          targetRasterSize: {
            width: targetRasterSize.width,
            height: targetRasterSize.height,
          },
        }),
    priority: demand.priority,
    interactive: demand.interactive,
  };
}

function demandsEqual(left: LiveSurfaceDemandV1, right: LiveSurfaceDemandV1): boolean {
  return (
    left.revision === right.revision &&
    left.mode === right.mode &&
    left.targetFps === right.targetFps &&
    left.priority === right.priority &&
    left.interactive === right.interactive &&
    left.targetRasterSize?.width === right.targetRasterSize?.width &&
    left.targetRasterSize?.height === right.targetRasterSize?.height
  );
}

/** Monotonic demand acceptance; source-specific actuation lives in adapters. */
export class LiveSurfaceDemandTracker {
  #current: LiveSurfaceDemandV1 | null = null;

  get current(): LiveSurfaceDemandV1 | null {
    return this.#current === null ? null : copyDemand(this.#current);
  }

  update(next: LiveSurfaceDemandV1): LiveSurfaceDemandUpdate {
    const candidate = copyDemand(next);
    const current = this.#current;
    if (current === null || candidate.revision > current.revision) {
      this.#current = candidate;
      return { kind: "accepted", current: copyDemand(candidate) };
    }
    if (candidate.revision < current.revision) {
      return { kind: "stale", current: copyDemand(current) };
    }
    if (!demandsEqual(current, candidate)) {
      throw new LiveSurfaceDemandConflictError(candidate.revision);
    }
    return { kind: "duplicate", current: copyDemand(current) };
  }
}

export function liveSurfaceDemandRequestsFrames(demand: LiveSurfaceDemandV1 | null): boolean {
  return demand?.mode === "live" && demand.targetFps > 0;
}
