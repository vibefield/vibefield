import Foundation
import Testing

@testable import FieldProduct

/// IOS-12c (M-c1; PC-L1, one Chat; the plan's Q1 (a)) — the phone's flow is the Mac's. Each golden is written by
/// field-app's own fold (`packages/field-app/test/chat-flow-goldens.test.ts`) and copied here byte for byte
/// (`pnpm check:ios-fixtures`): its input (the spark's record and row, the raw lines by run, the pending sends, now,
/// en-US at UTC), the fold's `facts` (what it reads of the entry), `flow` and `opened` (the earlier conversations
/// asked for). The phone's fold takes the same facts and the same reading, built from the raw lines as its reader
/// builds one (`SparkTranscriptReading.of`), and must say every row the Mac says, word for word. The phone's own
/// derivation of the facts from its entry, which the Mac's goldens cannot hold, has its own rows below.
@Suite("IOS-12c — the phone's flow is the Mac's: the chat-flow goldens")
struct ChatFlowGoldenTests {
  static let cases = ["at-rest", "receipts", "pending", "earlier", "honest", "hello", "thinking", "unknown"]
  static let locale = Locale(identifier: "en_US_POSIX")
  static let utc = TimeZone(identifier: "UTC") ?? .gmt

  @Test("each case's rows, folded and opened", arguments: cases)
  func flow(_ name: String) throws {
    let golden = try Self.golden("chat-flow.\(name).golden")
    let input = try #require(golden["input"])
    #expect(input["locale"] == .string("en-US") && input["timeZone"] == .string("UTC"))
    let spark = try Self.facts(try #require(golden["facts"]))
    let reading = try Self.reading(try #require(input["reading"]))
    let pending = try (input["pending"]?.arrayValue ?? []).map(Self.pending)
    let now = SparkEntries.time(try #require(input["now"]?.stringValue))
    for (key, earlier) in [("flow", false), ("opened", true)] {
      let flow = ChatFlows.flow(
        spark: spark, reading: reading, pending: pending, earlier: earlier, now: now, locale: Self.locale,
        timeZone: Self.utc)
      let said = Self.json(flow)
      let wanted = try #require(golden[key])
      #expect(said == wanted, "\(name) \(key): the phone says \(Self.differ(said, wanted))")
    }
  }

  @Test("a receipt: every state (none, each known, one unknown) × idle, busy, waiting in its pane, holding an item")
  func receipts() throws {
    let golden = try Self.golden("chat-flow.receipts.golden")
    let entries = try #require(golden["entries"]?.objectValue)
    #expect(Set(entries.keys) == ["idle", "busy", "asks", "held"])
    let sparks = try entries.mapValues(Self.facts)
    let rows = try #require(golden["receipts"]?.arrayValue)
    #expect(rows.count == 4 * 8 * 2)
    for row in rows {
      let name = try #require(row["entry"]?.stringValue)
      let spark = try #require(sparks[name])
      let state = row["state"]?.stringValue
      let last = try #require(row["last"]?.boolValue as Bool?)
      let said = Self.json(ChatFlows.receipt(state, spark, last: last))
      #expect(said == row["receipt"], "\(name), \(state ?? "no state"), last \(last)")
    }
    // the states this build says are the contracts' own, in their order
    #expect(ChatFlows.sayStates == ["queued", "waking", "waiting", "delivered", "uncertain", "dropped"])
  }

  @Test("the words: the flow's, each tool kind's, each act's, a chip's, a day's")
  func words() throws {
    let golden = try Self.golden("chat-flow.words.golden")
    let flow = try #require(golden["flow"])
    #expect(flow["reading"] == .string(ChatFlowWords.reading("Vela")))
    #expect(flow["unreadable"] == .string(ChatFlowWords.unreadable("Vela", "its desktop is asleep")))
    #expect(flow["earlier"] == .array([1, 3].map { .string(ChatFlowWords.earlier($0)) }))
    #expect(flow["conversation"] == .string(ChatFlowWords.conversation("Nov 3")))
    #expect(flow["thinking"] == .string(ChatFlowWords.thinking))
    #expect(flow["tools"] == .array([1, 2, 7].map { .string(ChatFlowWords.tools($0)) }))
    #expect(flow["before"] == .string(ChatFlowWords.before("Vela")))
    #expect(flow["gap"] == .string(ChatFlowWords.gap("Vela")))
    #expect(flow["dropped"] == .string(ChatFlowWords.dropped))

    let tools = try #require(golden["tools"]?.arrayValue)
    #expect(tools.compactMap { $0["kind"]?.stringValue } == ChatFlowWords.toolKinds.map { $0.kind } + ["telepathy"])
    for tool in tools {
      let kind = try #require(tool["kind"]?.stringValue)
      #expect(tool["words"] == .string(ChatFlowWords.tool(kind)), "\(kind)")
    }
    for act in try #require(golden["acts"]?.arrayValue) {
      let what = try #require(act["what"]?.stringValue)
      let text = try #require(act["text"]?.stringValue)
      #expect(act["words"] == .string(ChatFlowWords.act(what, text, "Vela")), "\(what)")
    }
    for chip in try #require(golden["chips"]?.arrayValue) {
      let text = try #require(chip["text"]?.stringValue)
      let span = try SparkTranscriptChip(json: try #require(chip["chip"]))
      #expect(chip["words"] == .string(ChatFlowWords.chip(text, span)), "\(text)")
    }
    for day in try #require(golden["days"]?.arrayValue) {
      let at = SparkEntries.time(try #require(day["at"]?.stringValue))
      let now = SparkEntries.time(try #require(day["now"]?.stringValue))
      let said = ChatFlowWords.day(at: at, now: now, locale: Self.locale, timeZone: Self.utc)
      #expect(day["words"] == .string(said), "\(day["at"]?.stringValue ?? "")")
    }
  }

  @Test("the hello's words and starters are NS-D4's, and only the canon's")
  func hello() {
    #expect(
      ChatFlowWords.hello("Vela")
        == "Hi, I'm Vela. I can start agents for you, keep track of the ones you run, and carry work between them. "
        + "What first?")
    #expect(ChatFlowWords.starters.map(\.glyph) == [.agents, .panes, .duplicate])
  }

  // MARK: - The phone's own facts

  @Test("the phone reads a spark's facts from its own entry: with no run on the board, its record decides")
  func factsWithNoRun() throws {
    let list = try ComposeSparksList(json: try Fixture.json("compose-sparks-list.turned"))
    let entries = SparkEntries.entries(sparks: list.sparks, rows: [], items: [])
    let facts = Dictionary(uniqueKeysWithValues: entries.map { ($0.spark.name, ChatFlowSpark(entry: $0)) })
    // Vela turned (a time), Lyra never has but is awake, Juno is asleep and says nothing: none is new
    #expect(facts["Vela"]?.turnedAt == "2026-11-01T08:40:12.000Z" && facts["Vela"]?.isNew == false)
    #expect(facts["Lyra"]?.turnedAt == nil && facts["Lyra"]?.isNew == false)
    #expect(facts["Juno"]?.isNew == false && facts["Juno"]?.awake == false)
    #expect(facts.values.allSatisfy { !$0.working && !$0.blocked && !$0.waiting })

    // Lyra asleep, never having worked: new, as the Mac's `sparkIsNew` says
    let sparks = try #require(try Fixture.json("compose-sparks-list.turned")["sparks"]?.arrayValue)
    let lyra = try #require(sparks.first { $0["name"] == .string("Lyra") })
    let session = Self.with(lyra["session"], ["live": .bool(false)])
    let asleep = try SparkSummary(json: Self.with(lyra, ["session": session]))
    let entry = try #require(SparkEntries.entries(sparks: [asleep], rows: [], items: []).first)
    #expect(ChatFlowSpark(entry: entry).isNew)

    // no session at all: new
    let none = try SparkSummary(json: Self.without(lyra, "session"))
    let bare = try #require(SparkEntries.entries(sparks: [none], rows: [], items: []).first)
    #expect(ChatFlowSpark(entry: bare).isNew)
  }

  @Test("with its own run on the board: pending is never new, the record alone decides, and the row says busy")
  func factsWithItsRun() throws {
    let rowJSON = try Fixture.json("agent-remote-row.spark")
    let sparks = try #require(try Fixture.json("compose-sparks-list.turned")["sparks"]?.arrayValue)
    let lyra = try #require(sparks.first { $0["name"] == .string("Lyra") })
    // Lyra as the row's spark: its id, its desktop and its session's run
    let record = Self.with(
      lyra,
      [
        "id": try #require(rowJSON["spark"]), "device": try #require(rowJSON["device"]),
        "session": Self.with(lyra["session"], ["runtimeRunId": try #require(rowJSON["runtimeRunId"])]),
      ])
    func facts(_ spark: JSONValue, _ monitor: [String: JSONValue], dropping: String? = nil) throws -> ChatFlowSpark {
      var changed = Self.with(rowJSON["monitorRow"], monitor)
      if let dropping { changed = Self.without(changed, dropping) }
      let row = try AgentRemoteRow(json: Self.with(rowJSON, ["monitorRow": changed]))
      let entry = try #require(
        SparkEntries.entries(sparks: [try SparkSummary(json: spark)], rows: [row], items: []).first)
      #expect(entry.run != nil)
      return ChatFlowSpark(entry: entry)
    }
    // never turned, by its record: new; the row waits on you (`blocked`), so it is blocked, not working
    let never = try facts(record, [:])
    #expect(never.isNew && never.blocked && !never.working && never.awake)
    // turned, by its record: not new
    #expect(try !facts(Self.with(record, ["turnedAt": .string("2026-11-05T10:00:00.000Z")]), [:]).isNew)
    // pending (AR-4): never new
    #expect(try !facts(record, ["pending": .bool(true)]).isNew)
    // at work: working, and not blocked
    let busy = try facts(record, ["status": .string("working")], dropping: "wait")
    #expect(busy.working && !busy.blocked)
  }

  // MARK: - Reading a golden

  static func golden(_ name: String) throws -> JSONValue {
    guard
      let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/chat-flow")
    else { throw Fixture.FixtureError.missing(name) }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  static func facts(_ json: JSONValue) throws -> ChatFlowSpark {
    // one #require a line: a macro may not nest in another, and a `Bool?` is required as an optional to unwrap
    func flag(_ key: String) throws -> Bool { try #require(json[key]?.boolValue as Bool?) }
    let word = try #require(json["status"]?.stringValue)
    let status = try #require(SparkStatus(rawValue: word))
    let seed = try #require(json["seed"]?.intValue)
    let name = try #require(json["name"]?.stringValue)
    return ChatFlowSpark(
      name: name, seed: UInt32(seed), status: status, turnedAt: json["turnedAt"]?.stringValue, isNew: try flag("new"),
      awake: try flag("awake"), blocked: try flag("blocked"), waiting: try flag("waiting"),
      working: try flag("working"))
  }

  static func reading(_ json: JSONValue) throws -> SparkTranscriptReading {
    #expect(json["state"] == .string("ready"))
    let runs = try (json["runs"]?.arrayValue ?? []).map(SparkTranscriptRun.init(json:))
    let raw = (json["raw"]?.objectValue ?? [:]).mapValues { $0.arrayValue ?? [] }
    let dropped = Int(json["dropped"]?.intValue ?? 0)
    return .of(runs: runs, raw: raw, dropped: dropped, whole: json["whole"]?.boolValue ?? false)
  }

  static func pending(_ json: JSONValue) throws -> ChatPendingSay {
    ChatPendingSay(
      requestId: try #require(json["requestId"]?.stringValue), text: try #require(json["text"]?.stringValue),
      chips: try (json["chips"]?.arrayValue ?? []).map(SparkTranscriptChip.init(json:)),
      at: try #require(json["at"]?.stringValue), state: json["state"]?.stringValue)
  }

  static func with(_ value: JSONValue?, _ changes: [String: JSONValue]) -> JSONValue {
    var fields = value?.objectValue ?? [:]
    for (key, change) in changes { fields[key] = change }
    return .object(fields)
  }

  static func without(_ value: JSONValue, _ key: String) -> JSONValue {
    var fields = value.objectValue ?? [:]
    fields[key] = nil
    return .object(fields)
  }

  // MARK: - The flow as the Mac's JSON

  static func json(_ flow: ChatFlow) -> JSONValue {
    switch flow {
    case .reading: .object(["state": .string("reading")])
    case .unreadable(let reason, _): .object(["state": .string("unreadable"), "reason": .string(reason)])
    case .ready(let items): .object(["state": .string("ready"), "items": .array(items.map(json))])
    }
  }

  static func json(_ item: ChatFlowItem) -> JSONValue {
    var fields: [String: JSONValue] = ["key": .string(item.key)]
    switch item {
    case .earlier(_, let count):
      fields["kind"] = .string("earlier")
      fields["count"] = .int(Int64(count))
    case .day(_, let words):
      fields["kind"] = .string("day")
      fields["words"] = .string(words)
    case .honest(_, let which, let words):
      fields["kind"] = .string("honest")
      fields["which"] = .string(which.rawValue)
      fields["words"] = .string(words)
    case .hello(_, let seed, let status, let words, let starters):
      fields["kind"] = .string("hello")
      fields["face"] = .object(["seed": .int(Int64(seed)), "status": .string(status.rawValue)])
      fields["words"] = .string(words)
      fields["starters"] = .array(
        starters.map { .object(["glyph": .string($0.glyph.rawValue), "words": .string($0.words)]) })
    case .you(_, let text, let chips, let receipt):
      fields["kind"] = .string("you")
      fields["text"] = .string(text)
      fields["chips"] = .array(chips.map(\.json))
      fields["receipt"] = json(receipt)
    case .reply(_, let text, let lead):
      fields["kind"] = .string("reply")
      fields["text"] = .string(text)
      fields["lead"] = .bool(lead)
    case .tools(_, let words, let rows, let lead):
      fields["kind"] = .string("tools")
      fields["words"] = .string(words)
      fields["rows"] = .array(
        rows.map { row in
          var tool: [String: JSONValue] = ["words": .string(row.words)]
          if let detail = row.detail { tool["detail"] = .string(detail) }
          return .object(tool)
        })
      fields["lead"] = .bool(lead)
    case .act(_, let what, let words, let lead, let crew):
      fields["kind"] = .string("act")
      fields["what"] = .string(what)
      fields["words"] = .string(words)
      fields["lead"] = .bool(lead)
      if let crew { fields["crew"] = .string(crew) }
    case .thinking(_, let lead):
      fields["kind"] = .string("thinking")
      fields["lead"] = .bool(lead)
    }
    return .object(fields)
  }

  static func json(_ receipt: ChatReceipt?) -> JSONValue {
    guard let receipt else { return .null }
    var fields: [String: JSONValue] = ["words": .string(receipt.words)]
    if receipt.attention { fields["tone"] = .string("attention") }
    return .object(fields)
  }

  /// Where two flows first part, for the failure's words: the first item that differs, or the counts.
  static func differ(_ said: JSONValue, _ wanted: JSONValue) -> String {
    let a = said["items"]?.arrayValue ?? []
    let b = wanted["items"]?.arrayValue ?? []
    for index in 0..<min(a.count, b.count) where a[index] != b[index] {
      return "item \(index): \(a[index]) where the Mac says \(b[index])"
    }
    return "\(a.count) items where the Mac says \(b.count) (\(said["state"] ?? .null) / \(wanted["state"] ?? .null))"
  }
}
