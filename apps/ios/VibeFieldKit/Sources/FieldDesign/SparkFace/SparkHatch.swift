import CoreGraphics
import Foundation

// IOS-12f's f5e (red) — NEW SPARK'S SKY, A SKELETON: the API SparkHatchGoldenTests is written against. The hatch's
// numbers are named (hatch.tsx's and the star engine's options); the deal places the face and drops no star, and the
// sky's clock does not step. f5f transcribes the hatch's deal (`packages/design-kit/src/spark-face/hatch.tsx`
// :199–238) and the two engines' clocks into it.

public enum SparkHatch {
  /// Where the star lands, as a share of the sky's height (hatch.tsx :48).
  public static let landAt = 0.5
  /// The star dies this long after it lands (:236).
  public static let deathAfter = 3.4
  /// What a born face plays before its rest (:215, :224).
  public static let hello: [(String, Double?)] = [("hello", 2.4)]
  /// The born face on the phone: 120, free (§2.10's phone table). The Mac's sheet draws it at 104.
  public static let faceSize = 120.0

  /// The sky's engine (`new SparkEngine(sky, { bloom: true, bloomStr: 0.45, max: 8, night: true })`, :191) over the
  /// engine's own defaults (star-spark.js :548), and the faces' (`{ max: 6 }`, :192).
  public static let bloom = true
  public static let bloomStrength = 0.45
  public static let night = true
  public static let maxStars = 8
  public static let dprCap = 2.0
  public static let grain = 0.035
  public static let maxFaces = 6

  /// The hatch's star draws its burst alone (`mask: LAYERS.BURST`), in the engine's second burst mode.
  public static let mask = StarSpark.Layer.burst
  public static let burstMode = 2

  /// The engine collects a star this long after its death (`gc`, star-spark.js :631).
  public static let collectAfter = 1.2

  /// `starPaletteOf(facePalette)` (star.ts :63): the face's palette where the star engine has it, else the nearest.
  public static func starPalette(of facePalette: Int) -> Int {
    0
  }

  /// Whether the engine has collected a star by `t` (`gc`): a star with a death, past it by `collectAfter`.
  public static func collected(tDeath: Double, at t: Double) -> Bool {
    false
  }

  /// A deal's three `Math.random` calls, in the hatch's order: the side it falls from (:219), the angle's spread
  /// (:219), and the star's seed (:229).
  public struct Draws: Sendable, Equatable {
    public var side: Double
    public var spread: Double
    public var star: Double

    public init(side: Double, spread: Double, star: Double) {
      self.side = side
      self.spread = spread
      self.star = star
    }

    /// The system's random, as the Mac's window draws them.
    public static func system() -> Draws {
      Draws(side: .random(in: 0..<1), spread: .random(in: 0..<1), star: .random(in: 0..<1))
    }

    /// Mulberry32 of the face's seed, for `-vf-spark-time`'s stills.
    public static func seeded(_ seed: UInt32) -> Draws {
      var random = Mulberry32(seed: seed)
      let side = random.next()
      let spread = random.next()
      return Draws(side: side, spread: spread, star: random.next())
    }
  }

  /// How a star falls: its angle from the vertical, its direction, how far it falls, from where, and for how long.
  public struct Fall: Sendable, Equatable {
    public let angle: Double
    public let direction: SIMD2<Double>
    public let distance: Double
    public let from: SIMD2<Double>
    public let flight: Double
  }

  /// One deal: the face, placed and born, and its star with its fall (nil under reduced motion).
  public struct Deal: Sendable {
    public let seed: UInt32
    public let centre: SIMD2<Double>
    public internal(set) var face: SparkBuddy
    public let fall: Fall?
    public let star: StarSpark.Star?
  }

