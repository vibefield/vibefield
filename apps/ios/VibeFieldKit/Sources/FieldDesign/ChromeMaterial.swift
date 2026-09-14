import SwiftUI

/// The chrome family's geometry (DESIGN.md §4, as the KeyboardLab canvas
/// instantiates it for a phone-sized card).
///
/// §4 gives the desktop's card radius as 22 and its pills as fully round; the
/// canvas draws this card at 26 because it is a floating control over a
/// keyboard rather than a widget on the field, and its inner keys at 9. Both
/// numbers are the canvas's own (`.card`, `.key`) and both are inside §4's
/// vocabulary rather than beside it.
public enum ChromeRadius {
  /// `.card` — the input card, and any sibling panel that rides above it.
  public static let card: CGFloat = 26
  /// §4: "pills/buttons — fully round". Used as a big number with
  /// `RoundedRectangle`, or as `Capsule()` where the shape is the whole point.
  public static let pill: CGFloat = 999
  /// `.chip` — a 36 pt pill is radius 18, which is the same thing said twice;
  /// it is named because the chips row measures itself by it.
  public static let chip: CGFloat = 18
  /// `.pop` — a long-press fan.
  public static let pop: CGFloat = 14
  /// `.menu` — the `+` menu.
  public static let menu: CGFloat = 18
  /// `.key` — every key on the card's rail.
  public static let key: CGFloat = 9
  /// `.kb.keypad .key` — the keypad's keys, a shade tighter than the rail's.
  public static let keypadKey: CGFloat = 7
  /// A text well on a sheet, and `.srow`'s 14 for a row inside a list.
  public static let well: CGFloat = 12
  public static let row: CGFloat = 14
  /// `.seg` and its thumb.
  public static let segment: CGFloat = 10
  public static let segmentThumb: CGFloat = 8
}

/// The chrome family's elevation (DESIGN.md §5 — ambient, never hard), at the
/// canvas's values. CSS blur is roughly twice SwiftUI's radius, which is how
/// each pair below was converted.
public struct ChromeShadow: Sendable {
  public let color: Color
  public let radius: CGFloat
  public let y: CGFloat

  /// `.glass` — `0 3px 8px rgba(0,0,0,0.08)`. The card resting on the sheet.
  public static let card = ChromeShadow(
    color: Color.black.opacity(0.08), radius: 4, y: 3)
  /// `.key` — `0 1px 0.75px rgba(0,0,0,0.2)`. A key cap's own edge, not a lift.
  public static let key = ChromeShadow(
    color: Color.black.opacity(0.20), radius: 0.4, y: 1)
  /// `.pop` — `0 10px 26px rgba(0,0,0,0.45)`. A fan standing over the card.
  public static let pop = ChromeShadow(
    color: Color.black.opacity(0.45), radius: 13, y: 10)
  /// `.menu` — `0 12px 30px rgba(0,0,0,0.45)` dark; §5's island recipe
  /// (`0 8px 30px rgba(0,0,0,0.08)`) in light, where a 45% shadow would be a
  /// bruise rather than a lift.
  public static let menu = ChromeShadow(
    color: Color(
      UIColor { traits in
        traits.userInterfaceStyle == .dark
          ? UIColor(white: 0, alpha: 0.45) : UIColor(white: 0, alpha: 0.10)
      }),
    radius: 15, y: 11)

  public init(color: Color, radius: CGFloat, y: CGFloat) {
    self.color = color
    self.radius = radius
    self.y = y
  }
}

/// The chrome family's materials, as backgrounds.
///
/// Each recipe is one canvas class, transcribed: `.glass.card` is the card,
/// `.key` is a key cap, `.circle` is a round control, `.menu`/`.pop` are the
/// two floating surfaces. Views ask for one of these rather than restating a
/// fill, a hairline and a shadow each time — the reason DESIGN.md §10 gives for
/// tokens at all.
public enum ChromeMaterial {

