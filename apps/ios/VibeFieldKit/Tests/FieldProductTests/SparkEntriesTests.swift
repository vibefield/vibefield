import Foundation
import Testing

@testable import FieldProduct

/// IOS-12b (PC-D1 A, PC-D5 A; DESIGN.md §8 "Chat's list", §2.10) — Chat's list on the phone is SP-1b's reading of a
/// spark (`packages/field-app/src/chat/spark-status.ts`), on the phone's own inputs: the home's merged sparks, the
/// remote cut's rows (`AgentRemoteRow`, which carry `spark` and `origin` since IOS-12a) and the merged needs-you
/// queue. The board row's words map to the remote cut's: a blocker is the row's `wait` (its kind), a status the board
/// says is `unknown` is an unobserved row, and a row's last activity is its activity's `since`, else its status's.
/// And SP-1d's thread marks (`thread-marks.ts`): a need, or the spark's own turn ending, in a thread not on screen.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("Chat's list reads each spark as the Mac's does")
struct SparkEntriesTests {
  static let home = "dev-01HQ9S7UD1"
  static let vela = "sp-7k2m9q4x"

  static func sparks(_ edits: [([Step], JSONValue?)] = []) throws -> [SparkSummary] {
    var json = try Fixture.json("compose-sparks-list.merged")
    for (path, value) in edits { json = edited(json, path, value) }
    return try ComposeSparksList(json: json).sparks
  }

  /// Vela's own session on the board (run-12, the home's), waiting on a question; `edits` from there.
  static func velaRun(_ edits: [([Step], JSONValue?)] = []) throws -> AgentRemoteRow {
    var json = try Fixture.json("agent-remote-row.spark")
    for (path, value) in edits { json = edited(json, path, value) }
    return try AgentRemoteRow(json: json)
  }

  /// An agent Vela started (run-31, the home's), at work.
  static func velasAgent(_ status: String = "working", alive: Bool = true) throws -> AgentRemoteRow {
    var json = try Fixture.json("agent-remote-row.valid")
    json = edited(json, [.key("runtimeRunId")], .string("run-31"))
    json = edited(json, [.key("origin")], .object(["by": .string("spark"), "spark": .string(vela)]))
    json = edited(json, [.key("monitorRow"), .key("id")], .string("run-31"))
    json = edited(json, [.key("monitorRow"), .key("status")], .string(status))
    json = edited(json, [.key("monitorRow"), .key("wait")], nil)
    json = edited(json, [.key("monitorRow"), .key("alive")], .bool(alive))
    return try AgentRemoteRow(json: json)
  }

  static func items(_ name: String = "needs-list.merged") throws -> [NeedsItem] {
    try NeedsList(json: try Fixture.json(name)).items
  }

  /// Vela's row at rest: no wait, idle.
  static let idle: [([Step], JSONValue?)] = [
    ([.key("monitorRow"), .key("wait")], nil), ([.key("monitorRow"), .key("status")], .string("idle")),
  ]

  /// One case of the status rule: Vela's record (its session live, asleep, or none) with `own`, `agents`, `items`.
  struct Case {
    let name: String
    let want: SparkStatus
    var own: AgentRemoteRow?
    var agents: [AgentRemoteRow] = []
    var items: [NeedsItem] = []
    /// its record's session: live, asleep, or (nil) none
    var live: Bool? = true
  }

  static func check(_ cases: [Case]) throws {
    let session: [Step] = [.key("sparks"), .index(0), .key("session")]
    for each in cases {
      let record = try sparks([(each.live == nil ? session : session + [.key("live")], each.live.map { .bool($0) })])
      let spark = try #require(record.first)
      let got = SparkEntries.status(of: spark, own: each.own, agents: each.agents, items: each.items)
      #expect(got == each.want, "\(each.name)")
    }
  }

  // MARK: - The list

