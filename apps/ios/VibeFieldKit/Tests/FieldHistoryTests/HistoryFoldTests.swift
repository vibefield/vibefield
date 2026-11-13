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
    // the Bash line, then its recorded image as words (item 362g: a tool's image was drawn nowhere), then the
    // reply, then its image as words, then the message
    try #require(turn.segments.count == 5)
    guard case .ledger(_, let summary, _, let failed, let isLive, let lines) = turn.segments[0] else {
      Issue.record("the first segment is the run")
      return
    }
    #expect(summary == "1 command")
    #expect(failed == 0 && !isLive)
    #expect(lines.map(\.verb) == ["Ran"])
    #expect(lines.first?.object == "one" && lines.first?.result == "exit 0")
    #expect(turn.segments[1] == .attachment(id: "t1/tool-image-1", kind: "image", label: "image on studio"))
    guard case .prose(let id, _, let text, let anchor) = turn.segments[2] else {
      Issue.record("the third segment is the reply")
      return
    }
    #expect(id == "t2" && anchor == "t2" && text.hasPrefix("Rendering every row"))
    #expect(turn.segments[3] == .attachment(id: "t2/img-1", kind: "image", label: "image specimen.png on studio"))
    guard case .ledger(_, let message, _, _, _, let messageLines) = turn.segments[4] else {
      Issue.record("the fifth segment is the collaboration's run")
      return
    }
    // item 362e: a team message is a member of its own kind under the room's head (it was a tool-shaped line,
    // `Message`, under the fallback sentence `message · design docs updated`)
    #expect(messageLines.first?.verb == "Team update" && messageLines.first?.object == "design docs updated")
    #expect(messageLines.first?.kind == .team)
    #expect(message == "1 team update")
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

// MARK: - Item 362e

/// Item 362e (James, 2026-11-12 18:40:35Z, of a session opened in the phone's History against the desktop's: "i
/// think all message type and views are different from desktop, needs thorough audit") — the kinds a row already
/// carries, drawn by the room's rule (rosetta at the pin, clients/room/src: `buildSegments` in
/// lib/transcript/turns.ts, then `activityPlan` and `summarizeActivity` in components/transcript/activity-plan.ts).
/// Between two replies everything the agent did is ONE group, and each thing in it keeps its own form. The phone
/// counted a thought and dropped its words, drew a notice, a summary and a team message as tool lines, drew a
/// blank reply as `(no words)` and let it cut the group, and folded a question to the reader into the run.
///
/// Rows are built in code, as the 362c suite's are: no fixture is added.
@Suite("item 362e — between two replies one group, and each thing in it keeps its own form")
struct HistoryGroupTests {
  private func row(
    _ id: String, _ ordinal: Int, _ kind: String, _ more: [String: JSONValue] = [:]
  ) throws -> IndexTimelineRow {
    var fields: [String: JSONValue] = [
      "timelineId": .string(id), "sessionId": .string("s1"), "ordinal": .int(Int64(ordinal)), "kind": .string(kind),
      "group": .object(["id": .string("g"), "kind": .string(kind == "user" ? "human_turn" : "agent_cycle")]),
    ]
    for (key, value) in more { fields[key] = value }
    return try IndexTimelineRow(json: .object(fields))
  }

  private func tool(
    _ id: String, _ ordinal: Int, _ family: String, _ object: String, failed: Bool = false
  ) throws -> IndexTimelineRow {
    try row(
      id, ordinal, "tool_use",
      [
        "tool": .object([
          "name": .string(family), "family": .string(family), "status": .string(failed ? "failed" : "succeeded"),
          "failed": .bool(failed), "object": .string(object),
        ])
      ])
  }

  private func words(_ id: String, _ ordinal: Int, _ kind: String, _ text: String) throws -> IndexTimelineRow {
    try row(id, ordinal, kind, ["text": .string(text)])
  }

  private func notice(_ id: String, _ ordinal: Int, _ type: String, _ text: String? = nil) throws -> IndexTimelineRow {
    var more: [String: JSONValue] = ["notice": .string(type)]
    if let text { more["text"] = .string(text) }
    return try row(id, ordinal, "notice", more)
  }

  private func group(
    _ segment: HistorySegment?
  ) -> (id: String, summary: String, failed: Int, lines: [HistoryLedgerLine])? {
    guard case .ledger(let id, let summary, _, let failed, _, let lines)? = segment else { return nil }
    return (id, summary, failed, lines)
  }

  private func isProse(_ segment: HistorySegment) -> Bool {
    if case .prose = segment { return true }
    return false
  }

  @Test("a reply with no words and no attachment says nothing and closes nothing")
  func aBlankReply() throws {
    let rows = [
      try tool("t1", 1, "shell", "pnpm build"),
      try words("a1", 2, "agent", "  \n "),
      try row("a2", 3, "agent"),
      try tool("t2", 4, "file_read", "a.ts"),
      try words("a3", 5, "agent", "Done."),
    ]
    let segments = FieldHistoryModel.segments(rows, desktop: "studio")
    #expect(segments.map(\.id) == ["t1", "a3"])
    let run = try #require(group(segments.first))
    #expect(run.lines.map(\.id) == ["t1", "t2"], "the group runs on across a reply that said nothing")
    #expect(run.summary == "1 command · 1 read")
    #expect(segments.filter(isProse).count == 1, "a blank reply is not drawn as (no words)")
    // a reply with an attachment and no words is its attachment, and it closes the group
    let pictured = try row(
      "a4", 2, "agent", ["attachments": .array([.object(["id": .string("i1"), "kind": .string("image")])])])
    let more = FieldHistoryModel.segments(
      [try tool("t3", 1, "shell", "ls"), pictured, try tool("t4", 3, "shell", "pwd")], desktop: "studio")
    #expect(more.map(\.id) == ["t3", "a4/i1", "t4"])
    #expect(more.filter(isProse).isEmpty)
  }

