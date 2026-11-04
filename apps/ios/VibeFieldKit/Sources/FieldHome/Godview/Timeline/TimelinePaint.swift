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
    if lane.kind == .terminal { return status == .working ? inks.muted : inks.border }
    switch status {
    case .working: return inks.project(lane.colour)
    case .blocked: return inks.orange
    case .unseen: return inks.blue
    case .idle: return inks.faint
    }
  }

  /// `dotted`: the thread for time in a lane's life it claims nothing for.
  static func dotted(_ inks: TimelineInks) -> [TimelineCanvas] {
    [.lineDash([1.2, 3.4]), .lineWidth(1.2), .roundCap, .strokeStyle(inks.faint)]
  }

  /// `paintRun`: one run of a wake — its light (the outline's own blur; `glow` 0 for none), the outline, and the
  /// sheen along its work.
  static func run(
    _ segments: [WakeSegment], cy: Double, cap: Bool, lane: TimelineLane, inks: TimelineInks, glow: Double,
    fade: Double
  ) -> [TimelineCanvas] {
    guard let first = segments.first, let last = segments.last else { return [] }
    let path = WakeGeometry.outline(segments, cy: cy, capStart: cap)
    let gradient = TimelineFill.gradient(
      TimelineGradient(
        x0: first.x0, y0: 0, x1: max(first.x0 + 1, last.x1), y1: 0,
        stops: WakeGeometry.gradient(segments) { wakeColour(inks, lane, $0.status) }))
    var out: [TimelineCanvas] = []
    // The light around it first (the outline's own blur), then the wake.
    if glow > 0 {
      out += [
        .save, .blur(inks.dark ? 6 : 5), .globalAlpha(fade * min(1, (inks.dark ? 0.62 : 0.24) * glow)),
        .fillStyle(gradient), .fillPath(path), .restore, .globalAlpha(fade),
      ]
    }
    out += [.fillStyle(gradient), .fillPath(path)]
    // A sheen along the work, so it reads as a lit tube rather than a bar.
    if lane.kind == .agent {
      out += [.strokeStyle(inks.dark ? inks.ink.withAlpha(0.28) : inks.ground.withAlpha(0.4)), .lineWidth(1)]
      for sheen in WakeGeometry.sheens(segments, cy: cy) {
        out += [.beginPath, .moveTo(x: sheen.x0, y: sheen.y), .lineTo(x: sheen.x1, y: sheen.y), .stroke]
      }
    }
    return out
  }

  /// `paintWakes`: the grid, then each lane's dotted thread and its outline, with its light and its sheen, then the
  /// head's light — the four parts below, in order.
  static func wakes(_ paint: TimelineWakePaint, inks: TimelineInks, timeZone: TimeZone) -> [TimelineCanvas] {
    frame(paint) + hairlines(paint, inks: inks, timeZone: timeZone) + lanes(paint, inks: inks)
      + headLight(paint, inks: inks)
  }

  /// The canvas made ready (`paintWakes` :112-113).
  static func frame(_ paint: TimelineWakePaint) -> [TimelineCanvas] {
    [
      .setTransform(a: paint.ratio, b: 0, c: 0, d: paint.ratio, e: 0, f: 0),
      .clearRect(x: 0, y: 0, width: paint.width, height: paint.height),
    ]
  }

  /// px per ms across the window.
  private static func pxPerMs(_ paint: TimelineWakePaint) -> Double {
    paint.width / max(1, paint.t1 - paint.t0)
  }

  /// The ticks' hairlines, behind everything; the hours a little firmer (`paintWakes` :115-120). Their instants are
  /// the local zone's.
  static func hairlines(_ paint: TimelineWakePaint, inks: TimelineInks, timeZone: TimeZone) -> [TimelineCanvas] {
    let k = pxPerMs(paint)
    let step = TimelineScale.tickStep(pxPerMs: k)
    return TimelineScale.ticksBetween(fromMs: paint.t0 - step, toMs: paint.t1, step: step, timeZone: timeZone)
      .flatMap { tick -> [TimelineCanvas] in
        [
          .fillStyle(.colour(tick.hour ? inks.ink.withAlpha(inks.dark ? 0.09 : 0.07) : inks.grid)),
          .fillRect(x: JSNumber.round((tick.t - paint.t0) * k), y: 0, width: 1, height: paint.height),
        ]
      }
  }

  /// Each lane the canvas covers: its weight, the dotted thread from its birth to its current state, and its run
  /// (`paintWakes` :121-157).
  static func lanes(_ paint: TimelineWakePaint, inks: TimelineInks) -> [TimelineCanvas] {
    let k = pxPerMs(paint)
    func x(_ t: Double) -> Double { (t - paint.t0) * k }
    var out: [TimelineCanvas] = []
    for (index, placed) in paint.lanes.enumerated() {
      let lane = placed.lane
      if placed.y + placed.h < -lightMargin || placed.y > paint.height + lightMargin { continue }
      let cy = placed.y + placed.h / 2
      let fade = TimelineLanes.alpha(lane, index: index, lit: paint.lit)
      out.append(.globalAlpha(fade))
      // From its birth to its current state the lane claims nothing (runtime only): a dotted thread, never a state.
      if lane.sinceMs > lane.bornMs {
        let a = max(lane.bornMs, paint.t0)
        let b = min(lane.sinceMs, paint.t1, paint.nowMs)
        if b > a {
          out += [.save] + dotted(inks)
          out += [.beginPath, .moveTo(x: x(a), y: cy), .lineTo(x: x(b), y: cy), .stroke, .restore]
        }
      }
      let segments = WakeGeometry.segments(
        lane, t0: paint.t0, t1: paint.t1, pxPerMs: k, laneHeight: placed.h, nowMs: paint.nowMs)
      guard let first = segments.first else { continue }
      // The phone's GraphicsContext blurs, so every agent's wake has its light (`'filter' in ctx`).
      out += run(
        segments, cy: cy, cap: WakeGeometry.capsStart(lane, first: first), lane: lane, inks: inks,
        glow: lane.kind == .agent ? paint.glow : 0, fade: fade)
    }
    return out
  }

  /// The head's light: a soft column the bodies sit in (`paintWakes` :158-166).
  static func headLight(_ paint: TimelineWakePaint, inks: TimelineInks) -> [TimelineCanvas] {
    let light = TimelineGradient(
      x0: paint.width - 44, y0: 0, x1: paint.width, y1: 0,
      stops: [
        WakeGradientStop(offset: 0, colour: inks.ink.withAlpha(0)),
        WakeGradientStop(offset: 1, colour: inks.ink.withAlpha(inks.dark ? 0.09 : 0.06)),
      ])
    return [
      .globalAlpha(1), .fillStyle(.gradient(light)),
      .fillRect(x: paint.width - 44, y: 0, width: 44, height: paint.height),
    ]
  }

  /// `fillBand`: a band's top edge left to right, its bottom edge back, filled.
  static func band(_ xs: [Float], _ band: PulseBand, width: Double) -> [TimelineCanvas] {
    guard let firstTop = band.top.first, let lastTop = band.top.last, let firstBottom = band.bottom.first,
      let lastBottom = band.bottom.last
    else { return [] }
    var out: [TimelineCanvas] = [.beginPath, .moveTo(x: 0, y: Double(firstTop))]
    for (x, y) in zip(xs, band.top) { out.append(.lineTo(x: Double(x), y: Double(y))) }
    out += [.lineTo(x: width, y: Double(lastTop)), .lineTo(x: width, y: Double(lastBottom))]
    for (x, y) in zip(xs, band.bottom).reversed() { out.append(.lineTo(x: Double(x), y: Double(y))) }
    out += [.lineTo(x: 0, y: Double(firstBottom)), .closePath, .fill]
    return out
  }

  /// `traceEdge`: an edge drawn as a 0.75 px line (the path's first `lineTo` begins it, as a 2D context's does).
  static func edge(_ xs: [Float], _ edge: [Float], colour: SwarmColor) -> [TimelineCanvas] {
    [.beginPath] + zip(xs, edge).map { .lineTo(x: Double($0), y: Double($1)) }
      + [.strokeStyle(colour), .lineWidth(0.75), .stroke]
  }

  /// `paintPulse`: the ridge with each band's upper edge traced in the ground, the waits hung below, the line, the
  /// ridge's light, and the hours behind it all, in `timeZone`.
  static func pulse(
    _ map: PulseMap, paint: TimelineMapPaint, inks: TimelineInks, timeZone: TimeZone
  ) -> TimelinePulseLayers {
    let width = paint.width
    let edgeColour = inks.ground.withAlpha(0.7)
    var ridge: [TimelineCanvas] = [
      .setTransform(a: paint.ratio, b: 0, c: 0, d: paint.ratio, e: 0, f: 0),
      .clearRect(x: 0, y: 0, width: width, height: paint.height),
    ]
    for (index, work) in map.work.enumerated() {
      ridge += [.fillStyle(.colour(inks.project(work.colour)))] + band(map.xs, work, width: width)
      // Each band's upper edge, traced in the ground, keeps the layers crisp.
      if index < map.work.count - 1 { ridge += edge(map.xs, work.top, colour: edgeColour) }
    }
    ridge += [.fillStyle(.colour(inks.orange))] + band(map.xs, map.blocked, width: width)
    ridge += edge(map.xs, map.blocked.bottom, colour: edgeColour)
    ridge += [.fillStyle(.colour(inks.blue))] + band(map.xs, map.unseen, width: width)
    // The line between the agents' time and yours.
    ridge += [
      .fillStyle(.colour(inks.ink.withAlpha(inks.dark ? 0.32 : 0.28))),
      .fillRect(x: 0, y: map.base - 0.25, width: width, height: 0.5),
    ]
    // The hours, behind everything: a hairline and the hour's number, which the day's work rises over. The first is
    // the hour after the local hour `startMs` falls in (`setMinutes(0, 0, 0)`), then every HOUR of ms to now.
    var hours: [TimelineCanvas] = []
    let range = max(1, paint.nowMs - paint.startMs)
    let hourPx = hour / range * width
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let start = Date(timeIntervalSince1970: paint.startMs.rounded(.towardZero) / 1000)
    let floor = calendar.dateInterval(of: .hour, for: start)?.start ?? start
    var t = floor.timeIntervalSince1970 * 1000 + hour
    while t < paint.nowMs {
      let x = JSNumber.round((t - paint.startMs) / range * width)
      if hourPx >= 30 && x < width - 18 {
        let label = calendar.component(.hour, from: Date(timeIntervalSince1970: t / 1000))
        hours += [
          .fillStyle(.colour(inks.ink.withAlpha(inks.dark ? 0.34 : 0.36))),
          .fillText(label < 10 ? "0\(label)" : "\(label)", x: x + 3, y: 2),
        ]
      }
      hours += [
        .fillStyle(.colour(inks.ink.withAlpha(inks.dark ? 0.08 : 0.07))),
        .fillRect(x: x, y: 0, width: 1, height: paint.height),
      ]
      t += hour
    }
    // The light around the ridge, behind it: the same blur as the wakes', copied from what was just drawn.
    return TimelinePulseLayers(
      hours: hours, ridge: ridge, lightBlur: inks.dark ? 2.5 : 2, lightAlpha: inks.dark ? 0.75 : 0.4)
  }
}

