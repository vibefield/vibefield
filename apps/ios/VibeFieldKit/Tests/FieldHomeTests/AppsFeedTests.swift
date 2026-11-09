import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// One app's row and a page of them, as `index.apps.list` answers.
enum AppsWire {
  static func row(_ name: String, at: Int64 = 100, device: String = "desk") -> JSONValue {
    .object([
      "appKey": .string("\(device):\(name)"),
      "foldKey": .string("app:\(name)"),
      "device": .string(device),
      "appId": .string(name),
      "devices": .array([.string(device)]),
      "presentationId": .string("p-\(name)"),
      "title": .string(name),
      "filename": .string("\(name).html"),
      "sessionId": .string("s-\(name)"),
      "timelineId": .string("t-\(name)"),
      "versions": .int(1),
      "publishedAt": .int(at),
      "availability": .string("captured"),
      "openable": .bool(true),
    ])
  }

  static func source(_ device: String = "desk", name: String = "studio", state: String = "live") -> JSONValue {
    .object([
      "device": .string(device),
      "name": .string(name),
      "self": .bool(device == "desk"),
      "state": .string(state),
      "rows": .int(1),
      "libraryReady": .bool(true),
    ])
  }

  static func page(_ names: [String], cursor: String? = nil, clipped: Bool = false) -> JSONValue {
    var fields: [String: JSONValue] = [
      "rows": .array(names.map { row($0) }),
      "sources": .array([source()]),
    ]
    if let cursor { fields["cursor"] = .string(cursor) }
    if clipped { fields["clipped"] = .bool(true) }
    return .object(fields)
  }
}

/// MA-6c — the feed: every page of the door, its pings, the project names, and every state said (MA-L10).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@MainActor
@Suite("MA-6c — the apps feed: the door's pages, its pings, the honest states")
struct AppsFeedTests {
  final class Door: ChatDoor {
    var calls: [(method: String, params: JSONValue?)] = []
    var watched: [(method: String, params: JSONValue?)] = []
    var frames: [@MainActor (JSONValue) -> Void] = []
    var list: @MainActor (JSONValue?) async throws -> JSONValue = { _ in AppsWire.page(["one"]) }
    var projects: Result<JSONValue, FieldProductError> = .failure(
      FieldProductError(kind: "NOT_FOUND", message: "project.list"))

    final class Watch: ChatWatch {
      func cancel() {}
    }

    func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
      calls.append((method, params))
      switch method {
      case "index.apps.list": return try await list(params)
      case "project.list": return try projects.get()
      default: throw FieldProductError(kind: "NOT_FOUND", message: method)
      }
    }

    func watch(
      _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> any ChatWatch {
      watched.append((method, params))
      frames.append(onFrame)
      return Watch()
    }

    func count(_ method: String) -> Int { calls.filter { $0.method == method }.count }

    func lists() -> [JSONValue?] { calls.filter { $0.method == "index.apps.list" }.map(\.params) }

    func reader(spark: String, device: String?, whole: Bool, held: SparkTranscriptReading) -> any ChatThreadReader {
      ChatThreadTests.Reader(held)
    }
  }

  /// Holds a door's answer until the test lets it go.
  @MainActor
  final class Gate {
    private var waiting: CheckedContinuation<Void, Never>?

    func wait() async { await withCheckedContinuation { waiting = $0 } }

    func open() {
      waiting?.resume()
      waiting = nil
    }
  }

  /// Until `done` holds, or two seconds.
  func settle(_ done: () -> Bool) async {
    for _ in 0..<200 where !done() {
      try? await Task.sleep(for: .milliseconds(10))
    }
  }

  private func titles(_ feed: AppsFeed) -> [String] { feed.reading.apps.map(\.title) }

