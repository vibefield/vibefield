import SwiftUI

// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — A SPARK'S FACE ON THE PHONE: the kit's `SparkFace`
// (seed, status, size, framed or free, live). It is drawn one of three ways:
// - live, on the stage it sits in: it reports its box and its scroll view's visible rect, and the stage draws it;
// - a still: drawn once by `SparkStar.metal`, kept, and shown as a picture;
// - the flat star (`SparkFlatFace`), where Metal cannot build the star: never a blank.
// A framed face's cut ring takes the ground behind it (`sparkGround`, the paper by default), read again when the theme
// turns. The face is an index and the word certifies (S-3), so it is hidden from VoiceOver: the row says the status.

public struct SparkFaceView: View {
  let seed: UInt32
  let status: String
  let size: CGFloat
  let framed: Bool
  let live: Bool

  @Environment(\.sparkStage) private var stage
  @Environment(\.sparkGround) private var groundColour
  @Environment(\.displayScale) private var scale
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.self) private var environment
  @State private var id = UUID().uuidString
  @State private var placement: Placement?

  /// Where a live face is, in the window's space: its box, and the visible rect of the scroll view it sits in (no
  /// bound where there is none: the layer's own edges cut it).
  struct Placement: Equatable, Sendable {
    let frame: CGRect
    let clip: CGRect
  }

  public init(seed: UInt32, status: String, size: CGFloat, framed: Bool = true, live: Bool = false) {
    self.seed = seed
    self.status = status
    self.size = size
    self.framed = framed
    self.live = live
  }

  public var body: some View {
    Group {
      if SparkStarGate.app.drawing == .flat {
        SparkFlatFace(seed: seed, size: size, framed: framed)
      } else if live, let stage {
        Color.clear
          .frame(width: size, height: size)
          .onGeometryChange(for: Placement.self) { proxy in
            Self.placement(of: proxy)
          } action: { placement in
            self.placement = placement
            stage.show(face(at: placement))
          }
          .onChange(of: status) {
            if let placement { stage.show(face(at: placement)) }
          }
          .onChange(of: ground) {
            if let placement { stage.show(face(at: placement)) }
          }
          .onDisappear { stage.hide(id) }
      } else if let picture = SparkStillCache.shared.picture(
        seed: seed, status: status, size: Double(size), framed: framed, cut: ground, scale: Double(scale),
        reducedMotion: reduceMotion)
      {
        let box = SparkStills.box(size: Double(size), framed: framed)
        Image(decorative: picture, scale: scale)
          .resizable()
          .frame(width: box, height: box)
          .frame(width: size, height: size)
      } else {
        SparkFlatFace(seed: seed, size: size, framed: framed)
      }
    }
    .accessibilityHidden(true)
  }

  /// The ground behind the face as the shader takes it: sRGB channels, 0–1.
  private var ground: SIMD3<Double> {
    let resolved = groundColour.resolve(in: environment)
    return SIMD3(Double(resolved.red), Double(resolved.green), Double(resolved.blue))
  }

  private func face(at placement: Placement) -> SparkStageFace {
    SparkStageFace(
      id: id, seed: seed, status: status, size: Double(size), framed: framed, cut: ground, frame: placement.frame,
      clip: placement.clip)
  }

  /// The face's box in the window's space (`.global`, where the stage's layer measures its own corner), and its port:
  /// the nearest scroll view's visible rect, else none.
  private nonisolated static func placement(of proxy: GeometryProxy) -> Placement {
    let frame = proxy.frame(in: .global)
    let port = proxy.bounds(of: .scrollView) ?? .infinite
    // the bounds are in the face's own space, whose origin is its box's corner
    let clip = port.isInfinite ? port : port.offsetBy(dx: frame.minX, dy: frame.minY)
    return Placement(frame: frame, clip: clip)
  }
}