  /// `deal(seed)`'s arithmetic at `t`, on a sky `sky` points in size: the face as the adapter makes it (at rest
  /// "ready", free, on the night: `sparkBuddyOptions(…, [0, 0, 0])`), drawing from Mulberry32 on its own seed and
  /// placed on the centre at `size`, and born at the star's impact (at once under reduced motion).
  public static func deal(
    seed: UInt32, draws: Draws, at t: Double, sky: CGSize, size: Double = faceSize, reducedMotion: Bool
  ) -> Deal {
    let centre = SIMD2(Double(sky.width) / 2, Double(sky.height) * landAt)
    var face = SparkBuddy(
      seed: seed, status: "ready", framed: false, cut: SIMD3(0, 0, 0), random: Mulberry32(seed: seed))
    face.place(centreX: centre.x, centreY: centre.y, size: size, framed: false)
    return Deal(seed: seed, centre: centre, face: face, fall: nil, star: nil)
  }

  /// The sky as the hatch runs it: the star engine's slots and the face engine's faces, on the hatch's one clock.
  /// A deal happens at the clock's time, between frames; `frame(at:)` is one frame of both engines.
  public struct Sky: Sendable {
    /// A face in the face engine, by the ticket its deal was given.
    public struct Face: Sendable {
      public let ticket: Int
      public internal(set) var buddy: SparkBuddy
    }

    /// What a deal put on the sky: the deal, its face's ticket and its star's slot.
    public struct Dealt: Sendable {
      public let deal: Deal
      public let ticket: Int
      public let slot: Int?
    }

    /// The clock: the time of the last frame (0 before the first).
    public private(set) var t = 0.0
    var last: Double?
    public private(set) var faces: [Face] = []
    public private(set) var slots: [StarSpark.Star?] = Array(repeating: nil, count: maxStars)
    /// The engine's data texture: every slot's 128 floats, zero where the slot is empty.
    public private(set) var starRows = [Float](repeating: 0, count: maxStars * StarSpark.floats)
    public private(set) var hero: Int?
    var tickets = 0

    public init() {}

    /// `deal(seed)` at the clock's time: the face before leaves, and the new face and its star are added.
    @discardableResult
    public mutating func deal(
      seed: UInt32, draws: Draws, sky: CGSize, size: Double = faceSize, reducedMotion: Bool
    ) -> Dealt {
      let deal = SparkHatch.deal(
        seed: seed, draws: draws, at: t, sky: sky, size: size, reducedMotion: reducedMotion)
      tickets += 1
      faces.append(Face(ticket: tickets, buddy: deal.face))
      hero = tickets
      return Dealt(deal: deal, ticket: tickets, slot: nil)
    }

    /// The slots the engine draws (`used`): through the last that holds a star.
    public var used: Int { (slots.lastIndex(where: { $0 != nil }) ?? -1) + 1 }

    /// One frame of both engines at `t`: the star engine collects its dead stars (`gc`), and the face engine steps
    /// every face, dt clamp(t − the last frame's, 0, 0.05) and 0 at the first, then drops the dead.
    public mutating func frame(at t: Double) {
      self.t = t
    }

    /// A face's rows after the last frame, as `write` lays them; nil once it has left the engine.
    public func rows(of ticket: Int, reducedMotion: Bool) -> [Float]? {
      guard let face = faces.first(where: { $0.ticket == ticket }) else { return nil }
      var rows = [Float](repeating: 0, count: SparkBuddy.floats)
      face.buddy.write(into: &rows, at: 0, reducedMotion: reducedMotion)
      return rows
    }

    /// Every face's rows, as the face engine writes them each frame: top to bottom (a stable sort on y).
    public func faceRows(reducedMotion: Bool) -> (rows: [Float], faces: Int) {
      let order = faces.enumerated().sorted { a, b in
        a.element.buddy.y != b.element.buddy.y ? a.element.buddy.y < b.element.buddy.y : a.offset < b.offset
      }
      var rows = [Float](repeating: 0, count: max(1, faces.count) * SparkBuddy.floats)
      for (index, face) in order.enumerated() {
        face.element.buddy.write(into: &rows, at: index * SparkBuddy.floats, reducedMotion: reducedMotion)
      }
      return (rows, faces.count)
    }
  }
}
