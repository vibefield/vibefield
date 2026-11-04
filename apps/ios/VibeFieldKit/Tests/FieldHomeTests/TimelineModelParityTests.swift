import FieldAgents
import FieldMesh
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-6 — THE TIMELINE'S MODEL, HELD TO PUPPETEER'S OWN: every row reads `phone-timeline.golden.json` (field-app's
// `perf/lib/phone-goldens-timeline.ts`: puppeteer-views 0.3.3's timeline over the home's window rows at every step of
// PG-3a's witness run, and fixed vectors on its open step), mirrored into this bundle byte for byte. No hand-copied
// value stands in a parity row; the hand rows are in `TimelineViewTests`.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-6 — the timeline view")
struct TimelineModelParityTests {
  // MARK: - The lanes, step by step (T1–T5)

  /// T1 — each step's lanes: the birth order, agents then terminals, and each lane's model.
  @Test func theLanesAreTheTimelinesStepByStep() throws {
    try TimelineWitness.walk { golden, set, step in
      for (group, lanes) in [("agents", set.agents), ("terminals", set.terminals)] {
        let expected = golden[group]?.arrayValue ?? []
        let expectedIds = expected.map { $0["id"]?.stringValue ?? "?" }
        let ids = lanes.map(\.id)
        #expect(ids == expectedIds, "step \(step.at): the \(group)' order")
        for (lane, record) in zip(lanes, expected) {
          let at = "step \(step.at) \(lane.id)"
          let kind = record["kind"]?.stringValue
          #expect(lane.kind.rawValue == kind, "\(at): kind")
          let bornMs = record["bornMs"]?.doubleValue
          #expect(lane.bornMs == bornMs, "\(at): bornMs")
          let sinceMs = record["sinceMs"]?.doubleValue
          #expect(lane.sinceMs == sinceMs, "\(at): sinceMs")
          let status = record["status"]?.stringValue
          #expect(lane.current.status.rawValue == status, "\(at): status")
          let fromMs = record["fromMs"]?.doubleValue
          #expect(lane.current.fromMs == fromMs, "\(at): fromMs")
          let waitKind = TimelineGolden.text(record["wait"]?["kind"])
          #expect(lane.current.wait?.kind == waitKind, "\(at): the wait's kind")
          let waitDetail = TimelineGolden.text(record["wait"]?["detail"])
          #expect(lane.current.wait?.detail == waitDetail, "\(at): the wait's words")
          let receded = record["receded"]?.boolValue
          #expect(lane.receded == receded, "\(at): receded")
          let colour = record["colour"]?.stringValue
          #expect((lane.colour?.hex ?? "") == colour, "\(at): the ledger's colour")
        }
      }
    }
  }

  /// T2 — each lane's words: its name, the line under it, and the sentence a screen reader hears.
  @Test func theWordsAreTheTimelinesStepByStep() throws {
    try TimelineWitness.walk { golden, set, step in
      let records = (golden["agents"]?.arrayValue ?? []) + (golden["terminals"]?.arrayValue ?? [])
      let count = set.all.count
      #expect(count == records.count, "step \(step.at): the lanes")
      for (lane, record) in zip(set.all, records) {
        let at = "step \(step.at) \(lane.id)"
        let name = record["name"]?.stringValue
        #expect(TimelineWords.name(lane) == name, "\(at): name")
        let sub = record["sub"]?.stringValue
        #expect(TimelineWords.subLine(lane) == sub, "\(at): sub")
        let label = record["label"]?.stringValue
        #expect(TimelineWords.label(lane, nowMs: TimelineGolden.nowMs) == label, "\(at): label")
      }
    }
  }

  /// T3 — each lane's readout following now, and looking back 1, 30 and 54 minutes (with the moment it reads).
  @Test func theReadoutsAreTheTimelinesStepByStep() throws {
    let now = TimelineGolden.nowMs
    try TimelineWitness.walk { golden, set, step in
      let records = (golden["agents"]?.arrayValue ?? []) + (golden["terminals"]?.arrayValue ?? [])
      let count = set.all.count
      #expect(count == records.count, "step \(step.at): the lanes")
      for (lane, record) in zip(set.all, records) {
        let at = "step \(step.at) \(lane.id)"
        let live = TimelineWords.readout(
          lane, moment: TimelineLanes.state(of: lane, at: now), at: now, live: true, nowMs: now)
        Self.expectReadout(live, record["live"], "\(at) live")
        for back in record["back"]?.arrayValue ?? [] {
          let minutes = back["minutes"]?.doubleValue ?? -1
          let moment = TimelineLanes.state(of: lane, at: now - minutes * 60_000)
          let kind = back["moment"]?.stringValue
          #expect(moment.kind == kind, "\(at) −\(minutes)m: the moment")
          let readout = TimelineWords.readout(
            lane, moment: moment, at: now - minutes * 60_000, live: false, nowMs: now)
          Self.expectReadout(readout, back, "\(at) −\(minutes)m")
        }
      }
    }
  }

  static func expectReadout(_ readout: TimelineReadout, _ record: JSONValue?, _ at: String) {
    let tone = record?["tone"]?.stringValue
    #expect(readout.tone.rawValue == tone, "\(at): tone")
    let big = record?["big"]?.stringValue
    #expect(readout.big == big, "\(at): big")
    let small = record?["small"]?.stringValue
    #expect(readout.small == small, "\(at): small")
    let owed = record?["owed"]?.boolValue
    #expect(readout.owed == owed, "\(at): owed")
  }

  /// T4 — the canvases' key over every lane, and each lane's weight with no lane lit.
  @Test func theKeyAndTheWeightsAreTheTimelines() throws {
    try TimelineWitness.walk { golden, set, step in
      let key = golden["key"]?.stringValue
      #expect(TimelineLanes.contentKey(set.all) == key, "step \(step.at): the content key")
      let records = (golden["agents"]?.arrayValue ?? []) + (golden["terminals"]?.arrayValue ?? [])
      let count = set.all.count
      #expect(count == records.count, "step \(step.at): the lanes")
      for (index, (lane, record)) in zip(set.all, records).enumerated() {
        let alpha = record["alpha"]?.doubleValue
        #expect(TimelineLanes.alpha(lane, index: index, lit: -1) == alpha, "step \(step.at) \(lane.id): alpha")
      }
    }
  }

  /// T4b — `laneAlpha` over a fixed vector (a receded lane, a lit one, another lit), and `QUIET_ALPHA`.
  @Test func theWeightsOverTheVector() throws {
    let open = try TimelineGolden.open()
    let quiet = open["quietAlpha"]?.doubleValue
    #expect(TimelineLanes.quietAlpha == quiet)
    let first = try Self.anyLane()
    let lane = try #require(first)
    for entry in try TimelineGolden.entries("alphaCalls") {
      let receded = entry["receded"]?.boolValue ?? false
      let index = Int(entry["index"]?.intValue ?? -9)
      let lit = Int(entry["lit"]?.intValue ?? -9)
      let out = entry["out"]?.doubleValue
      let row = TimelineRow(
        monitor: lane.row.monitor, isSelf: lane.row.isSelf, unread: false, colour: nil, active: false,
        receded: receded)
      let weighted = TimelineLanes.lane(for: row, nowMs: TimelineGolden.nowMs)
      #expect(TimelineLanes.alpha(weighted, index: index, lit: lit) == out, "receded \(receded) lit \(lit)")
    }
  }

  /// T5 — the map's left end and the head's earliest moment, for each preset.
  @Test func theDaysStartIsTheTimelines() throws {
    try TimelineWitness.walk { golden, set, step in
      for entry in golden["day"]?.arrayValue ?? [] {
        let spanMs = entry["spanMs"]?.doubleValue ?? -1
        let start = entry["start"]?.doubleValue
        let head = entry["head"]?.doubleValue
        #expect(
          TimelineLanes.dayStart(set, spanMs: spanMs, nowMs: TimelineGolden.nowMs) == start,
          "step \(step.at) span \(spanMs): dayStart")
        #expect(
          TimelineLanes.earliestHead(set, spanMs: spanMs, nowMs: TimelineGolden.nowMs) == head,
          "step \(step.at) span \(spanMs): earliestHead")
      }
    }
  }

  // MARK: - The fixed vectors (T8, T9, T12)

  /// T8 — the scale's words, as the SDK says them over the open step's vector.
  @Test func theScaleWordsAreTheTimelines() throws {
    var tweens: [String: TimelineTween] = [:]
    for entry in try TimelineGolden.entries("scaleCalls") {
      let fn = entry["fn"]?.stringValue ?? "?"
      let out = entry["out"]
      switch fn {
      case "clampSpan":
        let spanMs = entry["spanMs"]?.doubleValue ?? .nan
        let expected = out?.doubleValue
        #expect(TimelineScale.clampSpan(spanMs) == expected, "clampSpan \(spanMs)")
      case "initialScale":
        let nowMs = entry["nowMs"]?.doubleValue ?? .nan
        let scale = TimelineGolden.number(entry["spanMs"]).map { TimelineScale.initial(nowMs: nowMs, spanMs: $0) }
          ?? TimelineScale.initial(nowMs: nowMs)
        #expect(scale == Self.scale(out), "initialScale \(entry)")
      case "followNow":
        let given = try #require(Self.scale(entry["scale"]))
        let scale = TimelineScale.followNow(given, nowMs: entry["nowMs"]?.doubleValue ?? .nan)
        #expect(scale == Self.scale(out), "followNow \(entry)")
      case "headAt":
        let given = try #require(Self.scale(entry["scale"]))
        let scale = TimelineScale.headAt(
          given, endMs: entry["endMs"]?.doubleValue ?? .nan,
          nowMs: entry["nowMs"]?.doubleValue ?? .nan, earliestMs: entry["earliestMs"]?.doubleValue ?? .nan)
        #expect(scale == Self.scale(out), "headAt \(entry)")
      case "panBy":
        let given = try #require(Self.scale(entry["scale"]))
        let scale = TimelineScale.panBy(
          given, deltaMs: entry["deltaMs"]?.doubleValue ?? .nan,
          nowMs: entry["nowMs"]?.doubleValue ?? .nan, earliestMs: entry["earliestMs"]?.doubleValue ?? .nan)
        #expect(scale == Self.scale(out), "panBy \(entry)")
      case "zoomAt":
        let given = try #require(Self.scale(entry["scale"]))
        let scale = TimelineScale.zoomAt(
          given, spanMs: entry["spanMs"]?.doubleValue ?? .nan,
          anchorFromHeadPx: entry["anchorFromHeadPx"]?.doubleValue ?? .nan,
          widthPx: entry["widthPx"]?.doubleValue ?? .nan, nowMs: entry["nowMs"]?.doubleValue ?? .nan)
        #expect(scale == Self.scale(out), "zoomAt \(entry)")
      case "islandEase":
        let x = entry["x"]?.doubleValue ?? .nan
        let expected = out?.doubleValue
        #expect(TimelineScale.islandEase(x) == expected, "islandEase \(x)")
      case "tween":
        // made from its recorded inputs: a null target is a glide, a null duration tweenBetween's default
        let name = entry["name"]?.stringValue ?? "?"
        let from = try #require(Self.scale(entry["from"]))
        let at = entry["at"]?.doubleValue ?? .nan
        let made: TimelineTween
        if let target = Self.scale(entry["target"]) {
          made = TimelineGolden.number(entry["durationMs"]).map {
            TimelineScale.tweenBetween(from, target, at: at, durationMs: $0)
          } ?? TimelineScale.tweenBetween(from, target, at: at)
        } else {
          made = TimelineScale.glide(from, at: at)
        }
        let expected = try #require(Self.tween(out), "tween \(name) reads")
        #expect(made == expected, "tween \(name)")
        tweens[name] = expected
      case "tweenTarget":
        let tween = try #require(tweens[entry["name"]?.stringValue ?? "?"])
        let scale = TimelineScale.tweenTarget(tween, nowMs: entry["nowMs"]?.doubleValue ?? .nan)
        #expect(scale == Self.scale(out), "tweenTarget \(entry)")
      case "tweenAt":
        let tween = try #require(tweens[entry["name"]?.stringValue ?? "?"])
        let step = TimelineScale.tweenAt(
          tween, at: entry["at"]?.doubleValue ?? .nan, nowMs: entry["nowMs"]?.doubleValue ?? .nan,
          reduced: entry["reduced"]?.boolValue ?? false)
        #expect(step.scale == Self.scale(out?["scale"]), "tweenAt \(entry): scale")
        let done = out?["done"]?.boolValue
        #expect(step.done == done, "tweenAt \(entry): done")
      case "settledScale":
        let tween = entry["tween"]?.stringValue.flatMap { tweens[$0] }
        let given = try #require(Self.scale(entry["scale"]))
        let scale = TimelineScale.settled(
          given, tween: tween, nowMs: entry["nowMs"]?.doubleValue ?? .nan)
        #expect(scale == Self.scale(out), "settledScale \(entry)")
      default:
        Issue.record("a scale call the suite does not know: \(fn)")
      }
    }
    #expect(tweens.count == 4, "the four tweens")
  }

  /// T8b — the tick step for each preset's px a ms, the extremes and a chosen spacing.
  @Test func theTickStepIsTheTimelines() throws {
    for entry in try TimelineGolden.entries("tickSteps") {
      let pxPerMs = entry["pxPerMs"]?.doubleValue ?? .nan
      let out = entry["out"]?.doubleValue
      let step =
        TimelineGolden.number(entry["minPx"]).map { TimelineScale.tickStep(pxPerMs: pxPerMs, minPx: $0) }
        ?? TimelineScale.tickStep(pxPerMs: pxPerMs)
      #expect(step == out, "tickStep \(entry)")
    }
  }

  /// T8c — the ticks on wall-clock multiples of the step, ZONE-FREE: each window starts at its wall components in the
  /// zone the row names, and each tick is its offset from that start and its hour flag. Three zones, one of them off
  /// the hour by 45 minutes, read the same.
  @Test(arguments: ["America/New_York", "Asia/Kathmandu", "UTC"])
  func theTicksAreTheTimelinesInEveryZone(zone: String) throws {
    let timeZone = try #require(TimeZone(identifier: zone))
    for entry in try TimelineGolden.entries("ticks") {
      let wall = (entry["wall"]?.arrayValue ?? []).compactMap(\.intValue)
      let frac = entry["frac"]?.doubleValue ?? .nan
      let durationMs = entry["durationMs"]?.doubleValue ?? .nan
      let step = entry["step"]?.doubleValue ?? .nan
      let from = try #require(Self.instant(wall: wall, in: timeZone)) + frac
      let ticks = TimelineScale.ticksBetween(fromMs: from, toMs: from + durationMs, step: step, timeZone: timeZone)
      let expected = (entry["out"]?.arrayValue ?? []).map {
        "\($0["offset"]?.doubleValue ?? .nan) \($0["hour"]?.boolValue ?? false)"
      }
      let mine = ticks.map { "\($0.t - from) \($0.hour)" }
      #expect(mine == expected, "\(zone) \(wall) step \(step)")
    }
  }

  /// T9 — the SDK's `formatElapsed`, the timeline's own length word.
  @Test func theElapsedWordIsTheSDKs() throws {
    for entry in try TimelineGolden.entries("elapsed") {
      let ms = try #require(TimelineGolden.number(entry["in"]))
      let out = entry["out"]?.stringValue
      #expect(TimelineFormat.elapsed(ms: ms) == out, "formatElapsed \(ms)")
    }
  }

  /// T9b — the SDK's `laneWaitWords`: the wait's detail, else a question's prompt, trimmed as JavaScript trims, cut at
  /// 160 UTF-16 units.
  @Test func theWaitWordsAreTheSDKs() throws {
    for entry in try TimelineGolden.entries("waitWords") {
      let wait = entry["wait"]
      let out = TimelineGolden.text(entry["out"])
      let words =
        wait.flatMap { $0.isNull ? nil : $0 }.map {
          TimelineLanes.waitWords(
            kind: $0["kind"]?.stringValue ?? "", detail: $0["detail"]?.stringValue,
            question: $0["question"]?.stringValue)
        } ?? nil
      #expect(words == out, "laneWaitWords \(String(describing: wait))")
    }
  }

  /// T12 — `normalizeTimelineParameters` over finite numbers and absences.
  @Test func theParametersNormalizeAsTheSDKs() throws {
    let defaults = TimelineParameters.defaults
    #expect(defaults.glow == 1)
    #expect(defaults.laneMax == 36)
    for entry in try TimelineGolden.entries("parameters") {
      let input = entry["in"]
      let parameters = TimelineParameters.normalized(
        glow: TimelineGolden.number(input?["glow"]), laneMax: TimelineGolden.number(input?["laneMax"]))
      let glow = entry["out"]?["glow"]?.doubleValue
      let laneMax = entry["out"]?["laneMax"]?.doubleValue
      #expect(parameters.glow == glow, "glow \(String(describing: input))")
      #expect(parameters.laneMax == laneMax, "laneMax \(String(describing: input))")
    }
  }

  // MARK: - Reading the golden

  static func scale(_ json: JSONValue?) -> TimelineScale? {
    guard let spanMs = json?["spanMs"]?.doubleValue, let endMs = json?["endMs"]?.doubleValue,
      let live = json?["live"]?.boolValue
    else { return nil }
    return TimelineScale(spanMs: spanMs, endMs: endMs, live: live)
  }

  static func tween(_ json: JSONValue?) -> TimelineTween? {
    guard let startedAt = json?["startedAt"]?.doubleValue, let durationMs = json?["durationMs"]?.doubleValue,
      let fromSpanMs = json?["fromSpanMs"]?.doubleValue, let toSpanMs = json?["toSpanMs"]?.doubleValue,
      let fromEndMs = json?["fromEndMs"]?.doubleValue, let live = json?["live"]?.boolValue
    else { return nil }
    let toEnd: TimelineTween.End
    if json?["toEndMs"]?.stringValue == "now" {
      toEnd = .now
    } else if let ms = json?["toEndMs"]?.doubleValue {
      toEnd = .at(ms)
    } else {
      return nil
    }
    return TimelineTween(
      startedAt: startedAt, durationMs: durationMs, fromSpanMs: fromSpanMs, toSpanMs: toSpanMs, fromEndMs: fromEndMs,
      toEnd: toEnd, live: live)
  }

  /// The instant of wall components `[y, mo, d, h, mi, s, ms]` in `zone`, as JavaScript's `new Date(...)` makes it:
  /// the wall's own ms (days from the civil date, exact integer arithmetic) less the zone's offset at that instant.
  static func instant(wall: [Int64], in zone: TimeZone) -> Double? {
    guard wall.count == 7 else { return nil }
    let (y0, month, day) = (wall[0], wall[1], wall[2])
    let y = month <= 2 ? y0 - 1 : y0
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    let days = era * 146_097 + doe - 719_468
    let wallMs = Double(((days * 24 + wall[3]) * 60 + wall[4]) * 60 + wall[5]) * 1000 + Double(wall[6])
    var instant = wallMs
    for _ in 0..<2 {
      let offset = Double(zone.secondsFromGMT(for: Date(timeIntervalSince1970: instant / 1000))) * 1000
      instant = wallMs - offset
    }
    return instant
  }

  /// A lane of the witness open, for the vectors that need one.
  static func anyLane() throws -> TimelineLane? {
    var ledger = ProjectLedger.empty
    let open = try HomeFixture.witnessSteps().first
    let rows = TimelineWitness.rows(open?.rows ?? [], ledger: &ledger)
    return TimelineLanes.lanes(rows, nowMs: TimelineGolden.nowMs).agents.first
  }
}