  @Test("a thought is a line with its first words and opens to all of them; a blank thought is not drawn")
  func aThought() throws {
    let long = String(repeating: "x", count: 150)
    let rows = [
      try words("h1", 1, "thinking", "the lean"),
      try words("h2", 2, "thinking", "  first line  \nand a second"),
      try words("h3", 3, "thinking", long),
      try words("h4", 4, "thinking", " \n "),
      try row(
        "h5", 5, "thinking",
        ["text": .string("cut by the desktop"), "textClipped": .bool(true), "textByteLen": .int(14_336)]),
    ]
    let run = try #require(group(FieldHistoryModel.segments(rows, desktop: "studio").first))
    #expect(run.lines.map(\.id) == ["h1", "h2", "h3", "h5"])
    try #require(run.lines.count == 4)
    #expect(run.lines.allSatisfy { $0.kind == .thought && $0.verb == "Thought" })
    #expect(run.summary == "4 thoughts")
    // one short line says everything: nothing to open
    #expect(run.lines[0].object == "the lean" && run.lines[0].words == nil)
    // the first line, trimmed, and all of it under the line
    #expect(run.lines[1].object == "first line" && run.lines[1].words == "  first line  \nand a second")
    // the room's `firstLine`: 120, the last of them the ellipsis
    #expect(run.lines[2].object == String(repeating: "x", count: 119) + "…")
    #expect(run.lines[2].words == long)
    // words the desktop cut open to what it sent, with the cut said under them
    #expect(run.lines[3].words == "cut by the desktop")
    #expect(run.lines[3].clipped == "clipped · 14 KB on studio")
    #expect(FieldHistoryModel.firstLine("one\ntwo") == "one")
    #expect(FieldHistoryModel.firstLine(String(repeating: "y", count: 120)).count == 120)
  }

