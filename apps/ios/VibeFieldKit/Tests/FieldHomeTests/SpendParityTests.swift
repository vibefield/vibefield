import FieldAgents
import FieldMesh
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-7 — THE SPEND VIEW, HELD TO puppeteer-views 0.3.3's OWN WORDS: every parity row reads `phone-spend.golden.json`
// (field-app's `perf/lib/phone-goldens-spend.ts`: the shipping view mounted over the witness, spend's own modules by
// path, fixed vectors), mirrored into this bundle byte for byte; no hand-copied value stands in a parity row. A hand
// row says so where it stands: it is what the witness lacks.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

enum SpendGolden {
  static func load() throws -> JSONValue { try HomeFixture.json("phone-spend.golden") }

  /// A step's `at` as one string: a witness frame's number as its digits.
  static func label(_ at: JSONValue?) -> String {
    if let text = at?.stringValue { return text }
    if let number = at?.intValue { return "\(number)" }
    return "?"
  }

  /// Every step the golden records, in its order.
  static func steps() throws -> [JSONValue] {
    let golden = try load()
    let steps = golden["steps"]?.arrayValue ?? []
    return try #require(steps.isEmpty ? nil : steps, "the spend golden records no steps")
  }

  static func step(_ at: String) throws -> JSONValue {
    let found = try steps().first { label($0["at"]) == at }
    return try #require(found, "the spend golden has no step \(at)")
  }

  static func vectors() throws -> JSONValue { try step("vectors") }

  /// A number the golden carries: JSON's own, or a tag for what JSON cannot hold; nil is `undefined`.
  static func number(_ value: JSONValue?) -> Double? {
    switch value {
    case .string("NaN")?: .nan
    case .string("Infinity")?: .infinity
    case .string("-Infinity")?: -.infinity
    case .string("undefined")?, nil, .null?: nil
    case let other?: other.doubleValue
    }
  }

  static func numbers(_ value: JSONValue?) -> [Double] { (value?.arrayValue ?? []).compactMap { $0.doubleValue } }
  static func strings(_ value: JSONValue?) -> [String] { (value?.arrayValue ?? []).compactMap { $0.stringValue } }

  /// `[[t, v], …]`.
  static func points(_ value: JSONValue?) -> [SpendSeries.Point] {
    (value?.arrayValue ?? []).map { pair in
      let both = numbers(pair)
      return SpendSeries.Point(t: both.first ?? .nan, v: both.count > 1 ? both[1] : .nan)
    }
  }

  /// A vector row's agent: the wire row the golden carries, decoded as the replica decodes it, and its `self`.
  static func agent(_ entry: JSONValue) throws -> SpendAgent {
    let row = try MonitorAgentRow(json: entry["row"] ?? .null)
    let isSelf = entry["self"]?.boolValue ?? true
    return SpendAgent(monitor: row, isSelf: isSelf, unread: row.unread, active: false)
  }
}

/// PG-4t lands the shared `HomeFixture.witnessSteps(...)` (fd, Q7); this is its private stand-in: the witness open,
/// frames 0…7, PG-1c's resync after frame 7 (delivered as an open), and frame 8's gap, through `RemoteMeshCopy` as
/// FieldLink drives it (`PhoneBodyParityTests`' path).
enum SpendWitness {
  static let nowMs = 1_790_803_300_000.0

  struct Step {
    let at: String
    /// nil: the gap (the window asks again, and the run ends).
    let rows: [RemoteFieldRow]?
  }

  static func steps() throws -> [Step] {
    let open = try AgentRemoteMeshOpen(json: try HomeFixture.json("agent-remote-mesh-open.witness"))
    let list = try HomeFixture.json("agent-remote-mesh-frames.witness").arrayValue ?? []
    let frames = try list.map(AgentRemoteMeshFrame.init(json:))
    let resync = try AgentRemoteMeshOpen(json: try HomeFixture.json("agent-remote-mesh-open.resync"))
    var copy = RemoteMeshCopy()
    var out: [Step] = []
    _ = copy.open(open, now: HomeFixture.now)
    _ = copy.publish()
    out.append(Step(at: "open", rows: copy.drawn()))
    for (index, frame) in frames.enumerated() {
      if case .gap = copy.frame(frame, now: HomeFixture.now) {
        out.append(Step(at: "\(index)", rows: nil))
        return out
      }
      _ = copy.publish()
      out.append(Step(at: "\(index)", rows: copy.drawn()))
      if index == 7 {
        _ = copy.open(resync, now: HomeFixture.now)
        _ = copy.publish()
        out.append(Step(at: "resync", rows: copy.drawn()))
      }
    }
    return out
  }