/// Draws a `TimelineCanvas` stream into a SwiftUI `GraphicsContext`, as a 2D context would: a state stack (`save`,
/// `restore`), the current path, and each fill or stroke in the state it was made in.
enum TimelineCanvasReplay {
  /// What `save` keeps and `restore` brings back.
  private struct State {
    var alpha = 1.0
    var blur: Double?
    var fill = TimelineFill.colour(.black)
    var stroke = SwarmColor.black
    var lineWidth = 1.0
    var dash: [Double] = []
    var roundCap = false
    var transform = CGAffineTransform.identity
  }

  /// Draws `commands` into `context`. `clearRect` draws nothing (a SwiftUI Canvas starts clear on every render), and
  /// `setTransform` is in points, as the context's own space is (a ratio of 1 is the identity).
  static func draw(_ commands: [TimelineCanvas], in context: GraphicsContext, hourFont: Font) {
    var state = State()
    var saved: [State] = []
    var path = Path()
    var hasPoint = false
    /// The context a fill or stroke is made in: the state's weight (within the caller's own), its blur and its
    /// transform.
    func layer() -> GraphicsContext {
      var layer = context
      layer.opacity *= state.alpha
      if let blur = state.blur { layer.addFilter(.blur(radius: blur)) }
      layer.concatenate(state.transform)
      return layer
    }
    for command in commands {
      switch command {
      case .setTransform(let a, let b, let c, let d, let e, let f):
        state.transform = CGAffineTransform(a: a, b: b, c: c, d: d, tx: e, ty: f)
      case .clearRect: break
      case .save: saved.append(state)
      case .restore: state = saved.popLast() ?? state
      case .globalAlpha(let alpha): state.alpha = alpha
      case .blur(let px): state.blur = px
      case .fillStyle(let fill): state.fill = fill
      case .strokeStyle(let colour): state.stroke = colour
      case .lineWidth(let width): state.lineWidth = width
      case .lineDash(let dash): state.dash = dash
      case .roundCap: state.roundCap = true
      case .fillRect(let x, let y, let width, let height):
        layer().fill(Path(CGRect(x: x, y: y, width: width, height: height)), with: shading(state.fill))
      case .fillPath(let commands):
        layer().fill(outline(commands), with: shading(state.fill))
      case .beginPath:
        path = Path()
        hasPoint = false
      case .moveTo(let x, let y):
        path.move(to: CGPoint(x: x, y: y))
        hasPoint = true
      case .lineTo(let x, let y):
        // A 2D context's lineTo on an empty path begins it.
        if hasPoint { path.addLine(to: CGPoint(x: x, y: y)) } else { path.move(to: CGPoint(x: x, y: y)) }
        hasPoint = true
      case .closePath: path.closeSubpath()
      case .fill: layer().fill(path, with: shading(state.fill))
      case .stroke:
        layer().stroke(
          path, with: .color(color(state.stroke)),
          style: StrokeStyle(
            lineWidth: state.lineWidth, lineCap: state.roundCap ? .round : .butt,
            dash: state.dash.map { CGFloat($0) }))
      case .fillText(let text, let x, let y):
        let fill = state.fill
        let colour: SwarmColor
        if case .colour(let solid) = fill { colour = solid } else { colour = .black }
        layer().draw(
          Text(text).font(hourFont).foregroundColor(color(colour)), at: CGPoint(x: x, y: y), anchor: .topLeading)
      }
    }
  }