  @Test("a notice says its type and its words in the room's shape; a runtime error counts as failed")
  func notices() throws {
    let rows = [
      try notice("n1", 1, "command_output", "$0.42 so far"),
      try notice("n2", 2, "runtime_error", "the socket closed"),
      try notice("n3", 3, "async_task", "the build finished"),
      try notice("n4", 4, "compaction", "the context was full"),
      try notice("n5", 5, "model_changed"),
    ]
    let run = try #require(group(FieldHistoryModel.segments(rows, desktop: "studio").first))
    #expect(run.lines.allSatisfy { $0.kind == .notice && $0.verb == "Session notice" })
    #expect(
      run.lines.map(\.object) == [
        "$0.42 so far", "runtime error · the socket closed", "background task · the build finished",
        "context compacted · the context was full", "model changed",
      ])
    #expect(run.lines.map(\.state) == [.ok, .failed, .ok, .ok, .ok])
    #expect(run.summary == "5 context events")
    #expect(run.failed == 1, "a runtime error is counted with the failed tools")
    // each says everything on its line: none opens
    #expect(run.lines.allSatisfy { $0.words == nil })
    // a command's output of several lines opens to all of it
    let output = try #require(
      group(FieldHistoryModel.segments([try notice("n6", 1, "command_output", "one\ntwo")], desktop: "studio").first))
    #expect(output.lines.map(\.object) == ["one"] && output.lines.map(\.words) == ["one\ntwo"])
  }

  @Test("a summary is its purpose and opens to its words; a compaction's is its own card, always")
  func summaries() throws {
    let rows = [
      try row("s1", 1, "summary", ["summaryPurpose": .string("handoff"), "text": .string("where things stand")]),
      try row("s2", 2, "summary", ["summaryPurpose": .string("handoff"), "text": .string("  ")]),
      try row("s3", 3, "summary", ["summaryPurpose": .string("compaction"), "text": .string("the story so far")]),
      try row("s4", 4, "summary", ["summaryPurpose": .string("compaction")]),
      // the boundary's notice is NOT paired away by standing next to the recap: the row carries no native ids
      try notice("n1", 5, "compaction", "the context was full"),
    ]
    let run = try #require(group(FieldHistoryModel.segments(rows, desktop: "studio").first))
    #expect(run.lines.map(\.id) == ["s1", "s3", "s4", "n1"], "a blank summary is not drawn; a blank compaction is")
    try #require(run.lines.count == 4)
    #expect(run.lines[0].kind == .summary && run.lines[0].verb == "Handoff summary")
    #expect(run.lines[0].object.isEmpty && run.lines[0].words == "where things stand")
    #expect(run.lines[1].kind == .compaction && run.lines[1].verb == "Context compacted")
    #expect(run.lines[1].object == "summary" && run.lines[1].words == "the story so far")
    #expect(run.lines[2].kind == .compaction && run.lines[2].words == nil)
    #expect(run.lines[3].kind == .notice && run.lines[3].object == "context compacted · the context was full")
    #expect(run.summary == "4 context events")
  }

  @Test("a team message is a member of its own kind: Team update and its first line")
  func aTeamMessage() throws {
    let rows = [
      try words("c1", 1, "collaboration", "design docs updated"),
      try words("c2", 2, "collaboration", "the review\nthree findings, none blocking"),
      try row("c3", 3, "collaboration"),
    ]
    let run = try #require(group(FieldHistoryModel.segments(rows, desktop: "studio").first))
    #expect(run.lines.allSatisfy { $0.kind == .team && $0.verb == "Team update" })
    #expect(run.lines.map(\.object) == ["design docs updated", "the review", ""])
    #expect(run.lines.map(\.words) == [nil, "the review\nthree findings, none blocking", nil])
    #expect(run.summary == "3 team updates")
  }

  @Test("a question to the reader and a request for permission stand alone and close the group on both sides")
  func requests() throws {
    let rows = [
      try tool("t1", 1, "shell", "pnpm build"),
      try tool("q1", 2, "question", "Which lean?"),
      try tool("t2", 3, "file_read", "a.ts"),
      try notice("p1", 4, "permission_requested"),
      try tool("t3", 5, "file_change", "b.ts"),
    ]
    let segments = FieldHistoryModel.segments(rows, desktop: "studio")
    #expect(segments.map(\.id) == ["t1", "q1", "t2", "p1", "t3"])
    try #require(segments.count == 5)
    #expect(segments[1] == .request(id: "q1", question: true, words: "Which lean?", result: "", failed: false))
    #expect(segments[3] == .request(id: "p1", question: false, words: "", result: "", failed: false))
    #expect(group(segments[0])?.lines.map(\.id) == ["t1"])
    #expect(group(segments[2])?.lines.map(\.id) == ["t2"])
    #expect(group(segments[4])?.lines.map(\.id) == ["t3"])
  }

  @Test("the head is the room's sentence: the tool nouns, then each other kind where it first appeared")
  func theHead() throws {
    let rows = [
      try words("h1", 1, "thinking", "first, look"),
      try tool("t1", 2, "file_change", "a.ts"),
      try notice("n1", 3, "runtime_error", "the socket closed"),
      try tool("t2", 4, "shell", "pnpm build", failed: true),
      try tool("t3", 5, "shell", "pnpm test"),
      try words("c1", 6, "collaboration", "a teammate's note"),
      try words("h2", 7, "thinking", "then, decide"),
      try row("s1", 8, "summary", ["summaryPurpose": .string("compaction"), "text": .string("the story so far")]),
    ]
    let run = try #require(group(FieldHistoryModel.segments(rows, desktop: "studio").first))
    // acts before looks (a command is a look), then thoughts, context events and team updates by first appearance
    #expect(run.summary == "1 edit · a.ts · 2 commands · 2 thoughts · 2 context events · 1 team update")
    #expect(run.failed == 2, "the failed command and the runtime error")
    // every member in the order it happened
    #expect(run.lines.map(\.id) == ["h1", "t1", "n1", "t2", "t3", "c1", "h2", "s1"])
    #expect(run.lines.map { $0.kind == nil } == [false, true, false, true, true, false, false, false])
    // a group of notices alone still has a head, and a single thought is `1 thought`
    let alone = try #require(
      group(
        FieldHistoryModel.segments(
          [try notice("n2", 1, "model_changed"), try notice("n3", 2, "mode_changed")], desktop: "studio"
        ).first))
    #expect(alone.summary == "2 context events")
    let lone = FieldHistoryModel.segments([try words("h3", 1, "thinking", "hm")], desktop: "studio")
    let one = try #require(group(lone.first))
    #expect(one.summary == "1 thought")
    // rows that draw nothing make no group at all
    #expect(FieldHistoryModel.segments([try words("h4", 1, "thinking", " ")], desktop: "studio").isEmpty)
  }

  @Test("a group that grows keeps its id and its members' ids, so what was open stays open")
  func aGroupThatGrows() throws {
    let before = [
      try tool("t1", 1, "shell", "pnpm build"),
      try words("h1", 2, "thinking", "it compiles\nnow the rows"),
    ]
    let after = before + [try tool("t2", 3, "file_read", "a.ts"), try words("h2", 4, "thinking", "one more\nthought")]
    let first = try #require(group(FieldHistoryModel.segments(before, desktop: "studio").first))
    let grown = try #require(group(FieldHistoryModel.segments(after, desktop: "studio").first))
    #expect(first.id == "t1" && grown.id == first.id, "the group's open state is kept under its id")
    #expect(Array(grown.lines.prefix(2)) == first.lines, "the members it had are the members it has")
    #expect(grown.lines.map(\.id) == ["t1", "h1", "t2", "h2"])
    // a member's open state never collides with its group's, whose id is its first row's
    #expect(FieldHistoryModel.memberKey("t1") != "t1")
    #expect(FieldHistoryModel.memberKey("h1") != FieldHistoryModel.memberKey("h2"))
  }

  @Test("Open every run opens every group and no member: a member's words are laid out only when it is opened")
  func openEveryRun() throws {
    let header = try IndexSessionResult(json: try Fixture.json("index-session.valid")).session
    var rows = [try words("u1", 1, "user", "go")]
    // forty thoughts, each with more to say than its line
    for index in 0..<40 {
      rows.append(try words("h\(index)", 2 + index, "thinking", "thought \(index)\nand its reasons"))
    }
    rows.append(try words("a1", 50, "agent", "Done."))
    rows.append(try tool("t1", 51, "shell", "pnpm build"))
    let document = FieldHistoryModel.document(
      header: header, rows: rows, desktop: "studio", agentLabel: "Claude", nextCursor: nil, watermark: nil,
      liveSince: nil, now: Date(timeIntervalSince1970: 1_759_285_600))
    let opened = FieldHistoryModel.everyRun(document)
    #expect(opened == ["h0", "t1"], "the two groups, by their ids")
    let thoughts = try #require(group(document.turns.first?.segments.first))
    #expect(thoughts.lines.count == 40 && thoughts.lines.allSatisfy { $0.words != nil })
    #expect(thoughts.lines.allSatisfy { !opened.contains(FieldHistoryModel.memberKey($0.id)) })
  }

  @Test("a document cached before 362e still decodes: its lines are tool lines, and a new one round-trips")
  func cachedBefore() throws {
    // a run as the cache held it before this item: no `kind`, no `words`, no `clipped`
    let old = HistorySegment.ledger(
      id: "t1", summary: "1 command", duration: "3s", failed: 0, isLive: false,
      lines: [HistoryLedgerLine(id: "t1", verb: "Ran", object: "pnpm build", result: "exit 0")])
    var json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(old)) as? [String: Any])
    var ledger = try #require(json["ledger"] as? [String: Any])
    var lines = try #require(ledger["lines"] as? [[String: Any]])
    #expect(lines[0]["kind"] == nil && lines[0]["words"] == nil && lines[0]["clipped"] == nil)
    lines[0] = lines[0].filter { !["kind", "words", "clipped"].contains($0.key) }
    ledger["lines"] = lines
    json["ledger"] = ledger
    let read = try JSONDecoder().decode(HistorySegment.self, from: JSONSerialization.data(withJSONObject: json))
    #expect(read == old)
    // a member and a request round-trip through the cache's coding
    let now: [HistorySegment] = [
      .ledger(
        id: "h1", summary: "1 thought", duration: "0s", failed: 0, isLive: false,
        lines: [
          HistoryLedgerLine(
            id: "h1", verb: "Thought", object: "the lean", result: "", kind: .thought, words: "the lean\nand why",
            clipped: "clipped · 14 KB on studio")
        ]),
      .request(id: "q1", question: true, words: "Which lean?", result: "", failed: false),
    ]
    #expect(try JSONDecoder().decode([HistorySegment].self, from: JSONEncoder().encode(now)) == now)
  }
}

