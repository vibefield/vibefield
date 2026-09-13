import FieldAgents
import FieldDesign
import SwiftUI
import UIKit

/// The swarm's colours as numbers — the reference's `SwarmTheme`, resolved
/// from the same tokens `FieldPalette` projects (DESIGN.md §2.7 and the
/// reference's theme-scoped `--blocked-*` pair) rather than transcribed a
/// second time. A Metal surface can inherit no colour, so the palette is
/// resolved once per colour scheme, exactly as the reference resolves its
/// tokens once per theme.
public struct SwarmTheme: Equatable, Sendable {
  public struct Tier: Equatable, Sendable {
    public var bg: SwarmColor
    public var text: SwarmColor
    public var border: SwarmColor
  }

  public var idle: Tier
  public var working: Tier
  public var blocked: Tier
  /// The field's faint 24pt grid.
  public var grid: SwarmColor
  public var textMain: SwarmColor
  public var textMuted: SwarmColor
  /// The ramp a session with no project wears: a colour that is not a colour.
  public var neutral: SwarmColor
  public var panelBg: SwarmColor
  /// §2.5's orange: the blocked reply's dot, the hot figure, the blocker kind.
  public var orange: SwarmColor
  /// The branch dot's green.
  public var green: SwarmColor
  /// §2.5's select blue: the unread reply's dot.
  public var blue: SwarmColor
  /// The working body's drop shadow at rest and at its breathing peak: black
  /// on a light ground, white on a dark one.
  public var shadow: SwarmColor
  public var shadowPeak: SwarmColor
  /// The project tint for this scheme (`--tint-l`, `--tint-c`).
  public var tint: ProjectTint

  public static func resolve(_ scheme: ColorScheme) -> SwarmTheme {
    let traits = UITraitCollection(userInterfaceStyle: scheme == .dark ? .dark : .light)
    func color(_ value: Color) -> SwarmColor {
      var r: CGFloat = 0
      var g: CGFloat = 0
      var b: CGFloat = 0
      var a: CGFloat = 0
      UIColor(value).resolvedColor(with: traits).getRed(&r, green: &g, blue: &b, alpha: &a)
      return SwarmColor(r: Double(r), g: Double(g), b: Double(b), a: Double(a))
    }
    let panelBg = color(FieldPalette.panelBackground)
    let light = panelBg.luminance > 0.5
    return SwarmTheme(
      idle: Tier(bg: color(FieldPalette.idleBackground), text: color(FieldPalette.idleText), border: color(FieldPalette.idleText)),
      working: Tier(
        bg: color(FieldPalette.workingBackground), text: color(FieldPalette.workingText),
        border: color(FieldPalette.workingBorder)),
      blocked: Tier(
        bg: color(FieldPalette.blockedBackground), text: color(FieldPalette.blockedText),
        border: color(FieldPalette.blockedText)),
      grid: color(FieldPalette.gridLine),
      textMain: color(FieldPalette.textMain),
      textMuted: color(FieldPalette.textMuted),
      neutral: color(FieldPalette.textFaint),
      panelBg: panelBg,
      orange: color(FieldPalette.orange),
      green: color(FieldPalette.branchGreen),
      blue: color(FieldPalette.selectBlue),
      shadow: light ? SwarmColor(r: 0, g: 0, b: 0, a: 0.18) : SwarmColor(r: 1, g: 1, b: 1, a: 0.12),
      shadowPeak: light ? SwarmColor(r: 0, g: 0, b: 0, a: 0.34) : SwarmColor(r: 1, g: 1, b: 1, a: 0.3),
      tint: scheme == .dark ? .dark : .light)
  }
}
