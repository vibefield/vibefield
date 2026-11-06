import CoreGraphics
import Foundation

// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — A STILL: a face that is not moving, drawn once offscreen by
// `SparkStar.metal` and kept as a picture, as the kit's `stills.ts` keeps one. It is the face built and placed at the
// centre of its box and written once, never stepped (`render(0, { frozen: true })`), so its pose is its status's at
// rest and its phases are its seed's.

public enum SparkStills {
  /// A free face's picture is half again its box, so its props (thought dots, Zzz, hearts) are whole (`stills.ts`'s
  /// FREE_FACE_ROOM).
  public static let freeFaceRoom = 1.5

  /// The box a face's picture fills: its size framed, half again free.
  public static func box(size: Double, framed: Bool) -> Double { framed ? size : size * freeFaceRoom }

  /// A still's rows: the face built, placed at the centre of its box, written once.
  public static func rows(
    seed: UInt32, status: String, size: Double, framed: Bool, cut: SIMD3<Double>?, reducedMotion: Bool = false
  ) -> [Float] {
    var buddy = SparkBuddy(seed: seed, status: status, framed: framed, cut: cut, random: Mulberry32(seed: seed))
    let box = Self.box(size: size, framed: framed)
    buddy.place(centreX: box / 2, centreY: box / 2, size: size, framed: framed)
    var rows = [Float](repeating: 0, count: SparkBuddy.floats)
    buddy.write(into: &rows, at: 0, reducedMotion: reducedMotion)
    return rows
  }

  /// One face's rows drawn by `SparkStar.metal` offscreen on the system's GPU: `round(box × scale)` pixels square.
  public static func picture(rows: [Float], box: Double, scale: Double) throws -> CGImage {
    try SparkStarRenderer.system.get().picture(rows: rows, box: box, scale: scale)
  }
}

/// The stills the app has drawn, the last 256, kept by everything that changes one: its seed, status, size, frame,
/// ground (which carries the theme), scale and motion.
@MainActor
public final class SparkStillCache {
  public static let shared = SparkStillCache()

  struct Key: Hashable {
    let seed: UInt32
    let status: String
    let size: Double
    let framed: Bool
    let ground: SIMD3<Int>
    let scale: Double
    let reducedMotion: Bool
  }

  static let keep = 256
  private var pictures: [Key: CGImage] = [:]
  private var order: [Key] = []

  /// The face's picture, drawn once; nil where Metal cannot draw it (the face is then the flat star).
  public func picture(
    seed: UInt32, status: String, size: Double, framed: Bool, cut: SIMD3<Double>, scale: Double, reducedMotion: Bool
  ) -> CGImage? {
    let ground = SIMD3<Int>(Int((cut.x * 255).rounded()), Int((cut.y * 255).rounded()), Int((cut.z * 255).rounded()))
    let key = Key(
      seed: seed, status: status, size: size, framed: framed, ground: ground, scale: scale, reducedMotion: reducedMotion)
    if let kept = pictures[key] {
      order.removeAll { $0 == key }
      order.append(key)
      return kept
    }
    let rows = SparkStills.rows(
      seed: seed, status: status, size: size, framed: framed, cut: cut, reducedMotion: reducedMotion)
    guard
      let picture = try? SparkStills.picture(
        rows: rows, box: SparkStills.box(size: size, framed: framed), scale: scale)
    else { return nil }
    pictures[key] = picture
    order.append(key)
    if order.count > Self.keep { pictures[order.removeFirst()] = nil }
    return picture
  }
}
