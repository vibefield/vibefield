import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-6 — THE TIMELINE'S WAKES AND ITS MAP OF THE DAY, HELD TO PUPPETEER'S OWN: every row reads
// `phone-timeline.golden.json` (field-app's `perf/lib/phone-goldens-timeline.ts`), mirrored into this bundle byte for
// byte. The wakes are lane-local, as the golden records them (`wakeRecord`: the default scale and, at the open, the
// held one; cy at half the lane), and the map is drawn at the golden's stage (`pulseOf`). Equality is exact, Float32
// included: a map value is the float32 the golden holds, read back as a double.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-6 — the timeline's wakes and map")
struct TimelineGeometryParityTests {
  /// The golden's stage (`TRACK`, `MAP_WIDTH`, `TERMINAL_H`): the track at the kit device's 402 pt, the map 14 px in
  /// from its left, a bare terminal's lane.
  static let track = 298.0
  static let mapWidth = 284.0
  static let terminalHeight = 18.0
  /// The held scale the open's second wake set is drawn at: looking back 20 minutes, 15 minutes wide (`HELD`).
  static let heldBackMs = 20 * 60_000.0
  static let heldSpanMs = 15 * 60_000.0

  // MARK: - The wakes (T6)

  /// T6 — each lane's wake at the default scale (following now, the hour), step by step.
  @Test func theWakesAreTheTimelinesStepByStep() throws {
    let now = TimelineGolden.nowMs
    try TimelineWitness.walk { golden, set, step in
      let records = golden["wakes"]?.arrayValue ?? []
      let count = set.all.count
      #expect(count == records.count, "step \(step.at): the wakes")
      for (lane, record) in zip(set.all, records) {
        Self.expectWake(
          lane, record, t0: now - TimelineScale.defaultSpanMs, t1: now, "step \(step.at) \(lane.id)")
      }
    }
  }

  /// T6b — at the open, each lane's wake at a held scale, where the cut entry and the unborn lanes are.
  @Test func theHeldWakesAreTheTimelines() throws {
    let t1 = TimelineGolden.nowMs - Self.heldBackMs
    var seen = false
    try TimelineWitness.walk { golden, set, step in
      guard step.at == "open" else { return }
      seen = true
      let records = golden["heldWakes"]?.arrayValue ?? []
      let count = set.all.count
      #expect(count == records.count, "the held wakes")
      for (lane, record) in zip(set.all, records) {
        Self.expectWake(lane, record, t0: t1 - Self.heldSpanMs, t1: t1, "held \(lane.id)")
      }
    }
    #expect(seen, "the run has an open step")
  }

  /// T6c — `wakeRadius` over every kind, status and lane height the vector holds.
  @Test func theRadiiAreTheTimelines() throws {
    for entry in try TimelineGolden.entries("radii") {
      let kind = try #require(MonitorRowKind(rawValue: entry["kind"]?.stringValue ?? "?"))
      let status = try #require(TimelineStatus(rawValue: entry["status"]?.stringValue ?? "?"))
      let h = entry["h"]?.doubleValue ?? .nan
      let out = entry["out"]?.doubleValue
      let radius = WakeGeometry.radius(kind: kind, status: status, laneHeight: h)
      #expect(radius == out, "\(kind) \(status) at \(h)")
    }
  }

  /// T6d — the outline, gradient, sheens and necks over synthetic runs (a change of width, an equal width, a narrow
  /// neck, a lone hair, nothing), each capped and not.
  @Test func theOutlinesAreTheTimelines() throws {
    let entries = try TimelineGolden.entries("outlineCalls")
    for (index, entry) in entries.enumerated() {
      let cy = entry["cy"]?.doubleValue ?? .nan
      let cap = entry["cap"]?.boolValue ?? false
      let at = "run \(index) (cap \(cap))"
      let segments = try Self.segments(entry["segments"])
      let necks = segments.indices.dropLast().map { Optional(WakeGeometry.neck(segments, $0)) }
      let expectedNecks = (entry["necks"]?.arrayValue ?? []).map { $0.doubleValue }
      #expect(necks == expectedNecks, "\(at): the necks")
      Self.expectShape(segments, cy: cy, cap: cap, entry, at)
    }
  }