  @Test("the merged list: Vela asks you from its own run, Kiwi sleeps on the loft; newest activity first")
  func theList() throws {
    let entries = SparkEntries.entries(sparks: try Self.sparks(), rows: [try Self.velaRun()], items: try Self.items())
    let names = entries.map { $0.spark.name }
    // Kiwi's record moved at 11:20, Vela's at 11:02 and its run on 30 Sep
    #expect(names == ["Kiwi", "Vela"])
    let vela = try #require(entries.last)
    #expect(vela.status == .asking)
    #expect(vela.needsYou && vela.awake && vela.blocked && vela.heard)
    let runKey = vela.run?.runtimeRunId
    #expect(runKey == "run-12")
    // its question and its held send are its own items (only an agent-ask from its own run is its row's)
    let itemIds = vela.items.map { $0.id }
    #expect(itemIds == ["ny-3f9a1c0b7e2d4a61", "ny-8c41d2e09a77b305"])
    #expect(vela.activityAt == 1_793_271_730_118)
    let kiwi = try #require(entries.first)
    #expect(kiwi.status == .sleeping)
    #expect(!kiwi.needsYou && !kiwi.awake && !kiwi.blocked && !kiwi.heard)
    #expect(kiwi.run == nil && kiwi.items.isEmpty)
  }

  @Test("CH-D1: a run's later activity moves its spark up; a tie goes by name")
  func order() throws {
    let later = try Self.velaRun([([.key("monitorRow"), .key("activity"), .key("since")], .int(1_793_275_200_000))])
    let moved = SparkEntries.entries(sparks: try Self.sparks(), rows: [later], items: [])
    let names = moved.map { $0.spark.name }
    #expect(names == ["Vela", "Kiwi"])
    let first = try #require(moved.first)
    #expect(first.activityAt == 1_793_275_200_000)
    // the same moment: by name
    let moment = JSONValue.string("2026-10-29T11:20:00.000Z")
    let sparks = try Self.sparks([
      ([.key("sparks"), .index(0), .key("updatedAt")], moment),
      ([.key("sparks"), .index(1), .key("updatedAt")], moment),
    ])
    let tied = SparkEntries.entries(sparks: sparks, rows: [], items: [])
    let tiedNames = tied.map { $0.spark.name }
    #expect(tiedNames == ["Kiwi", "Vela"])
  }

  // MARK: - The status, the first that holds

  @Test("its own run waits on you while it runs: a question asks, a permission needs your OK, else stuck")
  func ownBlocker() throws {
    let asking = try Self.velaRun()
    let permission = try Self.velaRun([([.key("monitorRow"), .key("wait"), .key("kind")], .string("permission"))])
    let sandbox = try Self.velaRun([([.key("monitorRow"), .key("wait"), .key("kind")], .string("sandbox"))])
    let bare = try Self.velaRun([([.key("monitorRow"), .key("wait")], nil)])
    let gone = try Self.velaRun([([.key("monitorRow"), .key("alive")], .bool(false))])
    let items = try Self.items()
    try Self.check([
      Case(name: "a question", want: .asking, own: asking),
      Case(name: "a permission", want: .approval, own: permission),
      Case(name: "a wait of another kind", want: .stuck, own: sandbox),
      Case(name: "blocked with no wait named", want: .stuck, own: bare),
      // a run that has stopped waits on no one: asleep, or its item's word
      Case(name: "stopped", want: .sleeping, own: gone, live: false),
      Case(name: "stopped, with its items", want: .asking, own: gone, items: items, live: false),
    ])
  }

  @Test("an item's word stands over Asleep: a question asks, a held send or spawn needs your OK")
  func itemWords() throws {
    let all = try Self.items("needs-list.valid")
    let words = all.map { SparkEntries.status(ofItem: $0) }
    // question, held-send, held-spawn, agent-ask (permission)
    #expect(words == [.asking, .approval, .approval, .approval])
    let askJSON = try Fixture.json("needs-item.agent-ask")
    let askQuestion = try NeedsItem(json: edited(askJSON, [.key("ask")], .string("question")))
    #expect(SparkEntries.status(ofItem: askQuestion) == .asking)
    let unknown = try NeedsItem(json: try Fixture.json("needs-item.unknown-kind"))
    #expect(SparkEntries.status(ofItem: unknown) == .approval)
    let held = try #require(all.dropFirst().first)
    try Self.check([Case(name: "asleep with a held send", want: .approval, own: nil, items: [held], live: false)])
  }

