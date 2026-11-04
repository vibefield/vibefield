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

  /// `DEFAULT_RAIN_PARAMETERS` (:14-25). SKELETON (PG-8 red): the transcription lands in the green.
  static let defaults = RainParameters(
    speedMultiplier: 0, tailMultiplier: 0, refreshRate: 0, scrambleWorking: 0, scramblePending: 0, fontSize: 0,
    headGlow: 0, paneTint: 0)

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

  static let groups: [Group] = []

  static func normalize(_ stored: [String: Double]) -> RainParameters { defaults }

  func value(_ key: String) -> Double? { nil }
}
