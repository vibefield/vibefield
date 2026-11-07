import CoreGraphics
import Foundation
import Testing

@testable import FieldDesign

/// IOS-12f's f5 (PC-D8 A; DESIGN.md §2.10, amended 2026-11-07) — the hatch's ROWS golden, in this bundle: New spark's
/// sky as the desktop's vendored engines lay it out, dealt by `packages/design-kit/scripts/spark-hatch-golden.mjs` and
/// copied in byte for byte (`pnpm check:ios-fixtures`). Three deals, each with the geometry of its fall, its star's
/// 128 float32 rows (the star engine's own `add` and `_write`) and the rows of the face born where the star lands
/// (the face engine's `birth` and `write`), sampled on the hatch's clock; a reroll; and reduced motion.
///
/// The phone's `HatchSky` (the deal and the clock), `StarSpark` (the star's DNA and rows) and `SparkBuddy` (the
/// face's birth, hold, queue and fade) are those transcribed. The geometry is held within 1e-9, the words and the
/// integers exactly, and the rows within 1e-4 of each float's size, as 12e's rows are (SparkBuddyGoldenTests.misses).
///
/// The golden's clock: a deal at t happens after the frame at t, and frame n is at n / 60; the face engine's first
/// frame takes dt 0 and every later one clamp(Δt, 0, 0.05); a face that has died leaves after its frame.
@Suite("the hatch's sky is the desktop engines' rows")
struct SparkHatchGoldenTests {
  struct Golden: Decodable {
    struct Engine: Decodable {
      let file: String
      let sha256: String
    }
    struct Point: Decodable {
      let x, y: Double
      var simd: SIMD2<Double> { SIMD2(x, y) }
    }
    struct Sky: Decodable {
      let width, height, landAt, size: Double
    }
    struct Options: Decodable {
      let bloom, night: Bool
      let max: Int
      let dprCap, bloomStr, grain: Double
    }
    /// One step of a sequence: `["hello", 2.4]`.
    struct Step: Decodable {
      let name: String
      let hold: Double

      init(from decoder: Decoder) throws {
        var step = try decoder.unkeyedContainer()
        name = try step.decode(String.self)
        hold = try step.decode(Double.self)
      }
    }
    struct Palette: Decodable {
      let name: String
      let dark: Int
      /// each colour's three channels, float32s written to nine digits
      let c: [[Double]]
    }
    struct Star: Decodable {
      let x, y, R: Double
      let seed: UInt32
      let palette, mask, burstMode: Int
      let from: Point
      let tStart, tImpact, tDeath: Double
    }
    struct Sample: Decodable {
      let t: Double
      let rows: [Double]?
      let gone: Bool?
    }
    struct Deal: Decodable {
      let id: String
      let seed: UInt32
      let draws: [Double]
      let centre: Point
      let R, angle: Double
      let direction: Point
      let distance: Double
      let from: Point
      let flight: Double
      let star: Star
      let rows: [Double]
      let face: [Sample]
    }
    struct Seen: Decodable {
      let rows: [Double]?
      let gone: Bool?
    }
    struct RerollStar: Decodable {
      let deal: String
      let slot: Int
      let flight: Double
      let star: Star
      let rows: [Double]
    }
    struct RerollSample: Decodable {
      let t: Double
      let leaving, born: Seen
    }
    struct Reroll: Decodable {
      let open, next: String
      let at: Double
      let stars: [RerollStar]
      let samples: [RerollSample]
    }
    struct Reduced: Decodable {
      let deal: String
      let star: Star?
      let face: [Sample]
    }
    let engines: [String: Engine]
    let fps: Int
    let sky: Sky
    let options: Options
    let faces: [String: Int]
    let hello: [Step]
    let deathAfter: Double
    let layers: [String: Int]
    let mask: Int
    let night: Bool
    let burstMode: Int
    let palettes: [Palette]
    let confetti: [[Double]]
    let deals: [Deal]
    let reroll: Reroll
    let reduced: Reduced

    func deal(_ id: String) throws -> Deal { try #require(deals.first { $0.id == id }, "deal \(id)") }
    var skySize: CGSize { CGSize(width: sky.width, height: sky.height) }
  }

  static func golden() throws -> Golden {
    let url = try #require(
      Bundle.module.url(forResource: "spark-hatch.golden", withExtension: "json", subdirectory: "Fixtures"))
    return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
  }

