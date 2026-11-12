import FieldDesign
import FieldProduct
import Foundation
import Testing

@testable import FieldHistory

// SP-6 — the fold's decisions over the contracts' own goldens (H-D4): the
// words, a catalog row as a ledger row, the figures, the session rows under
// their days, the document's turns and runs, the hits, the standing.

@Suite("the fold decides in words")
struct HistoryFoldTests {
  /// Thursday 2026-10-01 10:30 local — a fixed now so the words are stable.
  private var now: Date {
    var parts = DateComponents()
    parts.year = 2026
    parts.month = 10
    parts.day = 1
    parts.hour = 10
    parts.minute = 30
    return Calendar.autoupdatingCurrent.date(from: parts)!
  }

  private func ms(_ date: Date) -> Int64 { Int64(date.timeIntervalSince1970 * 1000) }

  @Test("the clock, the day, the last word, the span, the tokens")
  func words() {
    let at = ms(now)
    #expect(FieldHistoryModel.clock(at) == "10:30")
    #expect(FieldHistoryModel.clockSeconds(at) == "10:30:00")
    #expect(FieldHistoryModel.clock(nil) == "—")
    #expect(FieldHistoryModel.dayWords(at) == "Thu 1 Oct")
    #expect(FieldHistoryModel.dayHeader(at, now: now) == "Today")
    #expect(FieldHistoryModel.dayHeader(at - 86_400_000, now: now) == "Yesterday")
    #expect(FieldHistoryModel.dayHeader(at - 3 * 86_400_000, now: now) == "Mon 28 Sep")
    #expect(FieldHistoryModel.lastWord(at - 30_000, now: now) == "now")
    #expect(FieldHistoryModel.lastWord(at - 40 * 60_000, now: now) == "40m")
    #expect(FieldHistoryModel.lastWord(at - 2 * 3_600_000, now: now) == "2h")
    #expect(FieldHistoryModel.lastWord(at - 26 * 3_600_000, now: now) == "yesterday")
    #expect(FieldHistoryModel.lastWord(at - 12 * 86_400_000, now: now) == "12d")
    #expect(FieldHistoryModel.lastWord(nil, now: now) == "—")
    #expect(FieldHistoryModel.spanText(48_000) == "48s")
    #expect(FieldHistoryModel.spanText(161_000) == "2m 41s")
    #expect(FieldHistoryModel.spanText(3_720_000) == "1h 02m")
    #expect(FieldHistoryModel.tokensWord(21_400) == ("21.4", "K"))
    #expect(FieldHistoryModel.tokensWord(1_240_000_000) == ("1.24", "B"))
    #expect(FieldHistoryModel.tokensWord(386_000_000) == ("386", "M"))
    #expect(FieldHistoryModel.tokensWord(42) == ("42", ""))
    #expect(FieldHistoryModel.homeAbbreviated("/Users/me/Projects/vibe-field") == "~/Projects/vibe-field")
    #expect(FieldHistoryModel.homeAbbreviated("/w/one") == "/w/one")
  }

  @Test("a catalog row is a ledger row: sessions as the figure until the figures land, then tokens, a spark and the ribbon")
  func ledgerRow() throws {
    let page = try IndexProjectsResult(json: try Fixture.json("index-projects.mesh"))
    let row = try #require(page.rows.first)
    let project = FieldHistoryModel.ledgerProject(row, seq: 0, now: now)
    #expect(project.id == "p-4f1c2a9e")
    #expect(project.name == "vibe-field")
    #expect(project.path == "~/Projects/vibe-field")
    #expect(project.figure == "412" && project.unit == "")
    #expect(project.spend == 0)
    #expect(project.spark.isEmpty && project.ribbon == nil && project.stats == nil)
    let figures = try IndexProjectResult(json: try Fixture.json("index-project.valid"))
    let sessions = try IndexSessionsResult(json: try Fixture.json("index-sessions.valid")).rows
    let filled = FieldHistoryModel.withFigures(project, figures, sessions: sessions, now: now)
    let total = figures.heatmap.reduce(0) { $0 + $1.tokens }
    #expect(filled.figure == FieldHistoryModel.tokensWord(total).figure)
    #expect(filled.spend == total / 1e6)
    #expect(filled.spark.count == FieldHistoryModel.sparkDays)
    #expect(filled.ribbon?.count == 53 && filled.ribbon?.allSatisfy { $0.count == 7 } == true)
    #expect(filled.stats?.sessions == "2")
    #expect(filled.stats?.tokens == FieldHistoryModel.tokensWord(total).figure)
    #expect(filled.agents.map(\.agent).sorted() == Array(Set(sessions.map { $0.provider ?? "agent" })).sorted())
    #expect(filled.stats?.facts.contains("active day") == true)
  }

