import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// IOS-12f's M-f2 (PC-L1, one Chat; plan-12f's Q8 A; VF-PM 2026-11-09 02:24:16Z) — the phone's @ is the Mac's. Each golden
/// is written by field-app's own models (`packages/field-app/test/at-rows-goldens.test.ts`) and copied here byte for byte
/// (`pnpm check:ios-fixtures`). A board row goes in as facts; the seam from the phone's remote row to those facts is a row
/// of its own at the foot, where Q3's residual lives.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("IOS-12f's M-f2 — the phone's @ is the Mac's: the at-rows goldens")
struct ChatAtGoldenTests {
  @Test("@'s words are the Mac's")
  func words() throws {
    let golden = try Self.golden("at-rows.rows.golden")
    let words = try #require(golden["words"])
    #expect(.string(ChatAtWords.agents) == words["agents"])
    #expect(.string(ChatAtWords.sessions) == words["sessions"])
    #expect(.string(ChatAtWords.reading) == words["reading"])
    #expect(.string(ChatAtWords.none("zzz")) == words["none"])
    #expect(.string(ChatAtWords.empty("Bare")) == words["empty"])
    #expect(.string(NewSparkWords.cannotListAgents) == words["failed"])
    #expect(.string(ChatAtWords.sessionsFailed) == words["sessionsFailed"])
  }

  @Test("the handles: a name, and an ordinal after the first by its start that shares it")
  func handles() throws {
    let golden = try Self.golden("at-rows.rows.golden")
    let want = try #require(golden["handles"]?.objectValue)
    #expect(want.count == 3)
    let board = try Self.board(golden)
    let sets = try Self.sets(golden)
    for (key, handles) in want {
      let spark = try Self.spark(golden, key)
      let drawn = ChatAt.handles(spark: spark, board: .read(board), sets: .read(sets))
      let said = JSONValue.object(drawn.mapValues { .string($0) })
      #expect(said == handles, "\(key)")
    }
  }

  @Test("the list: both groups, read bottom-up, each only what the spark's tools reach, or a word in their place")
  func list() throws {
    let golden = try Self.golden("at-rows.rows.golden")
    let board = try Self.board(golden)
    let sets = try Self.sets(golden)
    let labels = (golden["labels"]?.objectValue ?? [:]).compactMapValues { $0.stringValue }
    let cases = try #require(golden["cases"]?.arrayValue)
    #expect(cases.count == 13)
    for each in cases {
      let name = each["name"]?.stringValue ?? "?"
      let spark = try Self.spark(golden, each["spark"]?.stringValue ?? "")
      let query = each["query"]?.stringValue ?? ""
      let list = ChatAt.list(
        spark: spark, query: query, sets: Self.reading(each["sets"], sets), board: Self.reading(each["board"], board),
        labels: labels)
      let drawn = Self.json(list)
      let want = try #require(each["list"])
      #expect(drawn == want, "\(name)")
    }
  }

  // MARK: reading the golden

