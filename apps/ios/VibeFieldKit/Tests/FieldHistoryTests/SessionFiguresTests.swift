import FieldProduct
import Foundation
import Testing

@testable import FieldHistory

/// Item 393 (asked for 2026-11-13, of a project's page on a phone: a session's entry shows its message count,
/// token count, cost and the rest, laid out as the desktop's session entry is
/// designed) — a session's entry carries the desktop entry's figures where the phone holds them: its row
/// in its project's `contribution`, joined by the desktop that recorded it and its id there, and said in the
/// desktop's order (`N msgs · span · tokens · cost`) in the phone's own formatters.
///
/// The cut these rows hold too: a desktop answers a phone a hundred of a project's rows, so an entry past them has
/// no figures and keeps the line it had. The door that would answer the rest is item 398, and is not built here.
///
/// How the line reads on a phone, and whether it fits one line there, are to be seen on a device.
@Suite("item 393 — a session's entry carries the desktop entry's figures")
struct SessionFiguresTests {
  private static let studio = "01J9ZK3M5Q8XR2V7N4B6C1D0EF"
  private static let laptop = "01J9ZM0PQ7W3E6R8T2Y4U1I5O9"
  /// 2025-10-01 02:00:00Z: after every stamp these rows carry.
  private static let now = Date(timeIntervalSince1970: 1_759_284_000)
  /// The goldens' last activity. Every session made here ran 1 h 53 m 20 s, up to its own.
  private static let lastAt: Int64 = 1_759_276_800_000

  /// A listing row as `project.sessions` answers it, kept to what the join and the line read.
  private static func session(
    _ id: String, on device: String = SessionFiguresTests.studio, root: String? = nil, state: String = "indexed",
    lastAt: Int64 = SessionFiguresTests.lastAt
  ) throws -> IndexSessionRow {
    try IndexSessionRow(
      json: .object([
        "sessionId": .string(id), "nativeSessionId": .string("native-\(id)"), "rootSessionId": .string(root ?? id),
        "device": .string(device), "provider": .string("claude"), "title": .string(id),
        "streamState": .string(state), "startedAt": .int(lastAt - 6_800_000),
        "activity": .object(["firstAt": .int(lastAt - 6_800_000), "lastAt": .int(lastAt)]),
      ]))
  }

  /// One session's row of `project.figures`' `contribution`: the goldens' first row unless said otherwise.
  private static func figures(
    _ id: String, on device: String = SessionFiguresTests.studio, messages: Double = 88, tokens: Double = 182_000,
    cost: Double? = 1_240_000, unpriced: Double = 0, unrecorded: Double = 0
  ) throws -> IndexContribution {
    var fields: [String: JSONValue] = [
      "sessionId": .string(id), "device": .string(device), "messages": .double(messages),
      "tokens": .double(tokens), "unpricedTokens": .double(unpriced), "unrecordedOutput": .double(unrecorded),
    ]
    if let cost { fields["costMicroUsd"] = .double(cost) }
    return try IndexContribution(json: .object(fields))
  }

  /// A project's session rows, folded as the ledger folds them, over `contribution`.
  private static func rows(_ listed: [IndexSessionRow], _ contribution: [IndexContribution]) -> [HistorySession] {
    FieldHistoryModel.projectSessionRows(
      listed, key: "p", places: [], desktops: [], now: SessionFiguresTests.now, contribution: contribution)
  }

  @Test("a session's figures are its row in its project's contribution, joined by its desktop and its id there")
  func joined() throws {
    let listed = [
      try Self.session("ses-a"), try Self.session("ses-b", on: Self.laptop, lastAt: Self.lastAt - 60_000),
    ]
    let contribution = [
      try Self.figures("ses-a"),
      // the same id on ANOTHER desktop is another session's row
      try Self.figures("ses-b", on: Self.studio, messages: 5, tokens: 10, cost: 10),
    ]
    let rows = Self.rows(listed, contribution)
    let a = try #require(rows.first { $0.id == "ses-a" })
    #expect(a.messages == 88 && a.tokens == 182_000)
    #expect(a.spend == HistorySpend(costMicroUsd: 1_240_000))
    #expect(a.meta.hasPrefix("88 msgs · 1h 53m · 182K · $1.24 · started "))
    let b = try #require(rows.first { $0.id == "ses-b" })
    #expect(b.messages == nil && b.tokens == nil && b.spend == nil, "its own desktop gave no row for it")
    #expect(b.meta.hasPrefix("1h 53m · started "), "the line it had")
  }