/// Item 368 (found porting 362f, 2026-11-12; VF-PM numbered it 23:02:13Z) — a text past rosetta's 32 KiB is a file
/// on the desktop: its row carries the text's opening and the file's size (`textByteLen`). The door sets its cut
/// flag (`textClipped`) only when that opening is itself over the door's bound, so an opening within it arrives
/// with the size and without the flag, and the phone, which marked a cut by the flag alone, drew it as a whole
/// message. Rows are built in code; no fixture is added.
@Suite("item 368 — words that are less than the whole are marked, flag or no flag")
struct HistoryCutMarkTests {
  private func row(
    _ id: String, _ ordinal: Int, _ kind: String, _ more: [String: JSONValue]
  ) throws -> IndexTimelineRow {
    var fields: [String: JSONValue] = [
      "timelineId": .string(id), "sessionId": .string("s1"), "ordinal": .int(Int64(ordinal)), "kind": .string(kind),
      "group": .object(["id": .string("g"), "kind": .string(kind == "user" ? "human_turn" : "agent_cycle")]),
    ]
    for (key, value) in more { fields[key] = value }
    return try IndexTimelineRow(json: .object(fields))
  }

  /// A file's opening: its words and the file's size, and no cut flag.
  private func opening(_ text: String) -> [String: JSONValue] {
    ["text": .string(text), "textByteLen": .int(90_000)]
  }

  private func cutMarks(_ segments: [HistorySegment]) -> [String] {
    segments.compactMap { segment in
      if case .clipped(_, let words) = segment { return words }
      return nil
    }
  }

  @Test("a reply that is a file's opening is marked with the file's size")
  func aReply() throws {
    let reply = try row("a1", 1, "agent", opening("The opening of a long reply."))
    let segments = FieldHistoryModel.segments([reply], desktop: "studio")
    #expect(segments.map(\.id) == ["a1", "a1/clipped"])
    #expect(cutMarks(segments) == ["clipped · 88 KB on studio"])
  }

  @Test("a prompt that is a file's opening is marked")
  func aPrompt() throws {
    let header = try IndexSessionResult(json: try Fixture.json("index-session.valid")).session
    let prompt = try row("u1", 1, "user", opening("The opening of a long prompt."))
    let document = FieldHistoryModel.document(
      header: header, rows: [prompt], desktop: "studio", agentLabel: "Claude", nextCursor: nil, watermark: nil,
      liveSince: nil, now: Date(timeIntervalSince1970: 1_790_000_000))
    #expect(document.turns.first?.promptClipped == "clipped · 88 KB on studio")
  }

  @Test("a thought that is a file's opening opens, even of one line, with the mark under its words")
  func aMember() throws {
    let rows = [
      try row("h1", 1, "thinking", opening("one line of a long thought")),
      try row("a1", 2, "agent", ["text": .string("Done.")]),
    ]
    let segments = FieldHistoryModel.segments(rows, desktop: "studio")
    guard case .ledger(_, _, _, _, _, let lines)? = segments.first else {
      Issue.record("the thought is in no group")
      return
    }
    #expect(lines.first?.words == "one line of a long thought")
    #expect(lines.first?.clipped == "clipped · 88 KB on studio")
  }

  @Test("words with neither the flag nor a size are whole: no mark")
  func wholeWords() throws {
    let reply = try row("a1", 1, "agent", ["text": .string("A whole reply.")])
    #expect(FieldHistoryModel.segments([reply], desktop: "studio").map(\.id) == ["a1"])
  }

  @Test("the flag and the size together mark once, with the size")
  func bothTogether() throws {
    var more = opening("The opening.")
    more["textClipped"] = .bool(true)
    let segments = FieldHistoryModel.segments([try row("a1", 1, "agent", more)], desktop: "studio")
    #expect(cutMarks(segments) == ["clipped · 88 KB on studio"])
  }
}

