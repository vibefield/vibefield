import Foundation

// IOS-12b (PC-D6 A; DESIGN.md §2.10) — A SPARK'S FACE, DEALT ON THE PHONE: the desktop's vendored engine
// (`packages/design-kit/src/spark-face/vendor/sparks.js`, James's Agent Sparks byte for byte) transcribed, so a spark
// wears the same face on both. Held row for row to IOS-12a's golden (`spark-dna.golden.json`, SparkDnaGoldenTests).
// Every draw is the engine's, in the engine's order: a reordered draw is a different face.
//
// The engine seeds its generator with `seed * 31 + 17` (and `* 13 + 5`, `* 7 + 3`), a JavaScript number the
// generator's first `| 0` wraps to 32 bits; `dealt(_:_:_:)` does the same in UInt64, where the product is exact.

/// What `agentDNA(seed)` deals: the curated slice of the engine's DNA space every spark is hatched from.
public struct SparkDNA: Equatable, Sendable {
  /// The star's traits (`dna.body`).
  public struct Body: Equatable, Sendable {
    public let n: Int
    public let core, reach, hw, tip, k, jitter, rot: Double
    /// The long point's index, or -1.
    public let hero: Int
    public let heroLen, heroBend: Double
    /// Agent sparks have no stub (-1).
    public let stub: Int
  }

  /// The eyes' traits (`dna.eyes`).
  public struct Eyes: Equatable, Sendable {
    public let gap, y, w, h: Double
    /// 0, a pill; 1, a round eye.
    public let shape: Int
    public let tilt: Double
  }

  public let seed: UInt32
  /// Its place among the first twelve palettes (`SparkEngine.palettes`).
  public let palette: Int
  public let body: Body
  public let eyes: Eyes
}

/// One point of the star, in the star's radii (`[angle, length, halfWidth, bend]`).
public struct SparkPoint: Equatable, Sendable {
  public let angle, length, halfWidth, bend: Double
}

/// What `makeBody(seed, dna.body)` builds: the star's points.
public struct SparkBody: Equatable, Sendable {
  public let n: Int
  public let core, k, tip: Double
  public let points: [SparkPoint]
}

/// What `makeEyes(seed, dna.eyes)` builds: the DNA's eyes, open and looking ahead, and where the mouth sits.
public struct SparkEyes: Equatable, Sendable {
  public let gap, y, w, h: Double
  public let shape: Int
  public let tilt, lidY, lidAng, lookX, lookY, mouthY: Double
}

/// One of the engine's palettes, as a face draws it: `c` (flat body, glow centre, glow mid, glow rim, aura, frost tint,
/// prop ink, blush) and `deep` (the framed disc, top then bottom), each `#rrggbb`.
public struct SparkPalette: Equatable, Sendable {
  public let name: String
  public let c: [String]
  public let deep: [String]
}

public enum SparkEngine {
  /// `agentDNA(seed)`: the star's and the eyes' traits and the palette, in the engine's draw order.
  public static func agentDNA(_ seed: UInt32) -> SparkDNA {
    var r = dealt(seed, 31, 17)
    let n = [5, 5, 5, 6, 6, 7][Int((r.next() * 6).rounded(.down))]
    let core = 0.6 + r.next() * 0.06
    let reach = 0.9 + r.next() * 0.1
    let hw = 0.44 + r.next() * 0.08
    let tip = 0.4 + r.next() * 0.16
    let k = 0.12 + r.next() * 0.06
    let jitter = 0.04 + r.next() * 0.18
    let rot = Double.pi / 2 + (r.next() - 0.5) * 0.3
    let hero = r.next() < 0.22 ? Int((r.next() * Double(n)).rounded(.down)) : -1
    let heroLen = 1.08 + r.next() * 0.08
    let body = SparkDNA.Body(
      n: n, core: core, reach: reach, hw: hw, tip: tip, k: k, jitter: jitter, rot: rot, hero: hero,
      heroLen: heroLen, heroBend: 0.14, stub: -1)
    let big = r.next()
    let gap = 0.34 + r.next() * 0.08
    let y = -0.06 + r.next() * 0.08
    let w = 0.088 + big * 0.03
    let h = 0.17 + big * 0.05
    let shape = r.next() < 0.7 ? 0 : 1
    let tilt = r.next() < 0.12 ? (r.next() - 0.5) * 0.5 : 0
    let eyes = SparkDNA.Eyes(gap: gap, y: y, w: w, h: h, shape: shape, tilt: tilt)
    let palette = Int((r.next() * 12).rounded(.down))
    return SparkDNA(seed: seed, palette: palette, body: body, eyes: eyes)
  }

  /// `makeBody(seed, dna.body)`: the star's points. Every trait comes from the DNA, so the engine's own defaults (and
  /// their draws) are never reached; only the loop draws.
  public static func makeBody(_ seed: UInt32, _ traits: SparkDNA.Body) -> SparkBody {
    var r = dealt(seed, 13, 5)
    let n = traits.n
    let hw = traits.hw * (5 / Double(n)).squareRoot()
    let tau = Double.pi * 2
    var points: [SparkPoint] = []
    points.reserveCapacity(n)
    for i in 0..<n {
      let angle = traits.rot + (Double(i) + (r.next() - 0.5) * traits.jitter) * tau / Double(n)
      var length = traits.reach * (0.92 + r.next() * 0.16)
      var width = hw * (0.9 + r.next() * 0.2)
      var bend = (r.next() - 0.5) * 0.18
      if i == traits.hero {
        length *= traits.heroLen
        width *= 1.04
        bend += traits.heroBend * (r.next() < 0.5 ? -1 : 1)
      }
      if i == traits.stub && i != traits.hero {
        length *= 0.8
        width *= 0.86
      }
      points.append(SparkPoint(angle: angle, length: length, halfWidth: width, bend: bend))
    }
    return SparkBody(n: n, core: traits.core, k: traits.k, tip: traits.tip, points: points)
  }

