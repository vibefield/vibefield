import SwiftUI

/// The system's Liquid Glass, where the phone has it (IOS-9a, 2026-09-23).
///
/// DESIGN.md §5 says chrome is glass, and since iOS 26 the system draws that
/// glass itself — the tab bar, the search circle, a sheet — so a round control
/// of ours beside the system's must be the SAME material or it reads as a
/// photograph of one. These helpers put `glassEffect` under a control on iOS 26
/// and the chrome family's own recipe (`ChromeMaterial.glass`: ultra-thin
/// material, gradient, hairline, one soft shadow) beneath it, so a view asks
/// for "a glass circle" once and gets the honest material for the OS it is on.
///
/// The open Me menu is NOT glass on either OS (§8, James: "do not make it
/// transparent"); only the closed circle, the pill and the accessory are.
extension View {
  /// A round glass control: the account corner's face, the search circle.
  /// Interactive on iOS 26, so a touch presses the glass the way the system's
  /// own circles press.
  @ViewBuilder
  public func liquidGlassCircle(shadow: ChromeShadow? = ChromeShadow.card) -> some View {
    if #available(iOS 26.0, *) {
      glassEffect(.regular.interactive(), in: .circle)
    } else {
      background { ChromeMaterial.circleGlass(shadow: shadow) }
    }
  }

  /// A glass capsule: the tab capsule, the stepper, the search field.
  /// `interactive: false` for a surface that holds a text field, whose own
  /// caret is the touch feedback.
  @ViewBuilder
  public func liquidGlassCapsule(shadow: ChromeShadow? = ChromeShadow.card, interactive: Bool = true) -> some View {
    if #available(iOS 26.0, *) {
      glassEffect(.regular.interactive(interactive), in: .capsule)
    } else {
      background { ChromeMaterial.glass(radius: ChromeRadius.pill, shadow: shadow) }
    }
  }

  /// A glass panel with continuous corners (a card riding above a sheet).
  @ViewBuilder
  public func liquidGlassPanel(radius: CGFloat, shadow: ChromeShadow? = ChromeShadow.card) -> some View {
    if #available(iOS 26.0, *) {
      glassEffect(.regular, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
    } else {
      background { ChromeMaterial.glass(radius: radius, shadow: shadow) }
    }
  }

  /// Names a glass shape inside a `GlassGroup`, so a shape that leaves and
  /// one that arrives under the same id MORPH into each other (the search
  /// circle into the search field; the tab capsule into its folded circle).
  /// Below iOS 26 there is nothing to morph and it does nothing.
  @ViewBuilder
  public func glassID<ID: Hashable & Sendable>(_ id: ID, in namespace: Namespace.ID) -> some View {
    if #available(iOS 26.0, *) {
      glassEffectID(id, in: namespace)
    } else {
      self
    }
  }
}

/// The glass shapes that stand together — the bar's capsule and circles —
/// rendered as one group (`GlassEffectContainer` on iOS 26): one sampling pass
/// for all of them, and the morphs between `glassID`s. `spacing` is where two
/// shapes begin to melt into one; keep it under the gap between them at rest.
/// Below iOS 26 the content as it is.
public struct GlassGroup<Content: View>: View {
  private let spacing: CGFloat?
  private let content: Content

  public init(spacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {
    self.spacing = spacing
    self.content = content()
  }

  public var body: some View {
    if #available(iOS 26.0, *) {
      GlassEffectContainer(spacing: spacing) { content }
    } else {
      content
    }
  }
}

extension ChromeMaterial {
  /// `.glass` cut as a circle — the recipe `glass(radius:)` draws, on a
  /// `Circle` rather than a rounded rectangle, so the pre-26 corner is a true
  /// circle and not a square with very round corners.
  public static func circleGlass(shadow: ChromeShadow? = ChromeShadow.card) -> some View {
    Circle()
      .fill(.ultraThinMaterial)
      .overlay {
        Circle().fill(
          LinearGradient(
            colors: [ChromePalette.glassTop, ChromePalette.glassBottom],
            startPoint: .top, endPoint: .bottom))
      }
      .overlay { Circle().strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5) }
      .overlay {
        Circle().strokeBorder(
          LinearGradient(
            colors: [ChromePalette.cardHighlight, .clear],
            startPoint: .top, endPoint: .center),
          lineWidth: 0.5)
      }
      .compositingGroup()
      .shadow(
        color: shadow?.color ?? .clear, radius: shadow?.radius ?? 0, x: 0, y: shadow?.y ?? 0)
  }
}
