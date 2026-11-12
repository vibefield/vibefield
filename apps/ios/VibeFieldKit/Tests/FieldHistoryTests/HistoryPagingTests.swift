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