  /// The rows as spend reads them: the window's `self`, the row's own unread (no card is open in a replay, so it is
  /// the stage's `unreadIds`), not active.
  static func agents(_ rows: [RemoteFieldRow]) -> [SpendAgent] {
    rows.map { SpendAgent(monitor: $0.row.monitor, isSelf: $0.isSelf, unread: $0.unread, active: false) }
  }

  /// Each witness step that draws, beside its golden step.
  static func paired() throws -> [(at: String, agents: [SpendAgent], golden: JSONValue)] {
    let golden = try SpendGolden.steps()
    var out: [(at: String, agents: [SpendAgent], golden: JSONValue)] = []
    for step in try steps() {
      guard let rows = step.rows else { continue }
      let match = golden.first { SpendGolden.label($0["at"]) == step.at }
      let found = try #require(match, "the golden has no step \(step.at)")
      out.append((step.at, agents(rows), found))
    }
    return out
  }
}

@Suite("PG-7 — the spend view")
struct SpendParityTests {
  // MARK: - The witness, step by step

  /// W0 — the replay has the golden's witness steps: the open, frames 0…7, the resync, and frame 8's gap.
  @Test func theReplayIsTheGoldensRun() throws {
    let replay = try SpendWitness.steps().map { $0.at + ($0.rows == nil ? " gap" : "") }
    let golden = try SpendGolden.steps()
      .filter { $0["frame"] != nil || SpendGolden.label($0["at"]) == "open" }
      .map { SpendGolden.label($0["at"]) + ($0["gap"]?.boolValue == true ? " gap" : "") }
    #expect(replay == golden)
    #expect(replay.count == 11)
  }

