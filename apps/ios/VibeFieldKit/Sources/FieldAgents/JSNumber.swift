import Foundation

/// JavaScript's arithmetic words, for the numbers a window prints in JavaScript and the phone prints after it: the
/// SDK's `toolkit/format.js` (puppeteer-view-sdk 0.3.2). Nothing here traps; a non-finite or absurd value says what
/// JavaScript says. (Items 164/165, 2026-11-02: `whole` moved here unchanged from FieldHome's `GodviewFormat`
/// (PG-4s), so the Godview toolkit and FieldAgents' formatters print a number one way.)
public enum JSNumber {
  /// `Math.round`: the nearest whole number, a tie toward +∞ (2.5 is 3, -2.5 is -2). NaN and ±∞ stay themselves.
  /// The fraction `value - down` is exact, so a value just under a half (0.49999999999999994) never rounds up.
  public static func round(_ value: Double) -> Double {
    let down = value.rounded(.down)
    return value - down >= 0.5 ? down + 1 : down
  }

  /// `String(value)` for a whole number, as JavaScript prints it (Number::toString): its shortest round-trip digits,
  /// padded with zeros below 1e21 (`2777777777777777700`), an exponent from 1e21 (`1e+25`); `NaN`, `Infinity`.
  public static func whole(_ value: Double) -> String {
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