/// Item 370 (found reading the room for 362f's f3, 2026-11-12; VF-PM numbered it 23:19:02Z and settled its two
/// parts at 23:21:26Z) — two places where the phone's own fold said something other than the room, from a row that
/// already carries what the room reads. Rows are built in code; no fixture is added.
///
/// The row's `failure` is the failure's summary, or its KIND where it had none (`summary ?? kind`, fieldd's
/// index-timeline.ts), and rosetta's commonest failure has none (kind `unknown`). So a bare word is read as a kind.
@Suite("item 370 — a group's head and a failed line say what the room says")
struct HistoryRoomWordsTests {
  private func tool(_ family: String, _ more: [String: JSONValue]) throws -> (IndexTimelineRow, IndexTimelineTool) {
    var fields: [String: JSONValue] = [
      "name": .string(family), "family": .string(family), "status": .string("failed"), "failed": .bool(true),
      "object": .string("the object"),
    ]
    for (key, value) in more { fields[key] = value }
    let row = try IndexTimelineRow(
      json: .object([
        "timelineId": .string("t1"), "sessionId": .string("s1"), "ordinal": .int(1), "kind": .string("tool_use"),
        "group": .object(["id": .string("g"), "kind": .string("agent_cycle")]), "tool": .object(fields),
      ]))
    return (row, try #require(row.tool))
  }

  private func result(_ family: String, _ more: [String: JSONValue]) throws -> String {
    let (row, facts) = try tool(family, more)
    return FieldHistoryModel.ledgerLine(row, tool: facts).result
  }

  // MARK: The head

  @Test("past four edited files the head says … N more")
  func theOverflow() {
    let six = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"].map { (family: "file_change", object: $0) }
    #expect(FieldHistoryModel.runSummary(lines: six, thoughts: 0) == "6 edits · a.ts, b.ts, c.ts, d.ts … 2 more")
  }

  @Test("four edited files are all named, with nothing after them")
  func fourAreNamed() {
    let four = ["a.ts", "b.ts", "c.ts", "d.ts"].map { (family: "file_change", object: $0) }
    #expect(FieldHistoryModel.runSummary(lines: four, thoughts: 0) == "4 edits · a.ts, b.ts, c.ts, d.ts")
  }

  // MARK: A failed line

  @Test("a command that failed says its exit and then its failure")
  func aFailedCommand() throws {
    let said = try result("shell", ["result": .string("exit 2"), "failure": .string("command not found: pnpm")])
    #expect(said == "exit 2 · command not found: pnpm")
  }

  @Test("a failed line says its failure, not the family's result")
  func theFailureBeatsTheResult() throws {
    let said = try result("file_search", ["result": .string("3 matches"), "failure": .string("permission denied")])
    #expect(said == "permission denied")
  }

  @Test("the failure is its first line, cut at 60")
  func oneLineOfIt() throws {
    let long = String(repeating: "a", count: 80) + "\nand a second line"
    let said = try result("file_read", ["failure": .string(long)])
    #expect(said == String(repeating: "a", count: 59) + "…")
  }

  @Test("an exit of zero on a line that failed is not said before the failure")
  func aZeroExitIsNotSaid() throws {
    let said = try result("shell", ["result": .string("exit 0"), "failure": .string("killed by the caller")])
    #expect(said == "killed by the caller")
  }

  @Test("with no failure words a failed line says its exit, else its result, else failed")
  func noWords() throws {
    #expect(try result("shell", ["result": .string("exit 1")]) == "exit 1")
    #expect(try result("file_search", ["result": .string("3 matches")]) == "3 matches")
    #expect(try result("file_read", [:]) == "failed")
    #expect(try result("file_read", ["failure": .string("  ")]) == "failed")
  }

  @Test("the row's failure is a kind where it had no sentence, and `unknown` says nothing")
  func anUnknownKindSaysNothing() throws {
    #expect(try result("shell", ["result": .string("exit 1"), "failure": .string("unknown")]) == "exit 1")
    #expect(try result("file_read", ["failure": .string("unknown")]) == "failed")
    #expect(try result("shell", ["result": .string("exit 2"), "failure": .string("exit_non_zero")]) == "exit 2")
  }

  @Test("a kind says itself as words, and a timeout says timed out")
  func aKindAsWords() throws {
    #expect(try result("file_read", ["failure": .string("not_found")]) == "not found")
    #expect(try result("web_fetch", ["result": .string("404"), "failure": .string("timeout")]) == "timed out")
    #expect(try result("shell", ["result": .string("exit 124"), "failure": .string("timeout")]) == "timed out")
    #expect(try result("shell", ["status": .string("timed_out"), "failure": .string("it ran too long")]) == "timed out")
  }

  /// rosetta's eight, as its generated `FailureKind` lists them at the pin (811e554c6,
  /// clients/ts/generated/FailureKind.ts). The fold keeps no copy of this list: it reads a kind by its shape.
  @Test("every kind rosetta has today says nothing or says words, and one it adds later says words too")
  func noKindIsPrintedAsItIsSpelt() throws {
    let kinds = [
      "permission", "not_found", "invalid_input", "exit_non_zero", "timeout", "cancelled", "provider", "unknown",
    ]
    let said = kinds.map { FieldHistoryModel.failureWords($0) }
    #expect(said == ["permission", "not found", "invalid input", nil, "timed out", "cancelled", "provider", nil])
    #expect(FieldHistoryModel.failureWords("rate_limited") == "rate limited")
    #expect(FieldHistoryModel.failureWords("ENOENT: no such file") == "ENOENT: no such file", "a sentence stays")
  }

  @Test("a one-word summary in lowercase reads through the same rule and says itself")
  func aOneWordSummarySaysItself() throws {
    #expect(FieldHistoryModel.failureWords("denied") == "denied")
    #expect(FieldHistoryModel.failureWords("killed") == "killed")
    #expect(try result("shell", ["result": .string("exit 137"), "failure": .string("killed")]) == "exit 137 · killed")
  }

  @Test("a failed line with no words says its status, never the bare word failed for a denial")
  func theStatusSpeaks() throws {
    #expect(try result("file_read", ["status": .string("denied")]) == "denied")
    #expect(try result("file_change", ["status": .string("interrupted")]) == "interrupted")
    #expect(try result("shell", ["result": .string("exit 0")]) == "failed", "a failed line never says exit 0")
  }

  @Test("a line that did not fail says its result as it did")
  func aLineThatDidNotFail() throws {
    let said = try result(
      "shell", ["status": .string("succeeded"), "failed": .bool(false), "result": .string("exit 0")])
    #expect(said == "exit 0", "the door's `exit 0` on a line that did not fail is item 369's, and stays")
  }
}

/// Item 362g (James's board pick, 2026-11-12 20:43Z: "images through a rosetta release"; VF-PM's rulings,
/// 2026-11-13 00:24Z) — pictures in the phone's History, the document's part. A reply's attachment was a segment
/// with an id; a prompt's was its words alone; a tool's was drawn nowhere. For the view to find the picture a
/// direct read holds, each has to be named in the document, by an id and nothing more: the document is written to
/// the phone's cache, and nothing that says where a picture is kept may go into it. The room gathers a group's
/// images into one strip outside the fold (rosetta at the pin, clients/room/src/lib/transcript/images.ts,
/// `timelineImages`), and so does the fold. Rows are built in code; no fixture is added.
@Suite("item 362g — a recorded picture has its place in the document, and the document holds only its id")
struct HistoryPictureFoldTests {
  private func row(
    _ id: String, _ ordinal: Int, _ kind: String, _ more: [String: JSONValue] = [:]
  ) throws -> IndexTimelineRow {
    var fields: [String: JSONValue] = [
      "timelineId": .string(id), "sessionId": .string("s1"), "ordinal": .int(Int64(ordinal)), "kind": .string(kind),
      "group": .object(["id": .string("g"), "kind": .string(kind == "user" ? "human_turn" : "agent_cycle")]),
    ]
    for (key, value) in more { fields[key] = value }
    return try IndexTimelineRow(json: .object(fields))
  }

  /// An attachment as a row names it: its id and kind, its name when it has one, and whether its bytes were kept.
  private func attached(
    _ id: String, _ kind: String = "image", name: String? = nil, reason: String? = nil
  ) -> JSONValue {
    var fields: [String: JSONValue] = ["id": .string(id), "kind": .string(kind), "available": .bool(reason == nil)]
    if let name { fields["name"] = .string(name) }
    if let reason { fields["reason"] = .string(reason) }
    return .object(fields)
  }

  private func tool(
    _ id: String, _ ordinal: Int, _ family: String, _ object: String, attachments: [JSONValue] = []
  ) throws -> IndexTimelineRow {
    try row(
      id, ordinal, "tool_use",
      [
        "tool": .object([
          "name": .string(family), "family": .string(family), "status": .string("succeeded"), "failed": .bool(false),
          "object": .string(object), "attachments": .array(attachments),
        ])
      ])
  }

  private func document(_ rows: [IndexTimelineRow]) throws -> HistoryDocument {
    let header = try IndexSessionResult(json: try Fixture.json("index-session.valid")).session
    return FieldHistoryModel.document(
      header: header, rows: rows, desktop: "studio", agentLabel: "Claude", nextCursor: nil, watermark: nil,
      liveSince: nil, now: Date(timeIntervalSince1970: 1_790_000_000))
  }