  @Test("a door handed over walks every page of the mesh, at the tailnet's page, by the cursor")
  func walksEveryPage() async {
    let door = Door()
    door.list = { params in
      params?["cursor"]?.stringValue == nil ? AppsWire.page(["a", "b"], cursor: "next") : AppsWire.page(["c"])
    }
    let feed = AppsFeed()
    feed.attach(door, home: "desk")
    await settle { feed.reading.phase == .live }
    #expect(feed.reading.phase == .live)
    #expect(titles(feed) == ["a", "b", "c"])
    #expect(feed.reading.clipped == false)
    let asked = door.lists()
    #expect(asked.count == 2)
    #expect(asked.first??["scope"]?.stringValue == "mesh")
    #expect(asked.first??["limit"]?.intValue == 100)
    #expect(asked.last??["cursor"]?.stringValue == "next")
  }

  @Test("a page that says `clipped` with a cursor is only a page: the walk goes on, and nothing is said")
  func clippedPageWalksOn() async {
    let door = Door()
    door.list = { params in
      params?["cursor"]?.stringValue == nil
        ? AppsWire.page(["a"], cursor: "next", clipped: true) : AppsWire.page(["b"])
    }
    let feed = AppsFeed()
    feed.attach(door, home: "desk")
    await settle { feed.reading.phase == .live }
    #expect(titles(feed) == ["a", "b"])
    #expect(feed.reading.clipped == false)
  }

  @Test("the walk stops at its bound with pages left, and says so")
  func boundIsSaid() async {
    let door = Door()
    door.list = { [door] _ in
      AppsWire.page(["p\(door.count("index.apps.list"))"], cursor: "more")
    }
    let feed = AppsFeed()
    feed.attach(door, home: "desk")
    await settle { feed.reading.phase == .live }
    #expect(door.count("index.apps.list") == AppsFeed.maxPages)
    #expect(feed.reading.clipped)
  }

  @Test("the project names are joined from project.list; a refusal leaves the apps standing with none")
  func projectNames() async throws {
    let list = try HomeFixture.json("project-list.valid")
    let result = try ProjectListResult(json: list)
    let first = try #require(result.rows.first)
    let door = Door()
    door.projects = .success(list)
    let feed = AppsFeed()
    feed.attach(door, home: "desk")
    await settle { !feed.reading.projects.isEmpty }
    #expect(feed.reading.projects[first.key] == first.name)

    let refused = Door()
    let other = AppsFeed()
    other.attach(refused, home: "desk")
    await settle { other.reading.phase == .live }
    #expect(other.reading.phase == .live)
    #expect(other.reading.projects.isEmpty)
  }

  @Test("the mesh's pings are watched, and each one reads the shelf again")
  func pingsReread() async {
    let door = Door()
    let feed = AppsFeed()
    feed.attach(door, home: "desk")
    await settle { !door.frames.isEmpty && feed.reading.phase == .live }
    #expect(door.watched.first?.method == "index.apps.subscribe")
    #expect(door.watched.first?.params?["scope"]?.stringValue == "mesh")
    let before = door.count("index.apps.list")
    door.list = { _ in AppsWire.page(["one", "two"]) }
    door.frames.first?(.object([:]))
    await settle { door.count("index.apps.list") > before && feed.reading.apps.count == 2 }
    #expect(titles(feed) == ["one", "two"])
  }

  @Test("a library still reading is said, never an empty shelf")
  func libraryReading() async {
    let door = Door()
    door.list = { _ in
      throw FieldProductError(
        kind: "UNAVAILABLE", message: "reading", retryable: true,
        details: .object(["service": .string("apps"), "state": .string("library-reading"), "device": .string("mini")]))
    }
    let feed = AppsFeed()
    feed.attach(door, home: "desk")
    await settle { feed.reading.phase != .waiting }
    #expect(feed.reading.phase == .reading(device: "mini"))
  }

  @Test("a page this build cannot read, or a door that cannot answer, is unavailable")
  func unavailable() async {
    let unreadable = Door()
    unreadable.list = { _ in .object(["rows": .string("not rows")]) }
    let feed = AppsFeed()
    feed.attach(unreadable, home: "desk")
    await settle { feed.reading.phase != .waiting }
    #expect(feed.reading.phase == .unavailable)

    let silent = Door()
    silent.list = { _ in throw FieldProductError(kind: "UNAVAILABLE", message: "not connected", retryable: true) }
    let second = AppsFeed()
    second.attach(silent, home: "desk")
    await settle { second.reading.phase != .waiting }
    #expect(second.reading.phase == .unavailable)
  }

