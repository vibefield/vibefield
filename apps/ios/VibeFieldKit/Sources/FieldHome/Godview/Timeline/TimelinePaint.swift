import FieldAgents
import FieldProduct
import Foundation
import SwiftUI

// PG-6 — THE TIMELINE'S TWO CANVASES, transcribed from puppeteer-views 0.3.3 at the lock's `52d09c8e` (the timeline is
// byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`), `src/views/timeline/timeline-paint.ts` (dist
// `timeline-paint.js`): `HOUR` :10, `LIGHT_MARGIN` :12, `wakeColour` :15-27, `dotted` :29-34, `paintRun` :36-67,
// `paintWakes` :108-167, `fillBand` :168-181, `traceEdge` :182-189 and `paintPulse` :191-241; and `toPath2D`
// (`wake-geometry.js:227-242`) as the replay's path. Every colour comes from the inks or a lane's project colour; the
// only other values are alphas of those.
//
// THE PAINT IS AN EMITTER AND A REPLAY. `TimelinePaint` emits the 2D context's calls as `TimelineCanvas` values, in the
// desktop's order, so the wakes' stream is held call for call to `phone-timeline.golden.json`'s `paint`
// (`TimelinePaintParityTests`; its ticks' hairlines elided there, their zone being the host's). `TimelineCanvasReplay`
// draws a stream into a SwiftUI `GraphicsContext` (held by eye: the still pair). The map's paint is by eye alone (fd's
// Q7: its hours read the local zone), so `pulse` hands the replay its three layers in the order they composite — the
// desktop draws the hours and the ridge's light `destination-over`, UNDER what is drawn, so the phone draws them first.
//
// RUNTIME ONLY (fd's Q1 ruling, 2026-11-04): NOT transcribed, history alone reaches them — `BOUNDS_ALPHA` :14 and
// `wakeColour`'s bounds arm, `paintRecorded` :73-106, and `paintWakes`' `top` (the tall canvas ended runs make,
// :110, :123-124, :159-160), so a lane is drawn in the rows' y from the canvas's top.

/// A colour or a gradient, as a 2D context's `fillStyle` takes it. A colour carries its alpha (the desktop's
/// `css(colour, alpha)` is `withAlpha`).
enum TimelineFill: Equatable, Sendable {
  case colour(SwarmColor)
  case gradient(TimelineGradient)
}

/// `createLinearGradient(x0, y0, x1, y1)` with its stops.
struct TimelineGradient: Equatable, Sendable {
  let x0: Double
  let y0: Double
  let x1: Double
  let y1: Double
  let stops: [WakeGradientStop<SwarmColor>]
}

/// One call on a 2D context, as the timeline's paint makes it.
enum TimelineCanvas: Equatable, Sendable {
  case setTransform(a: Double, b: Double, c: Double, d: Double, e: Double, f: Double)
  case clearRect(x: Double, y: Double, width: Double, height: Double)
  case save
  case restore
  case globalAlpha(Double)
  /// `filter = "blur(<px>px)"`.
  case blur(Double)
  case fillStyle(TimelineFill)
  case strokeStyle(SwarmColor)
  case lineWidth(Double)
  case lineDash([Double])
  /// `lineCap = "round"`.
  case roundCap
  case fillRect(x: Double, y: Double, width: Double, height: Double)
  /// `fill(toPath2D(commands))`.
  case fillPath([WakePathCommand])
  case beginPath
  case moveTo(x: Double, y: Double)
  case lineTo(x: Double, y: Double)
  case closePath
  /// `fill()` of the path being built.
  case fill
  case stroke
  /// `fillText(text, x, y)` at the map's hour face (`700 7.5px`, top baseline).
  case fillText(String, x: Double, y: Double)
}

/// `PlacedLane`: a lane in the rows' y, at its height.
struct TimelinePlacedLane: Equatable, Sendable {
  let lane: TimelineLane
  let y: Double
  let h: Double
}

