import Foundation

// PG-6 — THE TIMELINE'S CLOCK FACE, transcribed whole from puppeteer-views 0.3.3 at the lock's `52d09c8e` (the
// timeline is byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`), `src/views/timeline/timeline-scale.ts`
// (dist `timeline-scale.js:8-151`): how much time the window spans, where its right edge (the head) stands, and whether
// it follows now. `TIMELINE_HORIZON_MS` :11, `ZOOM_PRESETS` :12-17, `DEFAULT_SPAN_MS` :19, `SPAN_MIN_MS`/`SPAN_MAX_MS`
// :20-21, `ZOOM_TWEEN_MS`/`GLIDE_TWEEN_MS` :22-23, `LIVE_SNAP_MS` :25, `clampSpan` :26, `initialScale` :27,
// `followNow` :31, `headAt` :35, `panBy` :40, `zoomAt` :48, `islandEase` :58, `tweenTarget` :77, `settledScale` :86,
// `tweenBetween` :90, `glideTween` :101, `tweenAt` :113, `TICK_STEPS` :127-138, `tickStep` :140, `ticksBetween` :144.
// Pure, so the view keeps one in its state and the tests drive it without a frame. Held to
// `phone-timeline.golden.json`.
//
// The phone's clock (the read's §1): `now` is ALWAYS the caller's (`GodviewStageInput.now()`, frozen under
// `-vf-godview-now=`), a tween's `at` the frame's own monotonic time, and the local zone an explicit `TimeZone`
// (JavaScript's `new Date` reads the host's), as `GodviewFormat.formatClock` takes it.

struct TimelineScale: Equatable, Sendable {
  var spanMs: Double
  var endMs: Double
  var live: Bool

  /// A zoom preset (`ZOOM_PRESETS`).
  struct Preset: Equatable, Sendable {
    let id: String
    let label: String
    let spanMs: Double
    let title: String
  }

  private static let minute = 60_000.0
  private static let hour = 60 * minute

  /// A day: the widest the window opens, and the furthest back the map of the day reaches.
  static let horizonMs = 24 * hour
  static let presets: [Preset] = [
    Preset(id: "15m", label: "15M", spanMs: 15 * minute, title: "Show 15 minutes"),
    Preset(id: "1h", label: "1H", spanMs: hour, title: "Show an hour"),
    Preset(id: "4h", label: "4H", spanMs: 4 * hour, title: "Show 4 hours"),
    Preset(id: "12h", label: "12H", spanMs: 12 * hour, title: "Show 12 hours"),
  ]
  /// The window opens on the last hour (TL-D5).
  static let defaultSpanMs = hour
  static let spanMinMs = 5 * minute
  static let spanMaxMs = horizonMs
  static let zoomTweenMs = 240.0
  static let glideTweenMs = 600.0
  /// A head this close to now is following it.
  static let liveSnapMs = 400.0
  static let tickSteps: [Double] = [
    minute, 2 * minute, 5 * minute, 10 * minute, 15 * minute, 30 * minute, hour, 2 * hour, 3 * hour, 6 * hour,
  ]

  static func clampSpan(_ spanMs: Double) -> Double {
    min(spanMaxMs, max(spanMinMs, spanMs))
  }

  static func initial(nowMs: Double, spanMs: Double = defaultSpanMs) -> TimelineScale {
    TimelineScale(spanMs: clampSpan(spanMs), endMs: nowMs, live: true)
  }

  /// A following head moves with now; a held one stays where it was put.
  static func followNow(_ scale: TimelineScale, nowMs: Double) -> TimelineScale {
    guard scale.live, scale.endMs != nowMs else { return scale }
    return TimelineScale(spanMs: scale.spanMs, endMs: nowMs, live: scale.live)
  }

  /// Put the head at `endMs`, clamped; within 400 ms of now it follows now again.
  static func headAt(_ scale: TimelineScale, endMs: Double, nowMs: Double, earliestMs: Double) -> TimelineScale {
    let end = min(nowMs, max(min(earliestMs, nowMs), endMs))
    let live = nowMs - end < liveSnapMs
    return TimelineScale(spanMs: scale.spanMs, endMs: live ? nowMs : end, live: live)
  }

  static func panBy(_ scale: TimelineScale, deltaMs: Double, nowMs: Double, earliestMs: Double) -> TimelineScale {
    headAt(scale, endMs: scale.endMs + deltaMs, nowMs: nowMs, earliestMs: earliestMs)
  }

  /// Zoom to `spanMs`, keeping the moment under the anchor in place. The anchor is its distance in px from the head; a
  /// following head keeps following, so only a held one moves its end.
  static func zoomAt(
    _ scale: TimelineScale, spanMs: Double, anchorFromHeadPx: Double, widthPx: Double, nowMs: Double
  ) -> TimelineScale {
    let span = clampSpan(spanMs)
    if scale.live || widthPx <= 0 {
      return TimelineScale(spanMs: span, endMs: scale.live ? nowMs : scale.endMs, live: scale.live)
    }
    let before = scale.spanMs / widthPx
    let after = span / widthPx
    let anchorMs = scale.endMs - anchorFromHeadPx * before
    return TimelineScale(spanMs: span, endMs: min(nowMs, anchorMs + anchorFromHeadPx * after), live: false)
  }

