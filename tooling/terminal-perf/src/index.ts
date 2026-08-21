// `@vibefield/terminal-perf` — the TP-S0a measurement floor.
//
//   fixtures/terminal-perf/trf1/   the corpus (recorded through a real cell)
//   pnpm perf:terminal:bench       the worker replay microbench (per PR)
//   pnpm perf:terminal:capture     re-record the corpus (spawns the daemon pair)
//
// The in-app half of the floor — `production` counters and the `metrics`-mode
// sampler — lives in `packages/field-app/src/perf/terminal-perf.ts`, because it
// must run inside the renderer beside the runtime it samples.
export {
  type BenchOptions,
  type BenchReport,
  benchTrace,
  corpusFiles,
  formatReport,
  nullArm,
  runBench,
  type TraceResult,
} from "./bench";
export { type ByteTrace, base1Corpus, crc32, formatRecord } from "./byte-traces";
export { captureSession, startNativeFloor, waitForEndpoint } from "./capture-harness";
export {
  CORPUS_COLS,
  CORPUS_ROWS,
  type CorpusEntry,
  REPLAY_ENTRIES,
  recordEntries,
} from "./corpus-plan";
export { connectFramesSocket, type FramesSocket, nowUs, packet } from "./frames-client";
export {
  EMPTY_HISTOGRAM,
  type Histogram,
  medianOf,
  quantile,
  round,
  roundHistogram,
  summarize,
} from "./histogram";
export { type CorpusManifest, describeCapture, describeFile, type ManifestEntry } from "./manifest";
export {
  applyDecodedFrame,
  classify,
  decodeFrameBody,
  emptyReplica,
  type SessionReplica,
} from "./replica";
export {
  capCapture,
  captureByteLength,
  captureDurationMs,
  decodeCapture,
  encodeCapture,
  isFrameBody,
  readCaptureFile,
  type Trf1Capture,
  type Trf1CaptureHeader,
  type Trf1FrameRecord,
  writeCaptureFile,
} from "./trf1-container";
