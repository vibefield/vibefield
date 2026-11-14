import FieldProduct
import Foundation
import Testing

@testable import FieldHistory

/// Item 352 (James, 2026-11-12 11:38:00Z: "the history items on the phone does not match the items on the desktop,
/// desktop have more items") — a desktop answers a phone a page of at most `HistoryReads.listRows` rows with a cursor
/// to the next. The ledger's reader asked the first page and never the next (his phone, 16:50Z: rows=100,
/// cursor=true, 99 drawn), so the phone's ledger stopped at a hundred projects, and an opened project at a hundred
/// sessions. The reader follows the cursor to the listing's end.
///
/// Whether his phone's ledger then holds what his desktop's does is his to see.

private let studio = "01J9ZK3M5Q8XR2V7N4B6C1D0EF"

/// A door that pages: each listing is its pages, and a cursor is the next page's number.
@MainActor
private final class PagedDoor: HistoryDoor {
  var asked: [(String, JSONValue?)] = []
  var ping: (@MainActor (JSONValue) -> Void)?
  /// The ledger's pages, each a list of project keys, the newest first.
  var projects: [[String]] = []
  /// A project's sessions' pages, each a list of session ids.
  var sessions: [[String]] = []
  /// Every answer carries this cursor, whatever was asked (a door that goes round).
  var roundCursor: String?

  func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
    asked.append((method, params))
    let at = params?["cursor"]?.stringValue.flatMap { Int($0) } ?? 0
    switch method {
    case "project.list":
      let keys = at < projects.count ? projects[at] : []
      var page: [String: JSONValue] = [
        "rows": .array(
          keys.map { key in
            .object(["key": .string(key), "name": .string(key), "sessions": .int(1), "lastAt": .int(1_759_000_000_000)])
          }),
        "sources": .array([]), "groupingVersion": .int(2),
      ]
      if let roundCursor {
        page["cursor"] = .string(roundCursor)
      } else if at + 1 < projects.count {
        page["cursor"] = .string(String(at + 1))
      }
      return .object(page)
    case "project.get":
      var answer = try #require(try Fixture.json("project-get.valid").objectValue)
      var project = try #require(answer["project"]?.objectValue)
      project["key"] = params?["key"] ?? project["key"]
      answer["project"] = .object(project)
      return .object(answer)
    case "project.sessions":
      let golden = try #require(try Fixture.json("project-sessions.valid").objectValue)
      let template = try #require(golden["rows"]?.arrayValue?.first?.objectValue)
      let ids = at < sessions.count ? sessions[at] : []
      var page: [String: JSONValue] = [
        "key": params?["key"] ?? .string("p"),
        "rows": .array(
          ids.map { id in
            var row = template
            row["sessionId"] = .string(id)
            row["nativeSessionId"] = .string("native-\(id)")
            return .object(row)
          }),
        "sources": .array([]),
      ]
      if at + 1 < sessions.count { page["cursor"] = .string(String(at + 1)) }
      return .object(page)
    default:
      // no index, no figures: the listing is believed and the rows stand without their figures
      throw FieldProductError(kind: "NOT_FOUND", message: method)
    }
  }

  func tail(
    _ method: String, params: JSONValue?, shape: SubscriptionShape,
    onSnapshot: @escaping @MainActor (JSONValue) -> Void,
    onDelta: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> HistoryTailHandle {
    ping = onDelta
    return HistoryTailHandle { [weak self] in self?.ping = nil }
  }

  func close() {}

  func lists() -> [JSONValue?] { asked.filter { $0.0 == "project.list" }.map(\.1) }
  func count(_ method: String) -> Int { asked.filter { $0.0 == method }.count }
}

@MainActor
private func settle(_ what: String, timeout: Duration = .seconds(5), _ condition: @MainActor () -> Bool) async {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if condition() { return }
    try? await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("timed out waiting for \(what)")
}

private func keys(_ prefix: String, _ count: Int) -> [String] {
  (0..<count).map { "\(prefix)-\($0)" }
}

