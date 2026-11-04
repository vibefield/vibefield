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

  /// The zone the suite reads clock words in: a half-hour offset, so a zone the golden leaked would show.
  static func zone() throws -> TimeZone {
    try #require(TimeZone(identifier: "Asia/Kolkata"), "the suite's zone")
  }

  /// A golden text with every zone-free `{{clock:<ms>}}` said by the phone's own `formatClock` in `zone`.
  static func clocks(_ text: String, zone: TimeZone) -> String {
    var out = ""
    var rest = Substring(text)
    while let open = rest.range(of: "{{clock:"), let close = rest[open.upperBound...].range(of: "}}") {
      out += rest[..<open.lowerBound]
      let ms = Double(rest[open.upperBound..<close.lowerBound]) ?? .nan
      out += GodviewFormat.formatClock(ms: ms, timeZone: zone)
      rest = rest[close.upperBound...]
    }
    return out + rest
  }

  /// A state as the golden records it (`{key, sinceMs, glyph?, words?}`); nil for a key spend does not have.
  static func state(_ value: JSONValue?) -> SpendWords.State? {
    guard let key = SpendWords.State.Key(rawValue: value?["key"]?.stringValue ?? "") else { return nil }
    var state = SpendWords.State(key: key, sinceMs: value?["sinceMs"]?.doubleValue ?? .nan)
    state.glyph = (value?["glyph"]?.stringValue).flatMap(SpendWords.Glyph.init(rawValue:))
    state.words = value?["words"]?.stringValue
    return state
  }

  /// Words and their tone (`{text, tone}`), the clock words said in `zone`.
  static func said(_ value: JSONValue?, zone: TimeZone) -> SpendWords.Said? {
    guard let text = value?["text"]?.stringValue,
      let tone = SpendWords.Tone(rawValue: value?["tone"]?.stringValue ?? "")
    else { return nil }
    return SpendWords.Said(text: clocks(text, zone: zone), tone: tone)
  }

  /// `spendNames`' map as the golden lists it (`[{id, name, one, task, model}]`).
  static func names(_ value: JSONValue?) -> [String: SpendWords.Name] {
    var out: [String: SpendWords.Name] = [:]
    for entry in value?.arrayValue ?? [] {
      out[entry["id"]?.stringValue ?? ""] = SpendWords.Name(
        name: entry["name"]?.stringValue ?? "?", one: entry["one"]?.stringValue ?? "?",
        task: entry["task"]?.stringValue ?? "?", model: entry["model"]?.stringValue ?? "?")
    }
    return out
  }

  /// `[{id, n}]` as a map.
  static func indices(_ value: JSONValue?) -> [String: Int] {
    var out: [String: Int] = [:]
    for entry in value?.arrayValue ?? [] { out[entry["id"]?.stringValue ?? ""] = Int(entry["n"]?.intValue ?? -1) }
    return out
  }

  /// A vector list's rows by id.
  static func agents(_ value: JSONValue?) throws -> [String: SpendAgent] {
    var out: [String: SpendAgent] = [:]
    for entry in value?.arrayValue ?? [] {
      let row = try Self.agent(entry)
      out[row.id] = row
    }
    return out
  }
}

/// The witness as spend reads it: PG-4t's shared replay (`HomeFixture.witnessSteps`: the open, frames 0…7, the
/// resync, frame 8's gap), each step's rows joined as the window joins them.
enum SpendWitness {
  static let nowMs = Double(HomeFixture.nowMs)

  /// The rows as spend reads them: the window's `self`, the row's own unread (no card is open in a replay, so it is
  /// the stage's `unreadIds`), not active.
  static func agents(_ rows: [RemoteFieldRow]) -> [SpendAgent] {
    rows.map { SpendAgent(monitor: $0.row.monitor, isSelf: $0.isSelf, unread: $0.unread, active: false) }
  }

  /// The open's rows, as spend reads them.
  static func open() throws -> [SpendAgent] {
    let steps = try HomeFixture.witnessSteps()
    let open = try #require(steps.first { $0.at == "open" }, "the witness opens")
    return agents(open.rows)
  }

