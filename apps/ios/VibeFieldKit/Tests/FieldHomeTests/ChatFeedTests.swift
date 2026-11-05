import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// IOS-12b (PC-L2, PC-L4; §9 "Chat on the phone") — Chat's feed and its words. The feed asks the home for both lists
/// with `scope: "mesh"` and asks again only when something moved (a door handed over, the board's live sparks, a
/// needs frame, a wake), never on a timer; a desktop that did not answer keeps its last word.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("Chat's feed asks the home, and its words say what is true")
@MainActor
struct ChatFeedTests {
  /// A door that answers the contracts' merged lists (the demo door's own copies) and records every ask.
  final class Door: ChatDoor {
    var calls: [(method: String, params: JSONValue?)] = []
    var watched: [JSONValue?] = []
    var frames: [@MainActor (JSONValue) -> Void] = []
    var sparks: JSONValue? = ChatFixtureDoor.fixture("compose-sparks-list.merged")
    var needs: JSONValue? = ChatFixtureDoor.fixture("needs-list.merged")

    final class Watch: ChatWatch {
      var cancelled = false
      func cancel() { cancelled = true }
    }

    func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
      calls.append((method, params))
      switch method {
      case "compose.sparks.list": return sparks ?? .null
      case "needs.list": return needs ?? .null
      default: return .object(["spark": .object([:])])
      }
    }

    func watch(
      _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> any ChatWatch {
      watched.append(params)
      frames.append(onFrame)
      return Watch()
    }

    func count(_ method: String) -> Int { calls.filter { $0.method == method }.count }
  }

  /// Until `done` holds, or two seconds.
  func settle(_ done: () -> Bool) async {
    for _ in 0..<200 where !done() {
      try? await Task.sleep(for: .milliseconds(10))
    }
  }

  /// The witness's idle home agent (`run-h-turn`, on dev-01HQ9S7UD1), as a spark's own run or no spark's.
  static func row(spark: String?, alive: Bool = true) throws -> AgentRemoteRow {
    let open = try HomeFixture.json("agent-remote-mesh-open.witness")
    let rows = open["devices"]?.arrayValue?.first?["snapshot"]?["rows"]?.arrayValue ?? []
    let turn = try #require(rows.first { $0["runtimeRunId"]?.stringValue == "run-h-turn" })
    guard case .object(var fields) = turn, case .object(var monitor)? = fields["monitorRow"] else {
      throw HomeFixture.MissingFixture(name: "run-h-turn")
    }
    fields["runtimeRunId"] = .string("run-\(spark ?? "plain")")
    if let spark { fields["spark"] = .string(spark) }
    monitor["alive"] = .bool(alive)
    fields["monitorRow"] = .object(monitor)
    return try AgentRemoteRow(json: .object(fields))
  }

  @Test("a door handed over asks both lists of every desktop, and watches the home's queue")
  func attach() async throws {
    let feed = ChatFeed()
    let door = Door()
    feed.attach(door, home: "dev-01HQ9S7UD1")
    await settle { feed.reading.heard && !feed.reading.items.isEmpty }
    let asked = door.calls.map { $0.method }.sorted()
    #expect(asked == ["compose.sparks.list", "needs.list"])
    let params = door.calls.map { $0.params }
    #expect(params.allSatisfy { $0 == .object(["scope": .string("mesh")]) })
    let names = feed.reading.sparks.map { $0.name }
    #expect(names == ["Vela", "Kiwi"])
    #expect(feed.reading.items.count == 2)
    #expect(feed.reading.connected)
    // the home's queue, and the loft's (it answered), each watched through the home
    await settle { door.watched.count == 2 }
    let watched = door.watched.map { $0?["device"]?.stringValue ?? "home" }.sorted()
    #expect(watched == ["dev-01HQ9S7XZ2", "home"])
    // the same door again asks nothing
    feed.attach(door, home: "dev-01HQ9S7UD1")
    #expect(door.calls.count == 2)
  }

  @Test("the list is asked again when a spark's live run appears or leaves, never for the rest of the board")
  func boardKey() async throws {
    let feed = ChatFeed()
    let door = Door()
    feed.attach(door, home: "dev-01HQ9S7UD1")
    await settle { feed.reading.heard }
    let before = door.count("compose.sparks.list")
    let plain = try Self.row(spark: nil)
    feed.board([plain])
    #expect(door.count("compose.sparks.list") == before)
    let vela = try Self.row(spark: "sp-7k2m9q4x")
    feed.board([plain, vela])
    await settle { door.count("compose.sparks.list") == before + 1 }
    #expect(door.count("compose.sparks.list") == before + 1)
    // the same live sparks: nothing
    feed.board([vela])
    #expect(door.count("compose.sparks.list") == before + 1)
    // its run ended: asked again
    feed.board([try Self.row(spark: "sp-7k2m9q4x", alive: false)])
    await settle { door.count("compose.sparks.list") == before + 2 }
    #expect(door.count("compose.sparks.list") == before + 2)
    #expect(ChatFeed.liveSparkKey([vela, plain]) == "dev-01HQ9S7UD1/sp-7k2m9q4x")
  }

