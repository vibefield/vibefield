// The mirror's door (TP-S2). A host mounts `TerminalMirrorSurface` with a
// session id and nothing else; the pool, the runtime facade and the demand
// ledger behind it are this module's business (TP-L-C).

export {
  type MirrorState,
  TerminalMirrorSurface,
  type TerminalMirrorSurfaceProps,
} from "./TerminalMirrorSurface";
export {
  MIRROR_REFUSED_VERBS,
  type MirrorRefusals,
  type MirrorRefusedVerb,
  type WatchOnlyRuntime,
  watchOnlyRuntime,
} from "./watch-only-runtime";
