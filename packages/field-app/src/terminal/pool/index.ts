// The window's terminal session pool (TP-S0b). The door: consumers import from
// here and never reach past it — placement, the transport table and the runtime
// factory are the pool's own business (TP-L-C).

export type { CellBootId, TerminalShellPolicy } from "./cell-transport";
export {
  LIVE_SOURCE_DEMAND,
  NO_SOURCE_DEMAND,
  type SessionDemand,
  type SourceDemand,
  type SourceDemandMode,
} from "./demand";
export { TERMINAL_FRAME_SUBSCRIPTION_GRACE_MS } from "./runtime-factory";
export type {
  SessionAvailability,
  SessionGrants,
  SessionPlacement,
  SessionUnavailable,
} from "./session-grants";
export { isSessionUnavailable } from "./session-grants";
export {
  bindTerminalSessionView,
  type CreatedTerminalSession,
  createTerminalSession,
  disposeTerminalPool,
  openDormantTransport,
  openTerminalPool,
  type ProjectedSessionDemand,
  prewarmTerminalPool,
  refreshTerminalRoster,
  retryTerminalPool,
  subscribeTerminalPool,
  type TerminalFault,
  type TerminalFaultPlane,
  type TerminalPoolPhase,
  type TerminalPoolSnapshot,
  type TerminalRosterState,
  type TerminalSessionView,
  type TransportTrace,
  terminalPoolCellCount,
  terminalPoolDemand,
  terminalPoolGrantedSessions,
  terminalPoolLiveSessions,
  terminalPoolProjectedDemand,
  terminalPoolRuntime,
  terminalPoolSnapshot,
  terminalPoolViewCount,
  terminalSessionAvailability,
  terminalSessionDemand,
  terminalSessionGrants,
  terminalSessionSummary,
} from "./terminal-pool";
export { useTerminalPool, useTerminalPoolOpen, useTerminalSessionViews } from "./use-terminal-pool";
