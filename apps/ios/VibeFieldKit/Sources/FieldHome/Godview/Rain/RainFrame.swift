import FieldProduct
import Foundation

// PG-8 — THE RAIN'S FRAME: what puppeteer-views 0.3.3's rain paints, op for op, as a value the Metal surface draws
// (dist `views/rain/RainView.js` at the pin `52d09c8e`): `measureCanvas` (:7-24), `sync` (:62-77), `draw` (:109-211)
// and `agentAt` (:241-249). The ops are the canvas calls in the canvas's order — the stage's fill, then each stream's
// tail from its head up, then its head — so `phone-rain.golden.json`'s still frame is compared op for op (G6).
//
// Transcribed as the desktop draws, kept where it surprises: a glyph is placed at its cell's centre and its row's
// alphabetic BASELINE (`row × cell`), so row 0 sits above the stage's top edge; a drop wraps (`y − tail > rows` → 0)
// in a still too; the head skips the tail's nearest cell. Not transcribed, named: the pane wash (:126-146; the phone
// mounts no panes, fd's Q4). The phone's one addition is J-S4's lit row (`RainAgent.lit`), heading in the dark
// palette's text main with the active row's glow ×1.5.

/// `measureCanvas` (:7-24): the stage in points, cut into cells of the font's size.
struct RainGeometry: Equatable, Sendable {
  let columns: Int
  let rows: Int
  let cell: Double
  let width: Double
  let height: Double

  /// `geometryRef`'s first value (:51): nothing measured yet.
  static let unmeasured = RainGeometry(columns: 0, rows: 0, cell: 14, width: 0, height: 0)

  /// The stage at `width` × `height` points: at least one column and one row.
  static func measure(width: Double, height: Double, fontSize: Double) -> RainGeometry { .unmeasured }
}


/// One canvas call the frame makes, in its order.
enum RainOp: Equatable, Sendable {
  /// The stage's fill (`fillRect(0, 0, width, height)`, :115-116): the whole frame, first.
  case stage(width: Double, height: Double, fill: String)
  /// One `fillText`.
  case glyph(RainGlyph)
}

/// One glyph as the canvas is told to paint it.
struct RainGlyph: Equatable, Sendable {
  /// One UTF-16 code unit, as `data[i]` and `String.fromCharCode` give.
  let unit: UInt16
  /// The cell's centre (`textAlign = 'center'`).
  let x: Double
  /// The row's alphabetic baseline.
  let y: Double
  let ink: RainInk
  /// `globalAlpha`: the column's recede weight.
  let alpha: Double
  /// `shadowBlur`: a head's glow; 0 for a tail.
  let blur: Double
  /// `shadowColor`'s channels (`rgba(<tail>, 1)`): a head's.
  let glowRgb: String?
}

/// A glyph's `fillStyle`.
enum RainInk: Equatable, Sendable {
  /// A head: the palette's colour, as it spells it.
  case solid(String)
  /// A tail: `rgba(<channels>, <opacity>)`.
  case faded(rgb: String, opacity: Double)
}

/// The rain's state between frames: the stage, the streams, the weights. Owned by the surface; a frame draws from it.
struct RainFrame {
  /// `geometryRef`.
  private(set) var geometry = RainGeometry.unmeasured
  /// `dropsRef`: the streams, in the Map's order (which is the draw order).
  private(set) var drops = RainColumns()
  /// `recedes` (:105): each row's weight as last drawn, by model id.
  private(set) var recedes: [String: Double] = [:]

  /// `sync` (:62-77): measure the stage, then reconcile the streams over the window's order. A new drop is rolled as
  /// the desktop rolls it, its row and then its speed.
  mutating func sync(
    width: Double, height: Double, fontSize: Double, order: [String], random: inout some RainRandom
  ) {
    geometry = RainGeometry.measure(width: width, height: height, fontSize: fontSize)
  }

  /// `draw` (:109-211): one frame's ops over `agents` (the window's rows, `agentsRef`). `elapsed` nil is a still (no
  /// drop falls, no glyph scrambles, a receded column sits at its weight); otherwise it is the frame's `deltaMs`.
  /// `hovered` is the row a pointer rests on: the desktop's; the phone's peek is James's (`RainTouchPeek`, nil today).
  mutating func plan(
    agents: [RainAgent], parameters: RainParameters, palette: RainPalette, hovered: String? = nil, elapsed: Double?,
    random: inout some RainRandom
  ) -> [RainOp] { [] }

  /// `agentAt` (:241-249): the row whose stream runs under a point's x, in the stage's points. Columns run the full
  /// height, so the point's row never matters; a column with no stream, or a stream whose row is gone, is no one.
  func agent(atX x: Double, among agents: [RainAgent]) -> RainAgent? { nil }

  /// `matrixGlyph` (:6): `String.fromCharCode(0x30a0 + Math.random() * 96)`, a katakana; `fromCharCode` truncates.
  static func matrixGlyph(_ roll: Double) -> UInt16 { 0 }
}