  static func draws(_ draws: [Double]) -> HatchSky.Draws {
    HatchSky.Draws(side: draws[0], spread: draws[1], star: draws[2])
  }

  /// The golden's clock over a sky: frame n at n / fps, every frame up to `until`.
  struct Clock {
    let fps: Int
    private(set) var frame = 0

    mutating func run(_ sky: inout HatchSky.Live, to until: Double) {
      let target = Int((until * Double(fps)).rounded())
      while frame < target {
        frame += 1
        sky.frame(at: Double(frame) / Double(fps))
      }
    }
  }

  static func near(_ got: Double, _ want: Double) -> Bool { abs(got - want) <= 1e-9 * max(1, abs(want)) }

  /// The star's fields against the golden's: the integers and the words exactly, the numbers within 1e-9.
  static func starMisses(_ got: StarSpark.Star?, _ want: Golden.Star) -> [String] {
    guard let got else { return ["no star"] }
    var said: [String] = []
    if got.seed != want.seed { said.append("seed \(got.seed), not \(want.seed)") }
    if got.palette != want.palette { said.append("palette \(got.palette), not \(want.palette)") }
    if got.mask != want.mask { said.append("mask \(got.mask), not \(want.mask)") }
    if got.burstMode != want.burstMode { said.append("burstMode \(got.burstMode), not \(want.burstMode)") }
    if got.hue != nil { said.append("a hue of its own, \(got.hue ?? 0): the DNA's is the engine's") }
    let numbers: [(String, Double, Double)] = [
      ("x", got.x, want.x), ("y", got.y, want.y), ("R", got.R, want.R), ("from.x", got.from.x, want.from.x),
      ("from.y", got.from.y, want.from.y), ("tStart", got.tStart, want.tStart),
      ("tImpact", got.tImpact, want.tImpact), ("tDeath", got.tDeath, want.tDeath),
    ]
    for (name, a, b) in numbers where !near(a, b) { said.append("\(name) \(a), not \(b)") }
    return said
  }

  /// A face's sample: its rows within 1e-4, or gone when the golden says it has left.
  static func sampleMisses(_ rows: [Float]?, rows want: [Double]?, gone: Bool?) -> [String] {
    if gone == true { return rows == nil ? [] : ["still on the sky; the engine's has left"] }
    guard let want else { return ["the golden has neither rows nor gone"] }
    guard let rows else { return ["gone; the engine's is still on the sky"] }
    return SparkBuddyGoldenTests.misses(rows, want)
  }

  @Test("the golden pins the engines and the hatch, and the hatch's numbers are the phone's")
  func shape() throws {
    let golden = try Self.golden()
    #expect(Set(golden.engines.keys) == ["star", "face", "hatch"])
    #expect(golden.engines.values.allSatisfy { $0.sha256.count == 64 })
    #expect(golden.fps == 60)
    #expect(golden.sky.width == 382 && golden.sky.height == 300)
    #expect(golden.sky.landAt == HatchSky.landAt)
    #expect(golden.sky.size == HatchSky.faceSize)
    #expect(golden.options.bloom == HatchSky.bloom)
    #expect(golden.options.night == HatchSky.night && golden.night == HatchSky.night)
    #expect(golden.options.max == HatchSky.maxStars)
    #expect(golden.options.dprCap == HatchSky.dprCap)
    #expect(golden.options.bloomStr == HatchSky.bloomStrength)
    #expect(golden.options.grain == HatchSky.grain)
    #expect(golden.faces["max"] == HatchSky.maxFaces)
    #expect(golden.hello.map(\.name) == HatchSky.hello.map { $0.0 })
    #expect(golden.hello.map(\.hold) == HatchSky.hello.map { $0.1 ?? -1 })
    #expect(golden.deathAfter == HatchSky.deathAfter)
    #expect(golden.mask == HatchSky.mask)
    #expect(golden.burstMode == HatchSky.burstMode)
    #expect(golden.deals.map(\.id) == ["a", "b", "c"])
    #expect(StarSpark.floats == 128)
    let rows = golden.deals.map(\.rows) + golden.reroll.stars.map(\.rows)
    #expect(rows.allSatisfy { $0.count == StarSpark.floats })
  }