  @Test("session rows stand under their days, newest first; the live ones are the recent ones")
  func sessionRows() throws {
    let listing = try IndexSessionsResult(json: try Fixture.json("index-sessions.valid")).rows
    let rows = FieldHistoryModel.sessionRows(listing, projectId: "p", now: now)
    #expect(rows.count == listing.count)
    #expect(rows.first?.day != nil)
    #expect(rows.allSatisfy { !$0.title.isEmpty && !$0.meta.isEmpty && $0.branch.isEmpty })
    // the golden's second row carries no stamp at all: undated, its last word a dash — never 1970's
    #expect(rows.last?.day == "Undated")
    #expect(rows.last?.last == "—")
    // nothing in the golden moved within ten minutes of this fixed now
    #expect(FieldHistoryModel.liveRows(listing, now: now).isEmpty)
    let fresh = Date(timeIntervalSince1970: Double(listing[0].activity!.lastAt) / 1000 + 60)
    #expect(FieldHistoryModel.liveRows(listing, now: fresh).map(\.destination) == [.session(listing[0].sessionId)])
    let counts = FieldHistoryModel.counts(projects: try IndexProjectsResult(json: try Fixture.json("index-projects.mesh")).rows, sessions: listing)
    #expect(counts.sessions == 449)
  }

  @Test("the document: a prompt opens a turn, the Bash line folds into a run, the reply's image is a placeholder, the head carries the model and the tokens")
  func document() throws {
    let header = try IndexSessionResult(json: try Fixture.json("index-session.valid")).session
    let page = try IndexTimelineResult(json: try Fixture.json("index-timeline.valid"))
    let document = FieldHistoryModel.document(
      header: header, rows: page.entries, desktop: "studio", agentLabel: "Claude Code", nextCursor: page.nextCursor,
      watermark: page.watermark, liveSince: nil, now: now)
    #expect(document.id == "s1")
    #expect(document.title == "Named")
    #expect(document.agentName == "Claude Code" && document.agent == "claude")
    #expect(document.nextCursor == page.nextCursor && document.watermark == "1.2.3")
    #expect(document.turns.count == 1)
    let turn = try #require(document.turns.first)
    #expect(turn.prompt.hasPrefix("Run the specimen"))
    #expect(turn.promptAnchor == "t0")
    #expect(turn.model == "claude-opus-5 · high")
    // both agent rows carry a REQUEST's usage (rosetta's `scope: request`; a tool
    // round-trip is two requests of one response): the turn sums its requests
    #expect(turn.facts.hasSuffix("· 36"))
    // the Bash line, then the reply, then its image as words, then the message
    #expect(turn.segments.count == 4)
    guard case .ledger(_, let summary, _, let failed, let isLive, let lines) = turn.segments[0] else {
      Issue.record("the first segment is the run")
      return
    }
    #expect(summary == "1 command")
    #expect(failed == 0 && !isLive)
    #expect(lines.map(\.verb) == ["Ran"])
    #expect(lines.first?.object == "one" && lines.first?.result == "exit 0")
    guard case .prose(let id, _, let text, let anchor) = turn.segments[1] else {
      Issue.record("the second segment is the reply")
      return
    }
    #expect(id == "t2" && anchor == "t2" && text.hasPrefix("Rendering every row"))
    #expect(turn.segments[2] == .attachment(id: "t2/img-1", kind: "image", label: "image specimen.png on studio"))
    guard case .ledger(_, let message, _, _, _, let messageLines) = turn.segments[3] else {
      Issue.record("the fourth segment is the collaboration's run")
      return
    }
    #expect(messageLines.first?.verb == "Message" && messageLines.first?.object == "design docs updated")
    #expect(message == "message · design docs updated")
    // every anchor the stepper can walk, in reading order
    #expect(document.anchors == ["t0", "t2"])
  }

