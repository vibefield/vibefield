import Foundation

// PG-8 — THE RAIN'S EIGHT TUNABLES, transcribed from puppeteer-views 0.3.3 at the pin `52d09c8e` (views `e79fc53d`,
// 10-28; SDK words `e79fc53d`, state-words and motion `5abe8f75`): `views/rain/rain-parameters.ts` — the defaults
// :14-25, the groups :27-52, `normalizeRainParameters` :56-66 (dist `rain-parameters.js:1-51`). The phone lends no
// parameters panel, so the rain stands on the defaults; the groups and `normalize` are here so the golden holds the
// whole file (`phone-rain.golden.json`'s `parameters` and `normalize`).

struct RainParameters: Equatable, Sendable {
  var speedMultiplier: Double
  var tailMultiplier: Double
  var refreshRate: Double
  var scrambleWorking: Double
  var scramblePending: Double
  var fontSize: Double
  var headGlow: Double
  var paneTint: Double

  /// `DEFAULT_RAIN_PARAMETERS` (:14-25).
  static let defaults = RainParameters(
    speedMultiplier: 1, tailMultiplier: 1, refreshRate: 30, scrambleWorking: 0.15, scramblePending: 0.8,
    fontSize: 12, headGlow: 10, paneTint: 0.12)

  /// One control of `RAIN_PARAMETER_GROUPS`: the key a stored value is saved under, its label and its range.
  struct Control: Equatable, Sendable {
    let key: String
    let label: String
    let min: Double
    let max: Double
    let step: Double
    let defaultValue: Double
  }

  struct Group: Equatable, Sendable {
    let title: String
    let controls: [Control]
  }

  /// `RAIN_PARAMETER_GROUPS` (:27-52), in its order.
  static let groups: [Group] = [
    Group(
      title: "STREAM",
      controls: [
        Control(
          key: "speedMultiplier", label: "Clock speed", min: 0.1, max: 5, step: 0.1, defaultValue: 1),
        Control(
          key: "tailMultiplier", label: "Tail multiplier", min: 0.2, max: 3, step: 0.1, defaultValue: 1),
        Control(
          key: "refreshRate", label: "Refresh rate", min: 10, max: 60, step: 1, defaultValue: 30),
      ]),
    Group(
      title: "LEGIBILITY",
      controls: [
        Control(
          key: "scrambleWorking", label: "Work scramble", min: 0, max: 1, step: 0.05, defaultValue: 0.15),
        Control(
          key: "scramblePending", label: "Pend scramble", min: 0, max: 1, step: 0.05, defaultValue: 0.8),
        Control(
          key: "fontSize", label: "Terminal font", min: 8, max: 36, step: 1, defaultValue: 12),
      ]),
    Group(
      title: "PRESENTATION",
      controls: [
        Control(key: "headGlow", label: "Head glow", min: 0, max: 40, step: 1, defaultValue: 10),
        Control(
          key: "paneTint", label: "Pane tint", min: 0, max: 0.4, step: 0.02, defaultValue: 0.12),
      ]),
  ]

  /// `normalizeRainParameters` (:56-66): the defaults, and each stored value that is a finite number clamped into its
  /// control's range, `Math.max(min, Math.min(max, value))`. A key no control names is ignored.
  static func normalize(_ stored: [String: Double]) -> RainParameters {
    var normalized = defaults
    for control in groups.flatMap(\.controls) {
      guard let candidate = stored[control.key], candidate.isFinite else { continue }
      normalized.set(control.key, Swift.max(control.min, Swift.min(control.max, candidate)))
    }
    return normalized
  }

  /// The value a control's key names.
  func value(_ key: String) -> Double? {
    switch key {
    case "speedMultiplier": speedMultiplier
    case "tailMultiplier": tailMultiplier
    case "refreshRate": refreshRate
    case "scrambleWorking": scrambleWorking
    case "scramblePending": scramblePending
    case "fontSize": fontSize
    case "headGlow": headGlow
    case "paneTint": paneTint
    default: nil
    }
  }

  private mutating func set(_ key: String, _ value: Double) {
    switch key {
    case "speedMultiplier": speedMultiplier = value
    case "tailMultiplier": tailMultiplier = value
    case "refreshRate": refreshRate = value
    case "scrambleWorking": scrambleWorking = value
    case "scramblePending": scramblePending = value
    case "fontSize": fontSize = value
    case "headGlow": headGlow = value
    case "paneTint": paneTint = value
    default: break
    }
  }
}