  @Test("no home answers: Off, with the last apps standing")
  func offKeepsTheLastWord() async {
    let door = Door()
    let feed = AppsFeed()
    feed.attach(door, home: "desk")
    await settle { feed.reading.phase == .live }
    feed.attach(nil, home: "desk")
    #expect(feed.reading.phase == .off)
    #expect(titles(feed) == ["one"])

    let never = AppsFeed()
    never.attach(nil, home: nil)
    #expect(never.reading.phase == .off)
    #expect(never.reading.apps.isEmpty)
  }

  @Test("another home's apps are not this one's, and the same door again asks nothing")
  func homesAndRepeats() async {
    let door = Door()
    let feed = AppsFeed()
    feed.attach(door, home: "desk")
    await settle { feed.reading.phase == .live }
    let asked = door.count("index.apps.list")
    feed.attach(door, home: "desk")
    #expect(door.count("index.apps.list") == asked)

    let other = Door()
    other.list = { _ in AppsWire.page(["theirs"]) }
    feed.attach(other, home: "mini")
    #expect(feed.reading.apps.isEmpty)
    await settle { feed.reading.phase == .live && !feed.reading.apps.isEmpty }
    #expect(titles(feed) == ["theirs"])
  }

  @Test("a reading a newer door overtook lands nothing")
  func overtaken() async {
    let gate = Gate()
    let slow = Door()
    slow.list = { _ in
      await gate.wait()
      return AppsWire.page(["late"])
    }
    let feed = AppsFeed()
    feed.attach(slow, home: "desk")
    await settle { slow.count("index.apps.list") == 1 }

    let fast = Door()
    fast.list = { _ in AppsWire.page(["fresh"]) }
    feed.attach(fast, home: "desk")
    await settle { feed.reading.phase == .live }
    gate.open()
    try? await Task.sleep(for: .milliseconds(50))
    #expect(titles(feed) == ["fresh"])
  }

  @Test("typed words ask the door's titles, across the mesh")
  func askAsks() async {
    let door = Door()
    door.list = { params in
      params?["q"]?.stringValue == "notes" ? AppsWire.page(["release notes"]) : AppsWire.page(["one"])
    }
    let feed = AppsFeed()
    feed.attach(door, home: "desk")
    await settle { feed.reading.phase == .live }
    await feed.ask("notes")
    let titles = feed.reading.matches.map(\.title)
    #expect(titles == ["release notes"])
    #expect(feed.reading.matchWords == "notes")
    let asked = door.lists().last ?? nil
    #expect(asked?["scope"]?.stringValue == "mesh")
    #expect(asked?["q"]?.stringValue == "notes")
  }

  @Test("no words clear the answer and ask nothing")
  func askClears() async {
    let door = Door()
    let feed = AppsFeed()
    feed.attach(door, home: "desk")
    await settle { feed.reading.phase == .live }
    await feed.ask("one")
    #expect(feed.reading.matches.count == 1)
    let asked = door.count("index.apps.list")
    await feed.ask("")
    #expect(feed.reading.matches.isEmpty)
    #expect(feed.reading.matchWords == "")
    #expect(door.count("index.apps.list") == asked)
  }

  @Test("an older ask that a newer one overtook lands nothing")
  func askOvertaken() async {
    let gate = Gate()
    let door = Door()
    door.list = { params in
      if params?["q"]?.stringValue == "old" {
        await gate.wait()
        return AppsWire.page(["old answer"])
      }
      return AppsWire.page([params?["q"]?.stringValue ?? "one"])
    }
    let feed = AppsFeed()
    feed.attach(door, home: "desk")
    await settle { feed.reading.phase == .live }
    async let first: Void = feed.ask("old")
    await settle { door.lists().contains { $0?["q"]?.stringValue == "old" } }
    await feed.ask("new")
    gate.open()
    await first
    let titles = feed.reading.matches.map(\.title)
    #expect(titles == ["new"])
    #expect(feed.reading.matchWords == "new")
  }
}
