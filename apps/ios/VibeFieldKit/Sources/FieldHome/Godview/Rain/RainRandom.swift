import FieldDesign
import Foundation

// PG-8 — THE RAIN'S DICE: `Math.random()`'s place in the rain (puppeteer-views 0.3.3 dist `views/rain/RainView.js`: a
// new drop's row then its speed, :71, and one draw per glyph in a moving frame, :185, plus one more for a scrambled
// glyph, `matrixGlyph` :6).
// The live rain rolls the system's; a still, a golden and a hand row roll `Mulberry32`, the golden's own generator
// (`phone-goldens-rain.ts`, `mulberry32(RAIN_SEED)`), so the phone replays the desktop's field draw for draw. No `#if`
// here: only DEBUG code names the launch flag (GodviewViewChoice.swift's pattern).

/// Where the rain's randomness comes from: one double in [0, 1) per call, as `Math.random()` gives.
protocol RainRandom {
  mutating func next() -> Double
}

/// The live rain's: the system's generator.
struct SystemRainRandom: RainRandom, Sendable {
  mutating func next() -> Double { Double.random(in: 0..<1) }
}

/// mulberry32 (FieldDesign's, since IOS-12b: the spark face deals from the same transcription) rolls the rain's seeded
/// dice.
extension Mulberry32: RainRandom {}

extension Mulberry32 {
  /// `-vf-godview-rain-seed=<n>` (fd's Q7): the seed a still is rolled with.
  static let argument = "-vf-godview-rain-seed"

  /// The first `-vf-godview-rain-seed=<n>`: a seeded generator, or nil when it is absent or names no 32-bit word (the
  /// caller rolls the system's). Matched with its `=`, so a longer flag never parses as this one.
  static func launch(_ arguments: [String]) -> Mulberry32? {
    let prefix = argument + "="
    guard let text = arguments.first(where: { $0.hasPrefix(prefix) })?.dropFirst(prefix.count),
      let seed = UInt32(text)
    else { return nil }
    return Mulberry32(seed: seed)
  }
}
