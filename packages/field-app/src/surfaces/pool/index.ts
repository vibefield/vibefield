// The window's live-surface attachment pool (DT-2a). The door: consumers import
// from here and never reach past it — entries, grace timers and the wire demand
// counter are the pool's own business.

export {
  coalesceSurfaceDemand,
  IDLE_SURFACE_DEMAND,
  normalizeSurfaceDemandIntent,
  type SurfaceDemandIntent,
  type SurfaceDemandMode,
  type SurfaceDemandRequest,
  surfaceDemandIntentsEqual,
} from "./demand";
export {
  disposeSurfacePool,
  getSurfacePool,
  type ProductSurfaceFrame,
} from "./host-pool";
export {
  createSurfacePool,
  SURFACE_POOL_GRACE_MS,
  type SurfaceAcquireOptions,
  type SurfaceHandle,
  type SurfaceHandleState,
  type SurfaceHandleStatus,
  type SurfacePool,
  type SurfacePoolDeps,
  type SurfacePoolEntrySnapshot,
  type SurfacePoolFailure,
  type SurfacePoolSnapshot,
  type SurfacePoolTimers,
  type SurfaceTicketGrant,
  type SurfaceTicketSource,
} from "./surface-pool";
