import FieldAgents
import FieldMesh
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-6 — THE TIMELINE'S HAND ROWS: what no golden reaches, each held to the desktop source line it cites (the read's
// §7, H1–H9; H10, the words rule). TimelineView's layout is its own (never exported), the phone's tolerance and its
// joins are the phone's, and J-S4's active treatment is James's. The golden rows are `Timeline*ParityTests`.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-6 — the timeline's hand rows")
struct TimelineViewTests {
  // MARK: - H1 the layout (TimelineView.js:34-85)

  /// H1 — `columnsFor` (:46-50): the narrow head under 640, the middle to 900, the wide from there; the head never
  /// past the left edge.
  @Test func theColumnsAreTheViews() {
    let cases: [(Double, Double, Double, Double, Bool)] = [
      (402, 116, 104, 298, true), (639, 116, 104, 535, true), (640, 166, 148, 492, false),
      (900, 196, 170, 730, false), (0, 116, 104, 1, true),
    ]
    for (width, names, head, x1, narrow) in cases {
      let columns = TimelineLayout.columns(width: width)
      let expected = TimelineLayout.Columns(width: width, names: names, head: head, x1: x1, narrow: narrow)
      #expect(columns == expected, "at \(width)")
    }
  }

  /// H1 — `layoutLanes` (:51-73) over the witness's open lanes: room for all at `laneMax` (36), then squeezed toward
  /// `LANE_MIN` (24) and never under it; the terminals at 18 after a 20 pt divider; the rows' height 4 under the last.
  @Test func theLanesAreLaidOutAsTheViewLaysThem() throws {
    let set = try Self.openSet()
    let agents = set.agents.count
    let terminals = set.terminals.count
    try #require(agents > 0 && terminals > 0, "the open has agents and terminals")
    for (bodyHeight, h) in [(1_000.0, 36.0), (300.0, 26.0), (100.0, 24.0)] {
      let placement = TimelineLayout.lanes(set, bodyHeight: bodyHeight, laneMax: 36)
      let agentHeights = placement.placed.prefix(agents).map { $0.h }
      let expectedHeights = Array(repeating: h, count: agents)
      #expect(agentHeights == expectedHeights, "at \(bodyHeight): the agents' height")
      let agentTops = placement.placed.prefix(agents).map { $0.y }
      let expectedTops = (0..<agents).map { 2 + Double($0) * h }
      #expect(agentTops == expectedTops, "at \(bodyHeight): the agents' y")
      let divider = 2 + Double(agents) * h
      #expect(placement.divider == divider, "at \(bodyHeight): the divider")
      let terminalTops = placement.placed.suffix(terminals).map { $0.y }
      let expectedTerminalTops = (0..<terminals).map { divider + 20 + Double($0) * 18 }
      #expect(terminalTops == expectedTerminalTops, "at \(bodyHeight): terminals")
      let terminalHeights = placement.placed.suffix(terminals).map { $0.h }
      let expectedTerminalHeights = Array(repeating: 18.0, count: terminals)
      #expect(terminalHeights == expectedTerminalHeights, "at \(bodyHeight): terminals' height")
      let height = divider + 20 + Double(terminals) * 18 + 4
      #expect(placement.height == height, "at \(bodyHeight): the rows' height")
    }
    let none = TimelineLayout.lanes(TimelineLaneSet(agents: [], terminals: []), bodyHeight: 500, laneMax: 36)
    #expect(none == TimelineLayout.Placement(placed: [], divider: nil, height: 6), "no lanes")
  }

  /// H1 — `dayLabel` (:83-85) for a midnight tick in en_US. The phone asks the platform for the desktop's own
  /// skeleton, CLDR's `Ed` (`{weekday: 'short', day: 'numeric'}`), so the ORDER is each platform's: Apple's data
  /// says `EEE d`, `WED 4`, where Node's (ICU 78.3, CLDR 48) says `d EEE`, `4 WED`. fd RULED keep (2026-11-04): the
  /// desktop asks the user's locale, so the platform's localized order is the intent.
  @Test func theDayLabelIsThePlatformsShortWeekdayAndDay() throws {
    let utc = try #require(TimeZone(identifier: "UTC"))
    let enUS = Locale(identifier: "en_US")
    #expect(TimelineLayout.daySkeleton == "Ed")
    let pattern = DateFormatter.dateFormat(fromTemplate: TimelineLayout.daySkeleton, options: 0, locale: enUS)
    #expect(pattern == "EEE d")
    let label = TimelineLayout.dayLabel(1_793_750_400_000, timeZone: utc, locale: enUS)
    #expect(label == "WED 4")
  }