  @Test("a transcript that opens on a reply draws a turn without a prompt; a gap wears a day pill")
  func replyFirst() throws {
    let header = try IndexSessionResult(json: try Fixture.json("index-session.valid")).session
    let page = try IndexTimelineResult(json: try Fixture.json("index-timeline.valid"))
    var rows = Array(page.entries.dropFirst())
    // a second prompt an hour and nineteen minutes after the first reply
    let later = try IndexTimelineRow(
      json: .object([
        "timelineId": .string("t5"), "sessionId": .string("s1"), "ordinal": .int(10), "kind": .string("user"),
        "at": .int(Int64(3_800_000 + 79 * 60_000)), "group": .object(["id": .string("turn-2"), "kind": .string("human_turn")]),
        "text": .string("And then?"),
      ]))
    rows.append(later)
    let document = FieldHistoryModel.document(
      header: header, rows: rows, desktop: "studio", agentLabel: "Claude", nextCursor: nil, watermark: nil,
      liveSince: "11:45", now: now)
    #expect(document.turns.count == 2)
    #expect(document.turns[0].prompt == "" && document.turns[0].promptAnchor == nil)
    #expect(document.turns[1].prompt == "And then?")
    #expect(document.turns[1].dayPill?.after == "after 1h 19m")
    #expect(document.liveSince == "11:45")
  }

  @Test("a cut text says so, with the whole's size; an attachment without bytes says its reason — never a body that reads as whole")
  func honestWords() throws {
    #expect(FieldHistoryModel.clippedWords(byteLen: 14_336, desktop: "studio") == "clipped · 14 KB on studio")
    #expect(FieldHistoryModel.clippedWords(byteLen: 2_300_000, desktop: "mini") == "clipped · 2.2 MB on mini")
    #expect(FieldHistoryModel.clippedWords(byteLen: 812, desktop: "studio") == "clipped · 812 B on studio")
    #expect(FieldHistoryModel.clippedWords(byteLen: nil, desktop: "studio") == "clipped on studio")
    #expect(FieldHistoryModel.unavailableWords("not_recorded") == "not recorded")
    #expect(FieldHistoryModel.unavailableWords("omitted") == "omitted from the record")
    #expect(FieldHistoryModel.unavailableWords("invalid_data") == "unreadable in the record")
    #expect(FieldHistoryModel.unavailableWords("unsupported_media") == "unsupported media")
    #expect(FieldHistoryModel.unavailableWords("too_large") == "too large")
    #expect(FieldHistoryModel.unavailableWords(nil) == "not recorded")
    let header = try IndexSessionResult(json: try Fixture.json("index-session.valid")).session
    let cutPrompt = try IndexTimelineRow(
      json: .object([
        "timelineId": .string("p1"), "sessionId": .string("s1"), "ordinal": .int(1), "kind": .string("user"),
        "group": .object(["id": .string("turn-1"), "kind": .string("human_turn")]),
        "text": .string("a prompt cut at the bound"), "textClipped": .bool(true), "textByteLen": .int(14_336),
      ]))
    let cutReply = try IndexTimelineRow(
      json: .object([
        "timelineId": .string("r1"), "sessionId": .string("s1"), "ordinal": .int(2), "kind": .string("agent"),
        "group": .object(["id": .string("turn-1"), "kind": .string("agent_cycle")]),
        "text": .string("a reply cut at the bound"), "textClipped": .bool(true),
        "attachments": .array([
          .object([
            "id": .string("a1"), "kind": .string("document"), "name": .string("notes.pdf"),
            "available": .bool(false), "reason": .string("omitted"),
          ])
        ]),
      ]))
    let document = FieldHistoryModel.document(
      header: header, rows: [cutPrompt, cutReply], desktop: "studio", agentLabel: "Claude", nextCursor: nil,
      watermark: nil, liveSince: nil, now: now)
    let turn = try #require(document.turns.first)
    #expect(turn.promptClipped == "clipped · 14 KB on studio")
    #expect(turn.segments.count == 3)
    #expect(turn.segments[1] == .clipped(id: "r1/clipped", words: "clipped on studio"))
    #expect(turn.segments[2] == .attachment(id: "r1/a1", kind: "document", label: "document notes.pdf · omitted from the record on studio"))
    // a whole text carries no such words
    let whole = FieldHistoryModel.document(
      header: header, rows: try IndexTimelineResult(json: try Fixture.json("index-timeline.valid")).entries,
      desktop: "studio", agentLabel: "Claude", nextCursor: nil, watermark: nil, liveSince: nil, now: now)
    #expect(whole.turns.first?.promptClipped == nil)
    let wholeHasClipped = whole.turns.first?.segments.contains { segment in
      if case .clipped = segment { return true } else { return false }
    } ?? false
    #expect(!wholeHasClipped)
  }