  @Test("awake and not waiting: its agents at work run, its own turn thinks, idle is ready, unheard says hello")
  func awake() throws {
    let idle = try Self.velaRun(Self.idle)
    let working = try Self.velaRun(Self.idle + [([.key("monitorRow"), .key("status")], .string("working"))])
    let unheard = try Self.velaRun(Self.idle + [([.key("monitorRow"), .key("observed")], .bool(false))])
    let atWork = try Self.velasAgent()
    let resting = try Self.velasAgent("idle")
    let ended = try Self.velasAgent(alive: false)
    try Self.check([
      Case(name: "idle", want: .ready, own: idle),
      Case(name: "an agent it started at work", want: .running, own: idle, agents: [atWork]),
      Case(name: "an agent it started at rest", want: .ready, own: idle, agents: [resting]),
      Case(name: "an agent it started, ended", want: .ready, own: idle, agents: [ended]),
      Case(name: "its own turn", want: .thinking, own: working),
      // a run the runtime has not reported says nothing yet (the board's `unknown`)
      Case(name: "unheard", want: .hello, own: unheard),
      // live by its record, no run on the board yet
      Case(name: "live, no run", want: .hello, own: nil),
      // never started: no session, no run, no item
      Case(name: "never started", want: .hello, own: nil, live: nil),
    ])
  }

  @Test("whose a run and an item are: its own session, the agents it started, its items but its own run's asks")
  func whose() throws {
    let all = try Self.sparks()
    let spark = try #require(all.first)
    let own = try Self.velaRun()
    let agent = try Self.velasAgent()
    // on another desktop, a row naming the spark is not its session: a spark lives where it hatched
    let elsewhere = try Self.velaRun([([.key("device")], .string("dev-01HQ9S7XZ2"))])
    let found = try #require(SparkEntries.ownRun(of: spark, in: [elsewhere, agent, own]))
    #expect(found.runtimeRunId == "run-12")
    let none = SparkEntries.ownRun(of: spark, in: [elsewhere])
    #expect(none == nil)
    let agents = SparkEntries.agentRuns(of: spark, in: [own, agent]).map { $0.runtimeRunId }
    #expect(agents == ["run-31"])
    // an agent's ask from the spark's own run is its row's blocker, read there once; from an agent it started, its
    let askJSON = try Fixture.json("needs-item.agent-ask")
    let fromOwn = try NeedsItem(json: edited(askJSON, [.key("from"), .key("session")], .string("run-12")))
    let fromAgent = try NeedsItem(json: askJSON)
    let kept = SparkEntries.items(of: spark, rows: [own, agent], items: [fromOwn, fromAgent]).map { $0.id }
    #expect(kept == [fromAgent.id])
    // and its own run is the one its record names, though it has not reached the board
    let byRecord = SparkEntries.items(of: spark, rows: [], items: [fromOwn])
    #expect(byRecord.isEmpty)
  }

  @Test("PC-D5 A: Chat counts the sparks that need you, their agents' asks among them, each spark once")
  func needing() throws {
    let idle = try Self.velaRun(Self.idle)
    let ask = try NeedsItem(json: try Fixture.json("needs-item.agent-ask"))
    let entries = SparkEntries.entries(sparks: try Self.sparks(), rows: [idle], items: [ask, ask])
    #expect(SparkEntries.needing(entries) == 1)
    let found = entries.first { $0.spark.id == Self.vela }
    let vela = try #require(found)
    #expect(vela.status == .approval)
    let calm = SparkEntries.entries(sparks: try Self.sparks(), rows: [idle], items: [])
    #expect(SparkEntries.needing(calm) == 0)
  }