  /// Each witness step that draws, beside its golden step.
  static func paired() throws -> [(at: String, agents: [SpendAgent], golden: JSONValue)] {
    let golden = try SpendGolden.steps()
    var out: [(at: String, agents: [SpendAgent], golden: JSONValue)] = []
    for step in try HomeFixture.witnessSteps() where !step.gap {
      let match = golden.first { SpendGolden.label($0["at"]) == step.at }
      let found = try #require(match, "the golden has no step \(step.at)")
      out.append((step.at, agents(step.rows), found))
    }
    return out
  }
}

@Suite("PG-7 — the spend view")
struct SpendParityTests {
  // MARK: - The witness, step by step

  /// W0 — the replay has the golden's witness steps: the open, frames 0…7, the resync, and frame 8's gap.
  @Test func theReplayIsTheGoldensRun() throws {
    let replay = try HomeFixture.witnessSteps().map { $0.at + ($0.gap ? " gap" : "") }
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
      let ids = meters.lines.map { $0.id }
      #expect(ids == lines.compactMap { $0["id"]?.stringValue }, "step \(at): the lines")
      for (meter, line) in zip(meters.lines, lines) {
        #expect(meter.bornMs == line["bornMs"]?.doubleValue, "step \(at) \(meter.id): bornMs")
        #expect(meter.total == line["total"]?.doubleValue, "step \(at) \(meter.id): total")
        #expect(meter.partial == line["partial"]?.boolValue, "step \(at) \(meter.id): partial")
        #expect(meter.recorded == line["recorded"]?.boolValue, "step \(at) \(meter.id): recorded")
        let points = SpendGolden.points(line["points"])
        #expect(meter.points == points, "step \(at) \(meter.id): points")
      }
      let unpriced = golden["unpriced"]?.arrayValue ?? []
      let unpricedIds = meters.unpriced.map { $0.id }
      #expect(unpricedIds == unpriced.compactMap { $0["id"]?.stringValue }, "step \(at): unpriced")
      let births = meters.unpriced.map { $0.bornMs }
      #expect(births == unpriced.compactMap { $0["bornMs"]?.doubleValue }, "step \(at): births")
    }
  }

  /// P2 — each line at now (`spendAt`): its head at the total, what it spent in the window and the points it draws
  /// from $0, its value and its five-minute rate.
  @Test func eachLineAtNowStepByStep() throws {
    let span = SpendScale.spendWindow(nowMs: SpendWitness.nowMs)
    for (at, agents, golden) in try SpendWitness.paired() {
      let set = SpendSeries.spendAt(SpendSeries.spendMeters(agents), nowMs: SpendWitness.nowMs)
      let lines = golden["atNow"]?.arrayValue ?? []
      let ids = set.lines.map { $0.id }
      #expect(ids == lines.compactMap { $0["id"]?.stringValue }, "step \(at): the lines")
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

  /// P3 — each line's words at now: its state (its key, since when, its glyph, the wait's words), its status words and
  /// their tone (a clock word said in the suite's zone), the burn the hero adds, and the figure the list prints.
  @Test func eachLinesWordsAtNowStepByStep() throws {
    let zone = try SpendGolden.zone()
    let nowMs = SpendWitness.nowMs
    let span = SpendScale.spendWindow(nowMs: nowMs)
    for (at, agents, golden) in try SpendWitness.paired() {
      let set = SpendSeries.spendSet(agents, nowMs: nowMs)
      let lines = golden["atNow"]?.arrayValue ?? []
      #expect(set.lines.count == lines.count, "step \(at): the lines")
      for (line, said) in zip(set.lines, lines) {
        let state = SpendWords.spendStateAt(bornMs: line.bornMs, agent: line.agent, t: span.tb, nowMs: nowMs)
        #expect(state == SpendGolden.state(said["state"]), "step \(at) \(line.id): state")
        let value = SpendSeries.valueAt(line, span.tb)
        let rate = value == nil ? nil : SpendSeries.rateAt(line, span.tb)
        let unrecorded = state.key != .before && value == nil
        let status =
          unrecorded
          ? SpendWords.notRecorded : SpendWords.stateWords(state, t: span.tb, perMinute: rate, timeZone: zone)
        #expect(status == SpendGolden.said(said["status"], zone: zone), "step \(at) \(line.id): status")
        let burn = unrecorded ? nil : SpendWords.printedBurn(state, perMinute: rate)
        #expect(burn == SpendGolden.number(said["burn"]), "step \(at) \(line.id): burn")
        let figure = SpendWords.est(value, partial: line.partial)
        #expect(figure == said["figure"]?.stringValue, "step \(at) \(line.id): figure")
      }
    }
  }

  /// P4 — the names every row goes by at every step (`spendNames` over the lines, then the unpriced): its project,
  /// the one-line form that tells its siblings apart, its task line and its model.
  @Test func theNamesStepByStep() throws {
    for (at, agents, golden) in try SpendWitness.paired() {
      let meters = SpendSeries.spendMeters(agents)
      let named = meters.lines.map { $0.agent } + meters.unpriced.map { $0.agent }
      let names = SpendWords.spendNames(named)
      let said = SpendGolden.names(golden["names"])
      #expect(names == said, "step \(at)")
      #expect(said.count == named.count, "step \(at): one name a row")
    }
  }

  /// P5b — the scale's labels at every step (`axisMoney`, as short as the step allows), over the ticks P5 holds.
  @Test func theScaleLabelsStepByStep() throws {
    for (at, _, golden) in try SpendWitness.paired() {
      for key in ["full", "compact"] {
        let scale = golden["scale"]?[key]
        let step = scale?["step"]?.doubleValue ?? .nan
        let labels = SpendGolden.numbers(scale?["ticks"]).map { SpendWords.axisMoney($0, step: step) }
        #expect(labels == SpendGolden.strings(scale?["labels"]), "step \(at) \(key)")
      }
    }
  }

  /// P6 — the siblings at every step (`siblingIndex`): the order each line was born in among its project's.
  @Test func theSiblingsStepByStep() throws {
    for (at, agents, golden) in try SpendWitness.paired() {
      let lines = SpendSeries.spendMeters(agents).lines
      let rows = lines.map { SpendInk.Born(id: $0.id, project: $0.agent.monitor.project.name, bornMs: $0.bornMs) }
      let sib = SpendInk.siblingIndex(rows)
      #expect(sib == SpendGolden.indices(golden["sib"]), "step \(at)")
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

  /// V1 — the money words: `money` (the toolkit's `formatUsd`, thousands as whole dollars written out with commas, even
  /// past 1e21), `est` (the tilde, a plus when partial), `perHour` (the burn by the hour: `$0/hr` at none, a tenth from
  /// $1, whole dollars from $10, `$Infinity/hr` as the window says it) and `axisMoney` (as short as the step allows).
  @Test func theMoneyWords() throws {
    let vectors = try SpendGolden.vectors()
    let money = vectors["money"]?.arrayValue ?? []
    #expect(money.count >= 23)
    for entry in money {
      let value = SpendGolden.number(entry["in"])
      #expect(SpendWords.money(value) == entry["out"]?.stringValue, "money(\(String(describing: value)))")
    }
    for entry in vectors["est"]?.arrayValue ?? [] {
      let value = SpendGolden.number(entry["in"])
      let partial = entry["partial"]?.boolValue ?? false
      let said = SpendWords.est(value, partial: partial)
      #expect(said == entry["out"]?.stringValue, "est(\(String(describing: value)), \(partial))")
    }
    let rates = vectors["perHour"]?.arrayValue ?? []
    #expect(rates.count >= 17)
    for entry in rates {
      let perMinute = SpendGolden.number(entry["in"])
      #expect(SpendWords.perHour(perMinute) == entry["out"]?.stringValue, "perHour(\(String(describing: perMinute)))")
    }
    for entry in vectors["axisMoney"]?.arrayValue ?? [] {
      let value = entry["in"]?.doubleValue ?? .nan
      let step = entry["step"]?.doubleValue ?? .nan
      #expect(SpendWords.axisMoney(value, step: step) == entry["out"]?.stringValue, "axisMoney(\(value), \(step))")
    }
  }

  /// V5 — `fitWords`: text cut at a word to a width (here the view's `averageGlyph`, 6.4 a UTF-16 unit), an
  /// ellipsis after the last word that fits, nothing when no word does.
  @Test func fitWordsCutsAtAWord() throws {
    let measure = { (text: String) in Double(text.utf16.count) * 6.4 }
    let entries = try SpendGolden.vectors()["fitWords"]?.arrayValue ?? []
    #expect(entries.count >= 8)
    for entry in entries {
      let text = entry["in"]?.stringValue ?? "?"
      let max = entry["max"]?.doubleValue ?? .nan
      #expect(SpendWords.fitWords(text, max: max, measure: measure) == entry["out"]?.stringValue, "\(text) in \(max)")
    }
  }

  /// V6 — the row's words: `taskOf` (the toolkit's detail line, its first line, leading marks off, nothing when it
  /// only repeats the project or the status) and `modelOf` over rows the witness lacks (a reply's punctuation, CRLF,
  /// digits, kana, a pending and an unobserved run, two peers, no model, no provider); `spendNames` over sibling
  /// groups.
  @Test func theRowWords() throws {
    let vectors = try SpendGolden.vectors()
    let words = vectors["words"]?.arrayValue ?? []
    #expect(words.count >= 19)
    for entry in words {
      let agent = try SpendGolden.agent(entry)
      #expect(SpendWords.taskOf(agent) == entry["taskOf"]?.stringValue, "taskOf(\(agent.id))")
      #expect(SpendWords.modelOf(agent) == entry["modelOf"]?.stringValue, "modelOf(\(agent.id))")
    }
    let rows = try SpendGolden.agents(vectors["nameRows"])
    let groups = vectors["names"]?.arrayValue ?? []
    #expect(groups.count == 3)
    for group in groups {
      let ids = SpendGolden.strings(group["rows"])
      let agents = ids.compactMap { rows[$0] }
      #expect(agents.count == ids.count, "every named row decodes")
      #expect(SpendWords.spendNames(agents) == SpendGolden.names(group["out"]), "spendNames(\(ids))")
    }
  }

  /// V7 — a row's state at a moment (`spendStateAt`: before its birth, unknown before its state began, a wait's glyph,
  /// a reply nobody opened), whether it waits on the person, the burn it prints and its words, over rows × moments ×
  /// rates the witness lacks (every wait kind, a clock skewed ahead, a run younger than the window).
  @Test func theStateWords() throws {
    let vectors = try SpendGolden.vectors()
    let zone = try SpendGolden.zone()
    let nowMs = vectors["nowMs"]?.doubleValue ?? .nan
    let rows = try SpendGolden.agents(vectors["stateRows"])
    let entries = vectors["states"]?.arrayValue ?? []
    #expect(entries.count >= 100)
    for entry in entries {
      let id = entry["id"]?.stringValue ?? "?"
      let agent = try #require(rows[id], "the state row \(id)")
      let t = entry["t"]?.doubleValue ?? .nan
      let rate = SpendGolden.number(entry["rate"])
      let born = Double(agent.monitor.createdAt)
      let state = SpendWords.spendStateAt(bornMs: born, agent: agent, t: t, nowMs: nowMs)
      #expect(state == SpendGolden.state(entry["state"]), "\(id) at \(t): state")
      #expect(SpendWords.waits(state) == entry["waits"]?.boolValue, "\(id) at \(t): waits")
      let burn = SpendWords.printedBurn(state, perMinute: rate)
      #expect(burn == SpendGolden.number(entry["burn"]), "\(id) at \(t), \(String(describing: rate)): burn")
      let said = SpendWords.stateWords(state, t: t, perMinute: rate, timeZone: zone)
      #expect(said == SpendGolden.said(entry, zone: zone), "\(id) at \(t), \(String(describing: rate)): words")
    }
  }

  /// V8 — the inks: `rgbToOklch`, a sibling's tone (the second born a step darker, the third and on a step lighter, in
  /// either ground) and the lifted fill the tag sits on, over fixed hexes; `siblingIndex` with ties by birth and id.
  /// The tones and fills — what the phone draws — are EXACT. `rgbToOklch`'s own readings are held within 1e-12 (L, C)
  /// and 1e-6° (H), said: V8's `Math.cbrt`, `hypot` and `atan2` are its fdlibm ports, not Darwin's libm, so the last
  /// bits differ (measured 2026-11-04: ≤ 2.5e-16 in L and C, ≤ 5.7e-14° in H), and a grey's hue is the atan2 of two
  /// ~1e-8 numbers, which turns those bits into 1.4e-7° (#888888).
  @Test func theInks() throws {
    let vectors = try SpendGolden.vectors()
    let inks = vectors["ink"]?.arrayValue ?? []
    #expect(inks.count == 8)
    for entry in inks {
      let hex = entry["hex"]?.stringValue ?? "?"
      let colour = try #require(SwarmColor(hex: hex), "\(hex) parses")
      let oklch = entry["oklch"]
      let ink = SpendInk.rgbToOklch(colour)
      let l = abs(ink.l - (oklch?["l"]?.doubleValue ?? .nan))
      let c = abs(ink.c - (oklch?["c"]?.doubleValue ?? .nan))
      let h = abs(ink.h - (oklch?["h"]?.doubleValue ?? .nan))
      #expect(l <= 1e-12 && c <= 1e-12 && h <= 1e-6, "rgbToOklch(\(hex)): off by \(l), \(c), \(h)°")
      for tone in entry["tone"]?.arrayValue ?? [] {
        let dark = tone["dark"]?.boolValue ?? false
        for (sib, rgba) in (tone["sibs"]?.arrayValue ?? []).enumerated() {
          let c = SpendGolden.numbers(rgba)
          try #require(c.count == 4, "an rgba is four numbers")
          let expected = SwarmColor(r: c[0], g: c[1], b: c[2], a: c[3])
          let toned = SpendInk.siblingTone(colour, sib: sib, dark: dark)
          #expect(toned == expected, "siblingTone(\(hex), \(sib), dark: \(dark))")
        }
      }
      for (sib, fill) in SpendGolden.strings(entry["fill"]).enumerated() {
        #expect(SpendInk.liftedFill(colour, sib: sib) == fill, "liftedFill(\(hex), \(sib))")
      }
    }
    let index = vectors["siblingIndex"]
    let rows = (index?["rows"]?.arrayValue ?? []).map {
      SpendInk.Born(
        id: $0["id"]?.stringValue ?? "?", project: $0["project"]?.stringValue ?? "?",
        bornMs: $0["bornMs"]?.doubleValue ?? .nan)
    }
    #expect(rows.count == 6)
    #expect(SpendInk.siblingIndex(rows) == SpendGolden.indices(index?["out"]))
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
    let ids = meters.lines.map { $0.id }
    #expect(ids == lines.compactMap { $0["id"]?.stringValue })
    for (meter, line) in zip(meters.lines, lines) {
      #expect(meter.bornMs == line["bornMs"]?.doubleValue, "\(meter.id): bornMs")
      #expect(meter.total == line["total"]?.doubleValue, "\(meter.id): total")
      #expect(meter.partial == line["partial"]?.boolValue, "\(meter.id): partial")
      #expect(meter.recorded == line["recorded"]?.boolValue, "\(meter.id): recorded")
      #expect(meter.points == SpendGolden.points(line["points"]), "\(meter.id): points")
    }
    let unpriced = vectors["seriesUnpriced"]?.arrayValue ?? []
    let unpricedIds = meters.unpriced.map { $0.id }
    #expect(unpricedIds == unpriced.compactMap { $0["id"]?.stringValue })
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