  @Test("the run's sentence: acts first, then looks, the edited files named, thoughts only alone")
  func runSummary() {
    let lines: [(family: String, object: String)] = [
      ("file_read", "a.ts"), ("file_search", "q"), ("file_change", "vibefield.ts"), ("file_change", "glyphs.svg"),
      ("shell", "pnpm build"), ("file_read", "b.ts"), ("shell", "pnpm specimen"),
    ]
    // item 362e: a command is a look (the room's FAMILY_CLASS), so it sits with the looks, by count then first seen
    #expect(FieldHistoryModel.runSummary(lines: lines, thoughts: 1) == "2 edits · vibefield.ts, glyphs.svg · 2 reads · 2 commands · 1 search")
    // and every family the room calls a look is one here, no more and no fewer
    #expect(
      FieldHistoryModel.lookFamilies == [
        "file_read", "file_list", "file_search", "code_lookup", "web_search", "web_fetch", "web_navigate",
        "tool_discovery", "shell",
      ])
    #expect(FieldHistoryModel.runSummary(lines: [], thoughts: 2) == "2 thoughts")
    #expect(FieldHistoryModel.runSummary(lines: [], thoughts: 0) == "")
    #expect(FieldHistoryModel.splitPath("design-kit/src/icons/vibefield.ts", family: "file_read") == ("src/icons/", "vibefield.ts"))
    #expect(FieldHistoryModel.splitPath("pnpm test", family: "shell") == (nil, "pnpm test"))
  }

  @Test("the hits group under the root they land in, the marks stripped; the index's own answer stands aside from the local filter")
  func hits() throws {
    let answer = try IndexSearchResult(json: try Fixture.json("index-search-result.valid"))
    let groups = FieldHistoryModel.hitGroups(answer, now: now)
    #expect(groups.count == 1)
    #expect(groups[0].sessionId == "s0")
    #expect(groups[0].rows.first?.text == "needle in a haystack")
    #expect(groups[0].rows.first?.who == .you)
    #expect(groups[0].rows.first?.anchor == "t1")
    var corpus = HistoryCorpus.empty(desktop: "studio", deviceId: "dev-1")
    corpus.hits = groups
    corpus.searchedQuery = "needl"
    // the index widened `needl` to `needle`: the local filter would drop it
    #expect(FieldHistoryModel.visibleHits(query: "needl", kind: .any, in: corpus).count == 1)
    #expect(FieldHistoryModel.visibleHits(query: "needl", kind: .replies, in: corpus).isEmpty)
    #expect(FieldHistoryModel.visibleHits(query: "other", kind: .any, in: corpus).isEmpty)
  }

  /// SE-P1 (SE-D3/SE-D4 A) — a group carries its ROOT's facts from the index's hits: the native id Live now joins a
  /// run's lines by, the folder's last name, the catalog agent and the PJ key; the unattributed hit's group carries
  /// none. The agent is the golden's own word (R23b: no id is written here).
  @Test("a hit group carries its root's facts: the native id, the folder, the agent; the unattributed one none")
  func hitGroupsCarryTheRootsFacts() throws {
    let json = try Fixture.json("index-search-result.everything")
    let hits = json["hits"]?.arrayValue ?? []
    let provider = hits.first?["provider"]?.stringValue
    let native = hits.first?["nativeSessionId"]?.stringValue
    let groups = FieldHistoryModel.hitGroups(try IndexSearchResult(json: json), now: now)
    // two hits share a root: three groups
    #expect(groups.count == 3)
    let first = groups[0]
    #expect(first.rows.count == 2)
    #expect(native != nil && provider != nil, "the golden names both")
    #expect(first.nativeSessionId == native)
    #expect(first.folder == "rosetta")
    #expect(first.provider == provider)
    #expect(first.agent == provider, "the agent's mark is the catalog's agent, not the word `agent`")
    #expect(first.projectKey == nil)
    #expect(groups[1].folder == "scratch")
    let lost = groups[2]
    #expect(lost.nativeSessionId == nil && lost.folder == nil && lost.provider == nil && lost.projectKey == nil)
  }

  /// SE-P1 — a filter's narrowing keeps the group's facts: the kind (the index's answer) and the local match (the
  /// mock's) both hand back the root's native id and folder.
  @Test("a narrowed group keeps its root's facts")
  func narrowingKeepsTheFacts() throws {
    let json = try Fixture.json("index-search-result.everything")
    var corpus = HistoryCorpus.empty(desktop: "studio", deviceId: "dev-1")
    corpus.hits = FieldHistoryModel.hitGroups(try IndexSearchResult(json: json), now: now)
    corpus.searchedQuery = "migration"
    let replies = FieldHistoryModel.visibleHits(query: "migration", kind: .replies, in: corpus)
    let first = try #require(replies.first)
    #expect(first.rows.count == 1)
    #expect(first.folder == "rosetta")
    #expect(first.nativeSessionId != nil)
    corpus.searchedQuery = nil
    let local = FieldHistoryModel.hits(for: "reversible", kind: .any, in: corpus)
    let only = try #require(local.first)
    #expect(only.folder == "rosetta")
  }

  /// SE-P1 — a group this phone cached before SE-2 carries none of the new keys: it still reads, with no facts.
  @Test("a cached group from before SE-2 still reads")
  func anOldCachedGroupReads() throws {
    let old = Data(
      """
      {"id":"g-s0","projectId":"","sessionId":"s0","sessionTitle":"Named","agent":"agent","day":"Today",
       "rows":[{"id":"s1/t1","anchor":"t1","who":{"you":{}},"text":"needle","at":"10:30"}]}
      """.utf8)
    let group = try JSONDecoder().decode(HistoryHitGroup.self, from: old)
    #expect(group.sessionId == "s0")
    #expect(group.rows.count == 1)
    #expect(group.nativeSessionId == nil && group.folder == nil && group.provider == nil && group.projectKey == nil)
  }

  @Test("the standing: live is connected, a reading phase is indexing with the build's counters, no answer is asleep, another version names both numbers")
  func standing() throws {
    let live = try IndexStatusResult(json: try Fixture.json("index-status.valid"))
    #expect(FieldHistoryModel.standing(status: live) == .connected)
    let building = try IndexStatusResult(
      json: .object([
        "phase": .string("backfilling"),
        "search": .object(["progress": .object(["done": .int(8_400), "total": .int(13_700)])]),
      ]))
    #expect(FieldHistoryModel.standing(status: building) == .indexing(percent: 61, done: "8,400", total: "13,700"))
    #expect(FieldHistoryModel.standing(status: nil) == .asleep)
    let corpus = HistoryCorpus.mock
    #expect(
      FieldHistoryModel.scopeLine(corpus, standing: .incompatible(theirs: "0.2.0", ours: "0.1.0"), device: .iPhone)
        == "studio speaks contracts 0.2.0 · this iPhone 0.1.0")
    #expect(FieldHistoryModel.liveHeader(corpus, standing: .incompatible(theirs: "0.2.0", ours: "0.1.0")).count == nil)
  }
}

