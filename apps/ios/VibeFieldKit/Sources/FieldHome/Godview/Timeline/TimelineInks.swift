import FieldAgents
import FieldSwarm
import Foundation

// PG-6 — THE TIMELINE'S INKS, transcribed from puppeteer-views 0.3.3 at the lock's `52d09c8e` (the timeline is
// byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`), `src/views/timeline/timeline-inks.ts` (dist
// `timeline-inks.js`): `resolveTimelineInks` :4-34, and the toolkit's `rgbaCss` (puppeteer-view-sdk `light.js:105-108`)
// as `css`. The palette resolved to the numbers a 2D context wants, once per theme. The desktop resolves its palette's
// CSS; the phone holds the same tokens resolved already: the swarm's `SwarmTheme` (ink, grid, the neutral ramp, the
// state lights at full chroma, fit to be read, and the ground under a lit body — the toolkit's `readableColour`,
// `vividColour` and `stateGround` at the default tuning, which SwarmTheme's own `readable`, `vivid` and
// `stateGroundColour` are) and the monitor skin (`GodviewSkin`, PG-4t: the ground, the muted words, the border). Held
// to `phone-timeline.golden.json`'s `inks` (the kit's T10) and its paint stream's colours (`TimelinePaintParityTests`).

/// `TimelineInks`: the palette as numbers.
struct TimelineInks: Equatable, Sendable {
  let dark: Bool
  let ground: SwarmColor
  let ink: SwarmColor
  let muted: SwarmColor
  let faint: SwarmColor
  let border: SwarmColor
  let grid: SwarmColor
  /// The swarm's state lights, at full chroma.
  let orange: SwarmColor
  let blue: SwarmColor
  /// The same two, fit to be read as words on this theme's ground.
  let orangeInk: SwarmColor
  let blueInk: SwarmColor
  /// The ground a lit body's light falls on (its outer ring).
  let orangeGround: SwarmColor
  let blueGround: SwarmColor

  /// `resolveTimelineInks`: the swarm's resolved theme and the monitor's skin, for one scheme.
  init(theme: SwarmTheme, skin: GodviewSkin) {
    self.init(
      dark: !(theme.ink.luminance < 0.5), ground: skin.monitorBg, ink: theme.ink, muted: skin.textMuted,
      faint: theme.neutral, border: skin.panelBorder, grid: theme.grid, orange: theme.orange, blue: theme.blue,
      orangeInk: theme.stateInk.orange, blueInk: theme.stateInk.blue, orangeGround: theme.stateGround.orange,
      blueGround: theme.stateGround.blue)
  }

  init(
    dark: Bool, ground: SwarmColor, ink: SwarmColor, muted: SwarmColor, faint: SwarmColor, border: SwarmColor,
    grid: SwarmColor, orange: SwarmColor, blue: SwarmColor, orangeInk: SwarmColor, blueInk: SwarmColor,
    orangeGround: SwarmColor, blueGround: SwarmColor
  ) {
    self.dark = dark
    self.ground = ground
    self.ink = ink
    self.muted = muted
    self.faint = faint
    self.border = border
    self.grid = grid
    self.orange = orange
    self.blue = blue
    self.orangeInk = orangeInk
    self.blueInk = blueInk
    self.orangeGround = orangeGround
    self.blueGround = blueGround
  }

  /// `project`: a lane's project colour; an undealt project (nil) wears the neutral ramp, as the desktop's host hands
  /// a row with no project the neutral colour.
  func project(_ colour: SwarmColor?) -> SwarmColor {
    colour ?? faint
  }

  /// `rgbaCss`: a colour as a 2D context's `rgba()` — each channel to a byte, the alpha to four places.
  static func css(_ colour: SwarmColor) -> String {
    func byte(_ channel: Double) -> String { JSNumber.whole(JSNumber.round(max(0, min(1, channel)) * 255)) }
    return "rgba(\(byte(colour.r)), \(byte(colour.g)), \(byte(colour.b)), \(fourPlaces(colour.a)))"
  }

  /// `+value.toFixed(4)` as JavaScript prints it: the four-place decimal nearest the EXACT binary value, an exact tie
  /// the larger (`toFixed`), its trailing zeros dropped (`+` makes it a number again). A tie is exact only where the
  /// expansion ends at the fifth place's 5, which forty places show (as `tenths`, SwarmBodyModel.swift, reads
  /// `toFixed(1)`'s). An alpha is in [0, 1]; a value with no decimal (NaN, ±∞) says what JavaScript says.
  private static func fourPlaces(_ value: Double) -> String {
    guard value.isFinite else { return JSNumber.whole(value) }
    let expansion = String(format: "%.40f", value)
    var fixed = String(format: "%.4f", value)
    if let point = expansion.firstIndex(of: ".") {
      let tail = expansion[expansion.index(point, offsetBy: 5)...]  // from the fifth place on
      if tail.first == "5", tail.dropFirst().allSatisfy({ $0 == "0" }) {
        fixed = String(format: "%.4f", value + 0.00005)
      }
    }
    return TimelineFormat.number(Double(fixed) ?? .nan)
  }
}