  /// `makeEyes(seed, dna.eyes)`: the engine deals eyes of its own and then lays the DNA's over them
  /// (`Object.assign`), so what stands is the DNA's eyes, the lids open, the look ahead, and the mouth under them.
  public static func makeEyes(_ seed: UInt32, _ traits: SparkDNA.Eyes) -> SparkEyes {
    SparkEyes(
      gap: traits.gap, y: traits.y, w: traits.w, h: traits.h, shape: traits.shape, tilt: traits.tilt, lidY: 1,
      lidAng: 0, lookX: 0, lookY: 0, mouthY: -(traits.h * 0.85 + 0.07))
  }

  /// The engine's generator for `seed * a + b`, wrapped to 32 bits as the generator's first `| 0` wraps it.
  static func dealt(_ seed: UInt32, _ a: UInt64, _ b: UInt64) -> Mulberry32 {
    Mulberry32(seed: UInt32(truncatingIfNeeded: UInt64(seed) * a + b))
  }

  /// The first twelve of the engine's palettes, the ones `agentDNA` deals from (`PALETTES.slice(0, 12)`), generated
  /// from the golden. A spark draws `c` and `deep`; the engine's `sky` is never drawn, so it is not here.
  public static let palettes: [SparkPalette] = [
    SparkPalette(
      name: "Periwinkle",
      c: ["#5468ff", "#3f6ff7", "#7fb4fc", "#eef4ff", "#a9a4ff", "#c9d3ff", "#6c7bff", "#ff8fc8"],
      deep: ["#2433b8", "#3f6ff7"]),
    SparkPalette(
      name: "Eclipse",
      c: ["#1b1636", "#170f3a", "#fd307f", "#ffe1ee", "#16e9de", "#ffd3e6", "#ff4f9a", "#ff5c9a"],
      deep: ["#0c0928", "#24124f"]),
    SparkPalette(
      name: "Mint Kiss",
      c: ["#2fd28a", "#1fc47d", "#8ef0bd", "#f3fff8", "#f68ce1", "#c9f6df", "#16b874", "#ff8cc6"],
      deep: ["#0b9a60", "#1fc47d"]),
    SparkPalette(
      name: "Lagoon",
      c: ["#1688ff", "#00a8f8", "#49cdfe", "#e7f8ff", "#6fd6ff", "#a8daf8", "#1a9bff", "#ff9ec4"],
      deep: ["#0090ec", "#01b2fe"]),
    SparkPalette(
      name: "Ember",
      c: ["#e0157e", "#b302ad", "#fc495c", "#ffe6dc", "#ff7a9a", "#ffc9dd", "#ff3f78", "#ffb0a0"],
      deep: ["#68019a", "#b302ad"]),
    SparkPalette(
      name: "Sorbet",
      c: ["#ff6f7d", "#f84a9e", "#ffa384", "#fff1ea", "#ff9a7a", "#ffd6dc", "#ff5a86", "#ff6f91"],
      deep: ["#de3584", "#f84a9e"]),
    SparkPalette(
      name: "Lilac Cream",
      c: ["#a07be6", "#8e62dc", "#d6b6ea", "#fffbef", "#c7a2f7", "#ece3ff", "#9a6be6", "#ff9fd0"],
      deep: ["#6f46c2", "#8e62dc"]),
    SparkPalette(
      name: "Citrine",
      c: ["#ff7a1f", "#f0602a", "#f9c46b", "#fff6d8", "#ffab4a", "#ffe3bf", "#ff7a1f", "#ff8f8f"],
      deep: ["#d44a1a", "#f0602a"]),
    SparkPalette(
      name: "Aurora",
      c: ["#1fc49b", "#16b88d", "#9df5a0", "#f8ffdc", "#b4f26e", "#d2f9e5", "#13b088", "#ff9fb8"],
      deep: ["#0a8c6d", "#16b88d"]),
    SparkPalette(
      name: "Orchid",
      c: ["#b65ad6", "#a24ccc", "#df9ff2", "#fbefff", "#9ae8a9", "#f1dcff", "#b552e0", "#ff9fd8"],
      deep: ["#7a2fa3", "#a24ccc"]),
    SparkPalette(
      name: "Nebula",
      c: ["#6c78ec", "#5f55e2", "#a48ff0", "#f2eeff", "#f2a6ff", "#dedcff", "#7470f0", "#ff9fe0"],
      deep: ["#3d36c4", "#5f55e2"]),
    SparkPalette(
      name: "Rose Noir",
      c: ["#d4245c", "#2a0718", "#e8174f", "#ffd9e3", "#ff4f7a", "#ffd3df", "#ff3f6f", "#ff7aa0"],
      deep: ["#1a0612", "#4a0d2c"]),
  ]
}