  /// `toPath2D`: the outline's commands replayed into a path (an arc in the 2D context's sense: increasing angle,
  /// which in a y-down space is SwiftUI's `clockwise: false`).
  static func outline(_ commands: [WakePathCommand]) -> Path {
    var path = Path()
    for command in commands {
      switch command {
      case .move(let x, let y): path.move(to: CGPoint(x: x, y: y))
      case .line(let x, let y): path.addLine(to: CGPoint(x: x, y: y))
      case .curve(let x1, let y1, let x2, let y2, let x, let y):
        path.addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
      case .arc(let cx, let cy, let r, let start, let end):
        path.addArc(
          center: CGPoint(x: cx, y: cy), radius: r, startAngle: .radians(start), endAngle: .radians(end),
          clockwise: false)
      case .close: path.closeSubpath()
      }
    }
    return path
  }

  static func color(_ colour: SwarmColor) -> Color {
    Color(.sRGB, red: colour.r, green: colour.g, blue: colour.b, opacity: colour.a)
  }

  private static func shading(_ fill: TimelineFill) -> GraphicsContext.Shading {
    switch fill {
    case .colour(let colour): return .color(color(colour))
    case .gradient(let gradient):
      return .linearGradient(
        Gradient(stops: gradient.stops.map { Gradient.Stop(color: color($0.colour), location: $0.offset) }),
        startPoint: CGPoint(x: gradient.x0, y: gradient.y0), endPoint: CGPoint(x: gradient.x1, y: gradient.y1))
    }
  }
}
