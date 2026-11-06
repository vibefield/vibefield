import FieldDesign
import Foundation
import Testing

@testable import FieldHome
@testable import FieldProduct

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

    func reader(spark: String, device: String?, whole: Bool, held: SparkTranscriptReading) -> any ChatThreadReader {
      ChatThreadTests.Reader(held)
    }
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

  // MARK: - The note (S-4)

  @Test("the note says a need that STARTS while another page stands; the first whole reading is no news")
  func note() throws {
    let sparks = try ComposeSparksList(json: try #require(ChatFixtureDoor.fixture("compose-sparks-list.merged"))).sparks
    let needsJSON = try #require(ChatFixtureDoor.fixture("needs-list.merged"))
    let items = try NeedsList(json: needsJSON).items
    // a new item for Vela: the first one, under a new id
    guard case .object(var fields)? = needsJSON["items"]?.arrayValue?.first else {
      Issue.record("no item in the golden")
      return
    }
    fields["id"] = .string("ny-0new0item0vela")
    let fresh = try NeedsItem(json: .object(fields))
    let calm = SparkEntries.entries(sparks: sparks, rows: [], items: items)
    let more = SparkEntries.entries(sparks: sparks, rows: [], items: items + [fresh])
    let vela = try #require(calm.first { $0.spark.name == "Vela" })
    let keys = ChatNotes.keys(vela)
    #expect(keys == items.map { $0.id })

    var notes = ChatNotes()
    // the queue not heard yet: nothing is said, nothing is known
    let unheard = notes.read(calm, elsewhere: true, whole: false)
    // the first whole reading: Vela's two items stand, and are no news
    let first = notes.read(calm, elsewhere: true, whole: true)
    let again = notes.read(calm, elsewhere: true, whole: true)
    // a new item, on another page: said, once
    let said = notes.read(more, elsewhere: true, whole: true)
    let saidAgain = notes.read(more, elsewhere: true, whole: true)
    #expect(unheard == nil && first == nil && again == nil && saidAgain == nil)
    let saidName = try #require(said).spark.name
    #expect(saidName == "Vela")
    // on Chat's own page: never said, but known
    var onChat = ChatNotes()
    _ = onChat.read(calm, elsewhere: false, whole: true)
    let onPage = onChat.read(more, elsewhere: false, whole: true)
    let afterwards = onChat.read(more, elsewhere: true, whole: true)
    #expect(onPage == nil && afterwards == nil)
    #expect(ChatWords.note("Vela") == "Vela needs you")
  }

  // MARK: - The words (§9 "Chat on the phone")

  // IOS-12d (TH-1, the Mac's `needsOf`; the 12d plan's Found 1)
  @Test("its own run waiting with its ask in the queue is ONE need, its key the item's")
  func oneNeed() throws {
    let list = try ComposeSparksList(json: try #require(ChatFixtureDoor.fixture("compose-sparks-list.merged")))
    let vela = try #require(list.sparks.first { $0.id == ChatNeedsTests.vela })
    let row = try Self.row(spark: ChatNeedsTests.vela)
    let ask = try NeedsItem(json: try #require(ChatFixtureDoor.fixture("needs-item.agent-ask")))
    let from: JSONValue = .object(["name": .string("Claude Code"), "session": .string(row.runtimeRunId)])
    let ownAsk = try ChatNeedsTests.ask(["from": from])
    func entry(_ items: [NeedsItem]) -> SparkEntry {
      SparkEntry(
        spark: vela, run: row, status: .approval, needsYou: true, awake: true, blocked: true, heard: true,
        items: items, ownRuns: [row.runtimeRunId], activityAt: 0)
    }
    let queued = ChatNotes.keys(entry([ownAsk]))
    #expect(queued == [ownAsk.id])
    let waiting = ChatNotes.keys(entry([]))
    #expect(waiting == ["\(row.runtimeRunId):wait"])
    // an agent it started asking beside its own run's wait: two needs
    let both = ChatNotes.keys(entry([ask]))
    #expect(both == ["\(row.runtimeRunId):wait", ask.id])
  }

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
      ChatWords.away("studio", .asleep, carried: true, device: .iPhone)
        == "studio is asleep. These are as it last said; your words wait here until it wakes.")
    #expect(
      ChatWords.away("loft", .silent, carried: true, device: .iPhone)
        == "loft isn't answering. These are as it last said; your words wait here until it answers.")
    #expect(
      ChatWords.away("mini", .incompatible, carried: true, device: .iPhone)
        == "mini runs a build this iPhone can't read. These are as it last said; "
        + "your words wait here until it's updated.")
    // a desktop the phone never heard: the same fact, never a last word (VF-PM 02:06Z, §9)
    #expect(
      ChatWords.away("studio", .asleep, carried: false, device: .iPhone)
        == "studio is asleep. Its sparks show here when it wakes.")
    #expect(
      ChatWords.away("loft", .silent, carried: false, device: .iPhone)
        == "loft isn't answering. Its sparks show here when it answers.")
    #expect(
      ChatWords.away("mini", .incompatible, carried: false, device: .iPhone)
        == "mini runs a build this iPhone can't read. Its sparks show here when it's updated.")
    // the merge's words, as the person reads them: a timeout and unreachable are one fact; a newer word is no answer
    let standings = [ComposeDesktopState.asleep, .timeout, .unreachable, .incompatible, nil].map(ChatAway.Standing.init)
    #expect(standings == [.asleep, .silent, .silent, .incompatible, .silent])
    // L4's word pass: the build the person's device can't read is said as its platform names it, never a phone
    for device in [DeviceWord.iPad, .unknown] {
      for standing in [ChatAway.Standing.asleep, .silent, .incompatible] {
        for carried in [true, false] {
          let said = ChatWords.away("mini", standing, carried: carried, device: device)
          #expect(!said.localizedCaseInsensitiveContains("phone"), "\(device) \(standing) \(carried): \(said)")
        }
      }
    }
    #expect(
      ChatWords.away("mini", .incompatible, carried: false, device: .iPad)
        == "mini runs a build this iPad can't read. Its sparks show here when it's updated.")
    #expect(ChatWords.emptyTitle == "No sparks yet.")
    #expect(ChatWords.emptyText == "A spark is an agent VibeField starts to run your other agents.")
  }

  /// The merged list's own desktops (`compose-sparks-list.merged`): studio and the loft answered, mini is asleep and
  /// holds no spark.
  static func merged() throws -> ChatReading {
    let list = try ComposeSparksList(json: try #require(ChatFixtureDoor.fixture("compose-sparks-list.merged")))
    var reading = ChatReading()
    reading.connected = true
    reading.heard = true
    reading.sparks = list.sparks
    reading.desktops = list.desktops
    return reading
  }

  static func name(_ device: String?) -> String {
    ChatFixtureDoor.names[device ?? ChatFixtureDoor.home] ?? "your desktop"
  }

  @Test("a desktop never heard is said as never heard, never as its last word")
  func neverHeard() throws {
    // mini is asleep with no spark of its own in the reading: "as it last said" would claim a last word the phone
    // never heard (VF-PM 2026-11-05, IOS-12b's Found, ruled (a) then (i)); it is said as never heard
    var reading = try Self.merged()
    let mini = ChatAway(device: "dev-01HQ9S7Y44", name: "mini", standing: .asleep, carried: false)
    let calm = ChatAway.lines(reading, home: ChatFixtureDoor.home, homeListed: true, name: Self.name)
    #expect(calm == [mini])
    let said = ChatWords.away(mini.name, mini.standing, carried: mini.carried, device: .iPhone)
    #expect(said == "mini is asleep. Its sparks show here when it wakes.")

    // the loft stops answering while Kiwi is carried from the last reading: its last word, as not answering
    let silent = try ComposeSparksList(
      json: .object([
        "sparks": .array([]),
        "desktops": .array([
          .object(["device": .string("dev-01HQ9S7UD1"), "state": .string("answered")]),
          .object(["device": .string("dev-01HQ9S7XZ2"), "state": .string("timeout")]),
          .object(["device": .string("dev-01HQ9S7Y44"), "state": .string("asleep")]),
        ]),
      ]))
    reading.desktops = silent.desktops
    let loft = ChatAway(device: "dev-01HQ9S7XZ2", name: "loft", standing: .silent, carried: true)
    let away = ChatAway.lines(reading, home: ChatFixtureDoor.home, homeListed: true, name: Self.name)
    #expect(away == [loft, mini])

    // an item alone is a row of its desktop: mini, asleep, holding an ask carried from before, says its last word
    let needsJSON = try #require(ChatFixtureDoor.fixture("needs-list.merged"))
    guard case .object(var fields)? = needsJSON["items"]?.arrayValue?.first else {
      Issue.record("no item in the golden")
      return
    }
    fields["device"] = .string("dev-01HQ9S7Y44")
    reading.items = [try NeedsItem(json: .object(fields))]
    let asked = ChatAway.lines(reading, home: ChatFixtureDoor.home, homeListed: true, name: Self.name)
    #expect(asked == [loft, ChatAway(device: "dev-01HQ9S7Y44", name: "mini", standing: .asleep, carried: true)])

    // no door: the whole list is the home's last word while the reading carries any row, in the fact that holds
    // (listed on the tailnet and silent, else asleep)
    reading.connected = false
    let listed = ChatAway.lines(reading, home: ChatFixtureDoor.home, homeListed: true, name: Self.name)
    #expect(listed == [ChatAway(device: ChatFixtureDoor.home, name: "studio", standing: .silent, carried: true)])
    let asleep = ChatAway.lines(reading, home: ChatFixtureDoor.home, homeListed: false, name: Self.name)
    #expect(asleep == [ChatAway(device: ChatFixtureDoor.home, name: "studio", standing: .asleep, carried: true)])

    // a cold start with the home asleep, the common case: nothing heard, so never "as it last said", and never a blank
    let cold = ChatAway.lines(ChatReading(), home: ChatFixtureDoor.home, homeListed: false, name: Self.name)
    #expect(cold == [ChatAway(device: ChatFixtureDoor.home, name: "studio", standing: .asleep, carried: false)])
  }

  // MARK: - IOS-12c: the thread's half of the feed

  static func say(_ n: Int) -> ChatPendingSay {
    ChatPendingSay(
      requestId: "say-test-\(String(format: "%08d", n))", text: "words \(n)", chips: [], at: "2026-11-06T09:00:00.000Z")
  }

  @Test("your sends stand until the record has them: newest last, 32 kept, and a send not taken leaves none")
  func sends() {
    let feed = ChatFeed()
    let vela = "sp-7k2m9q4x"
    for n in 1...33 { feed.stand(vela, Self.say(n)) }
    let held = feed.sends.of(vela).map { $0.requestId }
    #expect(held.count == ChatSends.kept)
    #expect(held.first == "say-test-00000002")
    #expect(held.last == "say-test-00000033")
    // a send stood again moves last, never twice
    feed.stand(vela, Self.say(5))
    let again = feed.sends.of(vela).map { $0.requestId }
    #expect(again.count == ChatSends.kept)
    #expect(again.last == "say-test-00000005")
    // answered: its receipt's state; not taken: gone
    feed.settle(vela, "say-test-00000033", state: "queued")
    let answered = feed.sends.of(vela).filter { $0.requestId == "say-test-00000033" }.map { $0.state }
    #expect(answered == ["queued"])
    feed.settle(vela, "say-test-00000033", state: nil)
    let left = feed.sends.of(vela).map { $0.requestId }
    #expect(!left.contains("say-test-00000033"))
    // the record shows two: they go, and another spark's sends are its own
    feed.stand("sp-9q2wloft1", Self.say(1))
    feed.letGo(vela, said: ["say-test-00000005", "say-test-00000006"])
    let after = feed.sends.of(vela).map { $0.requestId }
    #expect(!after.contains("say-test-00000005") && !after.contains("say-test-00000006"))
    #expect(after.count == ChatSends.kept - 3)
    #expect(feed.sends.of("sp-9q2wloft1").count == 1)
  }

  @Test("your words go through the home's door, and a different door is a new turn for an open thread")
  func sayAndTurn() async throws {
    let feed = ChatFeed()
    let door = Door()
    feed.attach(door, home: "dev-01HQ9S7UD1")
    let turn = feed.doorTurn
    feed.attach(door, home: "dev-01HQ9S7UD1")
    #expect(feed.doorTurn == turn)
    let params = try SparkSayParams(
      spark: "sp-7k2m9q4x", text: "Look at the composer test", requestId: "say-test-00000001", device: "dev-01HQ9S7UD1")
    _ = try? await feed.say(params)
    let said = door.calls.first { $0.method == SparkSay.method }?.params
    #expect(said == params.json)
    let reader = feed.reader(spark: "sp-7k2m9q4x", device: "dev-01HQ9S7UD1", whole: false, held: .reading)
    #expect(reader != nil)
    feed.attach(nil, home: nil)
    #expect(feed.doorTurn == turn + 1)
    let none = feed.reader(spark: "sp-7k2m9q4x", device: "dev-01HQ9S7UD1", whole: false, held: .reading)
    #expect(none == nil)
    await #expect(throws: FieldProductError.self) { _ = try await feed.say(params) }
  }
}
