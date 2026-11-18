import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// MA-3h (Keep), K4 — the phone keeps an app through its home: the long press's acts, the one `artifact.mark` a keep
/// sends, the Kept group the home's next page fills, and what a keep the home did not take says (MA-L10).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@MainActor
@Suite("MA-3h K4 — the phone's Keep: the long press, one mark through the home, its words")
struct AppsKeepTests {
  /// A home that keeps on `artifact.mark` and answers the list from what it keeps. Its write moves its fold, and the
  /// fold pings, as fieldd's does (`index-apps-mesh.ts`, the intents' `onChanged`).
  final class Home: ChatDoor {
    var calls: [(method: String, params: JSONValue?)] = []
    var frames: [@MainActor (JSONValue) -> Void] = []
    private(set) var kept: Set<String> = []
    /// What every mark is refused with; nil keeps as asked.
    var refusal: FieldProductError?

    final class Watch: ChatWatch {
      func cancel() {}
    }

    func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
      calls.append((method, params))
      switch method {
      case "index.apps.list":
        let rows = AppsKeepTests.apps.map { AppsKeepTests.row($0.id, $0.title, kept: kept.contains("app:\($0.id)")) }
        return .object(["rows": .array(rows), "sources": .array([AppsWire.source()])])
      case "artifact.mark":
        if let refusal { throw refusal }
        let foldKey = params?["foldKey"]?.stringValue ?? ""
        let keep = params?["kept"]?.boolValue == true
        if keep { kept.insert(foldKey) } else { kept.remove(foldKey) }
        for frame in frames { frame(.object([:])) }
        return .object(["foldKey": .string(foldKey), "kept": .bool(keep), "hidden": .bool(false)])
      default:
        throw FieldProductError(kind: "NOT_FOUND", message: method)
      }
    }

    func watch(
      _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> any ChatWatch {
      frames.append(onFrame)
      return Watch()
    }

    func marks() -> [JSONValue?] { calls.filter { $0.method == "artifact.mark" }.map(\.params) }

    func reader(spark: String, device: String?, whole: Bool, held: SparkTranscriptReading) -> any ChatThreadReader {
      ChatThreadTests.Reader(held)
    }
  }

  static let apps: [(id: String, title: String)] = [("notes", "Release notes"), ("board", "Sound board")]

  /// `AppsWire.row` under its own title, kept when `kept`.
  static func row(_ id: String, _ title: String, kept: Bool) -> JSONValue {
    guard case .object(var fields) = AppsWire.row(id) else { return AppsWire.row(id) }
    fields["title"] = .string(title)
    if kept { fields["kept"] = .bool(true) }
    return .object(fields)
  }

  /// Until `done` holds, or two seconds.
  func settle(_ done: () -> Bool) async {
    for _ in 0..<200 where !done() {
      try? await Task.sleep(for: .milliseconds(10))
    }
  }

  /// The Kept group of the shelf this reading draws.
  private static func kept(_ feed: AppsFeed) -> [String] {
    let reading = feed.reading
    let shelf = AppsShelf(
      reading: .init(apps: reading.apps, sources: reading.sources, clipped: reading.clipped),
      projects: reading.projects, opened: [], here: "This desktop")
    return shelf.kept.map(\.title)
  }

  private func live() async throws -> (Home, AppsFeed, IndexAppRow) {
    let home = Home()
    let feed = AppsFeed()
    feed.attach(home, home: "desk")
    await settle { feed.reading.phase == .live && !home.frames.isEmpty }
    let first = feed.reading.apps.first { $0.title == "Release notes" }
    let app = try #require(first)
    return (home, feed, app)
  }

  @Test("the long press offers Open, Keep and About this app, in that order; a kept app's offers Stop keeping instead")
  func longPressActs() throws {
    let plain = try IndexAppRow(json: Self.row("notes", "Release notes", kept: false))
    let kept = try IndexAppRow(json: Self.row("notes", "Release notes", kept: true))
    let plainWords = AppsTileAct.of(plain).map(\.word)
    #expect(plainWords == ["Open", "Keep", "About this app"])
    let keptWords = AppsTileAct.of(kept).map(\.word)
    #expect(keptWords == ["Open", "Stop keeping", "About this app"])
  }

  @Test("a Keep sends {foldKey, kept: true} once to the home, and a stop sends kept: false; neither names hidden")
  func markSendsOnce() async throws {
    let (home, feed, app) = try await live()
    let took = await feed.mark(app, kept: true)
    #expect(took == nil)
    let marks = home.marks()
    #expect(marks.count == 1)
    let sent = marks.first ?? nil
    #expect(sent?["foldKey"]?.stringValue == "app:notes")
    #expect(sent?["kept"]?.boolValue == true)
    #expect(sent?["hidden"] == nil)
    _ = await feed.mark(app, kept: false)
    let after = home.marks()
    #expect(after.count == 2)
    let stop = after.last ?? nil
    #expect(stop?["kept"]?.boolValue == false)
  }

  @Test("the Kept group fills from the home's next page, read on its ping, and stopping keeping takes the app out")
  func keptFillsOnThePing() async throws {
    let (_, feed, app) = try await live()
    #expect(Self.kept(feed).isEmpty)
    _ = await feed.mark(app, kept: true)
    await settle { Self.kept(feed) == ["Release notes"] }
    #expect(Self.kept(feed) == ["Release notes"])
    _ = await feed.mark(app, kept: false)
    await settle { Self.kept(feed).isEmpty }
    #expect(Self.kept(feed).isEmpty)
  }

  @Test("a keep the home did not take says so in words, never a code, and the shelf stands as it was")
  func refusedKeepSaysItsWords() async throws {
    let (home, feed, app) = try await live()
    home.refusal = FieldProductError(kind: "INTERNAL", message: "the settings document did not write")
    // DESIGN.md §9 "Keep's words" (the pick; MA-3h, 2026-11-14): its fourth line
    let failed = await feed.mark(app, kept: true)
    #expect(failed == "Couldn't keep Release notes.")
    // its fifth line
    let stopFailed = await feed.mark(app, kept: false)
    #expect(stopFailed == "Couldn't stop keeping Release notes.")
    // past MADE_APP_LIMITS.INTENTS: the card's third line, the desk's (on the phone too, DESIGN.md §9)
    home.refusal = FieldProductError(
      kind: "RESOURCE_EXHAUSTED", message: "kept apps are full", details: .object(["limit": .int(4096)]))
    let full = await feed.mark(app, kept: true)
    #expect(full == "You're keeping as many apps as VibeField holds. Stop keeping one to keep Release notes.")
    // a home from before 3h: the card's first line, the desk's (on the phone too, DESIGN.md §9)
    home.refusal = FieldProductError(
      kind: "UNAVAILABLE", message: "no intent to write",
      details: .object(["service": .string("apps"), "state": .string("intent-unbuilt")]))
    let older = await feed.mark(app, kept: true)
    #expect(older == "Keeping apps isn't ready yet.")
    let titles = feed.reading.apps.map(\.title)
    #expect(titles == ["Release notes", "Sound board"])
    #expect(Self.kept(feed).isEmpty)

    let offline = AppsFeed()
    offline.attach(nil, home: "desk")
    let none = await offline.mark(app, kept: true)
    #expect(none == "Couldn't keep Release notes.")
  }
}
