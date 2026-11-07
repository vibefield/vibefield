import CoreGraphics
import Foundation

// IOS-12f's f6 (PC-D8 A, Q1, Q4; DESIGN.md §2.10 and §8 "The phone's Chat", Created) — THE FLIGHT: hatch.tsx's `fly`
// (:240–269) and its frame (`#draw`, :290–323) on the phone. Created, the face leaves New spark's sky for its row's
// face in Chat's list as the sheet folds:
// - 660 ms, its place on the island curve as hatch.tsx draws it, e = 1 − (1 − u)³, lifted on an arc;
// - its radius running to the row's;
// - past 0.45 of the way, the disc it wears in its row.
// `SparkFlight` is the model, pure, held by SparkFlightTests. `SparkFlightWindow` draws it in a window of its own over
// the sheet, for the flight alone, as hatch.tsx draws it on a canvas over the whole window (VF-PM's Q1 ruling,
// 17:10:10Z). What flies is the face engine's buddy of the hero's seed, `ready` and free, as hatch.tsx's is.

/// One flight: from the hero's place to a row face's box, from `t0` of the flight's own clock.
public struct SparkFlight: Equatable, Sendable {
  /// How long a flight to a row takes, seconds (hatch.tsx's FLY_S, :50).
  public static let duration = 0.66
  /// Past this share of the way, the face puts on its row's disc (hatch.tsx :308).
  public static let disc = 0.45
  /// The face's eyes once it wears the disc (hatch.tsx :314): a row's 48 is in the 1.12 band.
  public static let discFaceScale = 1.12
  /// The lift's ceiling, points, and its share of the distance (hatch.tsx :301–303).
  static let liftMost = 90.0
  static let liftShare = 0.18

  /// Where the face leaves from: its centre and its star's radius, in the window's space (points, y down) for a
  /// flight, in the sky's own for the sky's hero.
  public struct Start: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var R: Double

    public init(x: Double, y: Double, R: Double) {
      self.x = x
      self.y = y
      self.R = R
    }
  }

  /// Where the face is at a moment of its flight.
  public struct Pose: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var R: Double
    /// It wears its row's disc.
    public var framed: Bool
    /// It has landed: the face is the row's now.
    public var landed: Bool

    public init(x: Double, y: Double, R: Double, framed: Bool, landed: Bool) {
      self.x = x
      self.y = y
      self.R = R
      self.framed = framed
      self.landed = landed
    }
  }

  public let from: Start
  public let t0: Double

  public init(from: Start, t0: Double) {
    self.from = from
    self.t0 = t0
  }

  /// The island curve, `cubic-bezier(0.25, 1, 0.3, 1)`, near enough for a flight's position (hatch.tsx's `islandish`).
  public static func islandish(_ u: Double) -> Double { 1 - pow(1 - u, 3) }

  /// The share of the way at `t` of the flight's clock (hatch.tsx :299): 0 before it leaves, 1 once it has landed.
  public func share(at t: Double) -> Double { 0 }

  /// The flight at `t`, to the row face's `box` as it stands now.
  public func pose(at t: Double, to box: CGRect) -> Pose { pose(u: share(at: t), to: box) }

  /// The flight at share `u` of the way (hatch.tsx :293–316), to the row face's `box` as it stands now. hatch.tsx reads
  /// the box each frame, so a row that moves is still met. The target is the box's centre with the star 6% of the row's
  /// radius below it, the row's radius its box's width / 2 / frameH.
  public func pose(u: Double, to box: CGRect) -> Pose {
    // the red's skeleton: it never leaves
    Pose(x: from.x, y: from.y, R: from.R, framed: false, landed: false)
  }
}

/// What flies a face from New spark's sky to its row: the flight window in the app, a recorder in the tests.
@MainActor
public protocol SparkFlying: AnyObject {
  /// Flies the face of `seed` from `start` (the window's space) to the box `to` reads each frame, the row's face,
  /// its disc's cut ring on `cut`, and calls `landed` once it has landed. False where nothing can fly: the caller
  /// fades the row's face in instead.
  func fly(
    seed: UInt32, from start: SparkFlight.Start, cut: SIMD3<Double>, to: @escaping @MainActor () -> CGRect?,
    landed: @escaping @MainActor () -> Void
  ) -> Bool
}
