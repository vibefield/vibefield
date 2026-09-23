import CoreImage
import SwiftUI
import UIKit

/// DESIGN.md §2.8's tokens, transcribed from `packages/design-kit/src/tokens.css`
/// (`--vf-sticker-*`, `--vf-coin-*`). The paper stays white in BOTH themes —
/// the white edge is what reads as a sticker — and only the shadows and the
/// pewter darken with the room. Nothing here is a person's colour (I-1).
public enum FaceTokens {
  // MARK: - The sticker

  /// `--vf-sticker-edge` — paper white, both themes.
  public static let stickerEdge = UIColor.white
  /// `--vf-sticker-cut` — the 1 px cut line beyond the paper, black/12, which
  /// is what holds a white edge on white chrome.
  public static let stickerCut = UIColor(white: 0, alpha: 0.12)
  /// `--vf-sticker-shadow` — black/22 in light, /50 in dark.
  public static let stickerShadow = dynamic(light: (0, 0.22), dark: (0, 0.50))

  static var stickerEdgeCI: CIColor { CIColor(color: stickerEdge) }
  static var stickerCutCI: CIColor { CIColor(color: stickerCut) }

  // MARK: - The coin (pewter)

  /// `--vf-coin-rim` — a conic gradient from 210°, six stops, light and dark.
  public static var coinRimStops: [Gradient.Stop] {
    [
      .init(color: dynamic(light: 0xFBFBFD, dark: 0x77777D), location: 0),
      .init(color: dynamic(light: 0xC4C4CA, dark: 0x36363B), location: 0.16),
      .init(color: dynamic(light: 0xF1F1F4, dark: 0x646469), location: 0.33),
      .init(color: dynamic(light: 0xB6B6BD, dark: 0x2A2A2F), location: 0.52),
      .init(color: dynamic(light: 0xF4F4F7, dark: 0x68686E), location: 0.70),
      .init(color: dynamic(light: 0xC0C0C6, dark: 0x34343A), location: 0.86),
      .init(color: dynamic(light: 0xFBFBFD, dark: 0x77777D), location: 1),
    ]
  }
  /// `--vf-coin-field` — radial at 34 % 28 %: white · #ECECF0 at 58 % · #D5D5DB.
  public static var coinFieldStops: [Gradient.Stop] {
    [
      .init(color: dynamic(light: 0xFFFFFF, dark: 0x5B5B61), location: 0),
      .init(color: dynamic(light: 0xECECF0, dark: 0x3A3A3F), location: 0.58),
      .init(color: dynamic(light: 0xD5D5DB, dark: 0x27272B), location: 1),
    ]
  }
  /// `--vf-coin-ink` — beading and the legend, /52.
  public static let coinInk = dynamic(
    light: (0x1C1C1E, 0.52), dark: (0xF5F5F7, 0.52))
  /// `--vf-coin-inset` — the sunk field's inset shadow.
  public static let coinInset = dynamic(light: (0, 0.22), dark: (0, 0.42))
  /// `--vf-coin-shadow` and `--vf-coin-shadow-contact` — what the coin throws.
  public static let coinShadow = dynamic(light: (0, 0.16), dark: (0, 0.50))
  public static let coinShadowContact = dynamic(light: (0, 0.06), dark: (0, 0.30))
  /// `--vf-coin-relief` — the figure's drop, /25 both themes.
  public static let coinRelief = Color(UIColor(white: 0, alpha: 0.25))
  /// `--vf-coin-bevel-light` · `-dark`.
  public static let coinBevelLight = Color(UIColor(white: 1, alpha: 0.50))
  public static let coinBevelDark = Color(UIColor(white: 0, alpha: 0.16))
  /// `--vf-coin-sheen` — the light it catches, white/30.
  public static let coinSheen = Color(UIColor(white: 1, alpha: 0.30))

  // MARK: - Construction

  private static func dynamic(light: UInt32, dark: UInt32) -> Color {
    Color(
      UIColor { traits in
        traits.userInterfaceStyle == .dark ? UIColor(faceRGB: dark, alpha: 1) : UIColor(faceRGB: light, alpha: 1)
      })
  }

  private static func dynamic(light: (UInt32, CGFloat), dark: (UInt32, CGFloat)) -> Color {
    Color(
      UIColor { traits in
        traits.userInterfaceStyle == .dark
          ? UIColor(faceRGB: dark.0, alpha: dark.1) : UIColor(faceRGB: light.0, alpha: light.1)
      })
  }
}

extension UIColor {
  fileprivate convenience init(faceRGB rgb: UInt32, alpha: CGFloat) {
    self.init(
      red: CGFloat((rgb >> 16) & 0xFF) / 255.0,
      green: CGFloat((rgb >> 8) & 0xFF) / 255.0,
      blue: CGFloat(rgb & 0xFF) / 255.0,
      alpha: alpha)
  }
}