@Suite("item 352 — the phone's ledger follows the door's cursor to the listing's end")
struct HistoryPagingTests {
  @Test("a ledger of 230 projects over three pages is 230 projects on the phone, asked page by page")
  @MainActor
  func theWholeLedger() async throws {
    let door = PagedDoor()
    door.projects = [keys("a", 100), keys("b", 100), keys("c", 30)]
    let projects = HistoryProjects(source: studio, door: door)
    projects.start()
    await settle("the ledger") { projects.corpus.projects.count == 230 }
    #expect(projects.corpus.projects.first?.id == "a-0" && projects.corpus.projects.last?.id == "c-29")
    #expect(projects.corpus.sessionCount == 230)
    #expect(projects.cut == false)
    #expect(door.lists().map { $0?["cursor"]?.stringValue } == [nil, "1", "2"])
    #expect(door.lists().allSatisfy { $0?["limit"]?.intValue == Int64(HistoryReads.listRows) })
    projects.close()
  }

  @Test("a ping reads the newest page alone and lays it over what is held: what moved leads, the rest stays")
  @MainActor
  func aPingReadsTheHead() async throws {
    let door = PagedDoor()
    door.projects = [keys("a", 100), keys("b", 40)]
    let projects = HistoryProjects(source: studio, door: door)
    projects.start()
    await settle("the ledger") { projects.corpus.projects.count == 140 }
    await settle("the pings") { door.ping != nil }
    let lists = door.count("project.list")
    // b-7 moved: the door now leads its newest page with it, and a project the phone never saw
    door.projects = [["b-7", "new"] + keys("a", 98), ["a-98", "a-99"] + keys("b", 40).filter { $0 != "b-7" }]
    door.ping?(.object(["since": .int(41), "revision": .int(42), "upserts": .array([]), "removed": .array([])]))
    await settle("the head") { projects.corpus.projects.first?.id == "b-7" }
    #expect(door.count("project.list") == lists + 1, "one page for a ping")
    #expect(projects.corpus.projects.count == 141)
    #expect(projects.corpus.projects.prefix(3).map(\.id) == ["b-7", "new", "a-0"])
    #expect(projects.corpus.projects.filter { $0.id == "b-7" }.count == 1)
    #expect(projects.corpus.projects.last?.id == "b-39", "the rows the page did not reach stay as they were read")
    projects.close()
  }

  @Test("a door that answers the page it already gave is not followed round")
  @MainActor
  func aDoorThatGoesRound() async throws {
    let door = PagedDoor()
    door.projects = [keys("a", 3)]
    door.roundCursor = "0"
    let projects = HistoryProjects(source: studio, door: door)
    projects.start()
    await settle("the ledger") { projects.corpus.projects.count == 3 }
    await settle("the pings") { door.ping != nil }
    #expect(door.count("project.list") == 2, "the page, and the one ask that brought nothing new")
    #expect(projects.cut == false)
    projects.close()
  }

  @Test("past its bound of pages the ledger holds the most recent and says it is cut")
  @MainActor
  func theBound() async throws {
    let door = PagedDoor()
    door.projects = (0..<(HistoryReads.ledgerPages + 4)).map { ["p-\($0)"] }
    let projects = HistoryProjects(source: studio, door: door)
    projects.start()
    await settle("the ledger") { projects.cut }
    #expect(projects.corpus.projects.count == HistoryReads.ledgerPages)
    #expect(door.count("project.list") == HistoryReads.ledgerPages)
    projects.close()
  }

  @Test("an opened project's sessions are followed to their end too")
  @MainActor
  func aProjectsSessions() async throws {
    let door = PagedDoor()
    door.projects = [["p"]]
    door.sessions = [keys("s", 100), keys("t", 100), keys("u", 12)]
    let projects = HistoryProjects(source: studio, door: door)
    projects.start()
    await settle("the ledger") { projects.corpus.projects.count == 1 }
    projects.open("p")
    await settle("the sessions") { projects.corpus.sessions(of: "p").count == 212 }
    let asks = door.asked.filter { $0.0 == "project.sessions" }.map { $0.1?["cursor"]?.stringValue }
    #expect(asks.prefix(3) == [nil, "1", "2"])
    #expect(Set(projects.corpus.sessions(of: "p").map(\.id)).count == 212)
    projects.close()
  }
}