  @Test("the nineteen words are DESIGN.md §2.10's, and four of them need you")
  func words() {
    #expect(SparkStatus.allCases.count == 19)
    #expect(SparkStatus.asking.word == "Asking you")
    #expect(SparkStatus.approval.word == "Needs your OK")
    #expect(SparkStatus.sleeping.word == "Asleep")
    #expect(SparkStatus.reviewing.word == "Reading")
    #expect(SparkStatus.focus.word == "Watching")
    let needy = SparkStatus.allCases.filter { $0.needsYou }
    #expect(needy == [.asking, .approval, .stuck, .limited])
  }

  // MARK: - The thread marks (SP-1d)

  @Test("a turn that ends off screen marks its thread unread; showing it reads it; the first reading is no news")
  func unread() throws {
    let sparks = try Self.sparks()
    let working = try Self.velaRun(Self.idle + [([.key("monitorRow"), .key("status")], .string("working"))])
    let idle = try Self.velaRun(Self.idle)
    var ledger = ThreadLedger()
    // a turn that had ended before the first reading
    ledger.read(SparkEntries.entries(sparks: sparks, rows: [idle], items: []))
    #expect(ledger.unread.isEmpty)
    ledger.read(SparkEntries.entries(sparks: sparks, rows: [working], items: []))
    #expect(ledger.unread.isEmpty)
    let ended = SparkEntries.entries(sparks: sparks, rows: [idle], items: [])
    ledger.read(ended)
    #expect(ledger.unread == [Self.vela])
    let found = ended.first { $0.spark.id == Self.vela }
    let vela = try #require(found)
    #expect(ledger.mark(of: vela) == .unread)
    ledger.show(Self.vela, ended)
    #expect(ledger.unread.isEmpty)
    #expect(ledger.mark(of: vela) == nil)
    // on screen, a turn's end is read as it happens
    ledger.read(SparkEntries.entries(sparks: sparks, rows: [working], items: []))
    ledger.read(ended)
    #expect(ledger.unread.isEmpty)
  }

  @Test("a need off screen keeps its dot until the thread is opened, and outranks unread")
  func needs() throws {
    let sparks = try Self.sparks()
    var ledger = ThreadLedger()
    let asking = SparkEntries.entries(sparks: sparks, rows: [try Self.velaRun()], items: [])
    ledger.read(asking)
    #expect(ledger.needs == [Self.vela])
    let calm = SparkEntries.entries(sparks: sparks, rows: [try Self.velaRun(Self.idle)], items: [])
    ledger.read(calm)
    let found = calm.first { $0.spark.id == Self.vela }
    let vela = try #require(found)
    #expect(ledger.mark(of: vela) == .needs)
    ledger.show(Self.vela, calm)
    #expect(ledger.mark(of: vela) == nil)
    // a spark the list no longer holds takes its marks with it
    ledger.show(nil, calm)
    ledger.read(asking)
    #expect(ledger.needs == [Self.vela])
    ledger.read(SparkEntries.entries(sparks: Array(sparks.dropFirst()), rows: [], items: []))
    #expect(ledger.needs.isEmpty)
  }

  // MARK: - The time

  @Test("a row's time: now, a time today, a weekday this week, else the date")
  func activityWords() throws {
    let utc = try #require(TimeZone(identifier: "UTC"))
    let locale = Locale(identifier: "en_US")
    let now: Int64 = 1_793_275_200_000  // Thu 29 Oct 2026, 12:00 UTC
    func words(_ at: Int64) -> String { SparkEntries.activityWords(at: at, now: now, locale: locale, timeZone: utc) }
    #expect(words(now - 59_000) == "now")
    #expect(words(now - 2 * 3_600_000).contains("10:00"))
    #expect(words(now - 2 * 86_400_000) == "Tue")
    #expect(words(now - 17 * 86_400_000) == "Oct 12")
  }

  @Test("a time it cannot read is the start of time, as Date.parse's NaN is 0 on the Mac")
  func times() {
    #expect(SparkEntries.time("2026-10-29T11:02:10.118Z") == 1_793_271_730_118)
    #expect(SparkEntries.time("2026-10-29T11:20:00Z") == 1_793_272_800_000)
    #expect(SparkEntries.time("yesterday") == 0)
  }
}
