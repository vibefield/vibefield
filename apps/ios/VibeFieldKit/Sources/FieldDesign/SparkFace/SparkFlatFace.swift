import SwiftUI

/// IOS-12b (PC-D6 A; DESIGN.md §2.10) — a spark's face as the phone draws it until IOS-12e's Metal star: design-kit's
/// `FlatStarView` (`packages/design-kit/src/spark-face/SparkFace.tsx`), the face where a window has no WebGL2. Its
/// own points in its palette, on its disc when framed, two pill eyes, no glow — drawn from the same DNA as the star
/// (`SparkEngine`, held to the DNA golden), its outline and eyes from `SparkFlatStar` (held to the flat-star golden).
///
/// The SVG's own recipe, in a Canvas:
///   · the box is the disc's: a radius of 1.26 (`SPARK_FRAME.frameH`) about the disc's centre, the star 0.06 below it
///     (`frameC`); free, the box is centred on the star;
///   · the disc: a linear gradient top to bottom, the palette's two deep colours;
///   · the star: a radial gradient over its own bounding box (SVG's `objectBoundingBox`, so an ellipse on a star that
///     is not round), the palette's second, third and fourth colours at 0, 0.55 and 1;
///   · the eyes: rounded rects whose `rx` is half their width, in the fourth colour, at the face scale of the size.
public struct SparkFlatFace: View {
  let seed: UInt32
  let size: CGFloat
  let framed: Bool

  public init(seed: UInt32, size: CGFloat, framed: Bool = true) {
    self.seed = seed
    self.size = size
    self.framed = framed
  }

  public var body: some View {
    Canvas { context, canvas in
      Self.draw(seed: seed, size: Double(size), framed: framed, in: &context, side: canvas.width)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  /// `SPARK_FRAME`: the disc's radius, and how far the star sits below its centre.
  static let frameRadius = 1.26
  static let frameDrop = 0.06

  /// The SVG's viewBox in the star's radii, y down: the disc's box when framed, else the star's.
  public static func viewBox(framed: Bool) -> CGRect {
    let top = framed ? -frameRadius - frameDrop : -frameRadius
    return CGRect(x: -frameRadius, y: top, width: frameRadius * 2, height: frameRadius * 2)
  }

  /// The palette a seed's face is drawn in.
  public static func palette(of seed: UInt32) -> SparkPalette {
    let palettes = SparkEngine.palettes
    return palettes[SparkEngine.agentDNA(seed).palette % palettes.count]
  }

  static func draw(seed: UInt32, size: Double, framed: Bool, in context: inout GraphicsContext, side: CGFloat) {
    let dna = SparkEngine.agentDNA(seed)
    let palette = Self.palette(of: seed)
    guard palette.c.count >= 4, palette.deep.count >= 2 else { return }
    let star = SparkFlatStar(body: SparkEngine.makeBody(seed, dna.body), eyes: SparkEngine.makeEyes(seed, dna.eyes))
    let eyes = SparkFlatStar.eyes(
      SparkEngine.makeEyes(seed, dna.eyes), faceScale: SparkFlatStar.faceScale(size: size))
    let box = viewBox(framed: framed)
    var face = context
    face.scaleBy(x: side / box.width, y: side / box.height)
    face.translateBy(x: -box.minX, y: -box.minY)

    if framed {
      let disc = CGRect(
        x: -frameRadius, y: -frameDrop - frameRadius, width: frameRadius * 2, height: frameRadius * 2)
      face.fill(
        Path(ellipseIn: disc),
        with: .linearGradient(
          Gradient(colors: [color(palette.deep[0]), color(palette.deep[1])]),
          startPoint: CGPoint(x: 0, y: disc.minY), endPoint: CGPoint(x: 0, y: disc.maxY)))
    }

    let outline = Self.path(star)
    if !outline.isEmpty {
      let bounds = outline.boundingRect
      var body = face
      body.clip(to: outline)
      // objectBoundingBox: the gradient's unit circle is the box's inscribed ellipse
      body.translateBy(x: bounds.midX, y: bounds.midY)
      body.scaleBy(x: max(bounds.width, 1e-6), y: max(bounds.height, 1e-6))
      body.fill(
        Path(CGRect(x: -1, y: -1, width: 2, height: 2)),
        with: .radialGradient(
          Gradient(stops: [
            .init(color: color(palette.c[1]), location: 0),
            .init(color: color(palette.c[2]), location: 0.55),
            .init(color: color(palette.c[3]), location: 1),
          ]),
          center: .zero, startRadius: 0, endRadius: 0.5))
    }

    for eye in eyes {
      let rect = CGRect(x: eye.x, y: eye.y, width: eye.width, height: eye.height)
      // SVG's `rx` alone: `ry` takes it, and each is held to half its side
      let corner = CGSize(width: eye.width / 2, height: min(eye.width / 2, eye.height / 2))
      face.fill(Path(roundedRect: rect, cornerSize: corner), with: .color(color(palette.c[3])))
    }
  }

  /// The outline as a path: from the last valley, one quadratic per point.
  static func path(_ star: SparkFlatStar) -> Path {
    var path = Path()
    guard !star.curves.isEmpty else { return path }
    path.move(to: CGPoint(x: star.startX, y: star.startY))
    for curve in star.curves {
      path.addQuadCurve(
        to: CGPoint(x: curve.x, y: curve.y), control: CGPoint(x: curve.controlX, y: curve.controlY))
    }
    path.closeSubpath()
    return path
  }

  /// `#rrggbb`, as the engine writes its palettes, in sRGB; black for anything else.
  static func color(_ hex: String) -> Color {
    let digits = hex.hasPrefix("#") ? hex.dropFirst() : Substring(hex)
    guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return .black }
    return Color(
      .sRGB, red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255)
  }
}