  // MARK: The fold

  @Test("a tool's recorded image is a segment right after its group, under the id a reply's image has")
  func aToolsImage() throws {
    let rows = [
      try tool("t1", 1, "shell", "pnpm shot", attachments: [attached("shot-1", name: "shot.png")]),
      try tool("t2", 2, "file_read", "a.ts"),
      try tool("t3", 3, "shell", "pnpm shots", attachments: [attached("a"), attached("b")]),
      try row("a1", 4, "agent", ["text": .string("Done.")]),
    ]
    let segments = FieldHistoryModel.segments(rows, desktop: "studio")
    #expect(segments.map(\.id) == ["t1", "t1/shot-1", "t3/a", "t3/b", "a1"])
    try #require(segments.count == 5)
    #expect(segments[1] == .attachment(id: "t1/shot-1", kind: "image", label: "image shot.png on studio"))
    #expect(segments[2] == .attachment(id: "t3/a", kind: "image", label: "image on studio"))
    // the group is the group it was: its id, its head, its lines
    guard case .ledger(let id, let summary, _, _, _, let lines) = segments[0] else {
      Issue.record("the first segment is the group")
      return
    }
    #expect(id == "t1" && summary == "2 commands · 1 read")
    #expect(lines.map(\.id) == ["t1", "t2", "t3"])
  }

  @Test("only an image is gathered: a tool's other attachments have no segment, and an image with no bytes says why")
  func onlyImages() throws {
    let report = attached("d1", "document", name: "report.pdf")
    let rows = [try tool("t1", 1, "shell", "pnpm report", attachments: [report, attached("i2", reason: "omitted")])]
    let segments = FieldHistoryModel.segments(rows, desktop: "studio")
    #expect(segments.map(\.id) == ["t1", "t1/i2"])
    #expect(
      segments.last == .attachment(id: "t1/i2", kind: "image", label: "image · omitted from the record on studio"))
  }

  @Test("a team message's image stands in its group's strip: the room gathers a run's images whatever the row")
  func aTeamMessagesImage() throws {
    let message = try row(
      "c1", 2, "collaboration",
      ["text": .string("the mock"), "attachments": .array([attached("i1", name: "mock.png")])])
    let segments = FieldHistoryModel.segments([try tool("t1", 1, "shell", "ls"), message], desktop: "studio")
    #expect(segments.map(\.id) == ["t1", "c1/i1"])
    #expect(segments.last == .attachment(id: "c1/i1", kind: "image", label: "image mock.png on studio"))
  }

  @Test("a group with no image is the group alone, and a reply's attachments stand under the reply as they did")
  func nothingElseMoves() throws {
    let reply = try row(
      "a1", 2, "agent", ["text": .string("Here."), "attachments": .array([attached("i1", name: "shot.png")])])
    let segments = FieldHistoryModel.segments([try tool("t1", 1, "shell", "ls"), reply], desktop: "studio")
    #expect(segments.map(\.id) == ["t1", "a1", "a1/i1"])
    #expect(segments.last == .attachment(id: "a1/i1", kind: "image", label: "image shot.png on studio"))
  }

