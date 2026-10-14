import SwiftUI
import UIKit

/// The godview monochrome language, made adaptive.
///
/// Every value is DESIGN.md §2.7's instrument palette (the reference's
/// `--vf-godview-*` tokens), light and dark, plus §2.5's two state colours.
/// Since the one-ink revision (2026-09-18) no state inverts the theme: every
/// body wears one surface and one ink, and what a body is doing is said by
/// its marks, its inner light and its size. The hues on the field are the
/// project's (record §02, dealt by `FieldAgents`, worn by the folder alone),
/// the branch dot's green, a blocked body's orange and an unread reply's blue
/// — never a colour that means nothing.
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

  // The body's surface — ONE, in both themes (2026-09-18): the instrument's
  // resting body colour (`--idle-bg`), which every agent body now wears. The
  // inverted working and blocked fills the July field read are gone; the
  // swarm's ink is `textMain`, at a weight from `SwarmWeight`'s ladder.
  public static let bodySurface = dynamic(light: 0xE5E5E5, dark: 0x2A2A2A)

  // PJ-7 — the spawn bloom's bud (DESIGN.md §8 "Hold, reach, let go": a clear
  // disc, `--bud-bg` white / #242424, with a 1.25 px ring at 22% ink).
  public static let bloomBud = dynamic(light: 0xFFFFFF, dark: 0x242424)

  // The terminal card surface (the desktop terminal deck's paper)
  public static let terminalBackground = dynamic(light: 0xECE8DC, dark: 0x282C34)
  public static let terminalDivider = dynamic(light: 0xD2CEC3, dark: 0x414650)

  // Atmosphere
  public static let scanline = dynamic(
    light: 0x000000, lightAlpha: 0.08, dark: 0x000000, darkAlpha: 0.30)
  public static let vignette = dynamic(
    light: 0x000000, lightAlpha: 0.15, dark: 0x000000, darkAlpha: 0.75)

  /// The branch-presence dot (`--vf-godview-rain-green`).
  public static let branchGreen = Color(red: 0x4A / 255.0, green: 0xDE / 255.0, blue: 0x80 / 255.0)
  /// §2.5's orange: a body that waits on the user.
  public static let orange = Color(red: 0xFF / 255.0, green: 0x9F / 255.0, blue: 0x0A / 255.0)
  /// §2.5's select blue: a reply that arrived unseen.
  public static let selectBlue = Color(red: 0x4A / 255.0, green: 0x90 / 255.0, blue: 0xD9 / 255.0)

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

/// The swarm's shadows and lights are the renderer's since IOS-6c (RFC 005:
/// the working body's drop shadow is a gaussian occupancy of the disc, black
/// on a light ground and white on a dark one, breathing over three seconds);
/// `SwarmTheme` carries those numbers beside the colours it resolves from here.

extension UIColor {
  fileprivate convenience init(rgb: UInt32, alpha: CGFloat) {
    self.init(
      red: CGFloat((rgb >> 16) & 0xFF) / 255.0,
      green: CGFloat((rgb >> 8) & 0xFF) / 255.0,
      blue: CGFloat(rgb & 0xFF) / 255.0,
      alpha: alpha)
  }
}