  @Test("the star engine's layer bits, twelve palettes and confetti are the phone's, float for float")
  func palettes() throws {
    let golden = try Self.golden()
    let layers: [String: Int] = [
      "FILL": StarSpark.Layer.fill, "RIM": StarSpark.Layer.rim, "CORE": StarSpark.Layer.core,
      "HALO": StarSpark.Layer.halo, "ECHO": StarSpark.Layer.echo, "AURA": StarSpark.Layer.aura,
      "ORBS": StarSpark.Layer.orbs, "GLINT": StarSpark.Layer.glint, "BURST": StarSpark.Layer.burst,
      "FLAT": StarSpark.Layer.flat, "SDF": StarSpark.Layer.sdf, "HARD": StarSpark.Layer.hard,
      "NOWARP": StarSpark.Layer.noWarp, "OUTLINE": StarSpark.Layer.outline, "ALL": StarSpark.Layer.all,
    ]
    #expect(golden.layers == layers)
    #expect(StarSpark.palettes.count == golden.palettes.count)
    for (palette, want) in zip(StarSpark.palettes, golden.palettes) {
      #expect(palette.name == want.name)
      #expect(palette.dark == (want.dark == 1), "\(want.name)")
      #expect(palette.c.count == want.c.count, "\(want.name)")
      for (hex, channels) in zip(palette.c, want.c) {
        #expect(StarSpark.rgb(hex) == SIMD3(channels.map(Float.init)), "\(want.name) \(hex)")
      }
    }
    #expect(StarSpark.confetti.count == golden.confetti.count)
    for (hex, channels) in zip(StarSpark.confetti, golden.confetti) {
      #expect(StarSpark.rgb(hex) == SIMD3(channels.map(Float.init)), "confetti \(hex)")
    }
  }

