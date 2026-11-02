import Foundation

// PG-4s — THE NUMBERS THE VIEWS PRINT, transcribed from puppeteer-view-sdk 0.3.2 at the pin `95a70aa7`,
// `src/toolkit/format.ts` (`5abe8f75`): `pad2` :15, `formatShort` :66, `formatWords` :76, `formatClock` :89,
// `formatPercent` :110. Namespaced: FieldAgents exports `formatUsd`, `formatTokens` and `formatElapsed(since:now:)` at
// file scope (CostFormat.swift, SwarmBodyModel.swift), and none of these may collide with or be picked for them.
// SDK `formatElapsed(ms)` is the timeline's own (a different contract from FieldAgents'), and `formatRatePerHour` /
// `formatTokens` have no caller among the four views (the design's §0.1).
//
// The inputs are `Double` ms, as JavaScript's arithmetic is. Every word is held to `phone-toolkit.golden.json`.

enum GodviewFormat {
  private static let second = 1000.0
  private static let minute = 60 * second

  /// `formatShort`: a length, compact — `45s`, `11m`, `2h 14m`, `2h`. Round, then clamp, then floor: 59.5 s is `1m`.
  /// A non-finite length says what JavaScript says (`NaNh`, `Infinityh`, `0s`), and an absurd one JavaScript's digits;
  /// nothing traps.
  static func formatShort(ms: Double) -> String {
    let seconds = jsRoundClamped(ms / second)
    let minutes = (seconds / 60).rounded(.down)
    let hours = (minutes / 60).rounded(.down)
    if minutes < 1 { return "\(whole(seconds))s" }
    if hours < 1 { return "\(whole(minutes))m" }
    let rest = minutes.truncatingRemainder(dividingBy: 60)
    return truthy(rest) ? "\(whole(hours))h \(pad2(rest))m" : "\(whole(hours))h"
  }

  /// `formatWords`: a length as a screen reader says it — `under a minute`, `1 hour 4 minutes`.
  static func formatWords(ms: Double) -> String {
    let minutes = jsRoundClamped(ms / minute)
    if minutes < 1 { return "under a minute" }
    let hours = (minutes / 60).rounded(.down)
    let rest = minutes.truncatingRemainder(dividingBy: 60)
    let parts = [
      truthy(hours) ? "\(whole(hours)) hour\(hours == 1 ? "" : "s")" : "",
      truthy(rest) ? "\(whole(rest)) minute\(rest == 1 ? "" : "s")" : "",
    ]
    return parts.filter { !$0.isEmpty }.joined(separator: " ")
  }

  /// `formatClock`: the wall clock in `timeZone` (the phone passes `.current`, as JavaScript reads the local zone) —
  /// `14:05`, or `14:05:09`. The instant is JavaScript's Date: truncated to a whole ms (TimeClip), and invalid past
  /// ±8.64e15 ms or non-finite, where every field reads `NaN`. The fields are LocalTime's: the zone's offset at that
  /// instant added, then floored, so an instant before 1970 reads as JavaScript reads it.
  static func formatClock(ms: Double, withSeconds: Bool = false, timeZone: TimeZone) -> String {
    guard ms.isFinite, abs(ms) <= 8.64e15 else { return withSeconds ? "NaN:NaN:NaN" : "NaN:NaN" }
    let instant = ms.rounded(.towardZero)
    let offset = Double(timeZone.secondsFromGMT(for: Date(timeIntervalSince1970: instant / second))) * second
    let local = instant + offset
    let hours = positiveRemainder((local / (60 * minute)).rounded(.down), 24)
    let minutes = positiveRemainder((local / minute).rounded(.down), 60)
    let base = "\(pad2(hours)):\(pad2(minutes))"
    guard withSeconds else { return base }
    return "\(base):\(pad2(positiveRemainder((local / second).rounded(.down), 60)))"
  }

  /// `formatPercent`: a share floored — `42%`; `missing` for nil or non-finite. −0 prints `0`, as JavaScript prints
  /// it. Exact below 2^53; at or beyond, `missing`: a phone-only bound at absurd values, as the body's
  /// `flooredPercent` has (JavaScript would print the digits).
  static func formatPercent(_ value: Double?, missing: String = "—") -> String {
    guard let value, value.isFinite else { return missing }
    let floored = value.rounded(.down)
    guard abs(floored) < 9_007_199_254_740_992 else { return missing }
    return "\(Int64(floored))%"
  }

  // MARK: - JavaScript's arithmetic and printing, where the words depend on it

  /// `Math.max(0, value)`: NaN stays NaN, and −0 becomes 0.
  static func jsMax0(_ value: Double) -> Double {
    value.isNaN ? .nan : (value > 0 ? value : 0)
  }

  /// `Math.sign`: −1, 1, or the value itself for ±0 and NaN.
  static func jsSign(_ value: Double) -> Double {
    value > 0 ? 1 : (value < 0 ? -1 : value)
  }

  /// `Math.max(0, Math.round(value))`. Rounding a clamped value is the same (a negative rounds to at most 0), and
  /// for a value at or above 0 JavaScript's ties-toward-+∞ is ties away from zero.
  private static func jsRoundClamped(_ value: Double) -> Double {
    jsMax0(value).rounded(.toNearestOrAwayFromZero)
  }

  /// JavaScript's truthiness of a number: neither 0 nor NaN.
  private static func truthy(_ value: Double) -> Bool { value != 0 && !value.isNaN }

  /// `((value % by) + by) % by` for a whole value: the field of a time that may be before 1970.
  private static func positiveRemainder(_ value: Double, _ by: Double) -> Double {
    let rest = value.truncatingRemainder(dividingBy: by)
    return rest < 0 ? rest + by : rest + 0
  }

  /// `pad2` (format.ts :15): `String(value).padStart(2, '0')`.
  private static func pad2(_ value: Double) -> String {
    let text = whole(value)
    return text.count < 2 ? String(repeating: "0", count: 2 - text.count) + text : text
  }

  /// `String(value)` for a whole number, as JavaScript prints it (Number::toString): its shortest round-trip digits,
  /// padded with zeros below 1e21 (`2777777777777777700`), an exponent from 1e21 (`1e+25`); `NaN`, `Infinity`.
  static func whole(_ value: Double) -> String {
    if value.isNaN { return "NaN" }
    if value.isInfinite { return value < 0 ? "-Infinity" : "Infinity" }
    if value == 0 { return "0" }
    let sign = value < 0 ? "-" : ""
    let magnitude = abs(value)
    if magnitude < 9_007_199_254_740_992 { return sign + String(Int64(magnitude)) }
    // Swift's description is the same shortest round-trip digits, in its own notation
    let text = magnitude.description
    if magnitude >= 1e21 { return sign + text }
    guard let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) else {
      return sign + (text.hasSuffix(".0") ? String(text.dropLast(2)) : text)
    }
    let mantissa = text[..<e]
    let exponent = Int(text[text.index(after: e)...].filter { $0 != "+" }) ?? 0
    let digits = mantissa.filter { $0 != "." }
    let integral = mantissa.firstIndex(of: ".").map { mantissa.distance(from: mantissa.startIndex, to: $0) }
      ?? mantissa.count
    return sign + digits + String(repeating: "0", count: max(0, exponent + integral - digits.count))
  }
}
