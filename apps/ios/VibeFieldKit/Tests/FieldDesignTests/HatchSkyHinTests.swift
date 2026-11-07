import Foundation
import Metal
import Testing

@testable import FieldDesign

/// IOS-12f's f5h (VF-PM's ruling 17:38:20Z) — THE HATCH'S HASH INPUT ON THIS GPU, BIT FOR BIT. Two sites in
/// HatchSky.metal hash a sum of two products, `seed * k1 + fj * k2`: the burst's rays (star-spark.js :200) and the
/// particles (:378). The engine's frames were drawn by ANGLE's Metal on the goldens' host (an M4), and its compiler
/// computes that sum as fma(fj, k2, seed * k1): the first product rounded to its own float, the second fused with the
/// sum. This is kit-f5f4's read: b's dust j30 and j31, and 13 of 13 placements still off at G4.
///
/// `hin` is how the shader says the sum. Its probe kernel (`hatch_sky_hin_probe`, which nothing draws) runs it here on
/// the kit's own GPU and compiler, and Swift's `addingProduct` (IEEE fusedMultiplyAdd) says the engine's form. Every
/// hash input either deal draws is asked: the rays' 26 × 5 and the particles' 56 × 6, at the deal's own seed as the
/// engine's rows hold it. The 13 placements' hashes are among them.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("A hatch hash's input is the engine's own, fma(fj, k2, seed · k1), bit for bit on this GPU")
struct HatchSkyHinTests {
  enum Site: String, CaseIterable, CustomStringConvertible {
    /// BODY_FS :200, the burst's 18 rays and 8 needles.
    case rays
    /// PART_VS :378, each star's 22 debris, 8 glitter and 26 dust.
    case particles
    var description: String { rawValue }

    var count: Int { self == .rays ? 26 : 56 }
    /// Each hash's (k1, k2), in the shader's order (hA…hE; h1…h6).
    var products: [(Float, Float)] {
      switch self {
      case .rays: [(13.7, 1.37), (7.13, 3.11), (3.37, 5.71), (9.91, 7.3), (1.93, 2.9)]
      case .particles: [(3.1, 1.71), (5.7, 2.33), (1.3, 3.97), (8.9, 5.03), (2.2, 6.11), (6.6, 7.77)]
      }
    }
  }

  /// The deal's star seed as the engine's rows hold it (row 3, a float).
  static func seed(of deal: String) throws -> Float {
    let golden = try SparkHatchGoldenTests.golden()
    let want = try golden.deal(deal)
    return Float(want.rows[3])
  }

  @Test("every hash input of the deal is the engine's, bit for bit", arguments: Site.allCases, ["a", "b"])
  func engineForm(_ site: Site, _ deal: String) throws {
    let seed = try Self.seed(of: deal)
    let renderer = try HatchSkyRenderer.system.get()
    var asks: [SIMD4<Float>] = []
    for j in 0..<site.count {
      for (k1, k2) in site.products { asks.append(SIMD4(seed, k1, Float(j), k2)) }
    }
    let answers = try renderer.hin(asks)
    #expect(answers.count == asks.count)
    let off = zip(asks, answers).filter { ask, answer in
      answer.bitPattern != (ask.x * ask.y).addingProduct(ask.z, ask.w).bitPattern
    }
    let said = off.prefix(4).map { ask, answer in
      "fj \(Int(ask.z)), k1 \(ask.y): \(answer), not \((ask.x * ask.y).addingProduct(ask.z, ask.w))"
    }
    #expect(off.isEmpty, "\(off.count) of \(asks.count) inputs are not the engine's: \(said.joined(separator: "; "))")
  }
}