  @Test("each deal falls as the hatch's does, and its star's rows are the engine's")
  func deals() throws {
    let golden = try Self.golden()
    for want in golden.deals {
      let deal = HatchSky.deal(
        seed: want.seed, draws: Self.draws(want.draws), at: 0, sky: golden.skySize, reducedMotion: false)
      #expect(deal.centre == want.centre.simd, "\(want.id)")
      #expect(Self.near(deal.face.R, want.R), "\(want.id): R \(deal.face.R), not \(want.R)")
      let fall = try #require(deal.fall, "\(want.id) has no fall")
      let numbers: [(String, Double, Double)] = [
        ("angle", fall.angle, want.angle), ("direction.x", fall.direction.x, want.direction.x),
        ("direction.y", fall.direction.y, want.direction.y), ("distance", fall.distance, want.distance),
        ("from.x", fall.from.x, want.from.x), ("from.y", fall.from.y, want.from.y),
        ("flight", fall.flight, want.flight),
      ]
      for (name, a, b) in numbers { #expect(Self.near(a, b), "\(want.id): \(name) \(a), not \(b)") }
      let starSaid = Self.starMisses(deal.star, want.star)
      #expect(starSaid.isEmpty, "\(want.id)'s star: \(starSaid.joined(separator: "; "))")
      let star = try #require(deal.star)
      let rowsSaid = SparkBuddyGoldenTests.misses(StarSpark.rows(star), want.rows)
      #expect(rowsSaid.isEmpty, "\(want.id)'s star rows: \(rowsSaid.joined(separator: "; "))")
    }
  }

  @Test("the face of each deal is born where its star lands, plays hello, and rests")
  func faces() throws {
    let golden = try Self.golden()
    for want in golden.deals {
      var sky = HatchSky.Live()
      var clock = Clock(fps: golden.fps)
      let dealt = sky.deal(seed: want.seed, draws: Self.draws(want.draws), sky: golden.skySize, reducedMotion: false)
      #expect(dealt.slot == 0, "\(want.id)")
      let rowsSaid = SparkBuddyGoldenTests.misses(Array(sky.starRows.prefix(StarSpark.floats)), want.rows)
      #expect(rowsSaid.isEmpty, "\(want.id)'s star on the sky: \(rowsSaid.joined(separator: "; "))")
      for sample in want.face {
        clock.run(&sky, to: sample.t)
        let said = Self.sampleMisses(
          sky.rows(of: dealt.ticket, reducedMotion: false), rows: sample.rows, gone: sample.gone)
        #expect(said.isEmpty, "\(want.id)'s face at \(sample.t) s: \(said.joined(separator: "; "))")
      }
    }
  }

  @Test("a reroll: the face before leaves as the next star falls, and the two stars share the sky's slots")
  func reroll() throws {
    let golden = try Self.golden()
    let reroll = golden.reroll
    let open = try golden.deal(reroll.open)
    let next = try golden.deal(reroll.next)
    var sky = HatchSky.Live()
    var clock = Clock(fps: golden.fps)
    let one = sky.deal(seed: open.seed, draws: Self.draws(open.draws), sky: golden.skySize, reducedMotion: false)
    clock.run(&sky, to: reroll.at)
    #expect(Self.near(sky.t, reroll.at), "the reroll at \(sky.t) s, not \(reroll.at)")
    let two = sky.deal(seed: next.seed, draws: Self.draws(next.draws), sky: golden.skySize, reducedMotion: false)
    #expect(sky.hero == two.ticket)
    let wantStars = Dictionary(uniqueKeysWithValues: reroll.stars.map { ($0.deal, $0) })
    for (dealt, id) in [(one, reroll.open), (two, reroll.next)] {
      let want = try #require(wantStars[id])
      #expect(dealt.slot == want.slot, "\(id)'s star in slot \(String(describing: dealt.slot)), not \(want.slot)")
      let starSaid = Self.starMisses(dealt.deal.star, want.star)
      #expect(starSaid.isEmpty, "\(id)'s star: \(starSaid.joined(separator: "; "))")
      let slot = try #require(dealt.slot)
      let rows = Array(sky.starRows[(slot * StarSpark.floats)..<((slot + 1) * StarSpark.floats)])
      let rowsSaid = SparkBuddyGoldenTests.misses(rows, want.rows)
      #expect(rowsSaid.isEmpty, "\(id)'s star rows: \(rowsSaid.joined(separator: "; "))")
    }
    #expect(sky.used == 2)
    for sample in reroll.samples {
      clock.run(&sky, to: sample.t)
      let leaving = Self.sampleMisses(
        sky.rows(of: one.ticket, reducedMotion: false), rows: sample.leaving.rows, gone: sample.leaving.gone)
      #expect(leaving.isEmpty, "the leaving face at \(sample.t) s: \(leaving.joined(separator: "; "))")
      let born = Self.sampleMisses(
        sky.rows(of: two.ticket, reducedMotion: false), rows: sample.born.rows, gone: sample.born.gone)
      #expect(born.isEmpty, "the born face at \(sample.t) s: \(born.joined(separator: "; "))")
    }
  }

  @Test("under reduced motion no star falls, and the face is born at once with every motion still")
  func reduced() throws {
    let golden = try Self.golden()
    #expect(golden.reduced.star == nil)
    let want = try golden.deal(golden.reduced.deal)
    var sky = HatchSky.Live()
    var clock = Clock(fps: golden.fps)
    let dealt = sky.deal(seed: want.seed, draws: Self.draws(want.draws), sky: golden.skySize, reducedMotion: true)
    #expect(dealt.deal.star == nil && dealt.deal.fall == nil && dealt.slot == nil)
    #expect(sky.used == 0)
    for sample in golden.reduced.face {
      clock.run(&sky, to: sample.t)
      let said = Self.sampleMisses(
        sky.rows(of: dealt.ticket, reducedMotion: true), rows: sample.rows, gone: sample.gone)
      #expect(said.isEmpty, "the face at \(sample.t) s: \(said.joined(separator: "; "))")
    }
  }

  @Test("the engine collects a star 1.2 s after its death, and a full sky reuses the slot that landed first")
  func slots() throws {
    let golden = try Self.golden()
    let want = try golden.deal("a")
    var sky = HatchSky.Live()
    for index in 0..<HatchSky.maxStars {
      let dealt = sky.deal(
        seed: want.seed, draws: Self.draws(want.draws), sky: golden.skySize, reducedMotion: false)
      #expect(dealt.slot == index)
    }
    // every star landed at the same time, so the first slot is the one that landed first
    let full = sky.deal(seed: want.seed, draws: Self.draws(want.draws), sky: golden.skySize, reducedMotion: false)
    #expect(full.slot == 0)
    #expect(sky.faces.count == HatchSky.maxFaces)
    let death = try #require(full.deal.star).tDeath
    #expect(!HatchSky.collected(tDeath: death, at: death + HatchSky.collectAfter))
    #expect(HatchSky.collected(tDeath: death, at: death + HatchSky.collectAfter + 1e-6))
    #expect(!HatchSky.collected(tDeath: 0, at: 99))
    sky.frame(at: death + 1.5)
    #expect(sky.used == 0 && sky.starRows.allSatisfy { $0 == 0 })
  }
}
