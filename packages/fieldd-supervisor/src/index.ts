// @vibefield/fieldd-supervisor — Node-only fieldd ownership for the shell
// (ESR spec §5.3). No Electron anywhere below this line (wall R3).
export { assertDataRootUsable, nativeSocketPath, productPath, runDir, tokenPath } from "./paths";
export { type ProbeResult, tryAdopt } from "./probe";
export {
  createLineBuffer,
  createLogTail,
  MAX_PARTIAL_LINE_BYTES,
  PARTIAL_LINE_TRUNCATION_MARKER,
  redactLine,
} from "./process-log";
export { createFielddSupervisor } from "./supervisor";
export {
  type FielddHandle,
  type FielddSpawnCommand,
  type FielddSupervisor,
  type FielddSupervisorOptions,
  type ProbeFailure,
  SupervisorError,
  type SupervisorErrorKind,
} from "./types";
