// @vibefield/plugin-playground — the headless verdict runner (plugin spec §5.4
// item 5): object kinds judged by the SDK's kind-conformance harness (DK-7; the
// widget states it once judged retired with `contributes.widgets` at DK-8). The bin is the product surface;
// this entry exists so tests (and any future kit command) can drive the same run
// in-process.
export { main, parseArgs, render } from "./cli";
export { isRefusal, toNdjson, toTable } from "./report";
export { type Loader, type RunOptions, runPlayground } from "./run";
export {
  DEFAULT_STATE,
  STATES_RELATIVE_PATH,
  type StateRow,
  type StatesFile,
  synthesizeDefaultState,
  validateState,
} from "./states";
export type {
  KindRow,
  NoteCode,
  ObjectVerdict,
  PluginVerdict,
  Refusal,
  RefusalCode,
  RunResult,
  RunSummary,
  TypeVerdict,
  Verdict,
  VerdictStatus,
} from "./verdict";
export { RETIRED_CODES } from "./verdict";
