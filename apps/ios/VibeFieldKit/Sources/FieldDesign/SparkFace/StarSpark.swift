import Foundation

// IOS-12f's f5 (PC-D8 A; DESIGN.md §2.10, amended 2026-11-07) — THE HATCH'S STAR: the desktop's vendored star engine's
// CPU half (`packages/design-kit/src/spark-face/vendor/star-spark.js`, James's Star Spark, vendored byte for byte;
// sha256 e4c142f2b52e8b52f4cda371232bda9aaa211c7c9535e07f18a63a19b0d9ead6) transcribed: its twelve palettes and its
// confetti, its layer bits, `makeDNA` (:43) and `_write` (:593). A star's rows are written once, when it is added;
// every motion after that is `HatchSky.metal`'s, a pure function of the rows and the time. Held float for float to
// the hatch's rows golden (`spark-hatch.golden.json`, SparkHatchGoldenTests).

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
  public static let palettes: [Palette] = [
    Palette(
      name: "Periwinkle", dark: false,
      c: [
        "#4092f9", "#6fb2fb", "#a4defd", "#d8fbff", "#ffffff", "#5a47f6", "#f1e4ff", "#a9a4ff", "#6c8cff", "#ffffff",
      ]),
    Palette(
      name: "Eclipse", dark: true,
      c: [
        "#f6f7f9", "#fc9fc5", "#fd307f", "#a00951", "#0c0928", "#16e9de", "#2a9ff6", "#5a2fc0", "#3c5ce8", "#89fae4",
      ]),
    Palette(
      name: "Mint Kiss", dark: false,
      c: [
        "#a9f5c8", "#d9d2e0", "#f3a6e2", "#f68ce1", "#ffe3f7", "#3fdc96", "#eafff2", "#7debb3", "#6fe6b0", "#fff0fb",
      ]),
    Palette(
      name: "Lagoon", dark: false,
      c: [
        "#2fd3fc", "#1ea4fd", "#3e7dfb", "#7660fc", "#c9bcff", "#c8fbff", "#4fd8ff", "#2a6bff", "#2fb8ff", "#e0fbff",
      ]),
    Palette(
      name: "Ember", dark: false,
      c: [
        "#8502bf", "#b302ad", "#e0157e", "#fc495c", "#ffc6a0", "#3d0b8f", "#ff7a9a", "#6a1bd6", "#ff4f7a", "#ffd2b0",
      ]),
    Palette(
      name: "Sorbet", dark: false,
      c: [
        "#ffa384", "#fe7590", "#f84a9e", "#f732a6", "#ffd1ee", "#ff6a3d", "#ffe0cc", "#ff9a7a", "#ff8fa3", "#fff1e6",
      ]),
    Palette(
      name: "Lilac Cream", dark: false,
      c: [
        "#c9a0f2", "#dcb8e2", "#ecd0cc", "#f9e2b9", "#fffbea", "#9a6de0", "#fff1d8", "#c7a2f7", "#b99cff", "#fffbea",
      ]),
    Palette(
      name: "Citrine", dark: false,
      c: [
        "#f7c36b", "#ef8a4c", "#e6503c", "#ef4f7f", "#ffe2ec", "#ffcf5a", "#fff2b8", "#ff8f4a", "#ffab4a", "#fff6d6",
      ]),
    Palette(
      name: "Aurora", dark: false,
      c: [
        "#d4ff5e", "#9df5a0", "#4fe3cf", "#79e6ff", "#f0fffb", "#29c79a", "#f4ffc0", "#b4f26e", "#5ef0c0", "#f8ffd8",
      ]),
    Palette(
      name: "Orchid", dark: false,
      c: [
        "#9ae8a9", "#a9a98c", "#a8687a", "#b86bb3", "#ebb8ff", "#61d79a", "#f3dcff", "#c06cf5", "#c86ef9", "#f3dcff",
      ]),
    Palette(
      name: "Nebula", dark: false,
      c: [
        "#c483ea", "#9a80e6", "#7482ea", "#8ca0f6", "#edf0ff", "#f2a6ff", "#ffd9f6", "#7682ec", "#9b8cff", "#ffe6fb",
      ]),
    Palette(
      name: "Rose Noir", dark: true,
      c: [
        "#ffd6e0", "#ff6f8e", "#e8174f", "#6d0a2e", "#140612", "#ff9ec0", "#ff4f7a", "#7a1f5c", "#ff5c8a", "#ffc2d4",
      ]),
  ]

  /// `CONFETTI` (:26).
  public static let confetti = [
    "#ffd84a", "#ff6f91", "#5fe08f", "#5cc8ff", "#8fb5ff", "#ffa25c", "#c9a2ff", "#ffffff",
  ]

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

  struct Spike: Equatable {
    let ang, len, hw, tip, bend: Double
  }

  struct Orb: Equatable {
    let ang, dist, size, speed: Double
  }

  /// A star's shape: everything random about it, decided from its seed alone (`makeDNA`, :43).
  struct DNA: Equatable {
    let seed: UInt32
    let n: Int
    let spikes: [Spike]
    let orbCount: Int
    let orbs: [Orb]
    let coreR, k, warp: Double
    let blob: (x: Double, y: Double, r: Double)
    let sheen, hue: Double
    let palette: Int
    let seedF: Double

    static func == (a: DNA, b: DNA) -> Bool {
      a.seed == b.seed && a.n == b.n && a.spikes == b.spikes && a.orbCount == b.orbCount && a.orbs == b.orbs
        && a.coreR == b.coreR && a.k == b.k && a.warp == b.warp && a.blob == b.blob && a.sheen == b.sheen
        && a.hue == b.hue && a.palette == b.palette && a.seedF == b.seedF
    }
  }

  /// `makeDNA(seed)`, draw for draw: the engine's mulberry32 seeded with `(seed * 2654435761) >>> 0`. The product is
  /// exact in a double for every seed under 3,393,000 (the hatch deals 1…999,999), so the wrapping multiply here is
  /// the engine's.
  static func makeDNA(_ seed: UInt32) -> DNA {
    let tau = Double.pi * 2
    var r = Mulberry32(seed: UInt32(truncatingIfNeeded: UInt64(seed) &* 2_654_435_761))
    let n = [6, 7, 7, 8, 8, 8, 9][Int(floor(r.next() * 7))]
    let base = r.next() * tau
    let hero = Int(floor(r.next() * Double(n)))
    let stub = (hero + 1 + Int(floor(r.next() * Double(n - 1)))) % n
    var spikes: [Spike] = []
    for i in 0..<n {
      let jitter = (r.next() - 0.5) * 0.62
      let ang = base + (Double(i) + jitter) * (tau / Double(n))
      let fat = (8 / Double(n)).squareRoot()
      var len = 0.68 + r.next() * 0.3
      var hw = (0.25 + r.next() * 0.08) * fat
      let tip = 0.035 + r.next() * 0.035
      if i == hero {
        len = 1.05 + r.next() * 0.2
        hw = (0.33 + r.next() * 0.08) * fat
      } else if i == stub && r.next() < 0.75 {
        len = 0.5 + r.next() * 0.08
        hw = (0.17 + r.next() * 0.05) * fat
      }
      spikes.append(Spike(ang: ang, len: len, hw: hw, tip: tip, bend: (r.next() - 0.5) * 0.22))
    }
    let orbCount = r.next() < 0.42 ? 0 : r.next() < 0.78 ? 1 : 2
    var orbs: [Orb] = []
    for _ in 0..<2 {
      let ang = r.next() * tau
      let dist = 1.3 + r.next() * 0.55
      let size = 0.075 + r.next() * 0.065
      let sign: Double = r.next() < 0.5 ? -1 : 1
      orbs.append(Orb(ang: ang, dist: dist, size: size, speed: sign * (0.05 + r.next() * 0.09)))
    }
    let ba = r.next() * tau
    let bd = 0.05 + r.next() * 0.1
    let coreR = 0.36 + r.next() * 0.07
    let k = 0.08 + r.next() * 0.05
    let warp = 0.012 + r.next() * 0.014
    let blob = (x: cos(ba) * bd, y: sin(ba) * bd, r: 0.27 + r.next() * 0.1)
    let sheen = r.next() * tau
    let hue = (r.next() - 0.5) * 0.22
    let palette = Int(floor(r.next() * Double(palettes.count)))
    let seedF = 1 + (Double(seed) * 0.6180339887).truncatingRemainder(dividingBy: 1) * 97
    return DNA(
      seed: seed, n: n, spikes: spikes, orbCount: orbCount, orbs: orbs, coreR: coreR, k: k, warp: warp, blob: blob,
      sheen: sheen, hue: hue, palette: palette, seedF: seedF)
  }

  /// `_write(i, s)`: the star as 32 vec4 rows, as `add` writes them.
  public static func rows(_ star: Star) -> [Float] {
    let dna = makeDNA(star.seed)
    var rows = [Float](repeating: 0, count: floats)
    func set(_ i: Int, _ a: Double, _ b: Double, _ c: Double, _ d: Double) {
      rows[i * 4] = Float(a)
      rows[i * 4 + 1] = Float(b)
      rows[i * 4 + 2] = Float(c)
      rows[i * 4 + 3] = Float(d)
    }
    set(0, star.x, star.y, star.R, dna.seedF)
    set(1, star.tStart, star.tImpact, star.tDeath, 1)
    set(2, star.from.x, star.from.y, Double(star.palette), star.hue ?? dna.hue)
    set(3, Double(dna.n), dna.coreR, dna.k, dna.warp)
    set(4, dna.blob.x, dna.blob.y, dna.blob.r, Double(dna.orbCount))
    for (k, orb) in dna.orbs.enumerated() { set(5 + k, orb.ang, orb.dist, orb.size, orb.speed) }
    set(7, Double(star.mask), Double(star.burstMode), dna.sheen, palettes[star.palette].dark ? 1 : 0)
    let travel = atan2(star.y - star.from.y, star.x - star.from.x)
    for (k, spike) in dna.spikes.enumerated() {
      set(8 + k * 2, spike.ang, spike.len, spike.hw, spike.tip)
      let delay =
        0.03 + 0.11 * (SparkBuddy.angDist(spike.ang, travel) / Double.pi)
        + (Double(k) * 0.37).truncatingRemainder(dividingBy: 1) * 0.02
      set(9 + k * 2, spike.bend, delay, 0, 0)
    }
    return rows
  }

  /// `#rrggbb` as the engine's `hex` reads it (:9): each channel / 255, then a float32.
  public static func rgb(_ hex: String) -> SIMD3<Float> {
    let digits = Array(hex.utf8.dropFirst())
    func channel(_ at: Int) -> Float {
      let text = String(decoding: digits[at..<(at + 2)], as: UTF8.self)
      return Float(Double(Int(text, radix: 16) ?? 0) / 255)
    }
    return SIMD3(channel(0), channel(2), channel(4))
  }
}