  static func golden(_ name: String) throws -> JSONValue {
    guard
      let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/at-rows")
    else { throw GoldenMissing(name: name) }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  struct GoldenMissing: Error {
    let name: String
  }

  static func sets(_ golden: JSONValue) throws -> [AgentProfileSet] {
    try (golden["sets"]?.arrayValue ?? []).map(AgentProfileSet.init(json:))
  }

  static func spark(_ golden: JSONValue, _ key: String) throws -> ChatAtSpark {
    let found = golden["sparks"]?[key]
    let spark = try #require(found)
    return ChatAtSpark(
      id: spark["id"]?.stringValue ?? "", name: spark["name"]?.stringValue ?? "",
      profiles: (spark["profiles"]?.arrayValue ?? []).compactMap { $0.stringValue }, run: spark["run"]?.stringValue)
  }

  static func board(_ golden: JSONValue) throws -> [ChatAtRun] {
    let rows = try #require(golden["board"]?.arrayValue)
    return rows.map { row in
      ChatAtRun(
        run: row["run"]?.stringValue ?? "", agent: row["agent"]?.stringValue ?? "",
        label: row["label"]?.stringValue ?? "",
        project: row["project"]?.stringValue, status: row["status"]?.stringValue ?? "",
        blockers: Int(row["blockers"]?.intValue ?? 0), alive: row["alive"]?.boolValue ?? false,
        spark: row["spark"]?.stringValue, originBy: row["origin"]?["by"]?.stringValue,
        originSpark: row["origin"]?["spark"]?.stringValue,
        profile: RunProfileFacts(profileSet: row["profileSet"]?.stringValue, profileId: row["profileId"]?.stringValue),
        createdAt: ms(row["createdAt"]) ?? 0, stateChangedAt: ms(row["stateChangedAt"]) ?? 0,
        lastActivityAt: ms(row["lastActivityAt"]))
    }
  }

  static func ms(_ value: JSONValue?) -> Double? {
    guard let text = value?.stringValue else { return nil }
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return parser.date(from: text).map { $0.timeIntervalSince1970 * 1000 }
  }

  static func reading<Value: Sendable>(_ word: JSONValue?, _ value: Value) -> ChatAtReading<Value> {
    switch word?.stringValue {
    case "read": .read(value)
    case "failed": .failed
    default: .reading
    }
  }

  // MARK: saying a list as the golden does

  static func json(_ list: ChatAtList) -> JSONValue {
    .object([
      "agents": .array(list.agents.map(json)), "sessions": .array(list.sessions.map(json)),
      "reading": .bool(list.reading), "sessionsFailed": .bool(list.sessionsFailed),
      "quiet": list.quiet.map { .string($0) } ?? .null,
    ])
  }

  static func json(_ row: ChatAtAgentRow) -> JSONValue {
    .object([
      "kind": .string("agent"), "id": .string(row.id), "agent": .string(row.agent), "label": .string(row.label),
      "profile": .object(["id": .string(row.profile.id), "name": .string(row.profile.name)]),
      "pill": row.pill.map { .string($0) } ?? .null,
    ])
  }

  static func json(_ row: ChatAtSessionRow) -> JSONValue {
    .object([
      "kind": .string("session"), "id": .string(row.id), "session": .string(row.session), "agent": .string(row.agent),
      "label": .string(row.label), "handle": .string(row.handle), "project": row.project.map { .string($0) } ?? .null,
      "word": row.word.map { .string($0.rawValue) } ?? .null,
    ])
  }
}

@Suite("IOS-12f's M-f2 — a remote row, as @ reads it")
struct ChatAtSeamTests {
  /// The witness's first row (claude, idle, in vibe-field, filed under the native set).
  private func witnessRow() throws -> AgentRemoteRow {
    let found = Bundle.module.url(
      forResource: "agent-remote-mesh-open.witness", withExtension: "json", subdirectory: "Fixtures")
    let url = try #require(found)
    let witness = try JSONValue.parse(try Data(contentsOf: url))
    let first = witness["devices"]?.arrayValue?.first?["snapshot"]?["rows"]?.arrayValue?.first
    let row = try #require(first)
    return try AgentRemoteRow(json: row)
  }

  @Test("the owner's monitor row says the run: its agent, its folder, its state and its times")
  func facts() throws {
    let row = try witnessRow()
    let run = ChatAtRun(remote: row)
    #expect(run.run == row.runtimeRunId)
    #expect(run.agent == "claude")
    #expect(run.label == "Claude Code")
    #expect(run.project == "vibe-field")
    #expect(run.status == "idle")
    #expect(run.blockers == 0)
    #expect(run.alive)
    #expect(run.createdAt == 1_790_800_100_000)
    #expect(run.stateChangedAt == 1_790_803_150_000)
    #expect(run.lastActivityAt == 1_790_803_150_000)
  }

  @Test("Q3: a remote row says the resolved profile and no persona, so a retired sign-in reads as its set")
  func profile() throws {
    let row = try witnessRow()
    let run = ChatAtRun(remote: row)
    let want = RunProfileFacts(profileSet: "native", profileId: nil)
    #expect(run.profile == want)
  }
}
