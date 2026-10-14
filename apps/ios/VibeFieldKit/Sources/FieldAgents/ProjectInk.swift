import Foundation

// PJ-7 — THE PROJECT INK (DESIGN.md §2.9; PJ-L7, PJ-D5 (a)), the design kit's
// `packages/design-kit/src/project-ink.ts` ported: the one map from a project's
// dealt number — `ProjectSummary.ink`, in [0, PROJECT_GROUPING.INK_DEALS) — to
// its colour, the same on every surface. Only the hue is the project's, and
// only the cool half of the OKLCH wheel is free: 350°→180° is state's (§2.5)
// and 238°–265° the selection's. The deal walks the golden ratio across the two
// arcs that are left. Lightness and chroma are the theme's — `ProjectTint`'s
// two rows are DESIGN.md's `--vf-project-ink-l` / `-c` (0.60 · 0.74, 0.15).
// Held to the kit by one golden table both sides read (`ProjectInkTests`).
//
// It supersedes, on the phone's History, the per-device deal by sequence
// (`ProjectTint`'s `projectHue`, D-i13), which the swarm keeps until PJ-5.

/// The arcs a project's hue is dealt on, in order (OKLCH degrees).
public let projectInkArcs: [(from: Double, to: Double)] = [(180, 238), (265, 350)]

private let inkGolden = 0.6180339887498949
/// Where the walk starts: the PJ page's own `projectHue`.
private let inkStart = 0.12
private let inkSpan = projectInkArcs.reduce(0) { $0 + ($1.to - $1.from) }

/// The hue (OKLCH degrees) of a project's dealt number; a negative number is
/// read from 0.
public func projectInkHue(_ ink: Int) -> Double {
  let seq = Double(max(0, ink))
  var along = ((inkStart + seq * inkGolden).truncatingRemainder(dividingBy: 1) + 1)
    .truncatingRemainder(dividingBy: 1) * inkSpan
  for arc in projectInkArcs {
    if along < arc.to - arc.from { return arc.from + along }
    along -= arc.to - arc.from
  }
  // only a rounding at the very end of the last arc lands here
  return projectInkArcs.last?.to ?? 0
}

/// The project's colour as sRGB hex under the theme's tone; a hue sRGB cannot
/// reach at that chroma keeps its hue and lightness and gives up chroma.
public func projectInkHex(_ ink: Int, _ tint: ProjectTint) -> String {
  oklchToHex(l: tint.l, c: tint.c, hueDegrees: projectInkHue(ink))
}

extension SwarmColor {
  /// A project's ink as the value a view draws.
  public static func projectInk(_ ink: Int, _ tint: ProjectTint) -> SwarmColor {
    SwarmColor(hex: projectInkHex(ink, tint)) ?? .black
  }
}