  // MARK: - The map of the day (T7)

  /// T7 — the map at every step: its rows, its start, its buckets, the band order, the line and the two scales, and
  /// each band's edges summed in order.
  @Test func theMapIsTheTimelinesStepByStep() throws {
    let now = TimelineGolden.nowMs
    try TimelineWitness.walk { golden, set, step in
      let at = "step \(step.at)"
      let pulse = golden["pulse"]
      let start = TimelineLanes.dayStart(set, spanMs: TimelineScale.defaultSpanMs, nowMs: now)
      let expectedStart = pulse?["start"]?.doubleValue
      #expect(start == expectedStart, "\(at): the map's start")
      let rows = PulseMap.rows(set.agents, nowMs: now)
      let records = pulse?["rows"]?.arrayValue ?? []
      let rowCount = rows.count
      #expect(rowCount == records.count, "\(at): the map's rows")
      for (index, (row, record)) in zip(rows, records).enumerated() {
        let colour = record["color"]?.stringValue
        #expect(Self.key(row.colour) == colour, "\(at) row \(index): colour")
        let status = record["status"]?.stringValue
        #expect(row.status.rawValue == status, "\(at) row \(index): status")
        let fromMs = record["fromMs"]?.doubleValue
        #expect(row.fromMs == fromMs, "\(at) row \(index): fromMs")
        let endMs = record["endMs"]?.doubleValue
        #expect(row.endMs == endMs, "\(at) row \(index): endMs")
      }
      let map = PulseMap(rows, startMs: start, nowMs: now, geometry: PulseGeometry(width: Self.mapWidth))
      let count = map.xs.count
      let expectedCount = pulse?["count"]?.intValue.map(Int.init)
      #expect(count == expectedCount, "\(at): the buckets")
      let bands = map.work.map { Self.key($0.colour) }
      let expectedBands = (pulse?["bands"]?.arrayValue ?? []).map { $0.stringValue ?? "?" }
      #expect(bands == expectedBands, "\(at): the band order")
      let base = pulse?["base"]?.doubleValue
      #expect(map.base == base, "\(at): base")
      let kUp = pulse?["kUp"]?.doubleValue
      #expect(map.kUp == kUp, "\(at): kUp")
      let kDn = pulse?["kDn"]?.doubleValue
      #expect(map.kDn == kDn, "\(at): kDn")
      let sums = Self.bands(map).map { band, edges in
        SummedBand(band: band, top: Self.sum(edges.top), bottom: Self.sum(edges.bottom))
      }
      let expectedSums = (pulse?["sums"]?.arrayValue ?? []).map {
        SummedBand(
          band: $0["band"]?.stringValue ?? "?", top: $0["top"]?.doubleValue ?? .nan,
          bottom: $0["bottom"]?.doubleValue ?? .nan)
      }
      #expect(sums == expectedSums, "\(at): each band's edges, summed")
    }
  }

