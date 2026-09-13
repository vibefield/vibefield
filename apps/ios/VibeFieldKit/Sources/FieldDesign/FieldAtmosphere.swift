import SwiftUI

// The 24 pt grid under its radial mask is drawn by the swarm's field pass
// since IOS-6c (`field.metal`), as the reference draws it; the two overlays
// below stay the phone's atmosphere above the surface.

/// CRT scanlines — the godview signature texture. Kept subtle; disabled
/// automatically when Reduce Transparency is on.
public struct ScanlinesOverlay: View {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  private let density: CGFloat
  private let opacity: Double

  public init(density: CGFloat = 2, opacity: Double = 0.4) {
    self.density = density
    self.opacity = opacity
  }

  public var body: some View {
    if !reduceTransparency {
      Canvas { context, size in
        var path = Path()
        var y = density / 2
        while y <= size.height {
          path.move(to: CGPoint(x: 0, y: y))
          path.addLine(to: CGPoint(x: size.width, y: y))
          y += density
        }
        context.stroke(path, with: .color(FieldPalette.scanline), lineWidth: density / 2)
      }
      .opacity(opacity)
      .allowsHitTesting(false)
      .accessibilityHidden(true)
    }
  }
}

/// The vignette: clear center, darkened corners (desktop: 52% → 100%).
public struct VignetteOverlay: View {
  private let opacity: Double

  public init(opacity: Double = 1) {
    self.opacity = opacity
  }

  public var body: some View {
    GeometryReader { proxy in
      let radius = max(proxy.size.width, proxy.size.height) * 0.72
      RadialGradient(
        stops: [
          .init(color: .clear, location: 0.52),
          .init(color: FieldPalette.vignette, location: 1.0),
        ],
        center: .center,
        startRadius: 0,
        endRadius: radius
      )
      .opacity(opacity)
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}
