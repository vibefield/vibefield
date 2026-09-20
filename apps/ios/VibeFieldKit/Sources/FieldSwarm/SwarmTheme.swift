import FieldAgents
import FieldDesign
import SwarmPhysics
import SwiftUI
import UIKit

/// The swarm's colours as numbers — the reference's `SwarmTheme` after the
/// one-ink revision (2026-09-18), resolved from the same tokens `FieldPalette`
/// projects (DESIGN.md §2.7 and §2.5) rather than transcribed a second time.
/// A Metal surface can inherit no colour, so the palette is resolved once per
/// colour scheme, exactly as the reference resolves its tokens once per theme.
///
/// Two colours carry the whole greyscale: the surface every body wears and
/// the ink every mark is drawn in. `SwarmWeight` holds the ladder between them.
/// Nothing here is per-state, because no state inverts the theme.
public struct SwarmTheme: Equatable, Sendable {
  /// The state colours fit to be READ on this theme's surface.
  public struct StateInk: Equatable, Sendable {
    public var orange: SwarmColor
    public var green: SwarmColor
    public var blue: SwarmColor
  }

  /// A state colour as a body's light (or the ground under it): orange for a
  /// body that waits on the user, blue for a reply that arrived unseen.
  public struct StateLight: Equatable, Sendable {
    public var orange: SwarmColor
    public var blue: SwarmColor
  }

  /// Every agent body's fill, in both themes.
  public var surface: SwarmColor
  /// The one ink every mark and every letter is drawn in.
  public var ink: SwarmColor
  /// The field's faint 24pt grid.
  public var grid: SwarmColor
  /// The ramp a session with no project wears: a colour that is not a colour.
  public var neutral: SwarmColor
  /// The state colours at full chroma: what a body's LIGHT is made of.
  public var orange: SwarmColor
  public var green: SwarmColor
  public var blue: SwarmColor
  /// The same three, fit to be read as words and marks on this theme's surface.
  public var stateInk: StateInk
  /// The light a blocked or unread body gives: the hue at this theme's hot end.
  public var stateGlow: StateLight
  /// The ground it gives that light over: the same hue at this theme's calm end.
  public var stateGround: StateLight
  /// The working body's drop shadow at rest and at its breathing peak: black
  /// on a light ground, white on a dark one.
  public var shadow: SwarmColor
  public var shadowPeak: SwarmColor
  /// The project tint for this scheme (`--tint-l`, `--tint-c`).
  public var tint: ProjectTint

  public static func resolve(_ scheme: ColorScheme, parameters: SwarmParameters = .default) -> SwarmTheme {
    let traits = UITraitCollection(userInterfaceStyle: scheme == .dark ? .dark : .light)
    func color(_ value: Color) -> SwarmColor {
      var r: CGFloat = 0
      var g: CGFloat = 0
      var b: CGFloat = 0
      var a: CGFloat = 0
      UIColor(value).resolvedColor(with: traits).getRed(&r, green: &g, blue: &b, alpha: &a)
      return SwarmColor(r: Double(r), g: Double(g), b: Double(b), a: Double(a))
    }
    let ink = color(FieldPalette.textMain)
    // A dark ink means a light theme, and a light theme casts a black shadow.
    let light = ink.luminance < 0.5
    let orange = color(FieldPalette.orange)
    let green = color(FieldPalette.branchGreen)
    let blue = color(FieldPalette.selectBlue)
    // The two states that light a body up. One hue each, taken to the hot end
    // for the light and to the calm end for the ground it falls on.
    let orangeHue = vivid(orange, chroma: parameters.stateChroma)
    let blueHue = vivid(blue, chroma: parameters.stateChroma)
    return SwarmTheme(
      surface: color(FieldPalette.bodySurface),
      ink: ink,
      grid: color(FieldPalette.gridLine),
      neutral: color(FieldPalette.textFaint),
      orange: orange,
      green: green,
      blue: blue,
      stateInk: StateInk(
        orange: readable(orange, ink: ink, light: light),
        green: readable(green, ink: ink, light: light),
        blue: readable(blue, ink: ink, light: light)),
      stateGlow: StateLight(
        orange: stateGlowColour(orangeHue, light: light, parameters: parameters),
        blue: stateGlowColour(blueHue, light: light, parameters: parameters)),
      stateGround: StateLight(
        orange: stateGroundColour(orangeHue, light: light, parameters: parameters),
        blue: stateGroundColour(blueHue, light: light, parameters: parameters)),
      // agent-bubble.css's pre-blurred layers: black on light, white on dark.
      shadow: light ? SwarmColor(r: 0, g: 0, b: 0, a: 0.18) : SwarmColor(r: 1, g: 1, b: 1, a: 0.12),
      shadowPeak: light ? SwarmColor(r: 0, g: 0, b: 0, a: 0.34) : SwarmColor(r: 1, g: 1, b: 1, a: 0.3),
      tint: scheme == .dark ? .dark : .light)
  }
}

