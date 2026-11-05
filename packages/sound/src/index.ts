/**
 * @vibefield/sound — VibeField's sound identity (DESIGN.md §14), in code: the field and its chord, the Starlight voice,
 * the spaces, the masters, the family, the phone's touch, and the voice that decides when the field speaks.
 *
 * Zero dependencies and pure at import (wall R31), so Electron main, the window, the package-time tools and the tests
 * run the same code: a render is a pure function of its cue, its options and its seed. `.ts` specifiers and erasable
 * syntax only, so plain Node runs it as it stands.
 */
export { SR } from "./dsp.ts";
export {
  above,
  FUNDAMENTAL,
  harmonicOf,
  hz,
  type Planet,
  SCALE,
  TONIC,
  TRAPPIST,
  tuned,
} from "./field.ts";
export { ENGINE_HASH, ENGINE_REVISION, nearestPlace, PREVIEW_CUES, renderKey } from "./files.ts";
export { haptics, type Tap } from "./haptics.ts";
export { momentaryMax } from "./loudness.ts";
export { isQuiet, QUIET, quietEnd } from "./quiet.ts";
export {
  clearOf,
  type Layout,
  layout,
  type Render,
  type RenderMeta,
  type RenderOptions,
  render,
} from "./render.ts";
export {
  CLEAR_AFTER_S,
  CUE_IDS,
  CUES,
  type CueId,
  type CueSpec,
  type Note,
  PAN_LIMIT,
  PAN_POSITIONS,
  PROFILES,
  type ProfileId,
  type ProfileSpec,
  SPACES,
  type SpaceId,
  type SpaceSpec,
  STARLIGHT,
  TAIL_FLOOR_DB,
  type VoiceSpec,
} from "./score.ts";
export {
  type AgentObservation,
  type AgentStatus,
  type Blocker,
  createVoice,
  cueFor,
  type PlayRequest,
  type StatusCue,
  VOICE,
  type Voice,
  type VoiceClock,
  type VoiceCue,
  type VoiceStats,
} from "./voice.ts";
export { encodeWav } from "./wav.ts";
