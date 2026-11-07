import Foundation

// IOS-12f's f5e (red) — THE HATCH'S STAR, A SKELETON: the API SparkHatchGoldenTests and SparkHatchFramesTests are
// written against, answering nothing yet. f5f transcribes the desktop's vendored star engine's CPU half into it
// (`packages/design-kit/src/spark-face/vendor/star-spark.js`: its palettes, its confetti, `makeDNA` and `_write`).

public enum StarSpark {
  /// One star's rows: 32 vec4s (`ROW`, :7).
  public static let floats = 128

  /// A palette: its ten colours, [edge, ramp1, ramp2, ramp3, deep, rim, halo, aura, trail, accent], and whether it is a
  /// dark one.
  public struct Palette: Sendable, Equatable {
    public let name: String
    public let dark: Bool
    public let c: [String]
  }

  /// `PALETTES` (:12), in the engine's order.
  public static let palettes: [Palette] = []

  /// `CONFETTI` (:26).
  public static let confetti: [String] = []

  /// The layer bits the shader reads from a star's row 7 (`L`, :29).
  public enum Layer {
    public static let fill = 1
    public static let rim = 2
    public static let core = 4
    public static let halo = 8
    public static let echo = 16
    public static let aura = 32
    public static let orbs = 64
    public static let glint = 128
    public static let burst = 256
    public static let flat = 512
    public static let sdf = 1024
    public static let hard = 2048
    public static let noWarp = 4096
    public static let outline = 8192
    public static let all = fill | rim | core | halo | echo | aura | orbs | glint | burst
  }

  /// One star, as `add` takes it (:612): where it lands and how big, its seed and palette, the layers it draws, where
  /// it falls from, and when it falls, lands and dies (seconds, the sky's clock). `hue` nil is its DNA's.
  public struct Star: Sendable, Equatable {
    public var x: Double
    public var y: Double
    public var R: Double
    public var seed: UInt32
    public var palette: Int
    public var hue: Double?
    public var mask: Int
    public var burstMode: Int
    public var from: SIMD2<Double>
    public var tStart: Double
    public var tImpact: Double
    public var tDeath: Double

    public init(
      x: Double, y: Double, R: Double, seed: UInt32, palette: Int, hue: Double? = nil, mask: Int, burstMode: Int,
      from: SIMD2<Double>, tStart: Double, tImpact: Double, tDeath: Double
    ) {
      self.x = x
      self.y = y
      self.R = R
      self.seed = seed
      self.palette = palette
      self.hue = hue
      self.mask = mask
      self.burstMode = burstMode
      self.from = from
      self.tStart = tStart
      self.tImpact = tImpact
      self.tDeath = tDeath
    }
  }

  /// `_write(i, s)`: the star as 32 vec4 rows, as `add` writes them.
  public static func rows(_ star: Star) -> [Float] {
    [Float](repeating: 0, count: floats)
  }

  /// `#rrggbb` as the engine's `hex` reads it (:9): each channel / 255, then a float32.
  public static func rgb(_ hex: String) -> SIMD3<Float> {
    SIMD3(0, 0, 0)
  }
}
