import Foundation

/// A straight-alpha sRGB colour as four unit floats — the reference's `Rgba`
/// (`gpu/color.ts`), the one shape every colour in the body model wears so the
/// renderer packs it without asking what it came from.
///
/// It lives in FieldAgents rather than FieldDesign because the MODEL carries
/// colours (the project's, the pane's) and FieldAgents imports no UI framework:
/// a SwiftUI `Color` cannot be read back into numbers without a trait
/// collection, and the model must be testable headless.
public struct SwarmColor: Equatable, Hashable, Sendable {
  public var r: Double
  public var g: Double
  public var b: Double
  public var a: Double

  public init(r: Double, g: Double, b: Double, a: Double = 1) {
    self.r = r
    self.g = g
    self.b = b
    self.a = a
  }

  public static let transparent = SwarmColor(r: 0, g: 0, b: 0, a: 0)
  public static let black = SwarmColor(r: 0, g: 0, b: 0)
  public static let white = SwarmColor(r: 1, g: 1, b: 1)

  /// `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` — the forms the tokens use
  /// (`parseCssColor`'s hex branch). Anything else is nil, never a guess.
  public init?(hex: String) {
    var text = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.hasPrefix("#") else { return nil }
    text.removeFirst()
    let raw = text.lowercased()
    guard raw.allSatisfy({ $0.isHexDigit }) else { return nil }
    let digits: String
    switch raw.count {
    case 3, 4: digits = raw.map { "\($0)\($0)" }.joined()
    case 6, 8: digits = raw
    default: return nil
    }
    guard let number = UInt32(digits, radix: 16) else { return nil }
    if digits.count == 6 {
      self.init(
        r: Double((number >> 16) & 255) / 255,
        g: Double((number >> 8) & 255) / 255,
        b: Double(number & 255) / 255,
        a: 1)
    } else {
      self.init(
        r: Double((number >> 24) & 255) / 255,
        g: Double((number >> 16) & 255) / 255,
        b: Double((number >> 8) & 255) / 255,
        a: Double(number & 255) / 255)
    }
  }

  /// `#rrggbb`, the alpha dropped — the form the tint deals and the tests pin.
  public var hex: String {
    func channel(_ value: Double) -> String {
      let clamped = Int((max(0, min(1, value)) * 255).rounded())
      return String(format: "%02x", clamped)
    }
    return "#\(channel(r))\(channel(g))\(channel(b))"
  }

  public func withAlpha(_ value: Double) -> SwarmColor {
    SwarmColor(r: r, g: g, b: b, a: a * value)
  }

  /// Relative luminance, enough to tell a light ground from a dark one.
  public var luminance: Double {
    0.2126 * r + 0.7152 * g + 0.0722 * b
  }
}
