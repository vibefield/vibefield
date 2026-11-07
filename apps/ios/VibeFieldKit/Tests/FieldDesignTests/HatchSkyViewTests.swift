import CoreGraphics
import Testing
import UIKit

@testable import FieldDesign

/// IOS-12f's f5 (PC-D8 A; DESIGN.md §2.10, amended 2026-11-07) — New spark's sky on screen runs the hatch's clock
/// (hatch.tsx's `Live`): a deal waits for the sky's size, a new seed deals again while the face before leaves, and
/// DEBUG's held clock (`-vf-spark-time`) steps a fresh sky from 0 to the held time at 60 frames a second, its draws
/// Mulberry32 of the face's seed, so a still is the same every run. What it draws is held by the hatch's goldens
/// (SparkHatchGoldenTests, SparkHatchFramesTests); this holds what it hands them.
@Suite("New spark's sky runs the hatch's clock")
@MainActor
struct HatchSkyViewTests {
  static let sky = CGSize(width: 382, height: 300)

  static func layer(held: Double?, laidOut: Bool = true) throws -> HatchSkyLayer {
    let layer = try HatchSkyLayer(
      sky: try HatchSkyRenderer.system.get(), stars: try SparkStarRenderer.system.get(),
      faceSize: HatchSky.faceSize, held: held)
    if laidOut {
      layer.frame = CGRect(origin: .zero, size: sky)
      layer.layoutIfNeeded()
    }
    return layer
  }

  @Test("held, a deal is the sky stepped from 0 to the held time, its draws Mulberry32 of the face's seed")
  func heldDeal() throws {
    let layer = try Self.layer(held: 1.2)
    layer.deal(4211)
    var want = HatchSky.Live()
    want.deal(seed: 4211, draws: .seeded(4211), sky: Self.sky, reducedMotion: false)
    for frame in 1...72 { want.frame(at: Double(frame) / 60) }
    #expect(layer.live.t == want.t)
    #expect(layer.live.used == 1)
    #expect(layer.live.starRows == want.starRows)
    let rows = layer.live.faceRows(reducedMotion: false)
    #expect(rows.faces == 1)
    #expect(rows.rows == want.faceRows(reducedMotion: false).rows)
  }

  @Test("a deal before the sky is laid out waits for its size, then deals once")
  func pendingDeal() throws {
    let layer = try Self.layer(held: 0.5, laidOut: false)
    layer.deal(7)
    #expect(layer.live.faces.isEmpty)
    layer.frame = CGRect(origin: .zero, size: Self.sky)
    layer.layoutIfNeeded()
    #expect(layer.live.faces.count == 1)
    #expect(layer.live.used == 1)
    layer.setNeedsLayout()
    layer.layoutIfNeeded()
    #expect(layer.live.faces.count == 1)
  }

  @Test("a new seed deals again: the face before leaves as the next star falls; the same seed deals nothing")
  func reroll() throws {
    let layer = try Self.layer(held: nil)
    layer.deal(4211)
    layer.deal(7)
    #expect(layer.live.faces.count == 2)
    #expect(layer.live.used == 2)
    #expect(layer.live.hero == layer.live.faces.last?.ticket)
    layer.deal(7)
    #expect(layer.live.faces.count == 2)
    #expect(layer.live.used == 2)
  }
}