  /// `.glass` — the card's material: a translucent gradient over a real blur,
  /// a hairline, a specular top edge and one soft ambient shadow.
  ///
  /// `.ultraThinMaterial` under the gradient is the honest equivalent of the
  /// canvas's `backdrop-filter: blur(20px) saturate(1.3)`: SwiftUI has no
  /// separate saturation control, and the system material is the one blur that
  /// is live rather than a snapshot. The card therefore reads as glass over the
  /// session sheet's own glass, which is exactly what the canvas draws it as.
  public static func glass(
    radius: CGFloat = ChromeRadius.card,
    shadow: ChromeShadow? = ChromeShadow.card
  ) -> some View {
    let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
    return shape
      .fill(.ultraThinMaterial)
      .overlay {
        shape.fill(
          LinearGradient(
            colors: [ChromePalette.glassTop, ChromePalette.glassBottom],
            startPoint: .top, endPoint: .bottom))
      }
      .overlay {
        // The hairline (§2.3) and, inside its top edge, the canvas's
        // `inset 0 0.5px 0 rgba(255,255,255,0.16)` — a specular line that fades
        // out before the card's waist.
        shape.strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5)
      }
      .overlay {
        shape.strokeBorder(
          LinearGradient(
            colors: [ChromePalette.cardHighlight, .clear],
            startPoint: .top, endPoint: .center),
          lineWidth: 0.5)
      }
      .compositingGroup()
      .shadow(
        color: shadow?.color ?? .clear, radius: shadow?.radius ?? 0, x: 0, y: shadow?.y ?? 0)
  }

  /// `.key` — a key cap. `fill` and `hairline` carry the state (`.nav`,
  /// `.armed`, `.locked`, `.on`), which is why they are parameters rather than
  /// a boolean: the canvas has five key states and none of them is "inverted or
  /// not".
  public static func key(
    radius: CGFloat = ChromeRadius.key,
    fill: Color = ChromePalette.keyFill,
    hairline: Color? = ChromePalette.keyHairline,
    hairlineWidth: CGFloat = 0.5,
    shadow: ChromeShadow? = ChromeShadow.key
  ) -> some View {
    let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
    return shape
      .fill(fill)
      .overlay {
        if let hairline {
          shape.strokeBorder(hairline, lineWidth: hairlineWidth)
        }
      }
      .shadow(
        color: shadow?.color ?? .clear, radius: shadow?.radius ?? 0, x: 0, y: shadow?.y ?? 0)
  }

  /// `.circle` — a 28 pt round control in a 44 pt target.
  public static func circle(
    fill: Color = ChromePalette.circleFill,
    hairline: Color? = ChromePalette.circleHairline
  ) -> some View {
    Circle()
      .fill(fill)
      .overlay {
        if let hairline {
          Circle().strokeBorder(hairline, lineWidth: 0.5)
        }
      }
  }

  /// `.menu` / `.pop` — the two floating surfaces, solid over the card.
  public static func floating(
    radius: CGFloat = ChromeRadius.menu,
    shadow: ChromeShadow? = ChromeShadow.menu
  ) -> some View {
    let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
    return shape
      .fill(ChromePalette.menuSurface)
      .overlay { shape.strokeBorder(ChromePalette.menuHairline, lineWidth: 0.5) }
      .shadow(
        color: shadow?.color ?? .clear, radius: shadow?.radius ?? 0, x: 0, y: shadow?.y ?? 0)
  }

  /// A text well on a sheet: the snippet editor's body, a search field,
  /// the paste preview.
  public static func well(radius: CGFloat = ChromeRadius.well) -> some View {
    let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
    return shape
      .fill(ChromePalette.wellFill)
      .overlay { shape.strokeBorder(ChromePalette.wellHairline, lineWidth: 0.5) }
  }
}

extension View {
  /// Put the card's glass behind this view.
  public func chromeGlass(
    radius: CGFloat = ChromeRadius.card,
    shadow: ChromeShadow? = ChromeShadow.card
  ) -> some View {
    background { ChromeMaterial.glass(radius: radius, shadow: shadow) }
  }
}