/// A state colour fit to be READ on this theme's surface.
///
/// The state hues are tuned for a dark ground: on the light theme's surface,
/// orange measures 1.6:1 and blue 1.5:1 against it, which is not text at any
/// size. A light theme therefore darkens them toward its own ink until they
/// carry — 4.3:1 and 4.0:1 — while the LIGHT inside a body keeps the full hue,
/// because a glow is supposed to be bright. The dark theme needs neither:
/// there the same hues already measure about 7:1 (2026-09-18).
func readable(_ colour: SwarmColor, ink: SwarmColor, light: Bool) -> SwarmColor {
  if !light { return colour }
  let towardInk = 0.45
  return SwarmColor(
    r: colour.r * (1 - towardInk) + ink.r * towardInk,
    g: colour.g * (1 - towardInk) + ink.g * towardInk,
    b: colour.b * (1 - towardInk) + ink.b * towardInk,
    a: colour.a)
}

/// A state colour as the LIGHT it is, rather than the label it is elsewhere.
/// Scaling each channel's distance from the brightest one raises HSV
/// saturation while holding hue and value, so the already-saturated orange
/// barely moves and the pale blue gains real chroma. The kit's token stays the
/// token; this is only how the swarm burns it, and `stateChroma` tunes how hard.
func vivid(_ colour: SwarmColor, chroma: Double) -> SwarmColor {
  let peak = max(colour.r, colour.g, colour.b)
  func lift(_ channel: Double) -> Double { max(0, peak - (peak - channel) * chroma) }
  return SwarmColor(r: lift(colour.r), g: lift(colour.g), b: lift(colour.b), a: colour.a)
}

/// The light itself, as against the ground it falls on. On a DARK theme it is
/// carried toward white, because against a dark ground brightness is what
/// reads as energy and a fully saturated hue only reads as paint. On a LIGHT
/// theme the hue at full chroma is already the hot end: the ground there is
/// paler still, so lifting the glow would put it on top of something it cannot
/// out-brighten.
func stateGlowColour(_ hue: SwarmColor, light: Bool, parameters: SwarmParameters) -> SwarmColor {
  if light { return hue }
  let lift = parameters.stateGlowLift
  return SwarmColor(
    r: hue.r + (1 - hue.r) * lift, g: hue.g + (1 - hue.g) * lift, b: hue.b + (1 - hue.b) * lift, a: hue.a)
}

/// The ground a glowing body sits on: the same light carried toward this
/// theme's own paper, down toward black on a dark theme and up toward white on
/// a light one. The words live in the middle of a body, so the middle has to
/// be the calm end of the light rather than its hottest part.
///
/// Carried by SCALING, not by mixing toward the grey surface. Mixing a
/// saturated hue into grey is what turned the dark theme's orange into a brown
/// and its blue into slate; scaling holds the hue exactly and only spends its
/// brightness.
func stateGroundColour(_ hue: SwarmColor, light: Bool, parameters: SwarmParameters) -> SwarmColor {
  if light {
    let towardWhite = parameters.stateGroundLight
    return SwarmColor(
      r: hue.r + (1 - hue.r) * towardWhite,
      g: hue.g + (1 - hue.g) * towardWhite,
      b: hue.b + (1 - hue.b) * towardWhite,
      a: hue.a)
  }
  let dim = parameters.stateGroundDark
  return SwarmColor(r: hue.r * dim, g: hue.g * dim, b: hue.b * dim, a: hue.a)
}