  /// P1 — the meters (`spendMeters`) at every step: each priced agent's id, birth, total, partial, whether it is
  /// recorded, and its readings back through its buckets; every unpriced agent. The witness carries the edges itself:
  /// run-h-partial's buckets outsum its total (the settled clamp), pty-p3's series is a peer's (no line), the
  /// terminals are not here, rows leave at steps 4, 6 and 7.
  @Test func theMetersStepByStep() throws {
    for (at, agents, golden) in try SpendWitness.paired() {
      let meters = SpendSeries.spendMeters(agents)
      let lines = golden["meters"]?.arrayValue ?? []
      #expect(meters.lines.map(\.id) == lines.compactMap { $0["id"]?.stringValue }, "step \(at): the lines")
      for (meter, line) in zip(meters.lines, lines) {
        #expect(meter.bornMs == line["bornMs"]?.doubleValue, "step \(at) \(meter.id): bornMs")
        #expect(meter.total == line["total"]?.doubleValue, "step \(at) \(meter.id): total")
        #expect(meter.partial == line["partial"]?.boolValue, "step \(at) \(meter.id): partial")
        #expect(meter.recorded == line["recorded"]?.boolValue, "step \(at) \(meter.id): recorded")
        let points = SpendGolden.points(line["points"])
        #expect(meter.points == points, "step \(at) \(meter.id): points")
      }
      let unpriced = golden["unpriced"]?.arrayValue ?? []
      #expect(meters.unpriced.map(\.id) == unpriced.compactMap { $0["id"]?.stringValue }, "step \(at): unpriced")
      #expect(
        meters.unpriced.map(\.bornMs) == unpriced.compactMap { $0["bornMs"]?.doubleValue }, "step \(at): births")
    }
  }

  /// P2 — each line at now (`spendAt`): its head at the total, what it spent in the window and the points it draws
  /// from $0, its value and its five-minute rate.
  @Test func eachLineAtNowStepByStep() throws {
    let span = SpendScale.spendWindow(nowMs: SpendWitness.nowMs)
    for (at, agents, golden) in try SpendWitness.paired() {
      let set = SpendSeries.spendAt(SpendSeries.spendMeters(agents), nowMs: SpendWitness.nowMs)
      let lines = golden["atNow"]?.arrayValue ?? []
      #expect(set.lines.map(\.id) == lines.compactMap { $0["id"]?.stringValue }, "step \(at): the lines")
      for (line, said) in zip(set.lines, lines) {
        let head = SpendGolden.points(.array([said["head"] ?? .null])).first
        #expect(line.points.last == head, "step \(at) \(line.id): the head")
        let spent = SpendSeries.spentAt(line, span.ta, span.tb)
        #expect(spent == SpendGolden.number(said["spent"]), "step \(at) \(line.id): spent")
        let spentPoints = SpendSeries.spentPoints(line, span.ta, span.tb)
        #expect(spentPoints == SpendGolden.points(said["spentPoints"]), "step \(at) \(line.id): spentPoints")
        let value = SpendSeries.valueAt(line, span.tb)
        #expect(value == SpendGolden.number(said["value"]), "step \(at) \(line.id): value")
        let rate = value == nil ? nil : SpendSeries.rateAt(line, span.tb)
        #expect(rate == SpendGolden.number(said["rate"]), "step \(at) \(line.id): rate")
      }
    }
  }

  /// P5 — the scale at every step: from $0 to a round top above the most spent in the window, full and compact, and
  /// its ticks (their labels are the words' rows).
  @Test func theScaleStepByStep() throws {
    let span = SpendScale.spendWindow(nowMs: SpendWitness.nowMs)
    for (at, agents, golden) in try SpendWitness.paired() {
      let set = SpendSeries.spendSet(agents, nowMs: SpendWitness.nowMs)
      let top = set.lines.map { SpendSeries.spentAt($0, span.ta, span.tb) ?? 0 }.reduce(0, max)
      let scale = golden["scale"]
      #expect(top == scale?["top"]?.doubleValue, "step \(at): the top")
      for (compact, key) in [(false, "full"), (true, "compact")] {
        let (step, max) = SpendScale.moneyScale(top: top, compact: compact)
        let said = scale?[key]
        #expect(step == said?["step"]?.doubleValue, "step \(at) \(key): step")
        #expect(max == said?["max"]?.doubleValue, "step \(at) \(key): max")
        let ticks = SpendScale.moneyTicks(max: max, step: step)
        #expect(ticks == SpendGolden.numbers(said?["ticks"]), "step \(at) \(key): ticks")
      }
    }
  }

  /// P4a — the list's order at every step: most spent first by each run's total, equal spend the elder first.
  @Test func theOrderStepByStep() throws {
    for (at, agents, golden) in try SpendWitness.paired() {
      let set = SpendSeries.spendSet(agents, nowMs: SpendWitness.nowMs)
      let order = SpendList.listOrder(set.lines.map { .init(id: $0.id, value: $0.total, bornMs: $0.bornMs) })
      #expect(order == SpendGolden.strings(golden["order"]), "step \(at)")
    }
  }

  // MARK: - The vectors

  /// V0 — the constants and the window.
  @Test func theConstants() throws {
    let vectors = try SpendGolden.vectors()
    let constants = vectors["constants"]
    #expect(SpendSeries.rateWindowMs == constants?["RATE_WINDOW_MS"]?.doubleValue)
    #expect(SpendScale.stepMs == constants?["SPEND_STEP_MS"]?.doubleValue)
    #expect(SpendScale.stepCount == constants?["SPEND_STEP_COUNT"]?.doubleValue)
    #expect(SpendScale.windowMs == constants?["SPEND_WINDOW_MS"]?.doubleValue)
    #expect(SpendScale.timeTickMs == constants?["TIME_TICK_MS"]?.doubleValue)
    let nowMs = vectors["nowMs"]?.doubleValue ?? .nan
    let span = SpendScale.spendWindow(nowMs: nowMs)
    #expect(span.ta == vectors["window"]?["ta"]?.doubleValue)
    #expect(span.tb == vectors["window"]?["tb"]?.doubleValue)
  }

  /// V1a — JavaScript's `toFixed` (spend's `jsFixed`, Q-S11 (b)): the exact ties take the larger digit (0.25 → 0.3,
  /// 2.5 → 3), the near-ties are the binary value's (1.005 → 1.00), and six places clean an accumulated sum.
  @Test func toFixedSaysJavaScriptsDigits() throws {
    let entries = try SpendGolden.vectors()["toFixed"]?.arrayValue ?? []
    #expect(entries.count >= 15)
    for entry in entries {
      let value = SpendGolden.number(entry["in"]) ?? .nan
      let places = Int(entry["places"]?.intValue ?? -1)
      let said = SpendNumber.fixed(value, places)
      #expect(said == entry["out"]?.stringValue, "(\(value)).toFixed(\(places))")
    }
  }

  /// V2 — the scale's numbers: `niceStep`, `moneyScale` with its ticks, `easeTop` (a new high never jumps), and the
  /// moments a pointer reads or a click holds.
  @Test func theScaleVectors() throws {
    let vectors = try SpendGolden.vectors()
    for entry in vectors["niceStep"]?.arrayValue ?? [] {
      let max = entry["max"]?.doubleValue ?? .nan
      let count = entry["count"]?.doubleValue ?? .nan
      let step = SpendScale.niceStep(max, count)
      #expect(step == entry["out"]?.doubleValue, "niceStep(\(max), \(count))")
    }
    for entry in vectors["moneyScale"]?.arrayValue ?? [] {
      let top = entry["top"]?.doubleValue ?? .nan
      let compact = entry["compact"]?.boolValue ?? false
      let (step, max) = SpendScale.moneyScale(top: top, compact: compact)
      #expect(step == entry["step"]?.doubleValue, "moneyScale(\(top), \(compact)): step")
      #expect(max == entry["max"]?.doubleValue, "moneyScale(\(top), \(compact)): max")
      let ticks = SpendScale.moneyTicks(max: max, step: step)
      #expect(ticks == SpendGolden.numbers(entry["ticks"]), "moneyScale(\(top), \(compact)): ticks")
    }
    for entry in vectors["easeTop"]?.arrayValue ?? [] {
      let shown = entry["shown"]?.doubleValue
      let target = entry["target"]?.doubleValue ?? .nan
      let eased = SpendScale.easeTop(shown: shown, target: target)
      #expect(eased == entry["out"]?.doubleValue, "easeTop(\(String(describing: shown)), \(target))")
    }
    let nowMs = vectors["nowMs"]?.doubleValue ?? .nan
    let span = SpendScale.spendWindow(nowMs: nowMs)
    for entry in vectors["moments"]?.arrayValue ?? [] {
      let t = entry["t"]?.doubleValue ?? .nan
      #expect(SpendScale.momentIn(t, span) == entry["momentIn"]?.doubleValue, "momentIn(\(t))")
      #expect(SpendScale.heldIn(t, span) == entry["heldIn"]?.doubleValue, "heldIn(\(t))")
    }
    #expect(SpendScale.heldIn(nil, span) == nil)
  }

  /// V3 — the time ticks at the phone's widths and others: every two minutes, doubled where labels would touch, none
  /// by the left edge or within 46 px of a chip.
  @Test func theTimeTicks() throws {
    let vectors = try SpendGolden.vectors()
    let span = SpendScale.spendWindow(nowMs: vectors["nowMs"]?.doubleValue ?? .nan)
    let entries = vectors["timeTicks"]?.arrayValue ?? []
    #expect(entries.count >= 24)
    for entry in entries {
      let x0 = entry["x0"]?.doubleValue ?? .nan
      let x1 = entry["x1"]?.doubleValue ?? .nan
      let chips = SpendGolden.numbers(entry["chips"])
      let ticks = SpendScale.timeTicks(ta: span.ta, tb: span.tb, x0: x0, x1: x1, chips: chips)
      let said = (entry["out"]?.arrayValue ?? []).map {
        SpendScale.Tick(t: $0["t"]?.doubleValue ?? .nan, x: $0["x"]?.doubleValue ?? .nan)
      }
      #expect(ticks == said, "timeTicks(\(x0)…\(x1), chips \(chips))")
    }
  }

  /// V4 — the watchlist: `listOrder` (most spent first; held under the pointer; while scrubbing hold, sink or rank),
  /// `fitList` (what fits in its slots, the "more" row, the waiting rows docked) and `moreWords`.
  @Test func theListVectors() throws {
    let vectors = try SpendGolden.vectors()
    let entries = (vectors["orderEntries"]?.arrayValue ?? []).map {
      SpendList.Entry(
        id: $0["id"]?.stringValue ?? "", value: $0["value"]?.doubleValue ?? .nan,
        bornMs: $0["bornMs"]?.doubleValue ?? .nan)
    }
    for entry in vectors["listOrder"]?.arrayValue ?? [] {
      let options = entry["options"]
      let held = options?["held"].map(SpendGolden.strings)
      var scrub: SpendList.Scrub?
      if let said = options?["scrub"] {
        let values = said["values"]?.objectValue ?? [:]
        let order = SpendList.ScrubOrder(rawValue: said["order"]?.stringValue ?? "") ?? .hold
        scrub = SpendList.Scrub(
          t: said["t"]?.doubleValue ?? .nan, order: order, valueAt: { values[$0]?.doubleValue })
      }
      let order = SpendList.listOrder(entries, held: held, scrub: scrub)
      #expect(order == SpendGolden.strings(entry["out"]), "listOrder \(String(describing: options))")
    }
    let fits = vectors["fitList"]?.arrayValue ?? []
    #expect(fits.count >= 10)
    for entry in fits {
      let n = Int(entry["n"]?.intValue ?? 0)
      let order = (0..<n).map { "r\($0)" }
      var waiting: [String: Double] = [:]
      for pair in entry["waiting"]?.arrayValue ?? [] {
        let both = SpendGolden.numbers(pair)
        if both.count == 2 { waiting["r\(Int(both[0]))"] = both[1] }
      }
      let cap = Int(entry["cap"]?.intValue ?? 0)
      let offset = Int(entry["offset"]?.intValue ?? 0)
      let dock = entry["dock"]?.boolValue ?? true
      let fit = SpendList.fitList(order, cap: cap, offset: offset, waiting: waiting, dock: dock)
      let out = entry["out"]
      let said = SpendList.Fit(
        fits: Int(out?["fits"]?.intValue ?? -1), offset: Int(out?["offset"]?.intValue ?? -1),
        maxOffset: Int(out?["maxOffset"]?.intValue ?? -1), docked: SpendGolden.strings(out?["docked"]),
        more: out?["more"]?.boolValue ?? false, below: Int(out?["below"]?.intValue ?? -1),
        above: Int(out?["above"]?.intValue ?? -1), waitingUnshown: Int(out?["waitingUnshown"]?.intValue ?? -1))
      #expect(fit == said, "fitList(\(n), cap \(cap), offset \(offset), waiting \(waiting), dock \(dock))")
      if let words = entry["moreWords"]?.stringValue {
        #expect(SpendList.moreWords(fit) == words, "moreWords(\(n), cap \(cap), offset \(offset))")
      }
    }
  }

  /// V9 — the lines the witness lacks: a birth inside the window (the line begins there), a birth after now (another
  /// clock's: the line begins at now), no steps, a negative step, an open coverage word (priced, not partial), no
  /// price, a negative total, a peer's series, a terminal's cost, buckets all before the window. Each line at now,
  /// read at eight moments, cut to the window, and drawn from $0.
  @Test func theSeriesVectors() throws {
    let vectors = try SpendGolden.vectors()
    let nowMs = vectors["nowMs"]?.doubleValue ?? .nan
    let span = SpendScale.spendWindow(nowMs: nowMs)
    let agents = try (vectors["seriesRows"]?.arrayValue ?? []).map(SpendGolden.agent)
    #expect(agents.count == 10)
    let meters = SpendSeries.spendMeters(agents)
    let lines = vectors["seriesMeters"]?.arrayValue ?? []
    #expect(meters.lines.map(\.id) == lines.compactMap { $0["id"]?.stringValue })
    for (meter, line) in zip(meters.lines, lines) {
      #expect(meter.bornMs == line["bornMs"]?.doubleValue, "\(meter.id): bornMs")
      #expect(meter.total == line["total"]?.doubleValue, "\(meter.id): total")
      #expect(meter.partial == line["partial"]?.boolValue, "\(meter.id): partial")
      #expect(meter.recorded == line["recorded"]?.boolValue, "\(meter.id): recorded")
      #expect(meter.points == SpendGolden.points(line["points"]), "\(meter.id): points")
    }
    let unpriced = vectors["seriesUnpriced"]?.arrayValue ?? []
    #expect(meters.unpriced.map(\.id) == unpriced.compactMap { $0["id"]?.stringValue })
    let readings = vectors["seriesAt"]?.arrayValue ?? []
    #expect(readings.count == meters.lines.count)
    for (meter, said) in zip(meters.lines, readings) {
      let line = SpendSeries.lineAt(meter, nowMs: nowMs)
      #expect(line.bornMs == said["bornMs"]?.doubleValue, "\(line.id): lineAt's birth")
      #expect(line.points == SpendGolden.points(said["points"]), "\(line.id): lineAt's points")
      for reading in said["at"]?.arrayValue ?? [] {
        let t = reading["t"]?.doubleValue ?? .nan
        let value = SpendSeries.valueAt(line, t)
        #expect(value == SpendGolden.number(reading["value"]), "\(line.id) valueAt(\(t))")
        let rate = SpendSeries.rateAt(line, t)
        #expect(rate == SpendGolden.number(reading["rate"]), "\(line.id) rateAt(\(t))")
        let spent = SpendSeries.spentAt(line, span.ta, t)
        #expect(spent == SpendGolden.number(reading["spent"]), "\(line.id) spentAt(\(t))")
      }
      let window = SpendSeries.windowPoints(line, span.ta, span.tb)
      #expect(window == SpendGolden.points(said["windowPoints"]), "\(line.id): windowPoints")
      let spent = SpendSeries.spentPoints(line, span.ta, span.tb)
      #expect(spent == SpendGolden.points(said["spentPoints"]), "\(line.id): spentPoints")
      let one = SpendSeries.lineOf(meter.agent, nowMs: nowMs)
      #expect(one == line, "\(line.id): lineOf is meterOf then lineAt")
    }
  }
}