  // MARK: - H2 tolerance

  /// H2 — a wait kind the toolkit does not know is said as itself; a block with no wait reads as a failure
  /// (MonitorWords.waitWord; SDK `waitWord`).
  @Test func anUnknownWaitIsSaidAsItself() {
    let unknown = TimelineSpan(status: .blocked, fromMs: 0, wait: TimelineWait(kind: "approval", detail: nil))
    #expect(TimelineWords.spanWord(unknown) == "blocked · approval")
    let none = TimelineSpan(status: .blocked, fromMs: 0, wait: nil)
    #expect(TimelineWords.spanWord(none) == "blocked · failed")
  }

  /// H2 — a blank question gives no wait words; a cut through a surrogate pair at the 160th unit keeps U+FFFD where
  /// JavaScript keeps the lone half (lane-words.js:18-23; the phone-only deviation, TimelineLanes.swift).
  @Test func theWaitWordsTolerateBlankAndSplit() {
    #expect(TimelineLanes.waitWords(kind: "question", detail: nil, question: " \n\t ") == nil)
    let split = String(repeating: "a", count: 158) + "😀" + "b"
    let cut = TimelineLanes.waitWords(kind: "question", detail: nil, question: split)
    #expect(cut == String(repeating: "a", count: 158) + "\u{FFFD}" + "…")
  }

  /// H2 — a row with no model says its provider (MonitorWords.modelWord; SDK `modelWord`).
  @Test func aRowWithNoModelSaysItsProvider() throws {
    let monitor = try Self.monitor("pty-h1", removing: ["model"])
    let lane = TimelineLanes.lane(
      for: TimelineRow(monitor: monitor, isSelf: true, unread: false, colour: nil, active: false),
      nowMs: TimelineGolden.nowMs)
    #expect(TimelineWords.subLine(lane) == "Claude Code · pg/3a")
  }

  // MARK: - H3 self and peer

  /// H3 — a peer's lane is said `on <device>, ` first; the home's own is not (timeline-words.js:115).
  @Test func aPeersLaneSaysWhereItRuns() throws {
    let set = try Self.openSet()
    let now = TimelineGolden.nowMs
    let peers = set.all.filter { !$0.row.isSelf }
    let selves = set.all.filter { $0.row.isSelf }
    try #require(!peers.isEmpty && !selves.isEmpty, "the open has lanes on both")
    for lane in peers {
      let label = TimelineWords.label(lane, nowMs: now)
      #expect(label.hasPrefix("on \(lane.row.monitor.device.name), "), "\(lane.id)")
    }
    for lane in selves {
      let label = TimelineWords.label(lane, nowMs: now)
      #expect(!label.hasPrefix("on "), "\(lane.id)")
    }
  }

  // MARK: - H4 empty

  /// H4 — no rows, no lanes; the empty stage says upstream's title (TimelineView.js:882) and the phone's hint, its pane
  /// dropped by the words rule (H10; draft word: James's eye (VF-PM 2026-11-04)).
  @Test func anEmptyFieldSaysSo() {
    let set = TimelineLanes.lanes([], nowMs: TimelineGolden.nowMs)
    #expect(set.all.isEmpty)
    #expect(TimelineWords.noAgents == "NO ACTIVE AGENTS")
    #expect(TimelineWords.noAgentsHint == "Launch an agent from a terminal.")
  }

  // MARK: - H5 active (J-S4)

  /// H5 — the open card's row alone wears the active treatment; with no card, none does; the weights are untouched
  /// (timeline.css:553-557, :560-573; `laneAlpha` reads hover, never `active`).
  @Test func theOpenCardsLaneAloneIsLit() throws {
    let rows = try HomeFixture.witnessRows()
    let first = try #require(rows.first)
    for row in rows {
      let lit = TimelineActive.lights(row: row, activeId: first.id)
      #expect(lit == (row.id == first.id), "\(row.id)")
      let none = TimelineActive.lights(row: row, activeId: nil)
      #expect(!none, "\(row.id) with no card")
    }
    let monitor = first.row.monitor
    let active = TimelineLanes.lane(
      for: TimelineRow(monitor: monitor, isSelf: true, unread: false, colour: nil, active: true),
      nowMs: TimelineGolden.nowMs)
    let quiet = TimelineLanes.lane(
      for: TimelineRow(monitor: monitor, isSelf: true, unread: false, colour: nil, active: false),
      nowMs: TimelineGolden.nowMs)
    for lit in [-1, 0, 1] {
      let weights = [TimelineLanes.alpha(active, index: 0, lit: lit), TimelineLanes.alpha(quiet, index: 0, lit: lit)]
      #expect(weights[0] == weights[1], "lit \(lit)")
    }
  }

