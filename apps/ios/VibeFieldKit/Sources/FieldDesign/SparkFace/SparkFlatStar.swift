import Foundation

// IOS-12b (PC-D6 A; DESIGN.md §2.10) — THE FLAT STAR: a spark's face as the phone draws it until IOS-12e's Metal star,
// transcribed from design-kit's `packages/design-kit/src/spark-face/flat-star.ts` (the face where the window has no
// WebGL2): the star's own points through a valley on its core, two pill eyes, no glow. Held to
// `spark-flat-star.golden.json` (SparkFlatStarTests). Coordinates are the star's radii, y down, the star's centre at
// the origin; every number is rounded to three places as the desktop's SVG is, so the phone draws the desktop's
// numbers.

/// A spark's flat face: its outline and its two pill eyes.
public struct SparkFlatStar: Equatable, Sendable {
  /// One point's curve: a quadratic from the valley before it to the valley after it, its control set so the curve's
  /// middle is the point's tip.
  public struct Curve: Equatable, Sendable {
    public let controlX, controlY, x, y: Double
  }

  /// One pill eye's box.
  public struct Eye: Equatable, Sendable {
    public let x, y, width, height: Double
  }

  /// Where the outline starts: the last valley.
  public let startX, startY: Double
  public let curves: [Curve]
  /// The two pill eyes at face scale 1; `eyes(_:faceScale:)` draws them at another.
  public let pills: [Eye]

  /// `flatStar(body, eyes, 1)`.
  public init(body: SparkBody, eyes: SparkEyes) {
    let (start, curves) = Self.outline(body)
    startX = start.x
    startY = start.y
    self.curves = curves
    pills = Self.eyes(eyes, faceScale: 1)
  }

  /// `flatStarOutline(body)`: through each valley on the core, out to each tip; empty below two points.
  static func outline(_ body: SparkBody) -> (start: (x: Double, y: Double), curves: [Curve]) {
    let points = body.points
    let count = points.count
    guard count >= 2 else { return ((0, 0), []) }
    let valleyRadius = body.core + body.k / 2
    let valleys: [(x: Double, y: Double)] = points.indices.map { index in
      valley(points[index], points[(index + 1) % count], valleyRadius)
    }
    let start = valleys[count - 1]
    let curves = points.indices.map { index -> Curve in
      let before = valleys[(index + count - 1) % count]
      let after = valleys[index]
      let tip = tipOf(points[index])
      let controlX = 2 * tip.x - (before.x + after.x) / 2
      let controlY = 2 * tip.y - (before.y + after.y) / 2
      return Curve(controlX: rounded(controlX), controlY: rounded(controlY), x: rounded(after.x), y: rounded(after.y))
    }
    return ((rounded(start.x), rounded(start.y)), curves)
  }

  /// `flatStarEyes(eyes, faceScale)`: the two pill eyes, larger at the small sizes as the star's are.
  public static func eyes(_ eyes: SparkEyes, faceScale: Double) -> [Eye] {
    let halfWidth = eyes.w * faceScale
    let halfHeight = eyes.h * faceScale
    let gap = max(eyes.gap * (1 + (faceScale - 1) * 0.6), halfWidth * 2.35)
    return [-1.0, 1.0].map { side in
      Eye(
        x: rounded((side * gap) / 2 - halfWidth), y: rounded(-eyes.y - halfHeight), width: rounded(halfWidth * 2),
        height: rounded(halfHeight * 2))
    }
  }

  /// `sparkFaceScale(size)` (design-kit `engine.ts`): at 32 and below a face's eyes are drawn 1.25× larger, up to 48
  /// 1.12×, so they read.
  public static func faceScale(size: Double) -> Double {
    size <= 32 ? 1.25 : size <= 48 ? 1.12 : 1
  }

  /// The outline as the desktop's SVG path (`M… Q… Z`), for the golden.
  public var svgPath: String {
    guard !curves.isEmpty else { return "" }
    let n = Self.number
    let steps = curves.map { "Q\(n($0.controlX)) \(n($0.controlY)) \(n($0.x)) \(n($0.y))" }.joined()
    return "M\(n(startX)) \(n(startY))\(steps)Z"
  }

  // MARK: - The desktop's arithmetic

  /// Where a point's tip is (the engine's reckoning of a resting point: its length, then its bend), y down.
  private static func tipOf(_ point: SparkPoint) -> (x: Double, y: Double) {
    let length: Double = point.length
    let dx: Double = cos(point.angle)
    let dy: Double = sin(point.angle)
    // flat-star.ts's `dx * length - dy * bend * length * length`, in its order (left to right)
    let leanX: Double = dy * point.bend * length * length
    let leanY: Double = dx * point.bend * length * length
    let x: Double = dx * length - leanX
    let y: Double = dy * length + leanY
    return (x, -y)
  }

  private static func valley(_ from: SparkPoint, _ to: SparkPoint, _ radius: Double) -> (x: Double, y: Double) {
    let ahead = to.angle > from.angle ? to.angle : to.angle + Double.pi * 2
    let angle = (from.angle + ahead) / 2
    return (cos(angle) * radius, -sin(angle) * radius)
  }

  /// `Math.round(value * 1000) / 1000`: three places, a half toward +∞, and never a negative zero.
  static func rounded(_ value: Double) -> Double {
    let scaled = value * 1000
    let floor = scaled.rounded(.down)
    let whole = scaled - floor >= 0.5 ? floor + 1 : floor
    return whole == 0 ? 0 : whole / 1000
  }

  /// A number as JavaScript prints it in the path: a whole number without its ".0", and zero unsigned.
  static func number(_ value: Double) -> String {
    if value == 0 { return "0" }
    if value == value.rounded(), abs(value) < 1e15 { return String(Int64(value)) }
    return "\(value)"
  }
}
