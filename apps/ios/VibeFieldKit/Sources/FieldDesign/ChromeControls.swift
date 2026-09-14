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
public struct ChromePillStyle: ButtonStyle {
  public enum Kind: Sendable {
    case primary
    case secondary
  }

  private let kind: Kind
  private let size: CGFloat

  public init(_ kind: Kind = .secondary, size: CGFloat = 15) {
    self.kind = kind
    self.size = size
  }

  public func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(ChromeType.sans(size, .semibold))
      .foregroundStyle(kind == .primary ? ChromePalette.keyOnInk : ChromePalette.ink)
      .lineLimit(1)
      .padding(.horizontal, 18)
      .frame(height: 44)
      .background {
        if kind == .primary {
          Capsule().fill(ChromePalette.keyOnFill)
        } else {
          Capsule()
            .fill(ChromePalette.keyFill)
            .overlay { Capsule().strokeBorder(ChromePalette.keyHairline, lineWidth: 0.5) }
        }
      }
      .overlay {
        Capsule()
          .fill(ChromePalette.keyPressedFill)
          .opacity(configuration.isPressed ? 1 : 0)
      }
      .animation(FieldMotion.ease(0.08), value: configuration.isPressed)
  }
}
