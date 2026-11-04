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
      dark: false, ground: .black, ink: .black, muted: .black, faint: .black, border: .black, grid: .black,
      orange: .black, blue: .black, orangeInk: .black, blueInk: .black, orangeGround: .black, blueGround: .black)
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
    .black
  }

  /// `rgbaCss`: a colour as a 2D context's `rgba()` — each channel to a byte, the alpha to four places.
  static func css(_ colour: SwarmColor) -> String {
    ""
  }
}