  @Test("a needs frame asks the merged queue again; a wake asks its spark's desktop, then both lists")
  func framesAndWake() async throws {
    let feed = ChatFeed()
    let door = Door()
    feed.attach(door, home: "dev-01HQ9S7UD1")
    await settle { feed.reading.heard && !door.frames.isEmpty }
    let needsBefore = door.count("needs.list")
    let frame = try #require(door.frames.first)
    frame(.object(["items": .array([])]))
    await settle { door.count("needs.list") > needsBefore }
    #expect(door.count("needs.list") == needsBefore + 1)

    let kiwi = try #require(feed.reading.sparks.last)
    try await feed.wake(kiwi)
    let open = door.calls.first { $0.method == "compose.sparks.open" }
    let openParams = open?.params
    #expect(openParams == .object(["spark": .string("sp-9q2wloft1"), "device": .string("dev-01HQ9S7XZ2")]))
    await settle { door.count("compose.sparks.list") >= 2 }
    #expect(door.count("compose.sparks.list") >= 2)
  }

  @Test("PC-L4: with no door the list stands as the home last said; a desktop that did not answer keeps its sparks")
  func lastWord() async throws {
    let feed = ChatFeed()
    let door = Door()
    feed.attach(door, home: "dev-01HQ9S7UD1")
    await settle { feed.reading.heard }
    feed.attach(nil, home: nil)
    #expect(!feed.reading.connected)
    let names = feed.reading.sparks.map { $0.name }
    #expect(names == ["Vela", "Kiwi"])

    // the loft stops answering: Kiwi is carried, said as the loft's last word
    let previous = feed.reading.sparks
    let next = try ComposeSparksList(
      json: .object([
        "sparks": .array([]),
        "desktops": .array([
          .object(["device": .string("dev-01HQ9S7UD1"), "state": .string("answered")]),
          .object(["device": .string("dev-01HQ9S7XZ2"), "state": .string("timeout")]),
        ]),
      ]))
    let carried = ChatReading.carry(previous, into: next.sparks, desktops: next.desktops, device: { $0.device })
    let carriedNames = carried.map { $0.name }
    #expect(carriedNames == ["Kiwi"])
    // every desktop answered: the next list as it is
    let answered = ChatReading.carry(previous, into: [], desktops: [], device: { $0.device })
    #expect(answered.isEmpty)
  }

  // MARK: - The words (§9 "Chat on the phone")

  @Test("the subtitle counts what is true: the sparks, where they live, and how many need you")
  func subtitle() {
    #expect(ChatWords.subtitle(sparks: 4, on: ["studio"], needing: 2) == "4 sparks on studio · 2 need you")
    #expect(ChatWords.subtitle(sparks: 1, on: ["studio"], needing: 1) == "1 spark on studio · 1 needs you")
    #expect(ChatWords.subtitle(sparks: 2, on: ["studio", "loft"], needing: 0) == "2 sparks on studio and loft")
    let three = ChatWords.subtitle(sparks: 3, on: ["studio", "loft", "mini"], needing: 0)
    #expect(three == "3 sparks on studio, loft and mini")
    #expect(ChatWords.subtitle(sparks: 0, on: [], needing: 0) == "0 sparks")
  }

  @Test("a desktop's last word is said in the fact that holds: asleep, not answering, or a build it can't read")
  func away() {
    #expect(
      ChatWords.away("studio", .asleep)
        == "studio is asleep. These are as it last said; your words wait here until it wakes.")
    #expect(
      ChatWords.away("loft", .silent)
        == "loft isn't answering. These are as it last said; your words wait here until it answers.")
    #expect(
      ChatWords.away("mini", .incompatible)
        == "mini runs a build this phone can't read. These are as it last said; "
        + "your words wait here until it's updated.")
    // the merge's words, as the person reads them: a timeout and unreachable are one fact; a newer word is no answer
    let standings = [ComposeDesktopState.asleep, .timeout, .unreachable, .incompatible, nil].map(ChatAway.Standing.init)
    #expect(standings == [.asleep, .silent, .silent, .incompatible, .silent])
    #expect(ChatWords.emptyTitle == "No sparks yet.")
    #expect(ChatWords.emptyText == "A spark is an agent VibeField starts to run your other agents.")
  }
}
