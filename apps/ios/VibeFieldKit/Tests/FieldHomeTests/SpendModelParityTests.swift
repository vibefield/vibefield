import FieldAgents
import FieldMesh
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-7 — THE COMPOSITION, HELD TO THE SHIPPING VIEW'S DOM: every step the golden mounted `spendMonitorView` at (the
// witness's, and the view's own: compact, pointed, a moment held, a short list, a scrolled one, rows not yet born,
// none) laid out by `SpendModel` over the same rows at the same stage and compared field by field. happy-dom lays
// out nothing, so the golden measured with the view's own `averageGlyph` (6.4 a UTF-16 unit), as these rows do; it
// writes a `left`/`top` to six places, so those compare within 5e-7, and a transform keeps JavaScript's digits, so
// those compare exactly. Hand rows (H) say what the witness lacks. Host-buildable; an extension of the one suite.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

enum SpendDOM {
  /// The view's own fallback measure where nothing lays out: 6.4 a UTF-16 unit (`averageGlyph`).
  static func averageGlyph(_ text: String, _ style: SpendModel.TextStyle) -> Double { Double(text.utf16.count) * 6.4 }

  /// `"538.428571px"` → 538.428571.
  static func px(_ value: JSONValue?) -> Double? {
    guard let text = value?.stringValue, text.hasSuffix("px") else { return nil }
    return Double(text.dropLast(2))
  }

  /// A `left`/`top` happy-dom wrote to six places.
  static func near(_ value: Double, _ said: JSONValue?) -> Bool {
    guard let said = px(said) else { return false }
    return abs(value - said) <= 5e-7
  }

  /// `translate(Xpx, Ypx)`, or the tag's `translate(calc(Xpx - 100%), Ypx)` (trailing): JavaScript's digits, exact.
  static func translate(_ value: JSONValue?) -> (x: Double, y: Double, trailing: Bool)? {
    guard var text = value?.stringValue, text.hasPrefix("translate("), text.hasSuffix(")") else { return nil }
    text = String(text.dropFirst("translate(".count).dropLast())
    var trailing = false
    if text.hasPrefix("calc(") {
      trailing = true
      text = text.replacingOccurrences(of: "calc(", with: "").replacingOccurrences(of: " - 100%)", with: "")
    }
    let parts = text.components(separatedBy: ", ")
    guard parts.count == 2, parts[0].hasSuffix("px"), parts[1].hasSuffix("px"),
      let x = Double(parts[0].dropLast(2)), let y = Double(parts[1].dropLast(2))
    else { return nil }
    return (x, y, trailing)
  }

  /// A class list less its base class.
  static func classes(_ value: JSONValue?, base: String) -> Set<String> {
    Set((value?.stringValue ?? "").split(separator: " ").map(String.init).filter { $0 != base })
  }

  /// The steady frame after the view's effects: the top landed (still), a passed moment let go.
  static func settled(_ input: SpendModel.Input, _ state: inout SpendModel.State) -> SpendModel.Frame {
    for _ in 0..<4 {
      let frame = SpendModel.frame(input, state)
      let before = state
      SpendModel.settle(frame, &state, motion: false)
      if state == before { return frame }
    }
    return SpendModel.frame(input, state)
  }

  /// A point on the chart as the golden's acts aim it: at `t`, on the zero line (1 pt above) or the top (4 pt below).
  static func at(_ frame: SpendModel.Frame, _ t: Double, top: Bool) -> (x: Double, y: Double) {
    let g = frame.g
    let span = frame.span
    let x = g.x0 + ((t - span.ta) / (span.tb - span.ta)) * (g.x1 - g.x0)
    return (x, top ? g.y0 + 4 : g.y1 - 1)
  }

  /// A tap on empty chart as the golden's acts make it (move, down, up, out), each followed by its frame.
  static func tap(_ input: SpendModel.Input, _ state: inout SpendModel.State, t: Double) {
    let first = settled(input, &state)
    let point = at(first, t, top: true)
    SpendModel.point(first, &state, x: point.x, y: point.y)
    SpendModel.press(&state, x: point.x, y: point.y)
    let pointed = settled(input, &state)
    _ = SpendModel.lift(pointed, &state, x: point.x, y: point.y)
    SpendModel.leave(&state)
  }
}

