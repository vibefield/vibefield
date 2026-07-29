import SwiftUI

/// The dotted-grid ground: 24 pt cells, hairline intersections, faded out
/// radially so the field reads as a lit instrument surface, not graph paper.
/// (Desktop: `.godview-swarm-grid` — mask from 20% solid to 82% transparent.)
public struct GridGroundView: View {
  private let cell: CGFloat = 24

  public init() {}

  public var body: some View {
    GeometryReader { proxy in
      let radius = (proxy.size.width * proxy.size.width + proxy.size.height * proxy.size.height)
        .squareRoot() / 2
      Canvas { context, size in
        var path = Path()
        var x: CGFloat = 0
        while x <= size.width {
          path.move(to: CGPoint(x: x, y: 0))
          path.addLine(to: CGPoint(x: x, y: size.height))
          x += cell
        }
        var y: CGFloat = 0
        while y <= size.height {
          path.move(to: CGPoint(x: 0, y: y))
          path.addLine(to: CGPoint(x: size.width, y: y))
          y += cell
        }
        context.stroke(path, with: .color(FieldPalette.gridLine), lineWidth: 1)
      }
      .mask(
        RadialGradient(
          stops: [
            .init(color: .black, location: 0.20),
            .init(color: .clear, location: 0.82),
          ],
          center: .center,
          startRadius: 0,
          endRadius: radius)
      )
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

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
