import FieldAgents
import Foundation

// PG-7 — THE TWO INKS SPEND DERIVES FROM A ROW'S PROJECT COLOUR, transcribed from puppeteer-views 0.3.3 at the pin
// `52d09c8e` (the spend module `5abe8f75`): `src/views/spend/spend-ink.ts` (dist `spend-ink.js` :9-49). Nothing new
// crosses the seam (SV-D4): a sibling's TONE — the second agent born in a project a step darker, the third and on a
// step lighter, so three rosetta lines can be told apart while all three read as rosetta — and a FILL, the hue lifted
// so the ink's own dark text reads on it (the tag at a pointed head). The first keeps the host's colour as it is.
// `oklchToHex` is FieldAgents' (the deal's own, `ProjectTint.swift`), `parseCssColor`'s hex branch is
// `SwarmColor(hex:)`. Held to `phone-spend.golden.json` (SpendParityTests P6, V8).

enum SpendInk {
  /// The lightness step per sibling, in OKLCH L: the first keeps the host's colour (`TONE_STEP`).
  private static let toneStepLight = [0, -0.1, 0.1]
  private static let toneStepDark = [0, -0.1, 0.08]

  /// OKLCH: lightness, chroma, hue in degrees.
  struct Oklch: Equatable, Sendable {
    let l: Double
    let c: Double
    let h: Double
  }

  /// One row as `siblingIndex` reads it: its id, its project's name, its birth.
  struct Born: Equatable, Sendable {
    let id: String
    let project: String
    let bornMs: Double
  }

  private static func toLinear(_ channel: Double) -> Double {
    channel <= 0.04045 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
  }

  /// `rgbToOklch` (:13): sRGB (0–1) to OKLCH, in JavaScript's order of operations.
  static func rgbToOklch(_ colour: SwarmColor) -> Oklch {
    let r = toLinear(colour.r)
    let g = toLinear(colour.g)
    let b = toLinear(colour.b)
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    let lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    let a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    let bee = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    let h = (atan2(bee, a) * 180) / .pi
    return Oklch(l: lightness, c: hypot(a, bee), h: h < 0 ? h + 360 : h)
  }

  /// `siblingTone` (:27): `sib` 0 is the colour itself, 1 a step darker, 2 and on a step lighter.
  static func siblingTone(_ colour: SwarmColor, sib: Int, dark: Bool) -> SwarmColor {
    if sib <= 0 { return colour }
    let ink = rgbToOklch(colour)
    let step = (dark ? toneStepDark : toneStepLight)[Swift.min(sib, 2)]
    let hex = oklchToHex(l: Swift.min(0.9, Swift.max(0.3, ink.l + step)), c: ink.c, hueDegrees: ink.h)
    return SwarmColor(hex: hex) ?? colour
  }

  /// `liftedFill` (:35): the colour lifted to a light fill its own dark text reads on, in both themes (a hex).
  static func liftedFill(_ colour: SwarmColor, sib: Int) -> String {
    oklchToHex(l: 0.83 - Double(Swift.min(sib, 2)) * 0.035, c: 0.085, hueDegrees: rgbToOklch(colour).h)
  }

  /// `siblingIndex` (:40): the order each agent was born in among its project's priced agents; equal births by id
  /// (JavaScript's `<`, UTF-16 units). A project is one by its exact units, as a JavaScript Map keys it.
  static func siblingIndex(_ rows: [Born]) -> [String: Int] {
    let sorted = SpendList.stableSorted(rows) { a, b in
      SpendList.or(a.bornMs - b.bornMs, a.id.utf16.lexicographicallyPrecedes(b.id.utf16) ? -1 : 1)
    }
    var seen: [[UInt16]: Int] = [:]
    var out: [String: Int] = [:]
    for row in sorted {
      let project = Array(row.project.utf16)
      let n = seen[project] ?? 0
      out[row.id] = n
      seen[project] = n + 1
    }
    return out
  }
}