// MARK: - Item 362b

/// A door whose session is pages of rows: the newest first, each page above asked by the cursor of the one below
/// it (the next page's number).
@MainActor
private final class TimelineDoor: HistoryDoor {
  var pages: [[JSONValue]] = []
  /// The cursor of every `index.timeline` asked, in order (nil: the head).
  var cursors: [String?] = []
  /// Every answer carries this cursor, whatever was asked (a door that goes round).
  var roundCursor: String?
  /// How long a page above takes to answer, so two asks can meet.
  var earlierTakes = Duration.zero
  private var inFlight = 0
  private(set) var mostInFlight = 0

  func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
    switch method {
    case "index.session":
      return try Fixture.json("index-session.valid")
    case "index.timeline":
      let cursor = params?["cursor"]?.stringValue
      cursors.append(cursor)
      inFlight += 1
      mostInFlight = max(mostInFlight, inFlight)
      defer { inFlight -= 1 }
      if cursor != nil, earlierTakes > .zero { try? await Task.sleep(for: earlierTakes) }
      let at = cursor.flatMap { Int($0) } ?? 0
      var page: [String: JSONValue] = [
        "sessionId": .string("s1"), "entries": .array(at < pages.count ? pages[at] : []), "watermark": .string("w1"),
      ]
      if let roundCursor {
        page["nextCursor"] = .string(roundCursor)
      } else if at + 1 < pages.count {
        page["nextCursor"] = .string(String(at + 1))
      }
      return .object(page)
    default:
      throw FieldProductError(kind: "NOT_FOUND", message: method)
    }
  }

  func tail(
    _ method: String, params: JSONValue?, shape: SubscriptionShape,
    onSnapshot: @escaping @MainActor (JSONValue) -> Void,
    onDelta: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> HistoryTailHandle {
    HistoryTailHandle {}
  }

  func close() {}

  func earlierAsks() -> [String] { cursors.compactMap { $0 } }
}

/// A row of a kind, numbered down the session (a larger ordinal is newer).
private func timelineRow(_ id: String, _ ordinal: Int, _ kind: String, group: String? = nil, text: String? = "words")
  -> JSONValue
{
  var fields: [String: JSONValue] = [
    "timelineId": .string(id), "sessionId": .string("s1"), "ordinal": .int(Int64(ordinal)), "kind": .string(kind),
    "at": .int(1_759_000_000_000 + Int64(ordinal) * 1_000),
    "group": .object(["id": .string("g"), "kind": .string(group ?? (kind == "user" ? "human_turn" : "agent_cycle"))]),
  ]
  if let text { fields["text"] = .string(text) }
  return .object(fields)
}

@MainActor
private func opened(_ door: TimelineDoor) async -> HistoryDesktopReader {
  let reader = HistoryDesktopReader(deviceId: "dev-1", name: "studio", door: door)
  reader.start()
  reader.need(.session(device: "dev-1", id: "s1"))
  await settle("the document") { reader.corpus.document("s1") != nil }
  return reader
}

