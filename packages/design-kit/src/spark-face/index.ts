// A spark's face (DESIGN.md §2.10) — the kit's `./spark-face` entry. Pure at import: the engine is
// loaded by the first face that mounts (./engine.ts).
export {
  loadSparklings,
  SPARK_FRAME,
  type Sparklings,
  type SparkPalette,
  sparkFaceScale,
} from "./engine";
export { type FlatStarShape, flatStar } from "./flat-star";
export { SparkHatch, type SparkHatchHandle, type SparkHatchProps } from "./hatch";
export {
  NIGHT_EASE_OUT_S,
  NIGHT_REST_AFTER_S,
  nightRestRate,
  nightRestTarget,
  SparkNight,
  type SparkNightProps,
} from "./night";
export {
  SparkFace,
  type SparkFaceProps,
  SparkFaceRenderer,
  type SparkFaceRendering,
} from "./SparkFace";
export { SparkStage, type SparkStageProps } from "./stage";
export {
  SPARK_NEEDS_YOU,
  SPARK_STATUSES,
  type SparkStatus,
  sparkStatusWord,
} from "./statuses";
