import SwiftUI
import UIKit

/// The godview monochrome language, made adaptive.
///
/// Every value is lifted from the desktop godview stylesheet
/// (`apps/godview/src/renderer/styles.css`), light and dark. The system is
/// strict black-and-white: status is contrast (idle grey · working inverted ·
/// waiting full-contrast), and the only hues on screen are each agent's
/// identity color used as a whisper, plus one green for branch presence.
public enum FieldPalette {
  // Ground & chrome
  public static let monitorBackground = dynamic(light: 0xF7F7F7, dark: 0x0A0A0A)
  public static let panelBackground = dynamic(light: 0xFFFFFF, dark: 0x111111)
  public static let panelBorder = dynamic(light: 0xE0E0E0, dark: 0x333333)
  public static let textMain = dynamic(light: 0x111111, dark: 0xFFFFFF)
  public static let textMuted = dynamic(light: 0x888888, dark: 0x777777)
  public static let textFaint = dynamic(light: 0xB8B8B8, dark: 0x555555)
  public static let gridLine = dynamic(
    light: 0x000000, lightAlpha: 0.022, dark: 0xFFFFFF, darkAlpha: 0.035)

  // Bubble tiers — status as contrast, never hue
  public static let idleBackground = dynamic(light: 0xE5E5E5, dark: 0x2A2A2A)
  public static let idleText = dynamic(light: 0x666666, dark: 0xAAAAAA)
  public static let workingBackground = dynamic(light: 0x222222, dark: 0xEEEEEE)
  public static let workingText = dynamic(light: 0xFFFFFF, dark: 0x111111)
  public static let workingBorder = dynamic(light: 0x111111, dark: 0xFFFFFF)
  public static let waitingBackground = dynamic(light: 0x000000, dark: 0xFFFFFF)
  public static let waitingText = dynamic(light: 0xFFFFFF, dark: 0x000000)
  public static let waitingBorder = dynamic(light: 0x000000, dark: 0xFFFFFF)

  // The terminal card surface (the desktop terminal deck's paper)
  public static let terminalBackground = dynamic(light: 0xECE8DC, dark: 0x282C34)
  public static let terminalDivider = dynamic(light: 0xD2CEC3, dark: 0x414650)

  // Atmosphere
  public static let scanline = dynamic(
    light: 0x000000, lightAlpha: 0.08, dark: 0x000000, darkAlpha: 0.30)
  public static let vignette = dynamic(
    light: 0x000000, lightAlpha: 0.15, dark: 0x000000, darkAlpha: 0.75)

  /// The one non-identity hue in the system: the branch-presence dot.
  public static let branchGreen = Color(red: 0x4A / 255.0, green: 0xDE / 255.0, blue: 0x80 / 255.0)

  /// An agent's identity color: the desktop's `hsl(hue 62% 44%)` converted to
  /// HSB exactly (L 0.44, S 0.62 → V ≈ 0.713, S ≈ 0.765).
  public static func agentColor(hue: Int) -> Color {
    let lightness = 0.44
    let saturationHSL = 0.62
    let value = lightness + saturationHSL * min(lightness, 1 - lightness)
    let saturationHSB = value == 0 ? 0 : 2 * (1 - lightness / value)
    return Color(
      hue: Double(hue) / 360.0, saturation: saturationHSB, brightness: value)
  }

  private static func dynamic(
    light: UInt32, lightAlpha: CGFloat = 1, dark: UInt32, darkAlpha: CGFloat = 1
  ) -> Color {
    Color(
      UIColor { traits in
        traits.userInterfaceStyle == .dark
          ? UIColor(rgb: dark, alpha: darkAlpha) : UIColor(rgb: light, alpha: lightAlpha)
      })
  }
}

/// A shadow recipe (CSS `drop-shadow(x y blur color)` translated; SwiftUI's
/// radius is close to half a CSS blur). Working and waiting bubbles pulse
/// between rest and peak — in dark mode the "shadow" is a white glow, exactly
/// like the desktop.
public struct FieldShadow: Sendable {
  public let color: Color
  public let radius: CGFloat
  public let y: CGFloat

  public init(color: Color, radius: CGFloat, y: CGFloat) {
    self.color = color
    self.radius = radius
    self.y = y
  }

  public static let workingRest = FieldShadow(
    color: FieldPalette.dynamicShadow(lightAlpha: 0.18, darkAlpha: 0.12), radius: 5, y: 8)
  public static let workingPeak = FieldShadow(
    color: FieldPalette.dynamicShadow(lightAlpha: 0.34, darkAlpha: 0.30), radius: 9, y: 12)
  public static let waitingRest = FieldShadow(
    color: FieldPalette.dynamicShadow(lightAlpha: 0.24, darkAlpha: 0.16), radius: 7, y: 9)
  public static let waitingPeak = FieldShadow(
    color: FieldPalette.dynamicShadow(lightAlpha: 0.40, darkAlpha: 0.25), radius: 12, y: 17)
}

extension FieldPalette {
  /// Light mode throws black shadows; dark mode throws white glows.
  static func dynamicShadow(lightAlpha: CGFloat, darkAlpha: CGFloat) -> Color {
    Color(
      UIColor { traits in
        traits.userInterfaceStyle == .dark
          ? UIColor(rgb: 0xFFFFFF, alpha: darkAlpha) : UIColor(rgb: 0x000000, alpha: lightAlpha)
      })
  }
}

extension UIColor {
  fileprivate convenience init(rgb: UInt32, alpha: CGFloat) {
    self.init(
      red: CGFloat((rgb >> 16) & 0xFF) / 255.0,
      green: CGFloat((rgb >> 8) & 0xFF) / 255.0,
      blue: CGFloat(rgb & 0xFF) / 255.0,
      alpha: alpha)
  }
}
