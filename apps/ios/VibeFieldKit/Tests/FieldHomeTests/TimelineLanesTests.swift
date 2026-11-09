import FieldMesh
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// puppeteer 0.4.0 — A TIMELINE LANE KEEPS ITS TRUE START (#41, upstream `5a0ae86b` in `e6e4753de`): `laneFor`
// starts a lane at its row's `statusSince` however long ago, and every reader clamps to its own window (the paint, the
// wakes, the map and `dayStart`). L1 and L2 are `timeline-lanes.test.ts`'s two rows ("keeps its own start however
// old", "holds for a lane older than the horizon as now moves"); L3 is what the wakes then draw at the widest window,
// the day's 24 h. All three are red under 0.3.3's rule, which started a lane older than the day at the horizon, so its
// key moved with the clock and its wake began at the window's edge with a round cap, as if it had started there.
//
// G1 and G2 are GUARDS, green by design at the red as at the green: the readers' own clamps, which 0.3.3 left them
// and a lane that keeps its start now leans on. Inside a window shorter than the day, the paint, the wakes and the map
// of a lane that keeps its start are, call for call, those of the same lane started at the horizon.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("puppeteer 0.4.0 — a timeline lane keeps its true start")
struct TimelineLanesTests {
  static let nowMs = 1_790_803_300_000.0
  static let minute = 60_000.0
  /// Born thirty hours ago and working for the last twenty-five: both older than the day.
  static let bornMs = nowMs - 30 * 60 * minute
  static let sinceMs = nowMs - 25 * 60 * minute

  /// The witness's `run-h-quiet` (an agent, working), born and working since then.
  static func row() throws -> TimelineRow {
    let monitor = try ListViewTests.monitor(
      "run-h-quiet", ["createdAt": .int(Int64(bornMs)), "statusSince": .int(Int64(sinceMs))])
    return TimelineRow(monitor: monitor, isSelf: true, unread: false, colour: nil, active: false)
  }

  /// The same lane as 0.3.3's `laneFor` started it: at the horizon.
  static func atHorizon(_ lane: TimelineLane) -> TimelineLane {
    let since = nowMs - TimelineScale.horizonMs
    return TimelineLane(
      row: lane.row, bornMs: lane.bornMs, sinceMs: since,
      current: TimelineSpan(status: lane.current.status, fromMs: since, wait: lane.current.wait))
  }

  /// L1 — older than the horizon, a lane keeps its own start: the window is its readers' to clamp to.
  @Test func aLaneKeepsItsOwnStartHoweverOld() throws {
    let lane = TimelineLanes.lane(for: try Self.row(), nowMs: Self.nowMs)
    #expect(lane.sinceMs == Self.sinceMs, "its start is its status's")
    #expect(lane.current.fromMs == lane.sinceMs, "its current state starts there")
    #expect(lane.bornMs == Self.bornMs, "its birth is its row's")
    let atHorizon = TimelineLanes.state(of: lane, at: Self.nowMs - TimelineScale.horizonMs)
    #expect(atHorizon == .span(lane.current), "at the horizon it is in its current state")
  }

  /// L2 — its key holds as now moves: a publish that moves nothing draws nothing.
  @Test func aLanesKeyHoldsAsNowMoves() throws {
    let row = try Self.row()
    func key(_ nowMs: Double) -> String { TimelineLanes.contentKey([TimelineLanes.lane(for: row, nowMs: nowMs)]) }
    let now = key(Self.nowMs)
    let later = key(Self.nowMs + 16)
    let minuteOn = key(Self.nowMs + Self.minute)
    #expect(later == now, "16 ms on")
    #expect(minuteOn == now, "a minute on")
  }

  /// L3 — at the day's 24 h window its wake enters from 30 px before the window, as any state older than the window
  /// does, with no round cap: it did not start at the window's edge.
  @Test func atTheWidestWindowItsWakeEntersFromBeforeTheDay() throws {
    let lane = TimelineLanes.lane(for: try Self.row(), nowMs: Self.nowMs)
    let span = TimelineScale.spanMaxMs
    let t0 = Self.nowMs - span
    let k = 300 / span
    let segments = WakeGeometry.segments(lane, t0: t0, t1: Self.nowMs, pxPerMs: k, laneHeight: 34, nowMs: Self.nowMs)
    let first = try #require(segments.first, "a working lane has a wake")
    #expect(segments.count == 1, "one state, one segment")
    #expect(first.a == t0 - 30 / k, "it starts 30 px before the window")
    #expect(abs(first.x0 + 30) < 1e-6, "at x −30")
    let cap = WakeGeometry.capsStart(lane, first: first)
    #expect(!cap, "no round cap")
  }

  /// G1 — a guard: inside an hour's window the paint (the thread from its birth and its run) and the wakes are, call
  /// for call, those of the lane started at the horizon.
  @Test func insideTheWindowItPaintsWhatTheClampedLaneDid() throws {
    let lane = TimelineLanes.lane(for: try Self.row(), nowMs: Self.nowMs)
    let inks = try TimelinePaintParityTests.inks(try TimelineGolden.open(), theme: "light")
    let t0 = Self.nowMs - 60 * Self.minute
    func paint(_ lane: TimelineLane) -> [TimelineCanvas] {
      let wake = TimelineWakePaint(
        width: 300, height: 120, ratio: 3, lanes: [TimelinePlacedLane(lane: lane, y: 20, h: 34)], t0: t0,
        t1: Self.nowMs, nowMs: Self.nowMs, lit: -1, glow: 0)
      return TimelinePaint.lanes(wake, inks: inks)
    }
    let kept = paint(lane)
    let clamped = paint(Self.atHorizon(lane))
    #expect(!kept.isEmpty, "it paints")
    #expect(kept == clamped, "the same calls")
    let k = 300 / (Self.nowMs - t0)
    let wakes = WakeGeometry.segments(lane, t0: t0, t1: Self.nowMs, pxPerMs: k, laneHeight: 34, nowMs: Self.nowMs)
    let clampedWakes = WakeGeometry.segments(
      Self.atHorizon(lane), t0: t0, t1: Self.nowMs, pxPerMs: k, laneHeight: 34, nowMs: Self.nowMs)
    #expect(wakes == clampedWakes, "the same wake")
  }

  /// G2 — a guard: the day's start is the horizon, never the lane's birth, and the map counts that day alone: the map
  /// of a lane that keeps its start is the map of the lane started at the horizon.
  @Test func theMapCountsTheDayAlone() throws {
    let lane = TimelineLanes.lane(for: try Self.row(), nowMs: Self.nowMs)
    let set = TimelineLaneSet(agents: [lane], terminals: [])
    let start = TimelineLanes.dayStart(set, spanMs: 60 * Self.minute, nowMs: Self.nowMs)
    #expect(start == Self.nowMs - TimelineScale.horizonMs, "the day starts at the horizon")
    let geometry = PulseGeometry(width: 300)
    let kept = PulseMap(PulseMap.rows([lane], nowMs: Self.nowMs), startMs: start, nowMs: Self.nowMs, geometry: geometry)
    let clamped = PulseMap(
      PulseMap.rows([Self.atHorizon(lane)], nowMs: Self.nowMs), startMs: start, nowMs: Self.nowMs, geometry: geometry)
    #expect(kept == clamped, "the same map")
  }
}
