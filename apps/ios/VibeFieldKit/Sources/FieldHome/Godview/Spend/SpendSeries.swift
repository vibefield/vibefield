import FieldProduct
import Foundation

// PG-7 — SPEND'S LINES ("Where the Money Went", SV), transcribed from puppeteer-views 0.3.3 at the pin `52d09c8e`
// (the spend module's last commit `5abe8f75`, 2026-10-12, byte-identical to 0.3.2's `95a70aa7`):
// `src/views/spend/spend-series.ts` :26-258 (dist `spend-series.js` :23-211). Runtime only: a line is drawn from what
// the live row says now — its meter, the run's estimated API-equivalent USD (`cost.usd`), and Core's last buckets
// (`cost.series`, oldest first, the last the bucket now is in, begun at `lastStepAt`). Another desktop's row has no
// window spend (SV-D2): no line; its row keeps its total. An agent whose provider reports no cost is named apart
// (SV-D5).
//
// The arithmetic is JavaScript's double arithmetic in its own order, so every reading is the window's to the bit:
// held to `phone-spend.golden.json` (SpendParityTests P1, P2, V9). The window's per-row-object cache (`cachedMeter`,
// a WeakMap) is the caller's: the view recomputes when its rows change, and a value equality does that work.

/// One row as spend reads it: the replica's row, the window's `self` join (`RemoteFieldRow.isSelf`), and the host's two
/// facts — the unread the stage shows (`GodviewStageInput.unreadIds`, S2: never the row's raw `unread`) and whether it
/// is the open card's row (`activeId`, Q-S6 (a)).
struct SpendAgent: Equatable, Sendable {
  let monitor: MonitorAgentRow
  let isSelf: Bool
  let unread: Bool
  /// J-S4 accepted (James 2026-11-04): the open card's row. Spend draws it only through the pane square, which shows
  /// only for a row mounted in a pane, and the phone mounts none: so it draws nothing (fd's Q9, desktop parity).
  let active: Bool

  var id: String { monitor.id }
}

enum SpendSeries {
  static let minute = 60_000.0
  /// The burn the view prints: the last five minutes (SV-D7).
  static let rateWindowMs = 5 * minute
  /// Under a billionth of a dollar is the buckets' sum rounding, not money.
  static let epsilonUsd = 1e-9

  /// A reading: the meter `v` at `t` (epoch ms).
  struct Point: Equatable, Sendable {
    var t: Double
    var v: Double
  }

  /// A meter (`SpendMeter`) and, after `lineAt`, a line (`SpendLine`: its points end at its head, at now).
  struct Meter: Equatable, Sendable {
    let id: String
    let agent: SpendAgent
    let bornMs: Double
    let partial: Bool
    let total: Double
    let points: [Point]
    /// Whether its buckets were recorded: false for a row with a total alone (a peer's, or one with no series).
    let recorded: Bool

    func with(bornMs: Double, points: [Point]) -> Meter {
      Meter(id: id, agent: agent, bornMs: bornMs, partial: partial, total: total, points: points, recorded: recorded)
    }
  }

  struct Unpriced: Equatable, Sendable {
    let id: String
    let agent: SpendAgent
    let bornMs: Double
  }

  struct Meters: Equatable, Sendable {
    let lines: [Meter]
    let unpriced: [Unpriced]
  }

  /// `spendOf` (:34): the meter a row reports, its cost's total. A row with no price reports nothing, never $0.
  static func spendOf(_ agent: SpendAgent) -> (usd: Double, partial: Bool)? {
    guard let cost = agent.monitor.cost, cost.coverage != .unavailable else { return nil }
    guard cost.usd.isFinite, cost.usd >= 0 else { return nil }
    return (cost.usd, cost.coverage == .partial)
  }

  /// `settled` (:90): readings that never fall and end at the head — a correction that lowered the meter reads flat.
  private static func settled(_ points: [Point]) -> [Point] {
    var points = points
    var low = Double.infinity
    for index in points.indices.reversed() {
      let point = points[index]
      low = Swift.min(low, point.v)
      if low < epsilonUsd { low = 0 }
      if point.v != low { points[index] = Point(t: point.t, v: low) }
    }
    return points
  }

  /// `meterOf` (:102): a row's meter back through its buckets, or nil when it has no price at all.
  static func meterOf(_ agent: SpendAgent) -> Meter? {
    guard let meter = spendOf(agent) else { return nil }
    let bornMs = Double(agent.monitor.createdAt)
    // another desktop's row is a total alone (SV-D2): a peer has no line, whatever its cut carries
    let series = agent.isSelf ? agent.monitor.cost?.series : nil
    let steps = series.map { $0.stepMs > 0 ? $0.steps : [] } ?? []
    guard let series, !steps.isEmpty else {
      return Meter(
        id: agent.id, agent: agent, bornMs: bornMs, partial: meter.partial, total: meter.usd, points: [],
        recorded: false)
    }
    let stepMs = Double(series.stepMs)
    let first = Double(series.lastStepAt) - Double(steps.count - 1) * stepMs
    // back from the head, the total: the meter at a bucket's start is what it read at the next one, less the bucket
    var points = [Point(t: .infinity, v: meter.usd)]
    var v = meter.usd
    for index in steps.indices.reversed() {
      let t = first + Double(index) * stepMs
      let cost = steps[index]
      v -= cost.isFinite ? cost : 0
      if t <= bornMs {
        // the bucket it was born in: the line begins at its birth, at what the meter read then
        points.append(Point(t: bornMs, v: v))
        break
      }
      points.append(Point(t: t, v: v))
    }
    // the head at the end, so the readings settle under the total; it is dropped, and put back at now (`lineAt`)
    let read = settled(points.reversed())
    return Meter(
      id: agent.id, agent: agent, bornMs: bornMs, partial: meter.partial, total: meter.usd,
      points: Array(read.dropLast()), recorded: true)
  }