  @Test("a prompt's attachments carry their ids beside their words, in the same order")
  func aPromptsIds() throws {
    let notes = attached("d1", "document", name: "notes.pdf", reason: "omitted")
    let prompt = try row(
      "u1", 1, "user",
      ["text": .string("What is wrong in this one?"), "attachments": .array([attached("i1", name: "shot.png"), notes])])
    let turn = try #require(try document([prompt]).turns.first)
    // the words are the words they were
    #expect(
      turn.promptAttachments == [
        "image shot.png on studio", "document notes.pdf · omitted from the record on studio",
      ])
    #expect(turn.promptAttachmentIds == ["u1/i1", "u1/d1"])
  }

  @Test("a prompt with nothing attached carries no ids, and its turn is encoded as it was")
  func noIdsWhereNothingIsAttached() throws {
    let turn = try #require(try document([try row("u1", 1, "user", ["text": .string("go")])]).turns.first)
    #expect(turn.promptAttachments.isEmpty && turn.promptAttachmentIds == nil)
    let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(turn)) as? [String: Any])
    #expect(json["promptAttachmentIds"] == nil)
  }

  @Test("a document kept before 362g still decodes: its prompt's placeholders stand with no ids; a new one round-trips")
  func keptBefore() throws {
    let turn = HistoryTurn(
      id: "u1", at: "10:02:14", prompt: "What is wrong in this one?", promptAnchor: "u1", model: "", facts: "",
      segments: [.attachment(id: "t1/shot-1", kind: "image", label: "image on studio")],
      promptAttachments: ["image shot.png on studio"], promptAttachmentIds: ["u1/i1"])
    var json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(turn)) as? [String: Any])
    #expect(json["promptAttachmentIds"] as? [String] == ["u1/i1"])
    // as a build before this item kept it: the words, and no ids
    json["promptAttachmentIds"] = nil
    let read = try JSONDecoder().decode(HistoryTurn.self, from: JSONSerialization.data(withJSONObject: json))
    #expect(read.promptAttachmentIds == nil)
    #expect(read.promptAttachments == turn.promptAttachments && read.segments == turn.segments)
    #expect(try JSONDecoder().decode(HistoryTurn.self, from: JSONEncoder().encode(turn)) == turn)
  }

  @Test("the kept document names a picture by its id alone: no digest and no address, whatever its row was read from")
  func idsOnly() throws {
    let digest = String(repeating: "ab", count: 32)
    // an attachment as a whole entry names it, its stored image beside it: the row's reader keeps none of that
    func stored(_ id: String) -> JSONValue {
      .object([
        "id": .string(id), "kind": .string("image"), "name": .string("shot.png"), "available": .bool(true),
        "source": .object([
          "type": .string("asset"),
          "asset": .object(["url": .string("/api/assets/\(digest).png"), "digest": .string(digest)]),
        ]),
      ])
    }
    let rows = [
      try row("u1", 1, "user", ["text": .string("look"), "attachments": .array([stored("i1")])]),
      try tool("t1", 2, "shell", "pnpm shot", attachments: [stored("shot-1")]),
      try row("a1", 3, "agent", ["text": .string("Done."), "attachments": .array([stored("i2")])]),
    ]
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    let kept = String(decoding: try encoder.encode(try document(rows)), as: UTF8.self)
    for id in ["u1/i1", "t1/shot-1", "a1/i2"] {
      #expect(kept.contains("\"\(id)\""), "\(id) is named")
    }
    #expect(!kept.contains(digest) && !kept.contains("/api/assets"))
  }

  // MARK: What the view decides

  @Test("a run of attachments is one strip, in order; every other segment stands as it was")
  func strips() throws {
    let group = HistorySegment.ledger(
      id: "t1", summary: "1 command", duration: "3s", failed: 0, isLive: false, lines: [])
    let reply = HistorySegment.prose(id: "a1", at: "10:02:14", text: "Done.", anchor: "a1")
    let pieces = HistoryPictureLayout.pieces(
      [
        group, .attachment(id: "t1/a", kind: "image", label: "image on studio"),
        .attachment(id: "t1/b", kind: "image", label: "image on studio"), reply,
        .attachment(id: "a1/i1", kind: "image", label: "image shot.png on studio"),
      ], desktop: "studio")
    #expect(pieces.map(\.id) == ["t1", "t1/a", "a1", "a1/i1"])
    try #require(pieces.count == 4)
    #expect(pieces[0] == .segment(group) && pieces[2] == .segment(reply))
    guard case .strip(let first) = pieces[1], case .strip(let second) = pieces[3] else {
      Issue.record("the second and the fourth piece are strips")
      return
    }
    #expect(first.map(\.id) == ["t1/a", "t1/b"] && second.map(\.id) == ["a1/i1"])
    #expect(HistoryPictureLayout.pieces([], desktop: "studio").isEmpty)
  }

  @Test("only an image is asked for as a picture; an attachment the document has no words for says where it is")
  func whatIsAskedFor() {
    let pieces = HistoryPictureLayout.pieces(
      [
        .attachment(id: "a1/d1", kind: "document", label: nil),
        .attachment(id: "a1/i1", kind: "image", label: "image shot.png on studio"),
      ], desktop: "studio")
    let strip = HistoryPiece.strip([
      HistoryAttached(id: "a1/d1", picture: nil, words: "attachment on studio"),
      HistoryAttached(id: "a1/i1", picture: "a1/i1", words: "image shot.png on studio"),
    ])
    #expect(pieces == [strip])
  }

  @Test("a prompt's attachments are a strip: its words with their ids; a document kept before the ids asks for nothing")
  func aPromptsStrip() {
    let words = ["image shot.png on studio", "document notes.pdf on studio"]
    func turn(_ ids: [String]?) -> HistoryTurn {
      HistoryTurn(
        id: "u1", at: "10:02:14", prompt: "look", model: "", facts: "", segments: [], promptAttachments: words,
        promptAttachmentIds: ids)
    }
    // the document names no kind for a prompt's attachment: each is asked for by its id, and what is no picture
    // finds none
    #expect(
      HistoryPictureLayout.attached(to: turn(["u1/i1", "u1/d1"])) == [
        HistoryAttached(id: "u1/i1", picture: "u1/i1", words: words[0]),
        HistoryAttached(id: "u1/d1", picture: "u1/d1", words: words[1]),
      ])
    let kept = HistoryPictureLayout.attached(to: turn(nil))
    #expect(kept.map(\.words) == words && kept.allSatisfy { $0.picture == nil })
    #expect(Set(kept.map(\.id)).count == 2, "each still has an id of its own")
    // ids fewer than the words (no fold makes this): the rest are placeholders, and nothing is read past the end
    #expect(HistoryPictureLayout.attached(to: turn(["u1/i1"])).map(\.picture) == ["u1/i1", nil])
  }

  @Test("a picture is found under its id and the size asked, the reader's key")
  func theKey() {
    #expect(HistoryPictureLayout.key("t1/shot-1", .tile) == "t1/shot-1/tile")
    #expect(HistoryPictureLayout.key("t1/shot-1", .preview) == "t1/shot-1/preview")
  }

  @Test("a held picture is its tile; one on its way is the tile's square, waiting; every other face is the line")
  func theFaces() {
    let bytes = Data([1, 2, 3])
    #expect(HistoryPictureLayout.draws(.held(bytes), read: true) == .tile)
    // asked and not yet answered, or answered and not yet read
    #expect(HistoryPictureLayout.draws(.waiting, read: nil) == .waiting)
    #expect(HistoryPictureLayout.draws(.held(bytes), read: nil) == .waiting)
    // a read that failed, bytes that are no picture, and nothing held: the placeholder's line, as it always was
    #expect(HistoryPictureLayout.draws(.failed, read: nil) == .placeholder)
    #expect(HistoryPictureLayout.draws(.held(bytes), read: false) == .placeholder)
    #expect(HistoryPictureLayout.draws(nil, read: nil) == .placeholder)
    // a picture read from bytes the reader no longer holds is not drawn
    #expect(HistoryPictureLayout.draws(nil, read: true) == .placeholder)
    #expect(HistoryPictureLayout.draws(.waiting, read: true) == .waiting)
  }

  @Test("a picture on its way holds its tile's square, so a row keeps its height when the picture lands")
  func theSquare() {
    let side = HistoryPictureLayout.tile
    #expect(HistoryPictureLayout.side(.tile) == side && HistoryPictureLayout.side(.waiting) == side)
    // the placeholder is a line as wide as its strip, and no square
    #expect(HistoryPictureLayout.side(.placeholder) == nil)
    // a strip on a 375 pt phone, as its cells draw
    func strip(_ draws: [HistoryPictureDraws]) -> CGSize {
      let sizes = draws.map { one in
        HistoryPictureLayout.side(one).map { CGSize(width: $0, height: $0) } ?? CGSize(width: 335, height: 34)
      }
      return HistoryPictureLayout.flow(sizes, width: 335, gap: HistoryPictureLayout.gap).size
    }
    // three on their way, one landed, all landed: the strip is the size it was
    #expect(strip([.waiting, .waiting, .waiting]) == CGSize(width: 328, height: 104))
    #expect(strip([.waiting, .tile, .waiting]) == strip([.waiting, .waiting, .waiting]))
    #expect(strip([.tile, .tile, .tile]) == strip([.waiting, .waiting, .waiting]))
  }

  @Test("the strip wraps: three tiles across a 375 pt phone and any wider, never four; a placeholder on its own row")
  func theStripWraps() {
    let gap = HistoryPictureLayout.gap
    let tile = CGSize(width: HistoryPictureLayout.tile, height: HistoryPictureLayout.tile)
    #expect(HistoryPictureLayout.tile == 104 && gap == 8, "three across every phone; the room's tile is 112 px")
    let three = [CGPoint(x: 0, y: 0), CGPoint(x: 112, y: 0), CGPoint(x: 224, y: 0)]
    // 375 pt across, the document's 20 pt margin on each side: three, and a fourth starts a row
    let narrow = HistoryPictureLayout.flow([tile, tile, tile, tile], width: 335, gap: gap)
    #expect(narrow.origins == three + [CGPoint(x: 0, y: 112)])
    #expect(narrow.size == CGSize(width: 328, height: 216))
    // 393 pt across, and the widest phone, 440 pt: still three, the fourth 40 pt short at the widest
    for width in [353, 400] as [CGFloat] {
      let wide = HistoryPictureLayout.flow([tile, tile, tile, tile], width: width, gap: gap)
      #expect(wide.origins == three + [CGPoint(x: 0, y: 112)], "\(width)")
    }
    // a placeholder is as wide as the strip: it shares no row, and a tile after it starts the next
    let line = CGSize(width: 353, height: 34)
    let mixed = HistoryPictureLayout.flow([tile, line, tile], width: 353, gap: gap)
    #expect(mixed.origins == [CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 112), CGPoint(x: 0, y: 154)])
    #expect(mixed.size == CGSize(width: 353, height: 258))
    // two placeholders stand as the document always stood them, 8 apart
    let lines = HistoryPictureLayout.flow([line, line], width: 353, gap: gap)
    #expect(lines.origins == [CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 42)] && lines.size.height == 76)
    #expect(HistoryPictureLayout.flow([], width: 353, gap: gap).size == .zero)
  }

  @Test("a picture is read to the pixels it is drawn in, and never larger than it is")
  func thePixels() {
    #expect(HistoryPictureLayout.pixels(104, scale: 3) == 312)
    #expect(HistoryPictureLayout.pixels(104, scale: 2) == 208)
    #expect(HistoryPictureLayout.pixels(353, scale: 3) == 1059)
    #expect(HistoryPictureLayout.pixels(0.2, scale: 1) == 1 && HistoryPictureLayout.pixels(104, scale: 0) == 104)
    #expect(HistoryPictureLayout.pixels(0, scale: 3) == 1 && HistoryPictureLayout.pixels(.infinity, scale: 3) == 1)
    // a tile of 640 px drawn 312 across: 312 a side
    #expect(HistoryPictureLayout.longSide(width: 640, height: 640, across: 312) == 312)
    // a wide picture's long side is its width
    #expect(HistoryPictureLayout.longSide(width: 1600, height: 900, across: 1059) == 1059)
    // a tall one drawn at half its width is read at half its height
    #expect(HistoryPictureLayout.longSide(width: 400, height: 1600, across: 200) == 800)
    // drawn wider than it is: itself, never enlarged
    #expect(HistoryPictureLayout.longSide(width: 400, height: 1600, across: 1059) == 1600)
    #expect(HistoryPictureLayout.longSide(width: 200, height: 100, across: 312) == 200)
    // a picture whose size is not known is read at the width it is drawn
    #expect(HistoryPictureLayout.longSide(width: 0, height: 0, across: 312) == 312)
    // on its sheet a picture is read to what its furthest zoom can show, which is all the desktop sent of it
    let zoomed = HistoryPictureLayout.pixels(353 * HistoryPictureLayout.zoomMost, scale: 3)
    #expect(zoomed == 4236 && HistoryPictureLayout.longSide(width: 1600, height: 900, across: zoomed) == 1600)
  }

  @Test("on its sheet a picture is fitted to the page's width; a double tap goes to twice and back, a pinch to four")
  func theZoom() {
    // a desktop's screenshot of 1,600 by 900 on a 393 pt phone's page, 353 across: its own shape
    #expect(HistoryPictureLayout.fitted(width: 1600, height: 900, across: 353) == CGSize(width: 353, height: 198.5625))
    // a small picture is drawn up to the width, as the tile's stand-in is
    #expect(HistoryPictureLayout.fitted(width: 8, height: 4, across: 353) == CGSize(width: 353, height: 176.5))
    // a picture with no size takes no room
    #expect(HistoryPictureLayout.fitted(width: 0, height: 4, across: 353) == .zero)
    #expect(HistoryPictureLayout.zoomMost == 4 && HistoryPictureLayout.zoomTap == 2)
    // fitted: to twice. Zoomed, by a tap or by a pinch: back to fitted
    #expect(HistoryPictureLayout.tapped(from: 1) == 2)
    #expect(HistoryPictureLayout.tapped(from: 2) == 1 && HistoryPictureLayout.tapped(from: 3.2) == 1)
    // the part a double tap zooms to: half the page each way, about the point tapped
    let part = HistoryPictureLayout.zoomRect(
      around: CGPoint(x: 100, y: 60), page: CGSize(width: 393, height: 700), zoom: 2)
    #expect(part == CGRect(x: 1.75, y: -115, width: 196.5, height: 350))
  }

  @Test("bytes that are no picture read as none; a picture reads at the size it is drawn, and no larger than it is")
  func theDecode() throws {
    #expect(HistoryPictureDecode.read(Data("not a picture".utf8), across: 312) == nil)
    #expect(HistoryPictureDecode.read(Data(), across: 312) == nil)
    // a picture of 8 by 4 pixels (a PNG made for this row: one colour, 74 bytes), drawn 4 across: 4 by 2
    let png64 = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAEUlEQVR42mM4YWODFTFQTwIA4k0oAUZvm1sAAAAASUVORK5CYII="
    let png = try #require(Data(base64Encoded: png64))
    let small = try #require(HistoryPictureDecode.read(png, across: 4))
    #expect(small.cgImage?.width == 4 && small.cgImage?.height == 2)
    // drawn wider than it is: itself
    let whole = try #require(HistoryPictureDecode.read(png, across: 312))
    #expect(whole.cgImage?.width == 8 && whole.cgImage?.height == 4)
  }
}