/// Item 362b (James, 2026-11-12 18:40:35Z, of the phone's History session view: "it does not load message
/// progressively like desktop") — the rows above a document's top are read a batch at a time, by the room's rule
/// (rosetta `lib/transcript/history-window.ts`): on until they hold six messages, in at most five asks; one read
/// at a time; and nothing that asks in a loop.
///
/// *Corrected 2026-11-14 (item 418; James, 08:13:38Z, session qa-01: "it seems still trying to load everything …
/// you pull down for load more"):* this said the rows above "are read as the reader nears it", and the suite was
/// named "are read in as the reader nears its top". That was the page's half of 362b (`HistoryFollow.asksEarlier`):
/// within a screen of the top the page asked by itself, and again after each batch. Item 418 overturned it: a batch
/// is asked for by a pull at the top, or a press, and its rows are in HistoryOlderPullTests.swift. What these rows
/// hold stands: what ONE ask reads.
@Suite("item 362b — one ask for the rows above a session's document reads one batch, by the room's rule")
struct HistoryEarlierTests {
  /// Item 418 — the reader's half of "nothing above is read in by itself". It holds before the item as after it:
  /// the reader never asked by itself, the page's rule did (`HistoryFollow.asksEarlier`, overturned).
  @Test("a session that opens reads its newest page and nothing above it; one ask reads one batch and no more")
  @MainActor
  func nothingAboveByItself() async throws {
    let door = TimelineDoor()
    door.pages = [
      [timelineRow("u9", 90, "user")],
      (0..<6).map { timelineRow("u8\($0)", 80 + $0, "user") },
      [timelineRow("u7", 70, "user")],
    ]
    let reader = await opened(door)
    // long enough for a read that was going to start by itself to have started
    try? await Task.sleep(for: .milliseconds(50))
    #expect(door.earlierAsks().isEmpty)
    #expect(reader.readingEarlier.isEmpty)
    #expect(reader.corpus.document("s1")?.nextCursor == "1")
    reader.need(.older(device: "dev-1", session: "s1"))
    await settle("the read's end") { !reader.readingEarlier.contains("s1") }
    #expect(door.earlierAsks() == ["1"], "six messages in one page: the batch is that page")
    try? await Task.sleep(for: .milliseconds(50))
    #expect(door.earlierAsks() == ["1"], "the batch above it waits for the next ask")
    #expect(reader.corpus.document("s1")?.nextCursor == "2")
    reader.close()
  }

  @Test("one approach reads on until six messages are held: a page of thoughts alone does not end it")
  @MainActor
  func untilSixMessages() async throws {
    let door = TimelineDoor()
    door.pages = [
      [timelineRow("u9", 90, "user"), timelineRow("a9", 91, "agent")],
      [timelineRow("t1", 80, "thinking"), timelineRow("t2", 81, "thinking"), timelineRow("t3", 82, "thinking")],
      [
        timelineRow("u7", 70, "user"), timelineRow("a7", 71, "agent"), timelineRow("u8", 72, "user"),
        timelineRow("a8", 73, "agent"),
      ],
      [timelineRow("u6", 60, "user"), timelineRow("a6", 61, "agent")],
      [timelineRow("u5", 50, "user")],
    ]
    let reader = await opened(door)
    #expect(HistoryReads.earlierMessages == 6 && HistoryReads.earlierPages == 5)
    reader.need(.older(device: "dev-1", session: "s1"))
    #expect(reader.readingEarlier.contains("s1"), "the read is said while it runs")
    await settle("the read's end") { !reader.readingEarlier.contains("s1") }
    #expect(door.earlierAsks() == ["1", "2", "3"], "four and two make six: the fourth page above is left")
    let document = try #require(reader.corpus.document("s1"))
    #expect(document.nextCursor == "4")
    #expect(document.turns.first?.id == "u6")
    reader.close()
  }

  @Test("an approach asks at most five pages, however little they hold")
  @MainActor
  func atMostFivePages() async throws {
    let door = TimelineDoor()
    door.pages = [[timelineRow("u9", 90, "user")]] + (1...7).map { [timelineRow("t\($0)", 90 - $0, "thinking")] }
    let reader = await opened(door)
    reader.need(.older(device: "dev-1", session: "s1"))
    await settle("the read's end") { !reader.readingEarlier.contains("s1") }
    #expect(door.earlierAsks() == ["1", "2", "3", "4", "5"])
    #expect(reader.corpus.document("s1")?.nextCursor == "6")
    reader.close()
  }