/// `WakePaint`: the wake canvas's size (`ratio` its pixels per point), its lanes, the window (its left edge and the
/// head), now, the lit lane (−1: all lit) and the glow.
struct TimelineWakePaint: Equatable, Sendable {
  let width: Double
  let height: Double
  let ratio: Double
  let lanes: [TimelinePlacedLane]
  let t0: Double
  let t1: Double
  let nowMs: Double
  let lit: Int
  let glow: Double
}

/// `MapPaint`: the map's canvas and the day it spans.
struct TimelineMapPaint: Equatable, Sendable {
  let width: Double
  let height: Double
  let ratio: Double
  let startMs: Double
  let nowMs: Double
}

/// The map's paint as the phone composites it, bottom first: the hours, the ridge's light (the ridge again, blurred
/// at `lightBlur` and `lightAlpha`), the ridge.
struct TimelinePulseLayers: Equatable, Sendable {
  let hours: [TimelineCanvas]
  let ridge: [TimelineCanvas]
  let lightBlur: Double
  let lightAlpha: Double
}

enum TimelinePaint {
  /// `HOUR`.
  static let hour = 3_600_000.0
  /// `LIGHT_MARGIN`: how far past the canvas's edges a lane is still drawn — its light (the blur) reaches in.
  static let lightMargin = 32.0

  /// `wakeColour`: a terminal in the muted words while it runs and the border while quiet; an agent's work in its
  /// project's colour, its waits orange and blue, its rest the neutral ramp.
  static func wakeColour(_ inks: TimelineInks, _ lane: TimelineLane, _ status: TimelineStatus) -> SwarmColor {
    .black
  }

  /// `paintWakes`: the grid, then each lane's dotted thread and its outline, with its light and its sheen, then the
  /// head's light — the four parts below, in order.
  static func wakes(_ paint: TimelineWakePaint, inks: TimelineInks, timeZone: TimeZone) -> [TimelineCanvas] {
    frame(paint) + hairlines(paint, inks: inks, timeZone: timeZone) + lanes(paint, inks: inks)
      + headLight(paint, inks: inks)
  }

  /// The canvas made ready (`paintWakes` :112-113).
  static func frame(_ paint: TimelineWakePaint) -> [TimelineCanvas] {
    []
  }

  /// The ticks' hairlines, behind everything; the hours a little firmer (`paintWakes` :115-120). Their instants are
  /// the local zone's.
  static func hairlines(_ paint: TimelineWakePaint, inks: TimelineInks, timeZone: TimeZone) -> [TimelineCanvas] {
    []
  }

  /// Each lane the canvas covers: its weight, the dotted thread from its birth to its current state, and its run
  /// (`paintWakes` :121-157).
  static func lanes(_ paint: TimelineWakePaint, inks: TimelineInks) -> [TimelineCanvas] {
    []
  }

  /// The head's light: a soft column the bodies sit in (`paintWakes` :158-166).
  static func headLight(_ paint: TimelineWakePaint, inks: TimelineInks) -> [TimelineCanvas] {
    []
  }

  /// `paintPulse`: the ridge with each band's upper edge traced in the ground, the waits hung below, the line, the
  /// ridge's light, and the hours behind it all, in `timeZone`.
  static func pulse(
    _ map: PulseMap, paint: TimelineMapPaint, inks: TimelineInks, timeZone: TimeZone
  ) -> TimelinePulseLayers {
    TimelinePulseLayers(hours: [], ridge: [], lightBlur: 0, lightAlpha: 0)
  }
}

/// Draws a `TimelineCanvas` stream into a SwiftUI `GraphicsContext`, as a 2D context would: a state stack (`save`,
/// `restore`), the current path, and each fill or stroke in the state it was made in.
enum TimelineCanvasReplay {
  static func draw(_ commands: [TimelineCanvas], in context: GraphicsContext, hourFont: Font) {}
}
