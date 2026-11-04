import Foundation

// PG-7 — JAVASCRIPT'S `Number.prototype.toFixed`, spend's own (Q-S11 (b): one caller, so in its view's folder). Spend
// prints with it twice: the money axis's labels (`axisMoney`, `spend-words.js` :37-41, one to three places) and the
// money ticks' cleaning (`moneyTicks`, `spend-scale.js` :47, six places). FieldAgents' `tenths`
// (SwarmBodyModel.swift :75) is the same rule for one place and is internal to FieldAgents; this generalises its test.

enum SpendNumber {
  /// `value.toFixed(places)` (ECMA-262 Number.prototype.toFixed) for 0…20 places: the `places`-digit decimal nearest
  /// the EXACT binary value, and on an exact tie the larger magnitude (`String(format:)` breaks it to even, so 0.25
  /// read `0.2` where JavaScript reads `0.3`). A tie is exact only when the binary value's expansion ends at the 5 one
  /// place past `places`, which sixty places show for every value spend prints. A negative keeps its sign (`-0.00`),
  /// −0 and NaN print as JavaScript prints them, and from 1e21 the number is said in its exponent form, as `toFixed`
  /// does.
  static func fixed(_ value: Double, _ places: Int) -> String {
    if value.isNaN { return "NaN" }
    let negative = value < 0
    let magnitude = abs(value)
    if magnitude >= 1e21 {
      if magnitude.isInfinite { return negative ? "-Infinity" : "Infinity" }
      return (negative ? "-" : "") + magnitude.description
    }
    let expansion = String(format: "%.60f", magnitude)
    var rounded = String(format: "%.\(places)f", magnitude)
    if let point = expansion.firstIndex(of: ".") {
      let tail = expansion[expansion.index(point, offsetBy: places + 1)...]
      if tail.first == "5", tail.dropFirst().allSatisfy({ $0 == "0" }) {
        rounded = String(format: "%.\(places)f", magnitude + 0.5 * pow(10, -Double(places)))
      }
    }
    return (negative ? "-" : "") + rounded
  }
}
