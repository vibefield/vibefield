import Foundation

// PG-8 — THE RAIN'S CADENCE: puppeteer-view-sdk 0.3.3 `toolkit/motion.js` `createMotionLoop` (:24-82), its rate cap
// and its delta, transcribed as a value the surface steps with each display frame. The desktop's frames ride
// `requestAnimationFrame`; the phone's ride the Metal view's own (`MTKView`, `isPaused = !isActive`, fd's Q1), so a
// hidden field asks for none. The cap keeps the deliberately chunky cadence: at the default 30 a frame is drawn on
// every 2nd tick at 60 Hz and every 4th at 120 Hz.
//
// Reduced motion, transcribed (fd's Q1): the desktop's loop asks for NO frame while the theme's `reducedMotion` (or
// its `animations` off) says so, and the view draws the field once where it stands on every change instead — a
// still (`elapsed` undefined: no drop falls, no glyph scrambles; dist RainView.js:106-110, :220-222, :231-238). The
// phone keeps the same rule: `RainMotion.wanted` false pauses the surface, and each change repaints one still.

struct RainMotion: Equatable, Sendable {
  /// `fps`: the cap, frames per second; nil or ≤ 0 draws on every tick.
  var fps: Double?
  private(set) var previousTime: Double
  private(set) var accumulated: Double
  private(set) var drawnAt: Double

  /// `reconcile`'s start (:47-53): the clock reads `now` (ms), so the first delta counts from here and a pause never
  /// arrives as one giant step.
  init(now: Double, fps: Double?) {
    self.fps = fps
    previousTime = now
    drawnAt = now
    accumulated = 0
  }

  /// `tick` (:33-45), one display frame at `time` (ms): nil when the cap skips it, else the frame's `deltaMs`, the
  /// time since the last draw, never negative.
  mutating func tick(_ time: Double) -> Double? { nil }

  /// `wanted` (:48, less `disposed`): the loop runs only while animations are on and motion is not reduced.
  static func wanted(animations: Bool, reducedMotion: Bool) -> Bool { false }
}