  /// T7b — at the open, the map whole: the bucket centres and every band's two edges, value for value.
  @Test func theMapsArraysAreTheTimelines() throws {
    let now = TimelineGolden.nowMs
    var seen = false
    try TimelineWitness.walk { golden, set, step in
      guard step.at == "open" else { return }
      seen = true
      let start = TimelineLanes.dayStart(set, spanMs: TimelineScale.defaultSpanMs, nowMs: now)
      let map = PulseMap(
        PulseMap.rows(set.agents, nowMs: now), startMs: start, nowMs: now,
        geometry: PulseGeometry(width: Self.mapWidth))
      var mine: [(name: String, values: [Float])] = [("xs", map.xs)]
      for (band, edges) in Self.bands(map) {
        mine.append(("\(band)/top", edges.top))
        mine.append(("\(band)/bottom", edges.bottom))
      }
      let records = golden["pulseArrays"]?.arrayValue ?? []
      let names = mine.map(\.name)
      let expectedNames = records.map { record in
        let band = record["band"]?.stringValue ?? "?"
        return record["edge"]?.stringValue.map { "\(band)/\($0)" } ?? band
      }
      #expect(names == expectedNames, "the map's arrays")
      for ((name, values), record) in zip(mine, records) {
        let doubles = values.map { Optional(Double($0)) }
        let expected = (record["values"]?.arrayValue ?? []).map { $0.doubleValue }
        #expect(doubles == expected, "the map's \(name)")
      }
    }
    #expect(seen, "the run has an open step")
  }

  /// T7c — `addCoverage` (into a bucket already holding float32 0.1), `smooth` (an impulse, a step, a short run) and
  /// `pulseScales` over the golden's vectors.
  @Test func theMapsPartsAreTheTimelines() throws {
    for (index, entry) in try TimelineGolden.entries("pulseCalls").enumerated() {
      let fn = entry["fn"]?.stringValue ?? "?"
      let at = "call \(index) \(fn)"
      switch fn {
      case "addCoverage":
        let count = Int(entry["count"]?.intValue ?? 0)
        var into = [Float](repeating: 0, count: count)
        if count > 0 { into[0] = Float(entry["seed"]?.doubleValue ?? .nan) }
        PulseMap.addCoverage(
          &into, startMs: entry["startMs"]?.doubleValue ?? .nan, dt: entry["dt"]?.doubleValue ?? .nan,
          a: entry["a"]?.doubleValue ?? .nan, b: entry["b"]?.doubleValue ?? .nan)
        let out = into.map { Optional(Double($0)) }
        let expected = (entry["out"]?.arrayValue ?? []).map { $0.doubleValue }
        #expect(out == expected, "\(at)")
      case "smooth":
        let values = (entry["in"]?.arrayValue ?? []).map { Float($0.doubleValue ?? .nan) }
        let out = PulseMap.smooth(values).map { Optional(Double($0)) }
        let expected = (entry["out"]?.arrayValue ?? []).map { $0.doubleValue }
        #expect(out == expected, "\(at) \(entry["name"]?.stringValue ?? "?")")
      case "pulseScales":
        let scales = PulseMap.scales(
          maxUp: entry["maxUp"]?.doubleValue ?? .nan, maxDown: entry["maxDown"]?.doubleValue ?? .nan,
          up: entry["up"]?.doubleValue ?? .nan, down: entry["down"]?.doubleValue ?? .nan)
        let kUp = entry["out"]?["kUp"]?.doubleValue
        #expect(scales.kUp == kUp, "\(at): kUp")
        let kDn = entry["out"]?["kDn"]?.doubleValue
        #expect(scales.kDn == kDn, "\(at): kDn")
      default:
        Issue.record("\(at): a call the rows do not read")
      }
    }
  }

  // MARK: - Readers

  /// One lane's wake between `t0` and the head `t1`, against its record (`wakeRecord`).
  static func expectWake(_ lane: TimelineLane, _ record: JSONValue, t0: Double, t1: Double, _ at: String) {
    let id = record["id"]?.stringValue
    #expect(lane.id == id, "\(at): the wake's lane")
    let h = lane.kind == .terminal ? terminalHeight : TimelineParameters.defaults.laneMax
    let expectedH = record["h"]?.doubleValue
    #expect(h == expectedH, "\(at): the lane's height")
    let segments = WakeGeometry.segments(
      lane, t0: t0, t1: t1, pxPerMs: track / max(1, t1 - t0), laneHeight: h, nowMs: TimelineGolden.nowMs)
    do {
      let expected = try Self.segments(record["segments"])
      #expect(segments == expected, "\(at): the segments")
    } catch {
      Issue.record("\(at): \(error)")
    }
    let caps = segments.first.map { WakeGeometry.capsStart(lane, first: $0) }
    let expectedCaps = record["caps"]?.boolValue
    #expect(caps == expectedCaps, "\(at): the round cap")
    expectShape(segments, cy: h / 2, cap: caps ?? false, record, at)
  }

