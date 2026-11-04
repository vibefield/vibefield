import Foundation

// PG-6 (RED SKELETON) — the timeline's clock face. Typed, and wrong on purpose until the green commit.

struct TimelineScale: Equatable, Sendable {
  var spanMs: Double
  var endMs: Double
  var live: Bool

  struct Preset: Equatable, Sendable {
    let id: String
    let label: String
    let spanMs: Double
    let title: String
  }

  static let presets: [Preset] = []

  static func clampSpan(_ spanMs: Double) -> Double { 0 }

  static func initial(nowMs: Double, spanMs: Double = 0) -> TimelineScale {
    TimelineScale(spanMs: 0, endMs: 0, live: false)
  }

  static func followNow(_ scale: TimelineScale, nowMs: Double) -> TimelineScale { initial(nowMs: 0) }

  static func headAt(_ scale: TimelineScale, endMs: Double, nowMs: Double, earliestMs: Double) -> TimelineScale {
    initial(nowMs: 0)
  }

  static func panBy(_ scale: TimelineScale, deltaMs: Double, nowMs: Double, earliestMs: Double) -> TimelineScale {
    initial(nowMs: 0)
  }

  static func zoomAt(
    _ scale: TimelineScale, spanMs: Double, anchorFromHeadPx: Double, widthPx: Double, nowMs: Double
  ) -> TimelineScale { initial(nowMs: 0) }

  static func islandEase(_ x: Double) -> Double { -1 }

  static func tweenBetween(
    _ from: TimelineScale, _ target: TimelineScale, at: Double, durationMs: Double = 0
  ) -> TimelineTween {
    TimelineTween(startedAt: 0, durationMs: 0, fromSpanMs: 0, toSpanMs: 0, fromEndMs: 0, toEnd: .now, live: false)
  }

  static func glide(_ scale: TimelineScale, at: Double) -> TimelineTween {
    TimelineTween(startedAt: 0, durationMs: 0, fromSpanMs: 0, toSpanMs: 0, fromEndMs: 0, toEnd: .now, live: false)
  }

  static func tweenTarget(_ tween: TimelineTween, nowMs: Double) -> TimelineScale {
    TimelineScale(spanMs: 0, endMs: 0, live: false)
  }

  static func settled(_ scale: TimelineScale, tween: TimelineTween?, nowMs: Double) -> TimelineScale {
    initial(nowMs: 0)
  }

  static func tweenAt(
    _ tween: TimelineTween, at: Double, nowMs: Double, reduced: Bool
  ) -> (scale: TimelineScale, done: Bool) {
    (TimelineScale(spanMs: 0, endMs: 0, live: false), false)
  }

  static func tickStep(pxPerMs: Double, minPx: Double = 0) -> Double { 0 }

  static func ticksBetween(fromMs: Double, toMs: Double, step: Double, timeZone: TimeZone) -> [TimelineTick] { [] }
}

struct TimelineTween: Equatable, Sendable {
  enum End: Equatable, Sendable {
    case now
    case at(Double)
  }

  let startedAt: Double
  let durationMs: Double
  let fromSpanMs: Double
  let toSpanMs: Double
  let fromEndMs: Double
  let toEnd: End
  let live: Bool
}

struct TimelineTick: Equatable, Sendable {
  let t: Double
  let hour: Bool
}