  /// DESIGN §6's island curve, `cubic-bezier(0.25, 1, 0.3, 1)`, solved for y at x by the SDK's own bisection, its
  /// arithmetic in its order (`**` is `pow`), so the values are the golden's — not `FieldMotion.islandCurve`.
  static func islandEase(_ x: Double) -> Double {
    if x <= 0 { return 0 }
    if x >= 1 { return 1 }
    var low = 0.0
    var high = 1.0
    for _ in 0..<20 {
      let middle = (low + high) / 2
      let bx =
        3 * (1 - middle) * (1 - middle) * middle * 0.25 + 3 * (1 - middle) * middle * middle * 0.3 + pow(middle, 3)
      if bx < x { low = middle } else { high = middle }
    }
    let m = (low + high) / 2
    return 3 * (1 - m) * (1 - m) * m + 3 * (1 - m) * m * m + pow(m, 3)
  }

  /// Where a running tween lands, as a scale: a glide's end, or a following zoom's, is now.
  static func tweenTarget(_ tween: TimelineTween, nowMs: Double) -> TimelineScale {
    TimelineScale(spanMs: tween.toSpanMs, endMs: tween.toEnd.ms(nowMs), live: tween.live)
  }

  /// `settledScale`: the scale a new move starts from — a running tween's TARGET, not the frame on screen.
  static func settled(_ scale: TimelineScale, tween: TimelineTween?, nowMs: Double) -> TimelineScale {
    tween.map { tweenTarget($0, nowMs: nowMs) } ?? scale
  }

  /// A tween from the scale on screen to `target` (240 ms, island).
  static func tweenBetween(
    _ from: TimelineScale, _ target: TimelineScale, at: Double, durationMs: Double = zoomTweenMs
  ) -> TimelineTween {
    TimelineTween(
      startedAt: at, durationMs: durationMs, fromSpanMs: from.spanMs, toSpanMs: target.spanMs, fromEndMs: from.endMs,
      toEnd: target.live ? .now : .at(target.endMs), live: target.live)
  }

  /// `glideTween`: NOW glides back (600 ms, island).
  static func glide(_ scale: TimelineScale, at: Double) -> TimelineTween {
    TimelineTween(
      startedAt: at, durationMs: glideTweenMs, fromSpanMs: scale.spanMs, toSpanMs: scale.spanMs,
      fromEndMs: scale.endMs, toEnd: .now, live: true)
  }

  /// The scale `at` into a tween; reduced motion lands it at once.
  static func tweenAt(
    _ tween: TimelineTween, at: Double, nowMs: Double, reduced: Bool
  ) -> (scale: TimelineScale, done: Bool) {
    let progress =
      reduced || tween.durationMs <= 0 ? 1 : min(1, max(0, (at - tween.startedAt) / tween.durationMs))
    let eased = islandEase(progress)
    let toEnd = tween.toEnd.ms(nowMs)
    let done = progress >= 1
    let scale = TimelineScale(
      spanMs: tween.fromSpanMs + (tween.toSpanMs - tween.fromSpanMs) * eased,
      endMs: done ? toEnd : tween.fromEndMs + (toEnd - tween.fromEndMs) * eased,
      live: done ? tween.live : false)
    return (scale, done)
  }

  /// The finest step whose ticks stand at least `minPx` apart.
  static func tickStep(pxPerMs: Double, minPx: Double = 76) -> Double {
    tickSteps.first { $0 * pxPerMs >= minPx } ?? tickSteps[tickSteps.count - 1]
  }

  /// Ticks on local wall-clock multiples of `step` covering [from, to], in `timeZone` (JavaScript's local zone: its
  /// offset read at `fromMs`, `getTimezoneOffset`, and each tick's hour flag at the tick's own instant). A step that is
  /// not positive, or an end that is not finite, gives no ticks where JavaScript would never return: a phone-only guard
  /// at inputs the view never makes.
  static func ticksBetween(fromMs: Double, toMs: Double, step: Double, timeZone: TimeZone) -> [TimelineTick] {
    guard step > 0, toMs.isFinite, fromMs.isFinite else { return [] }
    let offset = -offsetMs(at: fromMs, in: timeZone)
    let first = ((fromMs - offset) / step).rounded(.up) * step + offset
    var ticks: [TimelineTick] = []
    var t = first
    while t <= toMs {
      ticks.append(TimelineTick(t: t, hour: localMinute(t, in: timeZone) == 0))
      t += step
    }
    return ticks
  }

  /// The zone's offset east of UTC, in ms, at JavaScript's instant for `ms` (TimeClip truncates toward zero).
  private static func offsetMs(at ms: Double, in zone: TimeZone) -> Double {
    Double(zone.secondsFromGMT(for: Date(timeIntervalSince1970: ms.rounded(.towardZero) / 1000))) * 1000
  }

  /// `new Date(ms).getMinutes()` in `zone`.
  private static func localMinute(_ ms: Double, in zone: TimeZone) -> Double {
    let instant = ms.rounded(.towardZero)
    let minutes = ((instant + offsetMs(at: instant, in: zone)) / minute).rounded(.down)
      .truncatingRemainder(dividingBy: 60)
    return minutes < 0 ? minutes + 60 : minutes
  }
}

/// `ScaleTween`: a move from the scale on screen to its target, eased on the island curve.
struct TimelineTween: Equatable, Sendable {
  /// Where it lands: now (a glide, or a following zoom), or a held instant.
  enum End: Equatable, Sendable {
    case now
    case at(Double)

    func ms(_ nowMs: Double) -> Double {
      switch self {
      case .now: nowMs
      case .at(let ms): ms
      }
    }
  }

  let startedAt: Double
  let durationMs: Double
  let fromSpanMs: Double
  let toSpanMs: Double
  let fromEndMs: Double
  let toEnd: End
  let live: Bool
}

/// `TimelineTick`: a tick's instant, and whether it is on the hour.
struct TimelineTick: Equatable, Sendable {
  let t: Double
  let hour: Bool
}
