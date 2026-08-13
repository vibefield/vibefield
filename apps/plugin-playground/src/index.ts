// @vibefield/plugin-playground — the headless widget-state verdict runner
// (plugin spec §5.4 item 5). The bin is the product surface; this entry exists
// so tests (and any future kit command) can drive the same run in-process.
export { main, parseArgs, render } from "./cli";
export { isRefusal, toNdjson, toTable } from "./report";
export { type Loader, type RunOptions, runPlayground } from "./run";
export {
  DEFAULT_STATE,
  STATES_RELATIVE_PATH,
  type StatesFile,
  synthesizeDefaultState,
  validateState,
} from "./states";
export type {
  NoteCode,
  PluginVerdict,
  Refusal,
  RefusalCode,
  RunResult,
  RunSummary,
  StateVerdict,
  Verdict,
  VerdictStatus,
  WidgetVerdict,
} from "./verdict";
