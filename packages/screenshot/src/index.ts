// @vibefield/screenshot — the host side of the native screenshot helper
// (SNAP-D1): own one helper, read its line protocol, keep the
// capture timers and still ring honest. macOS prewarms --service without
// capturing; Windows keeps --once. Node-only; no Electron anywhere below this
// line (wall R19) — Electron main composes it, a vitest drives it with a
// scripted fake helper.
export { type LineVerdict, parseScreenshotHelperLine, ScreenshotLineReader } from "./protocol";
export {
  ScreenshotTool,
  type ScreenshotToolChild,
  type ScreenshotToolEvent,
  type ScreenshotToolOptions,
  type ScreenshotToolSpawn,
} from "./tool";
