import Foundation

// PG-6 — THE TIMELINE'S OWN LENGTH WORD, transcribed from puppeteer-view-sdk 0.3.3 at the lock's `52d09c8e` (identical
// to 0.3.2's `95a70aa7`), `src/toolkit/format.ts` (`5abe8f75`): `formatElapsed` (dist `format.js:53-62`) and its
// `pad2` (:11). The SDK's `ms` contract, not FieldAgents' `formatElapsed(since:now:)` (SwarmBodyModel.swift), which the
// swarm's body says; GodviewFormat.swift:7 names this one the timeline's own. `days: false` (format.js:57) has no
// timeline caller and is not transcribed. Held to `phone-timeline.golden.json`'s `elapsed`.

enum TimelineFormat {
  /// `formatElapsed(ms)`: how long something has been going, to the second — `4:39` under an hour, then `2h 05m`, then
  /// `1d 03h` from a day. JavaScript's arithmetic: `Math.max(0, Math.floor(ms / 1000))` keeps NaN, so NaN says
  /// `NaN:NaN` and +∞ `Infinityd NaNh`, as the SDK does; nothing traps.
  static func elapsed(ms: Double) -> String {
    let seconds = max0((ms / 1000).rounded(.down))
    let minutes = (seconds / 60).rounded(.down)
    let hours = (minutes / 60).rounded(.down)
    if hours >= 24 {
      return "\(number((hours / 24).rounded(.down)))d \(pad2(hours.truncatingRemainder(dividingBy: 24)))h"
    }
    if hours > 0 { return "\(number(hours))h \(pad2(minutes.truncatingRemainder(dividingBy: 60)))m" }
    return "\(number(minutes)):\(pad2(seconds.truncatingRemainder(dividingBy: 60)))"
  }

  /// `String(value)` for the numbers the timeline prints (whole lengths and ms instants): a whole number below 2^53 by
  /// its digits, NaN and ±Infinity by name, −0 as `0`, and anything else by Swift's shortest round-trip digits, which
  /// are JavaScript's for every value the timeline makes. Past those (a whole number from 2^53, or below 1e-6) Swift
  /// spells the digits its own way: a phone-only DEVIATION, unreachable from ms; FieldAgents' `JSNumber` replaces this
  /// at the rebase over items 164/165.
  static func number(_ value: Double) -> String {
    if value.isNaN { return "NaN" }
    if value.isInfinite { return value < 0 ? "-Infinity" : "Infinity" }
    if value == 0 { return "0" }
    if value == value.rounded(.towardZero), abs(value) < 9_007_199_254_740_992 { return String(Int64(value)) }
    return "\(value)"
  }

  /// `Math.max(0, value)`: NaN stays NaN, and −0 becomes 0.
  private static func max0(_ value: Double) -> Double {
    value.isNaN ? .nan : (value > 0 ? value : 0)
  }

  /// `pad2`: `String(value).padStart(2, '0')`.
  private static func pad2(_ value: Double) -> String {
    let text = number(value)
    return text.count < 2 ? "0" + text : text
  }
}
