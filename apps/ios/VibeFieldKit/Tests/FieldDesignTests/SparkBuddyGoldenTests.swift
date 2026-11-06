import Foundation
import Testing

@testable import FieldDesign

/// IOS-12e (PC-D6 A; DESIGN.md §2.10, amended 2026-11-06) — the spark face's ROWS golden, in this bundle: what the
/// desktop's vendored engine lays out for the GPU (`Buddy.write`: 32 vec4 rows, 128 float32s a face), dealt by
/// `packages/design-kit/scripts/spark-rows-golden.mjs` and copied in byte for byte (`pnpm check:ios-fixtures`).
///
/// The phone's `SparkBuddy` is the engine's `Buddy` transcribed. Each face is built as the product builds one: the
/// adapter's options (the seed's DNA, the glow, mouthless, at rest in its status), placed at the centre of its box. It
/// draws from Mulberry32 on its own seed, which the golden puts in place of the engine's `Math.random`, and it is
/// stepped as `Engine.render` steps a face. Its rows must equal the golden's within 1e-4 of each float's size. The
/// engine computes in doubles and stores float32s, as the phone does; the slack is for the platforms' sin, cos and
/// pow, which may differ in the last place. A transcription slip is far larger, and the first misses are named by row
/// and lane.
@Suite("the spark face's rows are the desktop engine's")
struct SparkBuddyGoldenTests {
  /// One value of a recipe as the engine writes it: a number, a word (a motion, a gaze, a prop), or a pair or four
  /// of numbers (a blink's range, a tint).
  enum RecipeValue: Decodable, Equatable {
    case number(Double)
    case word(String)
    case numbers([Double])

    init(from decoder: Decoder) throws {
      let value = try decoder.singleValueContainer()
      if let number = try? value.decode(Double.self) {
        self = .number(number)
      } else if let word = try? value.decode(String.self) {
        self = .word(word)
      } else {
        self = .numbers(try value.decode([Double].self))
      }
    }
  }

  struct Golden: Decodable {
    struct Sample: Decodable {
      let t: Double
      let rows: [Double]
    }
    struct Live: Decodable {
      let seed: UInt32
      let status: String
      let size: Double
      let framed: Bool
      let cut: [Double]
      let samples: [Sample]
    }
    struct Reduced: Decodable {
      let seed: UInt32
      let status: String
      let size: Double
      let framed: Bool
      let cut: [Double]
      let t: Double
      let rows: [Double]
    }
    struct Change: Decodable {
      let seed: UInt32
      let from, to: String
      let at: Double
      let size: Double
      let framed: Bool
      let cut: [Double]
      let samples: [Sample]
    }
    struct Still: Decodable {
      let id: String
      let seed: UInt32
      let status: String
      let size: Double
      let framed: Bool
      let cut: [Double]
      let rows: [Double]
    }
    let fps: Int
    let seeds: [UInt32]
    let times: [Double]
    let statuses: [String]
    let recipes: [String: [String: RecipeValue]]
    let live: [Live]
    let reduced: [Reduced]
    let change: Change
    let stills: [Still]
  }

