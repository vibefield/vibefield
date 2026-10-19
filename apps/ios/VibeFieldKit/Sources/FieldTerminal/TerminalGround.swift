import Foundation
import GhostteaCore
import SwiftUI

/// The terminal's own ground: its theme's background at its opacity.
///
/// Since 2026-10-19 the phone's live card is drawn on it from the sheet's top
/// to its foot (DESIGN.md §8, "The phone's live card is its terminal"): under
/// the band, behind the home indicator and the open input card, and as the
/// clearings the closed row's controls float on. The card asks for it here, so
/// it never has to learn a Ghostty type.
public struct TerminalGround: Equatable, Sendable {
  /// sRGB components, 0…1.
  public let red: Double
  public let green: Double
  public let blue: Double
  /// The appearance's background opacity, as the renderer was handed it.
  public let opacity: Double

  public init(_ config: GhostteaTerminalPresentationConfig) {
    let rgb = config.background.count == 3 ? config.background : [0x12, 0x12, 0x12]
    red = Double(rgb[0]) / 255
    green = Double(rgb[1]) / 255
    blue = Double(rgb[2]) / 255
    opacity = config.backgroundOpacity.isFinite ? min(max(Double(config.backgroundOpacity), 0), 1) : 1
  }

  /// The ground as the card paints it, opacity included.
  public var color: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: opacity) }

  /// The ground at full strength, its opacity left out: the ink of what stands
  /// on text main over it (the live card's badge), which a translucent ground
  /// would wash out.
  public var solidColor: Color { Color(.sRGB, red: red, green: green, blue: blue) }

  /// WCAG relative luminance of the colour itself. Opacity is not part of it:
  /// a translucent ground is still the colour that decides how text reads.
  public var luminance: Double {
    func linear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  }

  /// Which of §2.4's ramps the chrome standing on this ground wears: the dark
  /// one (white text) when white reads at least as well as the light ramp's
  /// ink (`#111111`) does, by the WCAG contrast ratio. It follows the ground,
  /// not the app's theme, so Matte Black takes white text by day too.
  public var inkScheme: ColorScheme {
    let darkInk = 0.005605  // #111111, the light ramp's text main
    let againstWhite = 1.05 / (luminance + 0.05)
    let againstDarkInk = (luminance + 0.05) / (darkInk + 0.05)
    return againstWhite >= againstDarkInk ? .dark : .light
  }
}
