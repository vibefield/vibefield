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
        "at": .int(3_800_000 + 79 * 60_000), "group": .object(["id": .string("turn-2"), "kind": .string("human_turn")]),
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
    #expect(FieldHistoryModel.runSummary(lines: lines, thoughts: 1) == "2 edits · vibefield.ts, glyphs.svg · 2 commands · 2 reads · 1 search")
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
    #expect(FieldHistoryModel.scopeLine(corpus, standing: .incompatible(theirs: "0.2.0", ours: "0.1.0")) == "studio speaks contracts 0.2.0 · this phone 0.1.0")
    #expect(FieldHistoryModel.liveHeader(corpus, standing: .incompatible(theirs: "0.2.0", ours: "0.1.0")).count == nil)
  }
}