  static func golden() throws -> Golden {
    let url = try #require(
      Bundle.module.url(forResource: "spark-rows.golden", withExtension: "json", subdirectory: "Fixtures"))
    return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
  }

  /// A face as the product builds one (`sparkBuddyOptions`, then `placeSparkBuddy` at the centre of its box), dealt
  /// from its own seed.
  static func face(seed: UInt32, status: String, size: Double, framed: Bool, cut: [Double]) -> SparkBuddy {
    var buddy = SparkBuddy(
      seed: seed, status: status, framed: framed, cut: SIMD3(cut[0], cut[1], cut[2]), random: Mulberry32(seed: seed))
    let box = SparkStills.box(size: size, framed: framed)
    buddy.place(centreX: box / 2, centreY: box / 2, size: size, framed: framed)
    return buddy
  }

  /// The stage's clock, as the golden steps a face: t = n / fps, dt = clamp(t − the previous t, 0, 0.05), and 0 at the
  /// first frame (`Engine.render`, sparks.js :1170).
  struct Clock {
    let fps: Int
    private var frame = 0
    private var last: Double?

    init(fps: Int, _ buddy: inout SparkBuddy) {
      self.fps = fps
      step(&buddy, 0)
    }

    mutating func advance(_ buddy: inout SparkBuddy, to until: Double) {
      let target = Int((until * Double(fps)).rounded())
      while frame < target {
        frame += 1
        step(&buddy, Double(frame) / Double(fps))
      }
    }

    private mutating func step(_ buddy: inout SparkBuddy, _ t: Double) {
      let dt = last.map { min(max(t - $0, 0), 0.05) } ?? 0
      last = t
      buddy.update(t: t, dt: dt)
    }
  }

  static func written(_ buddy: SparkBuddy, reducedMotion: Bool = false) -> [Float] {
    var rows = [Float](repeating: 0, count: SparkBuddy.floats)
    buddy.write(into: &rows, at: 0, reducedMotion: reducedMotion)
    return rows
  }

  /// The floats that are not the golden's, the first four named by row and lane; empty when every one is.
  static func misses(_ rows: [Float], _ want: [Double]) -> [String] {
    guard rows.count == want.count else { return ["\(rows.count) floats, not \(want.count)"] }
    let lanes = ["x", "y", "z", "w"]
    var said: [String] = []
    for (index, (got, wanted)) in zip(rows, want).enumerated()
    where abs(Double(got) - wanted) > 1e-4 * max(1, abs(wanted)) {
      said.append("row \(index / 4).\(lanes[index % 4]) = \(got), not \(wanted)")
      if said.count == 4 { break }
    }
    return said
  }

  @Test("the golden deals the nineteen statuses on three seeds, at 60 frames a second, 128 floats a face")
  func shape() throws {
    let golden = try Self.golden()
    #expect(golden.statuses.count == 19)
    #expect(golden.seeds == [7, 4211, 1])
    #expect(golden.fps == 60)
    #expect(golden.live.count == golden.statuses.count * golden.seeds.count)
    #expect(golden.stills.count == 58)
    #expect(SparkBuddy.floats == 128)
    let rows = golden.live.flatMap { $0.samples.map(\.rows) } + golden.stills.map(\.rows)
    #expect(rows.allSatisfy { $0.count == SparkBuddy.floats })
  }

  @Test("each status's recipe, mouthless, is the engine's, field by field")
  func recipes() throws {
    let golden = try Self.golden()
    #expect(Set(golden.recipes.keys) == Set(golden.statuses))
    for status in golden.statuses {
      let recipe = try #require(SparkRecipes.recipe(status, mouth: false), "\(status)")
      let want = try #require(golden.recipes[status])
      #expect(Set(recipe.fields.keys) == Set(want.keys), "\(status)")
      for (key, wanted) in want {
        let got = recipe.fields[key]
        switch (got, wanted) {
        case (.number(let a)?, .number(let b)):
          #expect(abs(a - b) <= 1e-12 * max(1, abs(b)), "\(status).\(key)")
        case (.word(let a)?, .word(let b)):
          #expect(a == b, "\(status).\(key)")
        case (.numbers(let a)?, .numbers(let b)):
          #expect(a.count == b.count && zip(a, b).allSatisfy { abs($0 - $1) <= 1e-12 }, "\(status).\(key)")
        default:
          Issue.record("\(status).\(key): \(String(describing: got)), not \(wanted)")
        }
      }
    }
  }

  @Test("a face at rest in each status writes the engine's rows at 0.5, 1.7 and 4 s")
  func live() throws {
    let golden = try Self.golden()
    for live in golden.live {
      var buddy = Self.face(
        seed: live.seed, status: live.status, size: live.size, framed: live.framed, cut: live.cut)
      var clock = Clock(fps: golden.fps, &buddy)
      for sample in live.samples {
        clock.advance(&buddy, to: sample.t)
        let said = Self.misses(Self.written(buddy), sample.rows)
        #expect(said.isEmpty, "\(live.status) on seed \(live.seed) at \(sample.t) s: \(said.joined(separator: "; "))")
      }
    }
  }

  @Test("under reduced motion the motions are still, and the blinks and the status's pose stay")
  func reduced() throws {
    let golden = try Self.golden()
    #expect(!golden.reduced.isEmpty)
    for reduced in golden.reduced {
      var buddy = Self.face(
        seed: reduced.seed, status: reduced.status, size: reduced.size, framed: reduced.framed, cut: reduced.cut)
      var clock = Clock(fps: golden.fps, &buddy)
      clock.advance(&buddy, to: reduced.t)
      let said = Self.misses(Self.written(buddy, reducedMotion: true), reduced.rows)
      #expect(said.isEmpty, "\(reduced.status) on seed \(reduced.seed): \(said.joined(separator: "; "))")
    }
  }

  @Test("a status changed mid-run: the springs chase the new pose and the glyph swaps behind a blink")
  func change() throws {
    let golden = try Self.golden()
    let change = golden.change
    var buddy = Self.face(
      seed: change.seed, status: change.from, size: change.size, framed: change.framed, cut: change.cut)
    var clock = Clock(fps: golden.fps, &buddy)
    clock.advance(&buddy, to: change.at)
    // as the stage changes a face's status (stage.tsx :122)
    buddy.rest = change.to
    buddy.feel(change.to)
    for sample in change.samples {
      clock.advance(&buddy, to: sample.t)
      let said = Self.misses(Self.written(buddy), sample.rows)
      #expect(said.isEmpty, "\(change.from) → \(change.to) at \(sample.t) s: \(said.joined(separator: "; "))")
    }
  }

  @Test("a still writes the engine's rows: placed, never stepped")
  func stills() throws {
    for still in try Self.golden().stills {
      let buddy = Self.face(
        seed: still.seed, status: still.status, size: still.size, framed: still.framed, cut: still.cut)
      let said = Self.misses(Self.written(buddy), still.rows)
      #expect(said.isEmpty, "\(still.id): \(said.joined(separator: "; "))")
    }
  }
}