/// Item 362c (James, 2026-11-12 18:40:35Z, of the phone's History session view: "there is no chat message time
/// grouping like desktop") — time cuts a session's document into SITTINGS by the room's rule (rosetta
/// `lib/transcript/sittings.ts`, `document-plan.ts`, `DayPill.tsx`): a new sitting before a row fifteen minutes or
/// more after the row before it, or on another calendar day, each opened by the room's pill. The phone had one
/// pill, before a prompt sixty minutes or more after the turn before it, with no day in it.
///
/// Every stamp is built on this phone's own calendar, so the rows hold in any time zone.
@Suite("item 362c — time cuts a session's document into sittings")
struct HistorySittingTests {
  private let calendar = Calendar.autoupdatingCurrent

  private func at(_ month: Int, _ day: Int, _ hour: Int, _ minute: Int, year: Int = 2026) -> Int64 {
    let parts = DateComponents(year: year, month: month, day: day, hour: hour, minute: minute)
    return Int64(calendar.date(from: parts)!.timeIntervalSince1970 * 1000)
  }

  /// Thursday 2026-10-01 10:30 on this phone.
  private var now: Date { calendar.date(from: DateComponents(year: 2026, month: 10, day: 1, hour: 10, minute: 30))! }

  private func row(_ id: String, _ ordinal: Int, _ kind: String, at: Int64?) throws -> IndexTimelineRow {
    var fields: [String: JSONValue] = [
      "timelineId": .string(id), "sessionId": .string("s1"), "ordinal": .int(Int64(ordinal)), "kind": .string(kind),
      "group": .object(["id": .string("g"), "kind": .string(kind == "user" ? "human_turn" : "agent_cycle")]),
      "text": .string("words of \(id)"),
    ]
    if let at { fields["at"] = .int(at) }
    return try IndexTimelineRow(json: .object(fields))
  }

