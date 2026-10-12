// The window's terminal session pool (TP-S0b). The door: consumers import from
// here and never reach past it — placement, the transport table and the runtime
// factory are the pool's own business (TP-L-C).

export type { RemoteRefusal, RemoteRefusalState } from "../routed/remote-refusal";
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
  adoptCreatedTerminal,
  adoptRemoteTerminalSession,
  bindTerminalSessionView,
  type CreatedTerminalSession,
  type CreateTerminalOptions,
  configureTerminalPool,
  createTerminalSession,
  disposeTerminalPool,
  floorReadWithin,
  openDormantTransport,
  openTerminalPool,
  type ProjectedSessionDemand,
  prewarmTerminalPool,
  readRemoteTerminalSession,
  refreshTerminalRoster,
  remoteTerminalDeviceFlipped,
  retryTerminalPool,
  subscribeTerminalPool,
  TERMINAL_PREWARM_TIMEOUT_MS,
  type TerminalFault,
  type TerminalFaultPlane,
  type TerminalPoolPhase,
  type TerminalPoolSnapshot,
  type TerminalRosterState,
  type TerminalSessionView,
  type TransportTrace,
  terminalBootstrapHome,
  terminalPoolCellCount,
  terminalPoolConfigured,
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
  terminalSessionProfileSet,
  terminalSessionSummary,
  terminalShellBirth,
  terminateTerminalSession,
} from "./terminal-pool";
export { useTerminalPool, useTerminalPoolOpen, useTerminalSessionViews } from "./use-terminal-pool";