  /// `spendMeters` (:143): every meter the view can draw, and every agent it names apart. Terminals are not here.
  static func spendMeters(_ agents: [SpendAgent]) -> Meters {
    var lines: [Meter] = []
    var unpriced: [Unpriced] = []
    for agent in agents where agent.monitor.kind == .agent {
      if let meter = meterOf(agent) {
        lines.append(meter)
      } else {
        unpriced.append(Unpriced(id: agent.id, agent: agent, bornMs: Double(agent.monitor.createdAt)))
      }
    }
    return Meters(lines: lines, unpriced: unpriced)
  }

  /// `lineAt` (:156): a meter as the chart reads it at `nowMs` — its points up to now, and its head there.
  static func lineAt(_ meter: Meter, nowMs: Double) -> Meter {
    let head = Point(t: nowMs, v: meter.total)
    let bornMs = Swift.min(meter.bornMs, nowMs)
    // a birth the clock has not reached yet (another clock's) begins at now, as nothing can be older than it
    let points =
      meter.bornMs > nowMs
      ? meter.points.map { $0.t > nowMs ? Point(t: nowMs, v: $0.v) : $0 }
      : meter.points
    return meter.with(bornMs: bornMs, points: points + [head])
  }

  /// `lineOf` (:168): one live agent's line at `nowMs`, or nil when it has no price.
  static func lineOf(_ agent: SpendAgent, nowMs: Double) -> Meter? {
    meterOf(agent).map { lineAt($0, nowMs: nowMs) }
  }

  /// `spendAt` (:174): the meters at `nowMs`.
  static func spendAt(_ set: Meters, nowMs: Double) -> Meters {
    Meters(lines: set.lines.map { lineAt($0, nowMs: nowMs) }, unpriced: set.unpriced)
  }

  /// `spendSet` (:179): every line the view can draw at `nowMs`, and every agent it names apart.
  static func spendSet(_ agents: [SpendAgent], nowMs: Double) -> Meters {
    spendAt(spendMeters(agents), nowMs: nowMs)
  }

  /// `valueAt` (:189): the meter at `t` — nil before the line's first point; between two points the line's own
  /// straight piece; from the head on, the total. A line always has its head.
  static func valueAt(_ line: Meter, _ t: Double) -> Double? {
    let points = line.points
    guard let firstPoint = points.first, let head = points.last else { return nil }
    if t < firstPoint.t { return nil }
    if t >= head.t { return head.v }
    var low = 0
    var high = points.count - 1
    while high - low > 1 {
      let middle = (low + high) >> 1
      if points[middle].t <= t { low = middle } else { high = middle }
    }
    let a = points[low]
    let b = points[high]
    if b.t == a.t { return b.v }
    return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t)
  }

  /// `rateAt` (:212): estimated USD a minute over the five minutes up to `t` (as much of them as the line reaches),
  /// or nil with under a minute to measure.
  static func rateAt(_ line: Meter, _ t: Double) -> Double? {
    guard let now = valueAt(line, t), let firstPoint = line.points.first else { return nil }
    let from = Swift.max(t - rateWindowMs, firstPoint.t)
    if t - from < minute { return nil }
    let then = valueAt(line, from) ?? now
    return GodviewFormat.jsMax0(now - then) / ((t - from) / minute)
  }

  /// `windowPoints` (:225): the line inside [ta, tb], cut at the window's edges by its own straight pieces. Fewer than
  /// two points — a head alone — is no line.
  static func windowPoints(_ line: Meter, _ ta: Double, _ tb: Double) -> [Point] {
    guard let firstPoint = line.points.first, let lastPoint = line.points.last else { return [] }
    let start = Swift.max(ta, firstPoint.t)
    let end = Swift.min(tb, lastPoint.t)
    if end <= start { return [] }
    guard let startValue = valueAt(line, start), let endValue = valueAt(line, end) else { return [] }
    var out = [Point(t: start, v: startValue)]
    for point in line.points where point.t > start && point.t < end { out.append(point) }
    out.append(Point(t: end, v: endValue))
    return out
  }

  /// `spentAt` (:242): what the line had spent in the window by `t` — its meter less what it read where the window
  /// begins for it (the window's start, or its birth) — so every line starts at $0. Nil before then, and for a row
  /// with a total alone.
  static func spentAt(_ line: Meter, _ ta: Double, _ t: Double) -> Double? {
    guard line.recorded, let firstPoint = line.points.first else { return nil }
    guard let value = valueAt(line, t), let base = valueAt(line, Swift.max(ta, firstPoint.t)) else { return nil }
    return GodviewFormat.jsMax0(value - base)
  }

  /// `spentPoints` (:250): the line as the chart draws it — its window spend across [ta, tb], from $0 to its head.
  static func spentPoints(_ line: Meter, _ ta: Double, _ tb: Double) -> [Point] {
    guard line.recorded else { return [] }
    let points = windowPoints(line, ta, tb)
    let base = points.first?.v ?? 0
    return points.map { Point(t: $0.t, v: GodviewFormat.jsMax0($0.v - base)) }
  }
}
