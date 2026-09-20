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

/// `toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })`
/// without a formatter: a fixed number of places and a comma every three
/// digits of the integer part.
private func groupedFixed(_ value: Double, digits: Int) -> String {
  let fixed = String(format: "%.\(digits)f", value)
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
