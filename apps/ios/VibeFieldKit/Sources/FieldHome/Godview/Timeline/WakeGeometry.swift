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
// `wakeSeam` :115, `capsRun` :136, `wakeSegments`' ended and recorded arms (:44-47, :48-50), `capsStart`'s ended
// arm, and the `bounds` status (the record's floor), so a segment's status is a lane's.

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
    if kind == .terminal { return status == .working ? 1.8 : 0.6 }
    switch status {
    case .working: return min(7.5, max(4, laneHeight * 0.22))
    case .blocked, .unseen: return min(3.8, max(2.2, laneHeight * 0.115))
    case .idle: return 0.85
    }
  }

  /// `wakeSegments`' live arm: the lane's current state between `t0` and the head `t1`, in px from `t0`, starting no
  /// earlier than it does and a little before the window, so the wake enters from off-canvas.
  static func segments(
    _ lane: TimelineLane, t0: Double, t1: Double, pxPerMs: Double, laneHeight: Double, nowMs: Double
  ) -> [WakeSegment] {
    let end = min(nowMs, t1)
    let span = lane.current
    if span.fromMs >= end { return [] }
    let a = max(span.fromMs, lane.sinceMs, t0 - 30 / pxPerMs)
    if end <= a { return [] }
    return [
      WakeSegment(
        a: a, b: end, x0: (a - t0) * pxPerMs, x1: (end - t0) * pxPerMs, status: span.status,
        r: radius(kind: lane.kind, status: span.status, laneHeight: laneHeight))
    ]
  }

  /// `neck`: how far either side of a change the S-curve runs — never more than 5 px, never more than 40% of either
  /// span.
  static func neck(_ segments: [WakeSegment], _ index: Int) -> Double {
    let a = segments[index]
    let b = segments[index + 1]
    return max(0.5, min(5, (a.x1 - a.x0) * 0.4, (b.x1 - b.x0) * 0.4))
  }

  /// `capsStart`: whether the wake begins with a round cap — it starts where the lane's current state does, inside
  /// the window.
  static func capsStart(_ lane: TimelineLane, first: WakeSegment) -> Bool {
    first.a <= max(lane.bornMs, lane.sinceMs) + 1000 && first.x0 > -20
  }

  /// `wakeOutline`: the top edge left to right, the bottom edge back, each change of thickness a short S-curve.
  static func outline(_ segments: [WakeSegment], cy: Double, capStart: Bool) -> [WakePathCommand] {
    guard let first = segments.first, let last = segments.last else { return [] }
    var out: [WakePathCommand] = []
    if capStart {
      out.append(.move(x: first.x0 + first.r, y: cy + first.r))
      out.append(.arc(cx: first.x0 + first.r, cy: cy, r: first.r, start: .pi / 2, end: .pi * 1.5))
    } else {
      out.append(.move(x: first.x0, y: cy + first.r))
      out.append(.line(x: first.x0, y: cy - first.r))
    }
    let changes = segments.indices.dropLast()
    for index in changes {
      let a = segments[index]
      let b = segments[index + 1]
      let n = neck(segments, index)
      let x = a.x1
      out.append(.line(x: x - n, y: cy - a.r))
      out.append(
        a.r != b.r
          ? .curve(x1: x, y1: cy - a.r, x2: x, y2: cy - b.r, x: x + n, y: cy - b.r) : .line(x: x + n, y: cy - b.r))
    }
    out.append(.line(x: last.x1, y: cy - last.r))
    out.append(.line(x: last.x1, y: cy + last.r))
    for index in changes.reversed() {
      let a = segments[index]
      let b = segments[index + 1]
      let n = neck(segments, index)
      let x = a.x1
      out.append(.line(x: x + n, y: cy + b.r))
      out.append(
        a.r != b.r
          ? .curve(x1: x, y1: cy + b.r, x2: x, y2: cy + a.r, x: x - n, y: cy + a.r) : .line(x: x - n, y: cy + a.r))
    }
    out.append(.close)
    return out
  }

  /// `wakeGradient`: the colours along the wake as a horizontal gradient; each change of colour blends across its
  /// neck, so the hue turns where the shape does.
  static func gradient<Colour: Equatable & Sendable>(
    _ segments: [WakeSegment], colour: (WakeSegment) -> Colour
  ) -> [WakeGradientStop<Colour>] {
    guard let first = segments.first, let last = segments.last else { return [] }
    let width = max(1, last.x1 - first.x0)
    func offset(_ x: Double) -> Double { min(1, max(0, (x - first.x0) / width)) }
    var stops = [WakeGradientStop(offset: 0, colour: colour(first))]
    var previous = 0.0
    for index in segments.indices.dropLast() {
      let a = segments[index]
      let b = segments[index + 1]
      let from = colour(a)
      let to = colour(b)
      if from == to { continue }
      let n = neck(segments, index)
      let o1 = max(previous, offset(a.x1 - n))
      let o2 = max(o1, offset(a.x1 + n))
      stops.append(WakeGradientStop(offset: o1, colour: from))
      stops.append(WakeGradientStop(offset: o2, colour: to))
      previous = o2
    }
    stops.append(WakeGradientStop(offset: 1, colour: colour(last)))
    return stops
  }

  /// `wakeSheens`: the sheen along each stretch of work long enough to carry one.
  static func sheens(_ segments: [WakeSegment], cy: Double) -> [WakeSheen] {
    var out: [WakeSheen] = []
    for (index, segment) in segments.enumerated() {
      if segment.status != .working || segment.x1 - segment.x0 < 12 || segment.r < 3 { continue }
      let left = index > 0 ? neck(segments, index - 1) : segment.r
      let right = index < segments.count - 1 ? neck(segments, index) : 0
      let x0 = max(segment.x0 + left + 2, -4)
      let x1 = segment.x1 - right - 2
      if x1 > x0 { out.append(WakeSheen(x0: x0, x1: x1, y: cy - segment.r * 0.45)) }
    }
    return out
  }
}
