import Foundation

// A project's colour, dealt from its sequence (design-system record §02) —
// the reference's `colour/project-tint.ts`, transcribed with goldens generated
// from it (`ProjectTintTests`).
//
// The host deals the sequence the first time an agent runs in a project and
// keeps it for life (`ProjectLedger`); this file turns it into a colour. Only
// the hue is the project's: lightness and chroma are the theme's, so no project
// is louder than another and each is the same colour in light and dark. The hue
// is DEALT along the golden ratio rather than hashed from the path, because a
// hash clusters and the golden ratio keeps every prefix of the sequence spread.
// A 27° band around `--vf-select` is withheld so no project can be mistaken for
// the selection colour.

/// The theme's lightness and chroma (`--tint-l`, `--tint-c`).
public struct ProjectTint: Equatable, Sendable {
  public var l: Double
  public var c: Double

  public init(l: Double, c: Double) {
    self.l = l
    self.c = c
  }

  /// The record's own numbers for the two themes. The phone carries them here
  /// rather than reading a token, because a SwiftUI colour scheme is not a
  /// stylesheet; DESIGN.md is the authority when they move.
  public static let light = ProjectTint(l: 0.6, c: 0.15)
  public static let dark = ProjectTint(l: 0.74, c: 0.15)
}

/// Where the dealing starts: the first project lands just past the withheld band.
private let tintHue0 = 258.0
/// The withheld band: 27° from here, centred on `--vf-select` (252°).
private let tintSkipAt = 238.0
private let tintSkipWidth = 27.0
/// The wheel less the band.
private let tintSpan = 360.0 - tintSkipWidth
private let golden = 0.6180339887498949
/// The pane wheel starts half a golden turn on, so the first pane and the first
/// project never share a hue.
private let paneWheelOffset = 0.5

/// `hue(seq) = (258 + seq · φ · 333) mod 333`, skipping the band.
public func projectHue(_ seq: Double) -> Double {
  let raw = (tintHue0 + seq * golden * tintSpan).truncatingRemainder(dividingBy: tintSpan)
  let position = (raw + tintSpan).truncatingRemainder(dividingBy: tintSpan)
  return position < tintSkipAt ? position : position + tintSkipWidth
}

public func projectHue(_ seq: Int) -> Double { projectHue(Double(seq)) }

/// The pane wheel: the same walk as the projects', a parallel sequence, offset
/// so the two never start together.
public func paneHue(_ seq: Int) -> Double { projectHue(Double(seq) + paneWheelOffset) }

private func linearToSrgb(_ channel: Double) -> Double {
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * pow(channel, 1 / 2.4) - 0.055
}

/// OKLCH → linear sRGB, unclamped, so a caller can tell an out-of-gamut colour.
private func oklchToLinearSrgb(l: Double, c: Double, hueDegrees: Double) -> (Double, Double, Double) {
  let hue = hueDegrees * .pi / 180
  let a = c * cos(hue)
  let b = c * sin(hue)
  let l_ = l + 0.3963377774 * a + 0.2158037573 * b
  let m_ = l - 0.1055613458 * a - 0.0638541728 * b
  let s_ = l - 0.0894841775 * a - 1.291485548 * b
  let cubeL = l_ * l_ * l_
  let cubeM = m_ * m_ * m_
  let cubeS = s_ * s_ * s_
  return (
    4.0767416621 * cubeL - 3.3077115913 * cubeM + 0.2309699292 * cubeS,
    -1.2684380046 * cubeL + 2.6097574011 * cubeM - 0.3413193965 * cubeS,
    -0.0041960863 * cubeL - 0.7034186147 * cubeM + 1.707614701 * cubeS
  )
}

private let gamutEpsilon = 0.0005

private func inGamut(_ rgb: (Double, Double, Double)) -> Bool {
  [rgb.0, rgb.1, rgb.2].allSatisfy { $0 >= -gamutEpsilon && $0 <= 1 + gamutEpsilon }
}

/// The sRGB hex for one OKLCH colour. A hue the theme's chroma cannot reach in
/// sRGB keeps its hue and lightness and gives up chroma until it fits, which is
/// what the engine does for the same `oklch()` text, so the record's page and
/// the app agree on every project.
public func oklchToHex(l: Double, c: Double, hueDegrees: Double) -> String {
  var rgb = oklchToLinearSrgb(l: l, c: c, hueDegrees: hueDegrees)
  if !inGamut(rgb) {
    var low = 0.0
    var high = c
    for _ in 0..<24 {
      let middle = (low + high) / 2
      let candidate = oklchToLinearSrgb(l: l, c: middle, hueDegrees: hueDegrees)
      if inGamut(candidate) {
        low = middle
        rgb = candidate
      } else {
        high = middle
      }
    }
  }
  func channel(_ value: Double) -> String {
    let encoded = linearToSrgb(max(0, min(1, value)))
    return String(format: "%02x", Int((max(0, min(1, encoded)) * 255).rounded()))
  }
  return "#\(channel(rgb.0))\(channel(rgb.1))\(channel(rgb.2))"
}

/// The colour of project `seq` under the theme's tint, as hex.
public func projectTint(_ seq: Int, _ tint: ProjectTint) -> String {
  oklchToHex(l: tint.l, c: tint.c, hueDegrees: projectHue(seq))
}

/// A pane's colour, dealt from its sequence on the pane wheel under the theme's tint.
public func paneTint(_ seq: Int, _ tint: ProjectTint) -> String {
  oklchToHex(l: tint.l, c: tint.c, hueDegrees: paneHue(seq))
}

extension SwarmColor {
  /// The same deal, as the value the model carries.
  public static func project(_ seq: Int, _ tint: ProjectTint) -> SwarmColor {
    SwarmColor(hex: projectTint(seq, tint)) ?? .black
  }

  public static func pane(_ seq: Int, _ tint: ProjectTint) -> SwarmColor {
    SwarmColor(hex: paneTint(seq, tint)) ?? .black
  }
}
