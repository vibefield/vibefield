import FieldAgents
import Foundation

// PG-7 — THE TWO INKS SPEND DERIVES FROM A ROW'S PROJECT COLOUR, transcribed from puppeteer-views 0.3.3 at the pin
// `52d09c8e` (the spend module `5abe8f75`): `src/views/spend/spend-ink.ts` (dist `spend-ink.js` :9-49). Held to
// `phone-spend.golden.json` (SpendParityTests P6, V8).
// RED SKELETON (pair 3): placeholder returns, so the rows fail by assertion.

enum SpendInk {
  /// OKLCH: lightness, chroma, hue in degrees.
  struct Oklch: Equatable, Sendable {
    let l: Double
    let c: Double
    let h: Double
  }

  /// One row as `siblingIndex` reads it.
  struct Born: Equatable, Sendable {
    let id: String
    let project: String
    let bornMs: Double
  }

  static func rgbToOklch(_ colour: SwarmColor) -> Oklch { Oklch(l: 0, c: 0, h: 0) }

  static func siblingTone(_ colour: SwarmColor, sib: Int, dark: Bool) -> SwarmColor { .black }

  static func liftedFill(_ colour: SwarmColor, sib: Int) -> String { "" }

  static func siblingIndex(_ rows: [Born]) -> [String: Int] { [:] }
}
