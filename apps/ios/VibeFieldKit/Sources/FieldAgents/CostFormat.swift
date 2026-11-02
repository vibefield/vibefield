import Foundation

/// Keep small positive estimates visibly distinct from a known zero — the
/// reference's `cost-format.ts` (RFC 008): `—` for nothing observed, `<$0.001`
/// under a tenth of a cent, three places under a cent, two otherwise, with
/// `en-US` grouping.
public func formatUsd(_ value: Double?) -> String {
  guard let value else { return "—" }
  if value > 0 && value < 0.001 { return "<$0.001" }
  let digits = value > 0 && value < 0.01 ? 3 : 2
  return "$" + groupedFixed(value, digits: digits)
}

/// `Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })` without a formatter: a fixed
/// number of places and a comma every three digits of the integer part.
///
/// It rounds as ICU does: the number's SHORTEST decimal (the digits JavaScript and Swift both print for it), half away
/// from zero (ICU's default, `halfExpand`). (Corrected 2026-11-02, PG-3e, the review's [0]: this said it was
/// `toLocaleString` while `String(format: "%.Nf")` rounded the exact binary value half to even, so a tie the decimal
/// shows, 1.005 or 0.125, printed a cent lower than the window's.) A sign stays, as ICU's does: -0.001 is `-0.00`.
private func groupedFixed(_ value: Double, digits: Int) -> String {
  let fixed = roundedFixed(value, digits: digits)
  let negative = fixed.hasPrefix("-")
  let unsigned = negative ? String(fixed.dropFirst()) : fixed
  let parts = unsigned.split(separator: ".", maxSplits: 1).map(String.init)
  let whole = parts[0]
  var grouped = ""
  for (index, character) in whole.reversed().enumerated() {
    if index > 0 && index % 3 == 0 { grouped.append(",") }
    grouped.append(character)
  }
  let integer = String(grouped.reversed())
  let fraction = parts.count > 1 ? "." + parts[1] : ""
  return (negative ? "-" : "") + integer + fraction
}

/// `value` at `digits` places, its shortest decimal rounded half away from zero, with the sign it had. A value with no
/// decimal (infinite, NaN) keeps `String(format:)`'s words; past `Decimal`'s 38 significant digits (1e38 dollars
/// and up) the trailing digits are `Decimal`'s, not ICU's: absurd values, said, as the body's 1e21% is.
private func roundedFixed(_ value: Double, digits: Int) -> String {
  guard value.isFinite, var decimal = Decimal(string: "\(value.magnitude)", locale: Locale(identifier: "en_US_POSIX"))
  else { return String(format: "%.\(digits)f", value) }
  var rounded = Decimal()
  NSDecimalRound(&rounded, &decimal, digits, .plain)
  let text = NSDecimalNumber(decimal: rounded).description(withLocale: Locale(identifier: "en_US_POSIX"))
  let parts = text.split(separator: ".", maxSplits: 1).map(String.init)
  let fraction = (parts.count > 1 ? parts[1] : "").padding(toLength: digits, withPad: "0", startingAt: 0)
  let unsigned = digits > 0 ? parts[0] + "." + fraction : parts[0]
  return (value.sign == .minus ? "-" : "") + unsigned
}