extension SpendParityTests {
  /// The rows and acts behind each step the golden mounted the view at (the witness steps are paired by `at`).
  private static func viewInputs() throws -> [(at: String, agents: [SpendAgent], nowMs: Double, act: String?)] {
    let open = try SpendWitness.steps().first { $0.at == "open" }?.rows ?? []
    let agents = SpendWitness.agents(open)
    let vectors = try SpendGolden.vectors()
    let lines = try (vectors["seriesRows"]?.arrayValue ?? []).map(SpendGolden.agent)
    let now = SpendWitness.nowMs
    var out = try SpendWitness.paired().map { (at: $0.at, agents: $0.agents, nowMs: now, act: String?.none) }
    out += [
      ("open · compact", agents, now, nil), ("open · pointed", agents, now, "point"),
      ("open · moment", agents, now, "tap"), ("open · moment · unrecorded", agents, now, "tap"),
      ("open · short", agents, now, nil), ("open · short · scrolled", agents, now, "scroll"),
      ("lines · before", lines, vectors["nowMs"]?.doubleValue ?? .nan, "tap"), ("empty", [], now, nil),
    ]
    return out
  }

  /// P7 — the composition at every step the golden mounted the shipping view: the root, the hero, the column's
  /// caption, the list's head, the money and time axes and their chips, the Now pill, the tag, the "more" row, the
  /// empty words, and every list row (its state, place, size, classes, name, peer, glyph, figure, task, state words,
  /// title and label). A clock word is said in the suite's zone.
  @Test func theCompositionStepByStep() throws {
    let zone = try SpendGolden.zone()
    let inputs = try Self.viewInputs()
    #expect(inputs.count == 18)
    for (at, agents, nowMs, act) in inputs {
      let golden = try SpendGolden.step(at)
      let stage = golden["stage"]
      let width = stage?["width"]?.doubleValue ?? .nan
      let height = stage?["height"]?.doubleValue ?? .nan
      let input = SpendModel.Input(
        agents: agents, nowMs: nowMs, width: width, height: height, timeZone: zone, measure: SpendDOM.averageGlyph)
      var state = SpendModel.State()
      if let moment = golden["moment"]?.doubleValue {
        let frame = SpendDOM.settled(input, &state)
        if act == "point" {
          let point = SpendDOM.at(frame, moment, top: false)
          SpendModel.point(frame, &state, x: point.x, y: point.y)
        } else {
          SpendDOM.tap(input, &state, t: moment)
        }
      }
      if act == "scroll" {
        let shown = SpendDOM.settled(input, &state)
        SpendModel.scrollList(shown, &state, deltaY: 1)
      }
      let frame = SpendDOM.settled(input, &state)
      Self.compareView(frame, golden["view"], zone: zone, at: at)
      Self.compareRows(frame.rows, golden["viewRows"]?.arrayValue ?? [], zone: zone, at: at)
    }
  }

