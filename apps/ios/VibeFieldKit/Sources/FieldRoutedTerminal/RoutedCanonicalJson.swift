import FieldProduct
import Foundation

/// RFC 8785 — the JSON Canonicalization Scheme, as the grant MAC input
/// (terminal-pipeline-v3 §5.1: "canonical encoding = RFC 8785 JSON — the
/// contracts corpus is zod/JSON; no second serializer").
///
/// This is the THIRD implementation of one function. `canonicalJson` in
/// `@vibefield/contracts` is the origin; `field-native/src/tp/jcs.rs` is the
/// cell's twin; this is the phone's. All three are pinned by the same vector
/// (`tp-jcs.vector.json`, the RFC's own example) and by the grant-MAC vector's
/// `signingInput` — which is what makes a third implementation honest rather
/// than a fourth chance to be subtly different.
///
/// WHY the phone needs it at all, given that it never MINTS a grant: because it
/// CARRIES one. A grant's MAC covers the protected header and the claims as the
/// cell RECEIVES them, unknown fields included, so a client that re-serializes a
/// grant through a typed struct and drops a field it did not know about breaks a
/// MAC it cannot compute. `RoutedGrant` therefore carries the received JSON
/// verbatim; this file is what lets a test PROVE the two agree, and what a
/// future holder of a key would verify with.
public enum RoutedCanonicalJson {
  public enum Failure: Error, Equatable, CustomStringConvertible {
    /// A number JSON cannot carry. Canonical JSON has no spelling for it.
    case nonFinite

    public var description: String {
      switch self {
      case .nonFinite: "canonical JSON cannot represent a non-finite number"
      }
    }
  }

  /// The canonical UTF-8 text of `value` (RFC 8785 §3).
  public static func text(_ value: JSONValue) throws -> String {
    var out = ""
    try write(value, into: &out)
    return out
  }

  /// The canonical bytes — what a MAC is actually computed over.
  public static func bytes(_ value: JSONValue) throws -> Data {
    Data(try text(value).utf8)
  }

  private static func write(_ value: JSONValue, into out: inout String) throws {
    switch value {
    case .null: out += "null"
    case .bool(let flag): out += flag ? "true" : "false"
    case .int(let number): writeInteger(number, into: &out)
    case .double(let number): out += try esNumberToString(number)
    case .string(let text): writeString(text, into: &out)
    case .array(let items):
      out += "["
      for (index, item) in items.enumerated() {
        if index > 0 { out += "," }
        try write(item, into: &out)
      }
      out += "]"
    case .object(let fields):
      // RFC 8785 §3.2.3: property names sorted by their UTF-16 code units.
      // Swift's own `<` on String is Unicode canonical order, which differs for
      // supplementary-plane names — so the comparison is explicit.
      let keys = fields.keys.sorted { utf16Less($0, $1) }
      out += "{"
      for (index, key) in keys.enumerated() {
        if index > 0 { out += "," }
        writeString(key, into: &out)
        out += ":"
        try write(fields[key] ?? .null, into: &out)
      }
      out += "}"
    }
  }

  /// UTF-16 code-unit lexicographic order — `Array.prototype.sort`'s own.
  static func utf16Less(_ a: String, _ b: String) -> Bool {
    var left = a.utf16.makeIterator()
    var right = b.utf16.makeIterator()
    while true {
      switch (left.next(), right.next()) {
      case (nil, nil): return false
      case (nil, _): return true
      case (_, nil): return false
      case (let x?, let y?):
        if x != y { return x < y }
      }
    }
  }

  /// `JSON.stringify`'s string escaping: `"` `\` and the C0 controls — the short
  /// escapes where ECMAScript has them, `\u00xx` (lowercase hex) otherwise;
  /// everything else literal (non-ASCII included, `/` unescaped, DEL literal).
  private static func writeString(_ text: String, into out: inout String) {
    out += "\""
    for scalar in text.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\u{8}": out += "\\b"
      case "\u{c}": out += "\\f"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      default:
        if scalar.value < 0x20 {
          out += "\\u"
          out += String(format: "%04x", scalar.value)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    out += "\""
  }

  /// 2^53 — beyond it a JavaScript reader has already rounded to a double, so
  /// both sides canonicalize THAT rather than disagreeing about a value neither
  /// should ever carry.
  private static let maxSafeInteger: Int64 = 9_007_199_254_740_992

  private static func writeInteger(_ value: Int64, into out: inout String) {
    if value.magnitude <= UInt64(maxSafeInteger) {
      out += String(value)
    } else {
      out += (try? esNumberToString(Double(value))) ?? "0"
    }
  }

  /// ECMAScript `Number::toString(10)` for a finite double (RFC 8785's own rule
  /// for numbers).
  ///
  /// Swift's `description` already yields the SHORTEST round-trip digits — the
  /// same digits ECMAScript mandates — but it places them by Swift's rules, not
  /// ECMAScript's: `1e-6` prints as `1e-06` where JavaScript writes `0.000001`,
  /// and `5.0` prints with a fraction JavaScript does not write. So the digits
  /// are taken from `description` and the PLACEMENT is done here, per
  /// ECMAScript 7.1.12.1, exactly as `jcs.rs` does with Rust's `{:e}`.
  public static func esNumberToString(_ value: Double) throws -> String {
    guard value.isFinite else { throw Failure.nonFinite }
    if value == 0 { return "0" }  // JSON.stringify(-0) === "0"

    // value = 0.d1d2…dk × 10^n, with `digits` carrying no leading or trailing zero.
    let (digits, n) = decimalDigits(of: abs(value))
    let k = digits.count
    var out = value < 0 ? "-" : ""
    if k <= n && n <= 21 {
      out += digits
      out += String(repeating: "0", count: n - k)
    } else if 0 < n && n <= 21 {
      let split = digits.index(digits.startIndex, offsetBy: n)
      out += digits[..<split]
      out += "."
      out += digits[split...]
    } else if -6 < n && n <= 0 {
      out += "0."
      out += String(repeating: "0", count: -n)
      out += digits
    } else {
      let exponent = n - 1
      let sign = exponent < 0 ? "-" : "+"
      if k == 1 {
        out += "\(digits)e\(sign)\(abs(exponent))"
      } else {
        let split = digits.index(after: digits.startIndex)
        out += "\(digits[..<split]).\(digits[split...])e\(sign)\(abs(exponent))"
      }
    }
    return out
  }

  /// The shortest round-trip digits of a positive finite double, and the `n`
  /// for which `value = 0.<digits> × 10^n`.
  ///
  /// `Double.description` is either `ddd.ddd` or `d.ddde±dd`; both are parsed
  /// the same way, so which one Swift chose never matters.
  private static func decimalDigits(of value: Double) -> (digits: String, n: Int) {
    let text = value.description
    var mantissa = text
    var exponent = 0
    if let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) {
      mantissa = String(text[..<e])
      exponent = Int(text[text.index(after: e)...]) ?? 0
    }
    let parts = mantissa.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
    let whole = String(parts.first ?? "")
    let fraction = parts.count > 1 ? String(parts[1]) : ""
    var all = Array(whole + fraction)

    // n counts the digits before the point, after the exponent is folded in and
    // the leading zeros are dropped ("0.002" is 0.2 × 10^-2).
    var leading = 0
    while leading < all.count && all[leading] == "0" { leading += 1 }
    if leading == all.count { return ("0", 1) }  // unreachable for a non-zero value
    let n = whole.count - leading + exponent
    all.removeFirst(leading)
    while let last = all.last, last == "0" { all.removeLast() }
    return (String(all), n)
  }
}