  /// H5b — the active name's underline is the stylesheet's (timeline.css:553-557): 1 thick, its top 3 under the
  /// name's baseline (`text-underline-offset` measures from the alphabetic baseline), drawn as a rule the name row
  /// sizes and aligns by `TimelineActive.underlineRule`, never the font's own underline.
  @Test func theActiveNamesUnderlineIsTheStylesheets() {
    #expect(TimelineActive.underlineThickness == 1)
    #expect(TimelineActive.underlineOffset == 3)
    let rule = TimelineActive.underlineRule
    #expect(rule.height == TimelineActive.underlineThickness, "the rule's height")
    #expect(rule.baselineGuide == -TimelineActive.underlineOffset, "the rule's baseline guide")
  }

  // MARK: - H6 the frozen clock

  /// H6 — a tween's progress reads the frame's time, never now: a frozen now lands it exactly as a live one
  /// (timeline-scale.js:113; the read's §1).
  @Test func aTweenReadsTheFramesTime() {
    let from = TimelineScale.initial(nowMs: 1_000_000_000)
    let target = TimelineScale(spanMs: 15 * 60_000, endMs: 1_000_000_000, live: true)
    let tween = TimelineScale.tweenBetween(from, target, at: 500)
    let early = TimelineScale.tweenAt(tween, at: 620, nowMs: 1_000_000_000, reduced: false)
    let later = TimelineScale.tweenAt(tween, at: 620, nowMs: 1_000_900_000, reduced: false)
    #expect(early.scale.spanMs == later.scale.spanMs, "the span at half the tween")
    #expect(!early.done && !later.done)
    let span = from.spanMs + (target.spanMs - from.spanMs) * TimelineScale.islandEase(0.5)
    #expect(early.scale.spanMs == span)
  }

  // MARK: - H7 an undealt agent

  /// H7 — an agent with no dealt colour works in the neutral ramp (EndedLaneView's `colour`, view.d.ts: "the neutral
  /// ramp for no project").
  @Test func anUndealtAgentWorksInTheNeutralRamp() throws {
    let open = try TimelineGolden.open()
    let inks = try TimelinePaintParityTests.inks(open, theme: "light")
    #expect(inks.project(nil) == inks.faint)
    let monitor = try Self.monitor("pty-h1", changing: ["status": .string("working")])
    let lane = TimelineLanes.lane(
      for: TimelineRow(monitor: monitor, isSelf: true, unread: false, colour: nil, active: false),
      nowMs: TimelineGolden.nowMs)
    #expect(TimelinePaint.wakeColour(inks, lane, .working) == inks.faint)
  }

  // MARK: - H8 the host's unread

  /// H8 — the row's own `unread` is the host's; the swarm's (`unreadIds`, S2) decides `unseen`, so a row the swarm
  /// does not draw unread reads idle (TimelineLanes.status; GodviewTone.of).
  @Test func theSwarmsUnreadDecidesUnseen() throws {
    let monitor = try Self.monitor("pty-h1")
    try #require(monitor.unread && monitor.status == .idle, "pty-h1 is an unread idle agent")
    let held = TimelineRow(monitor: monitor, isSelf: true, unread: false, colour: nil, active: false)
    #expect(TimelineLanes.status(of: held) == .idle)
    let drawn = TimelineRow(monitor: monitor, isSelf: true, unread: true, colour: nil, active: false)
    #expect(TimelineLanes.status(of: drawn) == .unseen)
  }

  // MARK: - H9 a half-hour zone