  @Test("over the contracts' goldens: the project's session wears its row, and says what it said before")
  func goldens() throws {
    let page = try ProjectSessionsResult(json: try Fixture.json("project-sessions.valid"))
    let answer = try ProjectFiguresResult(json: try Fixture.json("project-figures.valid"))
    let project = try ProjectSummary(json: try Fixture.json("project-summary.valid"))
    let rows = FieldHistoryModel.projectSessionRows(
      page.rows, key: page.key, places: project.places, desktops: [], now: Self.now,
      contribution: answer.contribution)
    // the golden's second contribution row is of a session the listing does not hold: it is given to no entry
    #expect(rows.count == 1)
    let row = try #require(rows.first)
    #expect(row.messages == 88 && row.tokens == 182_000)
    #expect(row.spend?.coverage == .complete)
    #expect(row.meta.hasPrefix("88 msgs · 1h 53m · 182K · $1.24 · started "))
    #expect(row.folder == "vibe-field" && row.provider == "claude" && row.day != nil)
  }

  @Test("an entry past the door's hundred draws no figures: it keeps the line it had, never a 0 or a dash")
  func pastTheHundred() throws {
    // 101 sessions listed, a minute apart; the door answered a phone its hundred heaviest rows
    let listed = try (0...100).map { try Self.session("ses-\($0)", lastAt: Self.lastAt - Int64($0) * 60_000) }
    let hundred = try (0..<100).map { try Self.figures("ses-\($0)", messages: Double($0 + 1)) }
    let rows = Self.rows(listed, hundred)
    #expect(rows.count == 101)
    #expect(rows.filter { $0.messages != nil }.count == 100, "every entry the phone holds a row for")
    let past = try #require(rows.first { $0.id == "ses-100" })
    #expect(past.messages == nil && past.tokens == nil && past.spend == nil)
    #expect(past.meta.hasPrefix("1h 53m · started "), "the line as it was before item 393")
    #expect(!past.meta.contains("msgs") && !past.meta.contains("$") && !past.meta.contains("—"))
    #expect(FieldHistoryModel.figuresLine(messages: nil, span: "1h 53m", tokens: nil, spend: nil) == nil)
    // and before the project's figures are read, every entry is as it was
    let unread = Self.rows(listed, [])
    #expect(unread.allSatisfy { $0.messages == nil && $0.meta.hasPrefix("1h 53m · started ") })
  }