  private func document(_ rows: [IndexTimelineRow]) throws -> HistoryDocument {
    let header = try IndexSessionResult(json: try Fixture.json("index-session.valid")).session
    return FieldHistoryModel.document(
      header: header, rows: rows, desktop: "studio", agentLabel: "Claude", nextCursor: nil, watermark: nil,
      liveSince: nil, now: now)
  }

  @Test("fifteen minutes of silence start a sitting, fourteen do not; the first sitting's pill is its day")
  func thePause() throws {
    let rows = [
      try row("u1", 1, "user", at: at(9, 1, 10, 0)), try row("a1", 2, "agent", at: at(9, 1, 10, 1)),
      try row("u2", 3, "user", at: at(9, 1, 10, 15)), try row("u3", 4, "user", at: at(9, 1, 10, 30)),
    ]
    #expect(FieldHistoryModel.sittingPauseMinutes == 15)
    #expect(FieldHistoryModel.sittings(rows, now: now).map(\.rowIds) == [["u1", "a1", "u2"], ["u3"]])
    let turns = try document(rows).turns
    #expect(turns.map(\.id) == ["u1", "u2", "u3"])
    #expect(turns[0].dayPill == HistoryDayPill(lead: "Tue 1 Sep"))
    #expect(turns[1].dayPill == nil, "fourteen minutes after the reply")
    #expect(turns[2].dayPill == HistoryDayPill(lead: "10:30", after: "after 15m"))
  }

