import Foundation

// PG-6 — THE TIMELINE'S TUNABLES, transcribed from puppeteer-views 0.3.3 at the lock's `52d09c8e` (the timeline is
// byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`), `src/views/timeline/timeline-parameters.ts` (dist
// `timeline-parameters.js`): `DEFAULT_TIMELINE_PARAMETERS` :1-4, `TIMELINE_PARAMETER_GROUPS` :5-13 and
// `normalizeTimelineParameters` :15-26. The phone lends no parameters (it has no tuning surface), so the view draws at
// the defaults; `normalized` is held to `phone-timeline.golden.json`'s `parameters` all the same.

struct TimelineParameters: Equatable, Sendable {
  /// The wakes' light (0–2).
  var glow: Double
  /// An agent lane's tallest (24–48 px).
  var laneMax: Double

  /// One tunable, as the view's manifest declares it.
  struct Control: Equatable, Sendable {
    let key: String
    let label: String
    let min: Double
    let max: Double
    let step: Double
    let defaultValue: Double
  }

  /// `TIMELINE_PARAMETER_GROUPS`'s one group, `WAKES`.
  static let glowControl = Control(key: "glow", label: "Glow", min: 0, max: 2, step: 0.05, defaultValue: 1)
  static let laneMaxControl = Control(
    key: "laneMax", label: "Lane height", min: 24, max: 48, step: 1, defaultValue: 36)

  /// `DEFAULT_TIMELINE_PARAMETERS`.
  static let defaults = TimelineParameters(glow: glowControl.defaultValue, laneMax: laneMaxControl.defaultValue)

  /// `normalizeTimelineParameters`: each finite number clamped into its control's range; anything else (nil: a key the
  /// host did not lend, or a value that is not a finite number) keeps its default.
  static func normalized(glow: Double?, laneMax: Double?) -> TimelineParameters {
    func clamped(_ value: Double?, _ control: Control) -> Double {
      guard let value, value.isFinite else { return control.defaultValue }
      return Swift.max(control.min, Swift.min(control.max, value))
    }
    return TimelineParameters(glow: clamped(glow, glowControl), laneMax: clamped(laneMax, laneMaxControl))
  }
}
