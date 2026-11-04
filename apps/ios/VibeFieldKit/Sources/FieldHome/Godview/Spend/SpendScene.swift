import FieldAgents
import Foundation

// PG-7 — WHAT THE SPEND VIEW'S CANVAS DRAWS: each line's ink and fill, and the scene the paint draws from (its grid,
// its now line, the lines in points, the heads, the cross and its dots, the ghost, a start), transcribed from
// puppeteer-views 0.3.3 at the pin `52d09c8e` (the spend module `5abe8f75`): `SpendView.tsx` (dist `SpendView.js`
// :39, :147-156 the colours, :259-318 the scene) and `spend-paint.js` :43 (`sceneMoves`). Pure, so host-built; the
// paint itself is by eye (Q2). Held by hand rows that tie every point to the frame's own places (SpendParityTests
// S1…S6).
// RED SKELETON (pair 4b): placeholder returns, so the rows fail by assertion.

enum SpendScene {
  /// Spend's own fallback ink (`GREY`): a line whose colour has not resolved — the palette not yet read, or a colour
  /// the palette cannot parse — is drawn grey.
  static let grey = SwarmColor(r: 0.5, g: 0.5, b: 0.5, a: 1)
  /// The lines' weight and the lit line's wash (`DEFAULT_SPEND_PARAMETERS`: the phone offers no parameters).
  static let weight = 0.0
  static let wash = 0.0

  /// A line's two inks: its stroke (its project's colour, a sibling a step darker or lighter) and the fill its tag
  /// sits on (a hex).
  struct Colour: Equatable, Sendable {
    let ink: SwarmColor
    let fill: String
  }

  struct Line: Equatable, Sendable {
    let id: String
    let colour: SwarmColor
    let points: [Point]
  }

  struct Point: Equatable, Sendable {
    let x: Double
    let y: Double
  }

  /// A line's head at now, and what its row is doing then (a waiting head waves).
  struct Head: Equatable, Sendable {
    let id: String
    let x: Double
    let y: Double
    let colour: SwarmColor
    let key: SpendWords.State.Key
  }

  struct Dot: Equatable, Sendable {
    let id: String
    let x: Double
    let y: Double
    let colour: SwarmColor
  }

  /// The moment's cross: its x, whether a tap holds it, a dot on each line already started.
  struct Cross: Equatable, Sendable {
    let x: Double
    let held: Bool
    let dots: [Dot]
  }

  /// Where a line pointed at before its birth starts.
  struct Start: Equatable, Sendable {
    let x: Double
    let y: Double
    let colour: SwarmColor
  }

  /// The scene (`SpendScene`): what one paint draws.
  struct Scene: Equatable, Sendable {
    let width: Double
    let height: Double
    let x0: Double
    let x1: Double
    let y0: Double
    let y1: Double
    let weight: Double
    let wash: Double
    let grid: [Double]
    let nowX: Double
    let lines: [Line]
    let hot: String?
    let fadeX: Double?
    let heads: [Head]
    let waves: Bool
    let cross: Cross?
    let ghostX: Double?
    let start: Start?
  }

  /// `colours` (:147): each line's inks from its project's colour (`base`, nil where it has not resolved) and its
  /// sibling index, on the ground's darkness.
  static func colours(
    _ lines: [SpendSeries.Meter], sib: [String: Int], dark: Bool, base: (SpendSeries.Meter) -> SwarmColor?
  ) -> [String: Colour] { [:] }

  /// The scene at one frame (:259-318).
  static func scene(
    _ input: SpendModel.Input, _ state: SpendModel.State, _ frame: SpendModel.Frame, colours: [String: Colour]
  ) -> Scene {
    Scene(
      width: 0, height: 0, x0: 0, x1: 0, y0: 0, y1: 0, weight: 0, wash: 0, grid: [], nowX: 0, lines: [], hot: nil,
      fadeX: nil, heads: [], waves: false, cross: nil, ghostX: nil, start: nil)
  }

  /// `sceneMoves` (`spend-paint.js` :43): whether any head moves on its own — the loop repaints only then.
  static func moves(_ scene: Scene) -> Bool { false }
}