  @Test("a session of one sitting wears no pill at all")
  func oneSitting() throws {
    let rows = [
      try row("u1", 1, "user", at: at(9, 1, 10, 0)), try row("a1", 2, "agent", at: at(9, 1, 10, 14)),
      try row("u2", 3, "user", at: at(9, 1, 10, 28)),
    ]
    #expect(try document(rows).turns.allSatisfy { $0.dayPill == nil })
  }

  @Test("a day that turns without a pause is the day alone; a pause across a day is the day, the clock and the gap")
  func theDay() throws {
    let quiet = [try row("a1", 1, "agent", at: at(8, 31, 23, 55)), try row("a2", 2, "agent", at: at(9, 1, 0, 2))]
    #expect(
      FieldHistoryModel.sittings(quiet, now: now).map(\.pill)
        == [HistoryDayPill(lead: "Mon 31 Aug"), HistoryDayPill(lead: "Tue 1 Sep")])
    let paused = [try row("a1", 1, "agent", at: at(8, 31, 23, 18)), try row("a2", 2, "agent", at: at(9, 1, 0, 2))]
    #expect(
      FieldHistoryModel.sittings(paused, now: now).last?.pill
        == HistoryDayPill(lead: "Tue 1 Sep · 00:02", after: "after 44m"))
    let within = [try row("a1", 1, "agent", at: at(9, 1, 0, 13)), try row("a2", 2, "agent", at: at(9, 1, 12, 31))]
    #expect(
      FieldHistoryModel.sittings(within, now: now).last?.pill == HistoryDayPill(lead: "12:31", after: "after 12h 18m"))
  }

  @Test("the day is Today, Yesterday, a named day, and wears its year only when it is not this one")
  func theDaysWords() {
    #expect(FieldHistoryModel.sittingDay(at(10, 1, 8, 0), now: now) == "Today")
    #expect(FieldHistoryModel.sittingDay(at(9, 30, 23, 0), now: now) == "Yesterday")
    #expect(FieldHistoryModel.sittingDay(at(9, 28, 9, 0), now: now) == "Mon 28 Sep")
    #expect(FieldHistoryModel.sittingDay(at(8, 24, 9, 0, year: 2025), now: now) == "24 Aug 2025")
  }

  @Test("a pause is said to the minute: minutes, hours and minutes up to two days, then days and hours")
  func thePausesWords() {
    #expect(FieldHistoryModel.pauseText(44 * 60_000) == "44m")
    #expect(FieldHistoryModel.pauseText(90_000) == "2m", "a half minute rounds up")
    #expect(FieldHistoryModel.pauseText((12 * 60 + 18) * 60_000) == "12h 18m")
    #expect(FieldHistoryModel.pauseText((47 * 60 + 59) * 60_000) == "47h 59m")
    #expect(FieldHistoryModel.pauseText(51 * 3_600_000) == "2d 3h")
  }

  @Test("a reply the time cuts continues under the pill: no second head, no prompt, and no run across the cut")
  func aReplyCut() throws {
    let rows = [
      try row("u1", 1, "user", at: at(9, 1, 10, 0)), try row("t1", 2, "thinking", at: at(9, 1, 10, 1)),
      try row("t2", 3, "thinking", at: at(9, 1, 10, 40)), try row("a1", 4, "agent", at: at(9, 1, 10, 41)),
    ]
    let turns = try document(rows).turns
    #expect(turns.count == 2)
    #expect(turns[0].id == "u1" && turns[0].continues == false)
    #expect(turns[0].segments.map(\.id) == ["t1"], "the run ends at the cut")
    #expect(turns[1].id == "t2" && turns[1].continues)
    #expect(turns[1].prompt == "" && turns[1].promptAnchor == nil)
    #expect(turns[1].model == "" && turns[1].facts == "", "the head stands once, on the reply's first part")
    #expect(turns[1].dayPill == HistoryDayPill(lead: "10:40", after: "after 39m"))
    #expect(turns[1].segments.map(\.id) == ["t2", "a1"])
    #expect(turns[0].facts.hasPrefix("40m"), "the reply's span is the whole reply's")
  }

  @Test("a prompt whose reply began in a later sitting stands alone before the pill, and the reply keeps its head")
  func aPromptAlone() throws {
    let rows = [
      try row("u1", 1, "user", at: at(8, 31, 23, 50)), try row("a1", 2, "agent", at: at(9, 1, 0, 30)),
    ]
    let turns = try document(rows).turns
    #expect(turns.map(\.id) == ["u1", "a1"])
    #expect(turns[0].prompt == "words of u1" && turns[0].segments.isEmpty)
    #expect(turns[0].dayPill == HistoryDayPill(lead: "Mon 31 Aug"))
    #expect(turns[1].continues == false, "it carries the reply's head")
    #expect(turns[1].dayPill == HistoryDayPill(lead: "Tue 1 Sep · 00:30", after: "after 40m"))
  }

  @Test("a row with no stamp never cuts, a stamp that runs backwards is no pause, and the rule starts at the first row's")
  func whatNeverCuts() throws {
    let unstamped = [
      try row("u1", 1, "user", at: at(9, 1, 10, 0)), try row("a1", 2, "agent", at: nil),
      try row("a2", 3, "agent", at: at(9, 1, 10, 10)),
    ]
    #expect(FieldHistoryModel.sittings(unstamped, now: now).count == 1)
    let backwards = [try row("u1", 1, "user", at: at(9, 1, 10, 0)), try row("a1", 2, "agent", at: at(9, 1, 9, 50))]
    #expect(FieldHistoryModel.sittings(backwards, now: now).count == 1)
    // the room's code as it stands: with no stamp on the first row there is nothing to measure a silence from
    let headless = [
      try row("a0", 1, "agent", at: nil), try row("a1", 2, "agent", at: at(9, 1, 10, 0)),
      try row("a2", 3, "agent", at: at(9, 1, 12, 0)),
    ]
    #expect(FieldHistoryModel.sittings(headless, now: now).count == 1)
  }

  @Test("a document this phone kept in the older shape is dropped and read again, never a crash")
  func anOlderKeptDocument() throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("vf-history-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let cache = HistoryCache(directory: directory)
    let key = HistoryCache.Key(device: "dev-1", session: "s1", stamp: "1")
    let kept = try document([
      try row("u1", 1, "user", at: at(9, 1, 10, 0)), try row("u2", 2, "user", at: at(9, 1, 11, 19)),
    ])
    cache.keep(kept, key: key)
    #expect(cache.document(key: key)?.document == kept)
    // as a build before item 362c kept it: a pill of `time` and `after`, turns with no `continues`
    let names = FileManager.default.enumerator(atPath: directory.path)?.allObjects as? [String] ?? []
    let file = directory.appendingPathComponent(try #require(names.first { $0.hasSuffix(".json") }))
    var whole = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    var document = try #require(whole["document"] as? [String: Any])
    let turns = try #require(document["turns"] as? [[String: Any]])
    document["turns"] = turns.map { turn -> [String: Any] in
      var older = turn
      older["continues"] = nil
      if older["dayPill"] != nil { older["dayPill"] = ["time": "11:19", "after": "after 1h 19m"] }
      return older
    }
    whole["document"] = document
    try JSONSerialization.data(withJSONObject: whole).write(to: file)
    #expect(cache.document(key: key) == nil)
    #expect(FileManager.default.fileExists(atPath: file.path) == false, "what cannot be read is not kept")
    #expect(cache.latestDocument(device: "dev-1", session: "s1") == nil)
    cache.keep(kept, key: key)
    #expect(cache.latestDocument(device: "dev-1", session: "s1")?.document == kept)
  }
}