  @Test("the session's start ends the read, and nothing is asked past it")
  @MainActor
  func theStart() async throws {
    let door = TimelineDoor()
    door.pages = [[timelineRow("u9", 90, "user")], [timelineRow("u8", 80, "user")]]
    let reader = await opened(door)
    reader.need(.older(device: "dev-1", session: "s1"))
    await settle("the read's end") { !reader.readingEarlier.contains("s1") }
    #expect(door.earlierAsks() == ["1"])
    #expect(reader.corpus.document("s1")?.nextCursor == nil)
    reader.need(.older(device: "dev-1", session: "s1"))
    #expect(reader.readingEarlier.isEmpty)
    #expect(door.earlierAsks() == ["1"])
    reader.close()
  }

  @Test("a door that answers the cursor it was asked is asked once, and its cursor is never asked by itself again")
  @MainActor
  func aDoorThatGoesRound() async throws {
    let door = TimelineDoor()
    door.pages = [[timelineRow("u9", 90, "user")], [timelineRow("t1", 80, "thinking")]]
    door.roundCursor = "1"
    let reader = await opened(door)
    reader.need(.older(device: "dev-1", session: "s1"))
    await settle("the read's end") { !reader.readingEarlier.contains("s1") }
    #expect(door.earlierAsks() == ["1"], "not followed round")
    let cursor = reader.corpus.document("s1")?.nextCursor
    #expect(cursor == "1")
    // the page's half (item 418; it was `asksEarlier`'s `stalled`): a read that left the document's top where it
    // was brought nothing. The line at the top says so, and the page asks for nothing again by itself.
    var pull = HistoryOlderPull()
    let asked = pull.pressed(ready: true)
    #expect(asked)
    pull.began()
    pull.ended()
    #expect(pull.failed)
    let again = pull.rested(ready: true)
    #expect(again == false, "a page at rest asks for nothing by itself")
    reader.close()
  }

  @Test("one read a session at a time: a second approach while one is in flight asks nothing")
  @MainActor
  func oneAtATime() async throws {
    let door = TimelineDoor()
    door.pages = [[timelineRow("u9", 90, "user")], [timelineRow("u8", 80, "user")]]
    door.earlierTakes = .milliseconds(60)
    let reader = await opened(door)
    reader.need(.older(device: "dev-1", session: "s1"))
    reader.need(.older(device: "dev-1", session: "s1"))
    reader.need(.older(device: "dev-1", session: "s1"))
    await settle("the read's end") { !reader.readingEarlier.contains("s1") }
    #expect(door.earlierAsks() == ["1"])
    #expect(door.mostInFlight == 1)
    reader.close()
  }

  // RETIRED 2026-11-14 (item 418): `whenTheTopAsks` ("the top asks by itself only near it, with rows above, an
  // answering desktop, no read running and a cursor that moved") and `theTopsWords` ("the rule at the top says where
  // the rows above stand"). They held the page's half of 362b, `HistoryFollow.asksEarlier` and `HistoryFollow.head`.
  // The top asks for nothing by itself now, in a document a search landed in as in any other, and the rule at the
  // top is the pull's: both are held in HistoryOlderPullTests.swift (`nothingByItself`, `theLine`).

  @Test("within a screen of the document's top is near it: the room's distance")
  func nearTheTop() {
    #expect(HistoryFollow.nearTop(offset: 600, container: 600))
    #expect(HistoryFollow.nearTop(offset: 601, container: 600) == false)
  }

  @Test("a message is a person's prompt, or a reply with words or an attachment: never a parent's invocation or a tool")
  func whatAMessageIs() throws {
    func message(_ kind: String, group: String? = nil, text: String? = "words") throws -> Bool {
      HistoryReads.isMessage(try IndexTimelineRow(json: timelineRow("r", 1, kind, group: group, text: text)))
    }
    #expect(try message("user"))
    #expect(try message("user", group: "parent_invocation") == false)
    #expect(try message("agent"))
    #expect(try message("agent", text: nil) == false)
    #expect(try message("agent", text: "") == false)
    #expect(try message("thinking") == false)
    #expect(try message("tool_use", text: nil) == false)
  }
}