  @Test("the line's words, in the desktop's order: whole, a lower bound, unpriced, and each figure absent")
  func words() {
    let whole = HistorySpend(costMicroUsd: 31_400_000)
    #expect(
      FieldHistoryModel.figuresLine(messages: 214, span: "3h 12m", tokens: 48_200_000, spend: whole)
        == "214 msgs · 3h 12m · 48.2M · $31.40")
    // the phone's own formatters: the count's separator, the tiles' tokens, the ledger row's cost
    #expect(
      FieldHistoryModel.figuresLine(
        messages: 1_214, span: "313h 54m", tokens: 1_240_000_000, spend: HistorySpend(costMicroUsd: 1_240_000_000))
        == "1,214 msgs · 313h 54m · 1.24B · $1.24K")
    // a lower bound (tokens with no list price, or a reply whose output was never recorded) says +
    #expect(
      FieldHistoryModel.figuresLine(
        messages: 21, span: "40m 00s", tokens: 96_000,
        spend: HistorySpend(costMicroUsd: 610_000, unpricedTokens: 1_200, unrecordedOutput: 1))
        == "21 msgs · 40m 00s · 96.0K · $0.61+")
    // usage with no list price reads n/p, never a claimed $0
    #expect(
      FieldHistoryModel.figuresLine(
        messages: 9, span: "5m 10s", tokens: 4_000, spend: HistorySpend(costMicroUsd: nil, unpricedTokens: 4_000))
        == "9 msgs · 5m 10s · 4.00K · n/p")
    // no tokens counted: neither tokens nor a cost, and no dash for either
    #expect(
      FieldHistoryModel.figuresLine(messages: 3, span: "48s", tokens: 0, spend: HistorySpend.none) == "3 msgs · 48s")
    // tokens whose spend says nothing: the cost leaves its place out
    #expect(
      FieldHistoryModel.figuresLine(messages: 3, span: "48s", tokens: 500, spend: HistorySpend.none)
        == "3 msgs · 48s · 500")
    #expect(
      FieldHistoryModel.figuresLine(messages: 3, span: "48s", tokens: 500, spend: nil) == "3 msgs · 48s · 500")
    // no recorded activity: the span leaves its place out
    #expect(
      FieldHistoryModel.figuresLine(
        messages: 3, span: nil, tokens: 2_000_000, spend: HistorySpend(costMicroUsd: 2_500_000))
        == "3 msgs · 2.00M · $2.50")
    // a count the phone does not hold leaves its place out, and the rest stand
    #expect(
      FieldHistoryModel.figuresLine(messages: nil, span: "48s", tokens: 2_000_000, spend: whole)
        == "48s · 2.00M · $31.40")
    // no figure at all: no figures line, with a span or without
    #expect(FieldHistoryModel.figuresLine(messages: nil, span: "48s", tokens: nil, spend: nil) == nil)
    #expect(FieldHistoryModel.figuresLine(messages: nil, span: nil, tokens: nil, spend: nil) == nil)
  }

  @Test("a subagent's own row carries no figures: they are in its root's, and it is never given its root's")
  func subagent() throws {
    let listed = [
      try Self.session("root-1"), try Self.session("sub-1", root: "root-1", lastAt: Self.lastAt - 60_000),
    ]
    let rows = Self.rows(listed, [try Self.figures("root-1", messages: 140)])
    #expect(rows.first { $0.id == "root-1" }?.messages == 140)
    let sub = try #require(rows.first { $0.id == "sub-1" })
    #expect(sub.messages == nil && sub.tokens == nil && sub.spend == nil)
    #expect(!sub.meta.contains("msgs"))
  }

  @Test("a session still being read whose row counts no message yet has no figures; the index's own zero is said")
  func landed() throws {
    let nothing = try Self.figures("empty", messages: 0, tokens: 0, cost: nil)
    let held = FieldHistoryModel.figuresBySession([
      try Self.figures("cooking", messages: 0, tokens: 0, cost: nil), try Self.figures("reading", messages: 12),
      nothing,
    ])
    #expect(held.count == 3)
    let cooking = try Self.session("cooking", state: "streaming")
    #expect(FieldHistoryModel.sessionFigures(cooking, in: held) == nil)
    let reading = try Self.session("reading", state: "streaming")
    #expect(FieldHistoryModel.sessionFigures(reading, in: held)?.messages == 12)
    // read to its end with nothing counted: a count, not an absence
    let empty = try Self.session("empty")
    #expect(FieldHistoryModel.sessionFigures(empty, in: held)?.messages == 0)
    #expect(Self.rows([empty], [nothing]).first?.meta.hasPrefix("0 msgs · 1h 53m · started ") == true)
    let absent = try Self.session("absent")
    #expect(FieldHistoryModel.sessionFigures(absent, in: held) == nil)
    // one conversation, one row: the first given for a session stands
    let twice = FieldHistoryModel.figuresBySession([
      try Self.figures("ses-a", messages: 7), try Self.figures("ses-a", messages: 99),
    ])
    let sessionA = try Self.session("ses-a")
    #expect(FieldHistoryModel.sessionFigures(sessionA, in: twice)?.messages == 7)
  }

  @Test("item 398: the listed sessions a cut answer lacks are asked for by id, the newest first, each once, a page")
  func wantedById() throws {
    let rows = [
      try Self.session("old", lastAt: Self.lastAt - 60_000), try Self.session("held"),
      try Self.session("asked", lastAt: Self.lastAt - 30_000), try Self.session("new", lastAt: Self.lastAt + 1),
      try Self.session("other", on: Self.laptop, lastAt: Self.lastAt - 90_000),
    ]
    let have: Set = [FieldHistoryModel.figuresKey(device: Self.studio, sessionId: "held")]
    let asked: Set = [FieldHistoryModel.figuresKey(device: Self.studio, sessionId: "asked")]
    let wanted = FieldHistoryModel.figuresWanted(rows, have: have, asked: asked)
    #expect(wanted.map(\.sessionId) == ["new", "old", "other"])
    #expect(wanted.map(\.device) == [Self.studio, Self.studio, Self.laptop])
    // a page at most: the door's own bound on one ask
    let many = try (0..<150).map { try Self.session("s\($0)", lastAt: Self.lastAt - Int64($0)) }
    let page = FieldHistoryModel.figuresWanted(many, have: [], asked: [])
    #expect(page.count == HistoryReads.listRows)
    #expect(page.first?.sessionId == "s0" && page.last?.sessionId == "s99")
  }

  @Test("a session cached before item 393 still reads, with no figures; one cached with them keeps them")
  func cached() throws {
    let before = """
      {"id":"s","projectId":"p","title":"t","agent":"claude","meta":"1h 53m · started 14:06","branch":"","last":"2h"}
      """
    let old = try JSONDecoder().decode(HistorySession.self, from: Data(before.utf8))
    #expect(old.messages == nil && old.tokens == nil && old.spend == nil)
    #expect(old.meta == "1h 53m · started 14:06")
    let kept = HistorySession(
      id: "s", projectId: "p", title: "t", agent: "claude", meta: "88 msgs · 1h 53m · 182K · $1.24 · started 14:06",
      branch: "", last: "2h", messages: 88, tokens: 182_000, spend: HistorySpend(costMicroUsd: 1_240_000))
    let read = try JSONDecoder().decode(HistorySession.self, from: try JSONEncoder().encode(kept))
    #expect(read == kept)
  }
}
