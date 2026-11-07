import SwiftUI

/// The two chrome primitives every sheet in this app needs: the eyebrow over a
/// title, and a button that is a pill.
///
/// They live in `FieldDesign` rather than beside one sheet because both the
/// input card's sheets (`FieldInput`) and the settings sheet (`FieldTerminal`)
/// draw them, and a second copy of a pill is how two surfaces drift apart.

/// DESIGN.md §3's eyebrow: 11 medium, uppercase, `tracking-wider`, 60%.
///
/// It is the one place §9's sentence case does not apply — an eyebrow is a
/// section label, and the ramp is what makes it read as one rather than as a
/// shouted sentence.
public struct ChromeEyebrow: View {
  private let text: String

  public init(_ text: String) {
    self.text = text
  }

  public var body: some View {
    Text(text)
      .font(ChromeType.sans(ChromeType.eyebrowSize, .medium))
      .textCase(.uppercase)
      .tracking(ChromeType.tracking(ChromeType.eyebrowTracking, of: ChromeType.eyebrowSize))
      .foregroundStyle(ChromePalette.eyebrow)
  }
}

/// DESIGN.md §4: "pills/buttons — fully round".
///
/// Two weights and no third: the primary is the solid inversion (white on the
/// dark theme, black on the light one), the secondary is the card's own glass.
/// A sheet that needs a third weight needs fewer buttons.
///
/// WI-2 (DESIGN.md §8 "The phone's way in") — `wide`: the way in's acts, 50 pt
/// tall and the full width of their glass, so the primary stands in one place
/// on every step. One size more, never a third weight.
///
/// Item 241 (DESIGN.md §7 "Off") — a pill that is off draws as the quiet one
/// with its words in t4, from the enabled state its view is given; a call
/// site never fades it. A pill whose word says its own press runs
/// ("Starting…") stays enabled with its hits off, so it keeps its look.
public struct ChromePillStyle: ButtonStyle {
  public enum Kind: Sendable {
    case primary
    case secondary
  }

  /// The wide pill's height (WI-2).
  public static let wideHeight: CGFloat = 50

  private let kind: Kind
  private let size: CGFloat
  private let wide: Bool

  public init(_ kind: Kind = .secondary, size: CGFloat? = nil, wide: Bool = false) {
    self.kind = kind
    self.size = size ?? (wide ? 16 : 15)
    self.wide = wide
  }

  public func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(ChromeType.sans(size, .semibold))
      .lineLimit(1)
      .padding(.horizontal, 18)
      .frame(maxWidth: wide ? .infinity : nil)
      .frame(height: wide ? Self.wideHeight : 44)
      .contentShape(Capsule())
      .modifier(
        ChromePillPaint(live: kind == .primary ? .primary : .quiet, off: .quiet, pressed: configuration.isPressed))
  }
}

/// One look of a pill: its fill, its words' ink and its hairline.
public struct ChromePillLook: Sendable {
  public let fill: Color
  public let ink: Color
  public let hairline: Color?
  public let hairlineWidth: CGFloat

  public init(fill: Color, ink: Color, hairline: Color? = nil, hairlineWidth: CGFloat = 0.5) {
    self.fill = fill
    self.ink = ink
    self.hairline = hairline
    self.hairlineWidth = hairlineWidth
  }

  /// The primary: the solid inversion.
  public static let primary = ChromePillLook(fill: ChromePalette.keyOnFill, ink: ChromePalette.keyOnInk)
  /// The quiet pill: the card's own glass and its hairline.
  public static let quiet = ChromePillLook(
    fill: ChromePalette.keyFill, ink: ChromePalette.ink, hairline: ChromePalette.keyHairline)
}

/// DESIGN.md §7 "Off" (item 241, ruled 2026-11-07): the kit's one Off look, for a capsule drawn by hand where the
/// pill's own size does not fit (the Needs card's acts). Live it wears `live`; while its button is off it wears
/// `off`, the quiet look beside it, with its words in t4; pressed, the kit's pressed fill lies over it, as the pill's.
public struct ChromeCapsuleStyle: ButtonStyle {
  private let live: ChromePillLook
  private let off: ChromePillLook

  public init(live: ChromePillLook, off: ChromePillLook) {
    self.live = live
    self.off = off
  }

  public func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .contentShape(Capsule())
      .modifier(ChromePillPaint(live: live, off: off, pressed: configuration.isPressed))
  }
}

/// How every pill in the kit is painted, from whether its button is enabled (DESIGN.md §4, §7 "Off"). A pill that
/// is off gives up its own look for the quiet one, so a primary loses its inversion, and its words wear t4 at full
/// opacity (`ChromePalette.inkT4`, 3.2–3.9:1 on the quiet fill); it is never the live pill faded. A modifier,
/// because a style is no view and only a view reads `isEnabled` (`ChromeSwitch`'s reason).
struct ChromePillPaint: ViewModifier {
  let live: ChromePillLook
  let off: ChromePillLook
  let pressed: Bool
  @Environment(\.isEnabled) private var isEnabled

  func body(content: Content) -> some View {
    let look = isEnabled ? live : off
    content
      .foregroundStyle(isEnabled ? live.ink : ChromePalette.inkT4)
      .background {
        Capsule()
          .fill(look.fill)
          .overlay {
            if let hairline = look.hairline {
              Capsule().strokeBorder(hairline, lineWidth: look.hairlineWidth)
            }
          }
      }
      .overlay {
        Capsule()
          .fill(ChromePalette.keyPressedFill)
          .opacity(pressed ? 1 : 0)
      }
      .animation(FieldMotion.ease(0.08), value: pressed)
  }
}