  /// H9 — in a :30 zone (Asia/Kolkata, +5:30) the hour ticks fall at local :00, which is :30 past a UTC hour
  /// (timeline-scale.js:144-151).
  @Test func aHalfHourZonesHoursFallOnItsOwnHour() throws {
    let kolkata = try #require(TimeZone(identifier: "Asia/Kolkata"))
    let from = TimelineGolden.nowMs - 6 * 3_600_000
    let ticks = TimelineScale.ticksBetween(
      fromMs: from, toMs: TimelineGolden.nowMs, step: 3_600_000, timeZone: kolkata)
    try #require(ticks.count == 6, "six hours of ticks")
    for tick in ticks {
      #expect(tick.hour, "\(tick.t)")
      #expect(tick.t.truncatingRemainder(dividingBy: 3_600_000) == 1_800_000, "\(tick.t)")
    }
  }

  // MARK: - H10 the words rule

  /// H10 — THE WORDS RULE (VF-PM via fd, 2026-11-04): on the phone no word, label or title names a key, hover or a
  /// pane. Every word the view says, pinned: the desktop's where it names none, and the named drops where it did —
  /// the body's label keeps its first sentence (TimelineView.js:861; "Up and down light a lane, Enter opens it, left
  /// and right move through time, minus and equals zoom." dropped) and the empty hint loses its pane (:882; draft
  /// word: James's eye (VF-PM 2026-11-04)). NOW's key legend (`keyLegend(NOW_KEY)`, :859) and the map's hover title
  /// (:856, "The whole day. Press to put the head there; drag to play it back.") are never drawn, so no word here
  /// carries them. Then every word and every preset is scanned for a key, hover or pane.
  @Test func thePhonesWordsNameNoKeyHoverOrPane() {
    let pinned: [(phone: String, words: String)] = [
      (TimelineWords.noAgents, "NO ACTIVE AGENTS"),
      (TimelineWords.noAgentsHint, "Launch an agent from a terminal."),
      (TimelineWords.bodyLabel, "Agents over time"),
      (TimelineWords.mapLabel, "The head\u{2019}s moment in the day"),
      (TimelineWords.followingNow, "Following now"),
      (TimelineWords.backToNow, "Back to now"),
      (TimelineWords.terminals, "TERMINALS"),
      (TimelineWords.since("9:41"), "SINCE 9:41"),
      (TimelineWords.spanLabel("1H", next: "Show 4 hours"), "Span 1H; Show 4 hours"),
      (TimelineWords.spanLabel(nil, next: "Show 15 minutes"), "Span custom; Show 15 minutes"),
      (TimelineWords.nowValue("9:41"), "Now, 9:41"),
      (TimelineWords.pastValue("9:12", ago: "29m"), "9:12, 29m ago"),
    ]
    for (phone, words) in pinned {
      #expect(phone == words, "\(words)")
    }
    let said = pinned.map { $0.phone } + TimelineScale.presets.flatMap { [$0.label, $0.title] }
    for word in said {
      let hit = word.range(of: Self.keyHoverPane, options: .regularExpression)
      #expect(hit == nil, "\(word)")
    }
  }

  /// A key, hover or pane: the words for them in any case, and the keys' own names as a keyboard prints them.
  static let keyHoverPane =
    #"(?i:\b(panes?|hover\w*|keys?|keyboard|arrows?|press\w*|click\w*|minus|equals)\b)"#
    + #"|\b(Enter|End|Home|Esc|Escape|Tab|Return|Space|Up|Down|Left|Right)\b"#

  // MARK: - Readers

  /// The open step's lanes, as the witness draws them.
  static func openSet() throws -> TimelineLaneSet {
    var found: TimelineLaneSet?
    try TimelineWitness.walk { _, set, step in
      if step.at == "open" { found = set }
    }
    return try #require(found, "the run has an open step")
  }

  /// A witness row's monitor row, as the open fixture carries it, with fields changed or removed.
  static func monitor(
    _ id: String, changing changes: [String: JSONValue] = [:], removing removed: [String] = []
  ) throws -> MonitorAgentRow {
    let open = try HomeFixture.json("agent-remote-mesh-open.witness")
    let rows = (open["devices"]?.arrayValue ?? []).flatMap { $0["snapshot"]?["rows"]?.arrayValue ?? [] }
    let found = rows.compactMap { $0["monitorRow"] }.first { $0["id"]?.stringValue == id }
    var object = try #require(found?.objectValue, "the witness has no row \(id)")
    for (key, value) in changes { object[key] = value }
    for key in removed { object[key] = nil }
    return try MonitorAgentRow(json: .object(object))
  }
}