  private static func compareView(_ frame: SpendModel.Frame, _ view: JSONValue?, zone: TimeZone, at: String) {
    let g = frame.g
    let root = view?["root"]
    let rootClasses = SpendDOM.classes(root?["className"], base: "vf-monitor-spend")
    #expect(rootClasses == (g.compact ? ["is-compact"] : []), "\(at): root classes")
    #expect(SpendDOM.px(root?["list"]) == g.listW, "\(at): the list's width")
    #expect(root?["label"]?.stringValue == SpendModel.windowLabel, "\(at): the view's label")

    let hero = view?["hero"]
    let heroClasses = SpendDOM.classes(hero?["className"], base: "vf-monitor-spend-hero")
    var heroSaid: Set<String> = []
    if frame.hero.compact { heroSaid.insert("is-compact") }
    if frame.hero.narrow { heroSaid.insert("is-narrow") }
    #expect(heroClasses == heroSaid, "\(at): hero classes")
    #expect(SpendDOM.near(frame.hero.left, hero?["left"]), "\(at): hero left")
    #expect(frame.hero.big == hero?["big"]?.stringValue, "\(at): hero big")
    let rate = SpendGolden.clocks(hero?["rate"]?.stringValue ?? "?", zone: zone)
    #expect(frame.hero.rate == rate, "\(at): hero rate")
    #expect(frame.hero.what == hero?["what"]?.stringValue, "\(at): hero what")

    let colcap = view?["colcap"]
    #expect(frame.colcap.text == colcap?["text"]?.stringValue, "\(at): colcap")
    #expect(SpendDOM.near(frame.colcap.left, colcap?["left"]), "\(at): colcap left")
    #expect(SpendDOM.near(frame.colcap.top, colcap?["top"]), "\(at): colcap top")

    let head = view?["head"]
    let headClasses = SpendDOM.classes(head?["className"], base: "vf-monitor-spend-head")
    #expect(headClasses == (frame.head.slim ? ["is-slim"] : []), "\(at): head classes")
    let headAt = SpendDOM.translate(head?["transform"])
    #expect(headAt?.x == frame.head.x && headAt?.y == frame.head.y, "\(at): head place")
    #expect(SpendDOM.px(head?["width"]) == frame.head.width, "\(at): head width")
    #expect(frame.head.a == head?["a"]?.stringValue, "\(at): head a")
    let headB = SpendGolden.clocks(head?["b"]?.stringValue ?? "?", zone: zone)
    #expect(frame.head.b == headB, "\(at): head b")

    let y = view?["y"]?.arrayValue ?? []
    #expect(frame.yTicks.count == y.count, "\(at): money ticks")
    for (tick, said) in zip(frame.yTicks, y) {
      #expect(tick.text == said["text"]?.stringValue, "\(at): money tick \(tick.text)")
      #expect(SpendDOM.near(tick.left, said["left"]), "\(at): money tick \(tick.text) left")
      #expect(SpendDOM.near(tick.top, said["top"]), "\(at): money tick \(tick.text) top")
    }
    let x = view?["x"]?.arrayValue ?? []
    #expect(frame.xTicks.count == x.count, "\(at): time ticks")
    for (tick, said) in zip(frame.xTicks, x) {
      let clock = SpendGolden.clocks(said["clock"]?.stringValue ?? "?", zone: zone)
      #expect(tick.text == clock, "\(at): time tick \(tick.text)")
      #expect(SpendDOM.near(tick.left, said["left"]), "\(at): time tick \(tick.text) left")
      #expect(SpendDOM.near(tick.top, said["top"]), "\(at): time tick \(tick.text) top")
    }
    let chips = view?["chips"]?.arrayValue ?? []
    #expect(frame.chips.count == chips.count, "\(at): chips")
    for (chip, said) in zip(frame.chips, chips) {
      var flags: Set<String> = []
      if chip.moment { flags.insert("is-moment") }
      if chip.held { flags.insert("is-held") }
      #expect(SpendDOM.classes(said["className"], base: "vf-monitor-spend-chip") == flags, "\(at): chip classes")
      let clock = SpendGolden.clocks(said["clock"]?.stringValue ?? "?", zone: zone)
      #expect(chip.text == clock, "\(at): chip \(chip.text)")
      #expect(SpendDOM.near(chip.left, said["left"]), "\(at): chip \(chip.text) left")
      #expect(SpendDOM.near(chip.top, said["top"]), "\(at): chip \(chip.text) top")
    }

    let more = view?["more"]
    #expect((frame.more == nil) == (more == nil), "\(at): the more row")
    if let row = frame.more, let more {
      let place = SpendDOM.translate(more["transform"])
      #expect(place?.x == g.lx0 && place?.y == row.top, "\(at): more place")
      #expect(row.words == more["name"]?.stringValue, "\(at): more words")
      #expect(row.waiting == more["v"]?.stringValue, "\(at): more waiting")
      #expect(row.attention == (more["tone"]?.stringValue == "attention"), "\(at): more tone")
    }

    let empty = view?["empty"].map(SpendGolden.strings)
    #expect(frame.empty == (empty != nil), "\(at): empty")
    if let empty { #expect(empty == [SpendModel.emptyTitle, SpendModel.emptyHint], "\(at): empty words") }

    let now = view?["now"]
    #expect((frame.now == nil) == (now == nil), "\(at): the Now pill")
    if let pill = frame.now, let now {
      #expect(now["title"]?.stringValue == SpendModel.nowTitle, "\(at): Now title")
      #expect(now["label"]?.stringValue == SpendModel.nowLabel, "\(at): Now label")
      #expect(now["keys"]?.stringValue == SpendModel.nowKey, "\(at): Now key")
      #expect(now["legend"]?.stringValue == SpendModel.nowLegend, "\(at): Now legend")
      #expect(now["words"]?.stringValue == SpendModel.nowWords, "\(at): Now words")
      #expect(SpendDOM.near(pill.right, now["right"]), "\(at): Now right")
      #expect(SpendDOM.near(pill.top, now["top"]), "\(at): Now top")
    }

    let tag = view?["tag"]
    #expect((frame.tag == nil) == (tag == nil), "\(at): the tag")
    if let mark = frame.tag, let tag {
      #expect(mark.text == tag["text"]?.stringValue, "\(at): tag text")
      let place = SpendDOM.translate(tag["transform"])
      #expect(place?.x == mark.x && place?.y == mark.y && place?.trailing == mark.trailing, "\(at): tag place")
    }
  }

  private static func compareRows(_ rows: [SpendModel.Row], _ golden: [JSONValue], zone: TimeZone, at: String) {
    let ids = rows.map { $0.id }
    #expect(ids == golden.compactMap { $0["id"]?.stringValue }, "\(at): the rows")
    for (row, said) in zip(rows, golden) {
      let tag = "\(at) \(row.id)"
      #expect(row.state.key.rawValue == said["state"]?.stringValue, "\(tag): state")
      #expect(row.dir?.rawValue == said["dir"]?.stringValue, "\(tag): dir")
      #expect(row.hidden == (said["hidden"]?.boolValue ?? false), "\(tag): hidden")
      let flags = Set(row.flags.map { $0.rawValue })
      #expect(flags == SpendDOM.classes(said["className"], base: "vf-monitor-spend-row"), "\(tag): classes")
      let place = SpendDOM.translate(said["transform"])
      #expect(place?.x == row.x && place?.y == row.top, "\(tag): place")
      #expect(SpendDOM.px(said["width"]) == row.width, "\(tag): width")
      #expect(SpendDOM.px(said["height"]) == row.height, "\(tag): height")
      #expect(row.hollow == said["hollow"]?.boolValue, "\(tag): hollow")
      #expect(row.name == said["name"]?.stringValue, "\(tag): name")
      let peer = row.peer.map { "on \($0)" }
      #expect(peer == said["peer"]?.stringValue, "\(tag): peer")
      #expect(row.stg?.tone.rawValue == said["stg"]?["tone"]?.stringValue, "\(tag): stg tone")
      #expect(row.stg?.glyph.rawValue == said["stg"]?["glyph"]?.stringValue, "\(tag): stg glyph")
      let figure = SpendGolden.clocks(said["figure"]?.stringValue ?? "?", zone: zone)
      #expect(row.figure == figure, "\(tag): figure")
      #expect(said["figureTone"] == nil, "\(tag): a row's figure has no tone")
      #expect(row.task == said["task"]?.stringValue, "\(tag): task")
      let stateText = said["stateText"]?.stringValue.map { SpendGolden.clocks($0, zone: zone) }
      #expect(row.stateText == stateText, "\(tag): state words")
      #expect(row.stateTone?.rawValue == said["stateTone"]?.stringValue, "\(tag): state tone")
      #expect(row.glyph?.rawValue == said["glyph"]?.stringValue, "\(tag): glyph")
      #expect(row.title == said["title"]?.stringValue, "\(tag): title")
      let label = SpendGolden.clocks(said["label"]?.stringValue ?? "?", zone: zone)
      #expect(row.label == label, "\(tag): label")
    }
  }

  /// V10 — `geometryFor` at the phone's sizes and others: the margins, the list's width, the plot, the rows.
  @Test func theGeometryVectors() throws {
    let entries = try SpendGolden.vectors()["geometry"]?.arrayValue ?? []
    #expect(entries.count == 8)
    for said in entries {
      let width = said["width"]?.doubleValue ?? .nan
      let height = said["height"]?.doubleValue ?? .nan
      let g = SpendModel.geometryFor(width: width, height: height)
      let expected = SpendModel.Geometry(
        width: width, height: height, compact: said["compact"]?.boolValue ?? false,
        narrow: said["narrow"]?.boolValue ?? false, x0: said["x0"]?.doubleValue ?? .nan,
        x1: said["x1"]?.doubleValue ?? .nan, y0: said["y0"]?.doubleValue ?? .nan, y1: said["y1"]?.doubleValue ?? .nan,
        lx0: said["lx0"]?.doubleValue ?? .nan, listW: said["listW"]?.doubleValue ?? .nan,
        ly0: said["ly0"]?.doubleValue ?? .nan, ly1: said["ly1"]?.doubleValue ?? .nan,
        rowH: said["rowH"]?.doubleValue ?? .nan, axisY: said["axisY"]?.doubleValue ?? .nan)
      #expect(g == expected, "geometryFor(\(width), \(height))")
    }
  }

  // MARK: - Hand rows (what the witness lacks)

  /// The witness's open, as spend reads it, at the golden's stage.
  private static func openInput(_ agents: [SpendAgent]? = nil) throws -> SpendModel.Input {
    let open = try SpendWitness.steps().first { $0.at == "open" }?.rows ?? []
    let stage = try SpendGolden.step("open")["stage"]
    return SpendModel.Input(
      agents: agents ?? SpendWitness.agents(open), nowMs: SpendWitness.nowMs,
      width: stage?["width"]?.doubleValue ?? .nan, height: stage?["height"]?.doubleValue ?? .nan,
      timeZone: try SpendGolden.zone(), measure: SpendDOM.averageGlyph)
  }

  private static func witnessAgent(_ id: String) throws -> SpendAgent {
    let open = try SpendWitness.steps().first { $0.at == "open" }?.rows ?? []
    let found = SpendWitness.agents(open).first { $0.id == id }
    return try #require(found, "the witness's \(id)")
  }

  /// H1 — self and peer: one row's bytes (pty-h1's, with its buckets) as this desktop's draw a line and read real
  /// money at a held moment; the same bytes as another desktop's keep the total at now but draw no line, carry the
  /// desktop's mark, and say "not recorded" at the moment.
  @Test func aPeersRowDrawsNoLine() throws {
    let mine = try Self.witnessAgent("pty-h1")
    let theirs = SpendAgent(monitor: mine.monitor, isSelf: false, unread: mine.unread, active: false)
    let moment = SpendWitness.nowMs - 120_000
    for (agent, isSelf) in [(mine, true), (theirs, false)] {
      var state = SpendModel.State()
      let input = try Self.openInput([agent])
      let atNow = SpendDOM.settled(input, &state)
      let line = try #require(atNow.lines.first, "a priced row has a meter")
      #expect(line.recorded == isSelf, "self \(isSelf): recorded")
      let row = try #require(atNow.rows.first)
      #expect(row.figure == "~$2.10", "self \(isSelf): the total at now")
      #expect(row.peer == (isSelf ? nil : agent.monitor.device.name), "self \(isSelf): the desktop's mark")
      state.held = moment
      let then = SpendDOM.settled(input, &state)
      let held = try #require(then.rows.first)
      #expect(held.flags.contains(.unrecorded) == !isSelf, "self \(isSelf): unrecorded at the moment")
      #expect(held.stateText == (isSelf ? "reply unseen · 30s" : "not recorded"), "self \(isSelf): words then")
      #expect((held.figure == "—") == !isSelf, "self \(isSelf): a figure then")
    }
  }

  /// H2 — unread: the open card's row (its unread suppressed: the stage's `unreadIds` without it) reads idle and
  /// hollow, never `reply unseen`.
  @Test func anOpenCardsRowReadsIdle() throws {
    let unseen = try Self.witnessAgent("pty-h1")
    let read = SpendAgent(monitor: unseen.monitor, isSelf: unseen.isSelf, unread: false, active: false)
    var state = SpendModel.State()
    let input = try Self.openInput([read])
    let frame = SpendDOM.settled(input, &state)
    let row = try #require(frame.rows.first)
    #expect(row.state.key == .idle)
    #expect(row.hollow)
    #expect(row.stateText?.hasPrefix("idle · ") == true)
    #expect(row.glyph == nil)
  }

  /// H3 — active (J-S4 (a), fd's Q9): the open card's row carries `is-active` and nothing else changes; the phone
  /// mounts no pane, so it draws nothing for it.
  @Test func anActiveRowChangesOnlyItsFlag() throws {
    let agent = try Self.witnessAgent("pty-h1")
    let active = SpendAgent(monitor: agent.monitor, isSelf: agent.isSelf, unread: agent.unread, active: true)
    var plain = SpendModel.State()
    var lit = SpendModel.State()
    let plainInput = try Self.openInput([agent])
    let litInput = try Self.openInput([active])
    let plainFrame = SpendDOM.settled(plainInput, &plain)
    let litFrame = SpendDOM.settled(litInput, &lit)
    let row = try #require(plainFrame.rows.first)
    let activeRow = try #require(litFrame.rows.first)
    #expect(activeRow.flags == row.flags.union([.active]))
    #expect(!row.flags.contains(.mounted) && !activeRow.flags.contains(.mounted))
    #expect(activeRow.label == row.label && activeRow.figure == row.figure && activeRow.top == row.top)
  }

  /// H5 — terminals only: spend draws agents alone, so a field of terminals is empty.
  @Test func terminalsAloneAreEmpty() throws {
    let open = try SpendWitness.steps().first { $0.at == "open" }?.rows ?? []
    let terminals = SpendWitness.agents(open).filter { $0.monitor.kind == .terminal }
    try #require(!terminals.isEmpty, "the witness carries terminals")
    var state = SpendModel.State()
    let input = try Self.openInput(terminals)
    let frame = SpendDOM.settled(input, &state)
    #expect(frame.empty)
    #expect(frame.rows.isEmpty)
    #expect(frame.hero.big == "~$0.00")
  }

  /// H6 — lifetime: the rows going away (`FieldLink.stop` hands the stage `[]`) leave the view empty, a list scrolled
  /// past its end clamped to its start, and a moment the window still holds kept.
  @Test func rowsGoingAwayLeaveItEmpty() throws {
    var state = SpendModel.State()
    state.listOffset = 3
    state.held = SpendWitness.nowMs - 60_000
    let input = try Self.openInput([])
    let frame = SpendDOM.settled(input, &state)
    #expect(frame.empty)
    #expect(frame.rows.isEmpty)
    #expect(frame.fit.offset == 0)
    #expect(frame.pinned == SpendWitness.nowMs - 60_000)
  }

  /// H9 — touch (fd's Q3, the pointer's own semantics): a lift more than 4 pt from its press is no tap and sets
  /// nothing; a tap on empty chart sets the moment there; a tap on the set moment (within 8 pt) lets it go; a tap on a
  /// line within reach opens it and sets nothing; a cancelled touch taps nothing; a drag on the list steps whole rows.
  @Test func touchKeepsThePointersSemantics() throws {
    let input = try Self.openInput()
    var state = SpendModel.State()
    let frame = SpendDOM.settled(input, &state)
    let empty = SpendDOM.at(frame, SpendWitness.nowMs - 120_000, top: true)

    SpendModel.press(&state, x: empty.x, y: empty.y)
    let dragged = SpendModel.lift(frame, &state, x: empty.x + 5, y: empty.y)
    #expect(dragged == nil && state.held == nil, "a drag is no tap")

    SpendModel.press(&state, x: empty.x, y: empty.y)
    SpendModel.cancel(&state)
    let cancelled = SpendModel.lift(frame, &state, x: empty.x, y: empty.y)
    #expect(cancelled == nil && state.held == nil, "a cancelled touch taps nothing")

    SpendModel.press(&state, x: empty.x, y: empty.y)
    let tapped = SpendModel.lift(frame, &state, x: empty.x + 4, y: empty.y - 4)
    #expect(tapped == nil && state.held != nil, "a tap on empty chart sets the moment")

    let held = SpendDOM.settled(input, &state)
    #expect(held.now != nil, "the Now pill shows")
    SpendModel.press(&state, x: empty.x + 7, y: empty.y)
    _ = SpendModel.lift(held, &state, x: empty.x + 7, y: empty.y)
    #expect(state.held == nil, "a tap on the moment lets it go")

    let line = try #require(frame.lines.first { $0.id == "pty-h1" })
    let spent = SpendSeries.spentAt(line, frame.span.ta, frame.span.tb) ?? .nan
    let g = frame.g
    let head = (x: g.x1, y: g.y1 - (spent / max(1e-9, frame.yMax)) * (g.y1 - g.y0))
    SpendModel.press(&state, x: head.x, y: head.y)
    let opened = SpendModel.lift(frame, &state, x: head.x, y: head.y)
    #expect(opened == "pty-h1" && state.held == nil, "a tap on a line opens it")

    let short = SpendModel.Input(
      agents: input.agents, nowMs: input.nowMs, width: 402, height: 480, timeZone: input.timeZone,
      measure: input.measure)
    var list = SpendModel.State()
    let before = SpendDOM.settled(short, &list)
    try #require(before.fit.more, "the short list has more rows than slots")
    SpendModel.scrollList(before, &list, deltaY: 40)
    #expect(list.listOffset == 1, "a drag steps one whole row")
    SpendModel.scrollList(before, &list, deltaY: -3)
    #expect(list.listOffset == 0, "and back")
    for _ in 0..<20 {
      let shown = SpendDOM.settled(short, &list)
      SpendModel.scrollList(shown, &list, deltaY: 1)
    }
    let end = SpendDOM.settled(short, &list).fit.maxOffset
    #expect(list.listOffset == end, "never past its end")
  }
}