  /// A run's outline, gradient (coloured by status, as the golden colours it) and sheens, against `record`.
  static func expectShape(_ segments: [WakeSegment], cy: Double, cap: Bool, _ record: JSONValue, _ at: String) {
    let outline = WakeGeometry.outline(segments, cy: cy, capStart: cap).map { Optional($0) }
    let expectedOutline = (record["outline"]?.arrayValue ?? []).map(command)
    #expect(outline == expectedOutline, "\(at): the outline")
    let gradient = WakeGeometry.gradient(segments) { $0.status.rawValue }
    let expectedGradient = (record["gradient"]?.arrayValue ?? []).map {
      WakeGradientStop(offset: $0["offset"]?.doubleValue ?? .nan, colour: $0["color"]?.stringValue ?? "?")
    }
    #expect(gradient == expectedGradient, "\(at): the gradient")
    let sheens = WakeGeometry.sheens(segments, cy: cy)
    let expectedSheens = (record["sheens"]?.arrayValue ?? []).map {
      WakeSheen(
        x0: $0["x0"]?.doubleValue ?? .nan, x1: $0["x1"]?.doubleValue ?? .nan, y: $0["y"]?.doubleValue ?? .nan)
    }
    #expect(sheens == expectedSheens, "\(at): the sheens")
  }

  /// A recorded run of segments.
  static func segments(_ json: JSONValue?) throws -> [WakeSegment] {
    try (json?.arrayValue ?? []).map { record in
      let status = try #require(TimelineStatus(rawValue: record["status"]?.stringValue ?? "?"))
      return WakeSegment(
        a: record["a"]?.doubleValue ?? .nan, b: record["b"]?.doubleValue ?? .nan,
        x0: record["x0"]?.doubleValue ?? .nan, x1: record["x1"]?.doubleValue ?? .nan, status: status,
        r: record["r"]?.doubleValue ?? .nan)
    }
  }

  /// A recorded path command, by its `op`.
  static func command(_ json: JSONValue) -> WakePathCommand? {
    func value(_ key: String) -> Double { json[key]?.doubleValue ?? .nan }
    switch json["op"]?.stringValue {
    case "M": return .move(x: value("x"), y: value("y"))
    case "L": return .line(x: value("x"), y: value("y"))
    case "C":
      return .curve(
        x1: value("x1"), y1: value("y1"), x2: value("x2"), y2: value("y2"), x: value("x"), y: value("y"))
    case "A":
      return .arc(cx: value("cx"), cy: value("cy"), r: value("r"), start: value("start"), end: value("end"))
    case "Z": return .close
    default: return nil
    }
  }

  /// A band's key as the golden spells it: a work band's colour, as the SDK keys bands by the row's colour string
  /// (`""` for none); the waits by name.
  static func key(_ colour: SwarmColor?) -> String {
    colour?.hex ?? ""
  }

  /// The map's bands in the golden's order: the work bands from the line up, then blocked, then unseen.
  static func bands(_ map: PulseMap) -> [(String, PulseBand)] {
    map.work.map { (key($0.colour), $0) } + [("blocked", map.blocked), ("unseen", map.unseen)]
  }

  /// `sum`: a band edge's values added in order, as JavaScript's numbers.
  static func sum(_ values: [Float]) -> Double {
    values.reduce(0.0) { $0 + Double($1) }
  }

  struct SummedBand: Equatable {
    let band: String
    let top: Double
    let bottom: Double
  }
}
