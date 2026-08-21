// The window's terminal session pool (TP-S0b). The door: consumers import from
// here and never reach past it — placement, the transport table and the runtime
// factory are the pool's own business (TP-L-C).

export type { TerminalShellPolicy } from "./cell-transport";
export {
  LIVE_SOURCE_DEMAND,
  NO_SOURCE_DEMAND,
  type SessionDemand,
  type SourceDemand,
  type SourceDemandMode,
} from "./demand";
export { TERMINAL_FRAME_SUBSCRIPTION_GRACE_MS } from "./runtime-factory";
export {
  bindTerminalSessionView,
  disposeTerminalPool,
  openTerminalPool,
  type ProjectedSessionDemand,
  prewarmTerminalPool,
  retryTerminalPool,
  subscribeTerminalPool,
  type TerminalFault,
  type TerminalFaultPlane,
  type TerminalPoolPhase,
  type TerminalPoolSnapshot,
  type TerminalSessionView,
  type TransportTrace,
  terminalPoolCellCount,
  terminalPoolDemand,
  terminalPoolLiveSessions,
  terminalPoolProjectedDemand,
  terminalPoolRuntime,
  terminalPoolSnapshot,
  terminalPoolViewCount,
  terminalSessionDemand,
} from "./terminal-pool";
export { useTerminalPool, useTerminalPoolOpen, useTerminalSessionViews } from "./use-terminal-pool";
