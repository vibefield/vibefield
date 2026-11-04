import FieldProduct
import Foundation

// PG-6 — A LANE'S WAKE, transcribed from puppeteer-views 0.3.3 at the lock's `52d09c8e` (the timeline is byte-identical
// to 0.3.2's `95a70aa7`; its last change `5abe8f75`), `src/views/timeline/wake-geometry.ts` (dist `wake-geometry.js`):
// `wakeRadius` :3-12, `wakeSegments` :42-67, `neck` :125-129, `capsStart` :131-134, `wakeOutline` :140-181,
// `wakeGradient` :186-210 and `wakeSheens` :212-225. One closed, variable-width outline that swells into work and
// narrows through a short S-curve into a wait (DESIGN §8), produced as plain path commands so the shape is held to
// `phone-timeline.golden.json` without a canvas (`TimelineGeometryParityTests`). `toPath2D` :227-242, the replay into a
// path, belongs to the paint (`TimelinePaint.swift`).
//
// RUNTIME ONLY (fd's Q1 ruling, 2026-11-04): a lane's wake is its current state alone, one segment. NOT transcribed,
// history alone reaches them: `RECORDED` :14, `recordedSegments` :20, `wakeRuns` :69, `unrecordedStretches` :89,
// `wakeSeam` :115, `capsRun` :136, `wakeSegments`' ended and recorded arms (:44-47, :48-50), `capsStart`'s ended arm, and
// the `bounds` status (the record's floor), so a segment's status is a lane's.

/// `WakeSegment`: a stretch of wake — the span's visible start and end in ms (`a`, `b`), the same in the canvas's x
/// with the window's left edge at 0 (`x0`, `x1`), its status, and its half-thickness.
struct WakeSegment: Equatable, Sendable {
  let a: Double
  let b: Double
  let x0: Double
  let x1: Double
  let status: TimelineStatus
  let r: Double
}

/// `PathCommand`: one step of the outline, as a 2D canvas path takes it.
enum WakePathCommand: Equatable, Sendable {
  case move(x: Double, y: Double)
  case line(x: Double, y: Double)
  case curve(x1: Double, y1: Double, x2: Double, y2: Double, x: Double, y: Double)
  case arc(cx: Double, cy: Double, r: Double, start: Double, end: Double)
  case close
}

/// `GradientStop`: an offset along the wake (0–1) and the colour there, in whatever the caller colours by.
struct WakeGradientStop<Colour: Equatable & Sendable>: Equatable, Sendable {
  let offset: Double
  let colour: Colour
}

/// A sheen: a 1 px line along a stretch of work, in the tube's upper half.
struct WakeSheen: Equatable, Sendable {
  let x0: Double
  let x1: Double
  let y: Double
}

enum WakeGeometry {
  /// `wakeRadius`: half the wake's thickness — work is wide, a wait you owe is a thread, rest a hair.
  static func radius(kind: MonitorRowKind, status: TimelineStatus, laneHeight: Double) -> Double {
    0
  }

  /// `wakeSegments`' live arm: the lane's current state between `t0` and the head `t1`, in px from `t0`, starting no
  /// earlier than it does and a little before the window, so the wake enters from off-canvas.
  static func segments(
    _ lane: TimelineLane, t0: Double, t1: Double, pxPerMs: Double, laneHeight: Double, nowMs: Double
  ) -> [WakeSegment] {
    []
  }

  /// `neck`: how far either side of a change the S-curve runs — never more than 5 px, never more than 40% of either
  /// span.
  static func neck(_ segments: [WakeSegment], _ index: Int) -> Double {
    0
  }

  /// `capsStart`: whether the wake begins with a round cap — it starts where the lane's current state does, inside
  /// the window.
  static func capsStart(_ lane: TimelineLane, first: WakeSegment) -> Bool {
    false
  }

  /// `wakeOutline`: the top edge left to right, the bottom edge back, each change of thickness a short S-curve.
  static func outline(_ segments: [WakeSegment], cy: Double, capStart: Bool) -> [WakePathCommand] {
    []
  }

  /// `wakeGradient`: the colours along the wake as a horizontal gradient; each change of colour blends across its
  /// neck, so the hue turns where the shape does.
  static func gradient<Colour: Equatable & Sendable>(
    _ segments: [WakeSegment], colour: (WakeSegment) -> Colour
  ) -> [WakeGradientStop<Colour>] {
    []
  }

  /// `wakeSheens`: the sheen along each stretch of work long enough to carry one.
  static func sheens(_ segments: [WakeSegment], cy: Double) -> [WakeSheen] {
    []
  }
}
