import FieldDesign
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// IOS-12d (PC-D4 A, PC-L2, PC-L3, PC-L4; VF-PM's rulings on its Q1–Q10, 2026-11-06 19:12Z) — what waits on you, on the
/// phone: the Needs you group and a thread's card, read from the home's merged queue and from what this phone answers,
/// and an answer through the home (`needs.answer`, by the act's place, carried to the item's desktop). The card's
/// words are the Mac's, held by NeedsCardGoldenTests; these rows hold the phone's own part: which cards stand, in
/// which order, what an answer does to them, where an agent's ask goes, and what is said when a desktop is away or an
/// answer comes back off screen.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("IOS-12d — what waits on you: the group, the thread's card, an answer through the home")
@MainActor
struct ChatNeedsTests {
  static let home = "dev-01HQ9S7UD1"
  static let vela = "sp-7k2m9q4x"
  static let question = "ny-3f9a1c0b7e2d4a61"
  static let heldSend = "ny-8c41d2e09a77b305"

  /// A door that answers the merged lists (the demo door's own copies), the home's catalog, and `needs.answer` as the
  /// row says it comes out; it records every ask.
  final class Door: ChatDoor {
    enum Outcome {
      case done(told: Bool)
      case failed(String)
      case refused(String)
      /// held until `release()`
      case held
    }

    var calls: [(method: String, params: JSONValue?)] = []
    var needs: JSONValue? = ChatFixtureDoor.fixture("needs-list.merged")
    var outcome: Outcome = .done(told: true)
    private var waiting: [CheckedContinuation<Void, Never>] = []

    final class Watch: ChatWatch {
      func cancel() {}
    }

    func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
      calls.append((method, params))
      switch method {
      case "compose.sparks.list": return ChatFixtureDoor.fixture("compose-sparks-list.merged") ?? .null
      case "needs.list": return needs ?? .null
      case "agent.catalog": return ChatFixtureDoor.fixture("agent-catalog.valid") ?? .null
      case "needs.answer": return try await answer(params)
      default: return .object([:])
      }
    }

    private func answer(_ params: JSONValue?) async throws -> JSONValue {
      let id = params?["item"]?.stringValue
      let choice = params?["choice"]?.intValue ?? 0
      let items = needs?["items"]?.arrayValue ?? []
      guard case .object(var item)? = items.first(where: { $0["id"]?.stringValue == id }) else {
        throw FieldProductError(kind: "NOT_FOUND", message: "no such item")
      }
      var answer: [String: JSONValue] = ["choice": .int(choice), "at": .string("2026-11-06T19:00:00.000Z")]
      switch outcome {
      case .held:
        await withCheckedContinuation { waiting.append($0) }
        answer["outcome"] = .string("done")
        answer["told"] = .bool(true)
      case .refused(let words):
        throw FieldProductError(kind: "PRECONDITION_FAILED", message: words)
      case .failed(let reason):
        answer["outcome"] = .string("failed")
        answer["reason"] = .string(reason)
        answer["told"] = .bool(true)
      case .done(let told):
        answer["outcome"] = .string("done")
        answer["told"] = .bool(told)
      }
      item["state"] = .string("answered")
      item["answer"] = .object(answer)
      return .object(["item": .object(item)])
    }

    func release() {
      for each in waiting { each.resume() }
      waiting = []
    }

    func watch(
      _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> any ChatWatch {
      Watch()
    }

    func count(_ method: String) -> Int { calls.filter { $0.method == method }.count }

    func reader(spark: String, device: String?, whole: Bool, held: SparkTranscriptReading) -> any ChatThreadReader {
      ChatThreadTests.Reader(held)
    }

    /// The merged queue without `id`: fieldd dropped it once the answer was recorded.
    func drop(_ id: String) {
      guard case .object(var fields)? = needs, let items = fields["items"]?.arrayValue else { return }
      fields["items"] = .array(items.filter { $0["id"]?.stringValue != id })
      needs = .object(fields)
    }

    /// The merged queue with one of the contracts' own items of Vela's, on the home.
    func add(_ name: String) {
      guard case .object(var fields)? = needs, var items = fields["items"]?.arrayValue,
        case .object(var item)? = ChatFixtureDoor.fixture(name)
      else { return }
      item["device"] = .string(ChatNeedsTests.home)
      items.append(.object(item))
      fields["items"] = .array(items)
      needs = .object(fields)
    }
  }

  /// A pause the row opens: a said or refused card holds until it does.
  @MainActor
  final class Gate {
    private var waiting: [CheckedContinuation<Void, Never>] = []
    func wait() async { await withCheckedContinuation { waiting.append($0) } }
    func open() {
      for each in waiting { each.resume() }
      waiting = []
    }
  }

  /// Until `done` holds, or two seconds.
  func settle(_ done: () -> Bool) async {
    for _ in 0..<200 where !done() {
      try? await Task.sleep(for: .milliseconds(10))
    }
  }

  /// A feed on `door`, its queue heard.
  func makeFeed(_ door: Door, gate: Gate? = nil) async -> ChatFeed {
    let feed = ChatFeed()
    if let gate { feed.pause = { _ in await gate.wait() } }
    feed.attach(door, home: Self.home)
    await settle { feed.reading.needsHeard && feed.reading.heard }
    return feed
  }

  func item(_ feed: ChatFeed, _ id: String) throws -> NeedsItem {
    try #require(feed.reading.items.first { $0.id == id })
  }

  // MARK: - An answer

  @Test("an act is ONE needs.answer through the home, by its place, carried to the item's desktop")
  func answer() async throws {
    let door = Door()
    let gate = Gate()
    let feed = await makeFeed(door, gate: gate)
    let asked = try item(feed, Self.question)
    feed.press(asked, choice: 1, spark: Self.vela, names: NeedsCards.names(of: asked))
    let busy = feed.answering[Self.question]?.act
    #expect(busy == .busy(choice: 1))
    await settle { door.count("needs.answer") == 1 && feed.answering[Self.question]?.act == .said(choice: 1) }
    let sent = door.calls.first { $0.method == "needs.answer" }?.params
    let want = NeedsAnswerParams(item: Self.question, choice: 1, device: Self.home).json
    #expect(sent == want)
    let said = feed.answering[Self.question]
    #expect(said?.act == .said(choice: 1) && said?.holds == true)
    let answered = said?.item.answer?.choice
    #expect(answered == 1)
    // the record says what the act did: the queue is asked again. That ask is a task of its own, begun as the answer
    // returns, so the door counts it after `said` may already stand: wait for it (a9's kit at 81be8567f read 1 here)
    await settle { door.count("needs.list") >= 2 }
    #expect(door.count("needs.list") >= 2)
    gate.open()
  }

  @Test("one answer at a time to an item; a refused one may be answered again while its item still waits")
  func oneAtATime() async throws {
    let door = Door()
    door.outcome = .held
    let gate = Gate()
    let feed = await makeFeed(door, gate: gate)
    let asked = try item(feed, Self.question)
    let names = NeedsCards.names(of: asked)
    feed.press(asked, choice: 0, spark: Self.vela, names: names)
    feed.press(asked, choice: 1, spark: Self.vela, names: names)
    await settle { door.count("needs.answer") == 1 }
    try? await Task.sleep(for: .milliseconds(50))
    #expect(door.count("needs.answer") == 1)
    door.release()
    await settle { feed.answering[Self.question]?.act == .said(choice: 0) }

    let refusing = Door()
    refusing.outcome = .refused("already answered: Push")
    let held = Gate()
    let again = await makeFeed(refusing, gate: held)
    let other = try item(again, Self.heldSend)
    again.press(other, choice: 0, spark: Self.vela, names: NeedsCards.names(of: other))
    await settle { again.answering[Self.heldSend]?.act == .refused(reason: "already answered: Push") }
    let refused = again.answering[Self.heldSend]?.act
    #expect(refused == .refused(reason: "already answered: Push"))
    #expect(NeedsCards.refused("already answered: Push") == "Couldn't answer: already answered: Push")
    again.press(other, choice: 0, spark: Self.vela, names: NeedsCards.names(of: other))
    await settle { refusing.count("needs.answer") == 2 }
    #expect(refusing.count("needs.answer") == 2)
    gate.open()
    held.open()
  }

  @Test("said holds a note's time; then it leaves with its item, and stays while its item still waits")
  func holds() async throws {
    let door = Door()
    let gate = Gate()
    let feed = await makeFeed(door, gate: gate)
    let asked = try item(feed, Self.question)
    feed.press(asked, choice: 0, spark: Self.vela, names: NeedsCards.names(of: asked))
    await settle { feed.answering[Self.question]?.act == .said(choice: 0) }
    // fieldd drops the item once the answer is recorded; the card stands for its note's time all the same
    door.drop(Self.question)
    feed.refresh()
    await settle { !feed.reading.items.contains { $0.id == Self.question } }
    let standing = feed.answering[Self.question]?.holds
    #expect(standing == true)
    let cards = ChatNeeds.group(
      items: feed.reading.items, entries: [], answering: feed.answering, reduced: false)
    let ids = cards.map { $0.id }
    #expect(ids == [Self.question, Self.heldSend])
    // its note's time over: it goes, the item having left the queue
    gate.open()
    await settle { feed.answering[Self.question] == nil }
    let gone = feed.answering[Self.question]
    #expect(gone == nil)
  }

  // MARK: - The cards

  @Test("the group: every spark's item, oldest asked first; one with no spark is Field's, never Chat's (Q7)")
  func group() throws {
    let list = try NeedsList(json: try #require(ChatFixtureDoor.fixture("needs-list.merged")))
    let noSpark = try Self.ask(["spark": nil, "id": .string("ny-n0spark00000")])
    let older = try Self.ask(["id": .string("ny-01der0a5k000"), "asked": .string("2026-01-01T00:00:00.000Z")])
    let cards = ChatNeeds.group(
      items: list.items + [noSpark, older], entries: [], answering: [:], reduced: false)
    let ids = cards.map { $0.id }
    #expect(ids == ["ny-01der0a5k000", Self.question, Self.heldSend])
    // a spark the list does not hold is named by its asker, the need being real
    let first = try #require(cards.first)
    #expect(first.sparkName == "claude·2")
  }

  @Test("an item answered elsewhere leaves the group at once: only what this phone answers holds")
  func elsewhere() throws {
    let list = try NeedsList(json: try #require(ChatFixtureDoor.fixture("needs-list.merged")))
    let before = ChatNeeds.group(items: list.items, entries: [], answering: [:], reduced: false).map { $0.id }
    #expect(before == [Self.question, Self.heldSend])
    let gone = list.items.filter { $0.id != Self.question }
    let after = ChatNeeds.group(items: gone, entries: [], answering: [:], reduced: false).map { $0.id }
    #expect(after == [Self.heldSend])
  }

  @Test("the thread's card: its own run's ask first, then the oldest; one this phone answers stands while it holds")
  func thread() throws {
    let sparks = try ComposeSparksList(json: try #require(ChatFixtureDoor.fixture("compose-sparks-list.merged"))).sparks
    let list = try NeedsList(json: try #require(ChatFixtureDoor.fixture("needs-list.merged")))
    let ownFrom: JSONValue = .object(["name": .string("Claude Code"), "session": .string("run-12")])
    let ownAsk = try Self.ask(["id": .string("ny-0wn0a5k0vela"), "from": ownFrom])
    let entries = SparkEntries.entries(sparks: sparks, rows: [], items: list.items + [ownAsk])
    let vela = try #require(entries.first { $0.spark.id == Self.vela })
    let first = ChatNeeds.thread(vela, answering: [:], reduced: false)
    #expect(first?.id == "ny-0wn0a5k0vela")
    #expect(first?.own == true && first?.of == 3)
    // one it answers stands while it holds, whatever is first in the queue
    let held = ChatAnswering(
      spark: Self.vela, item: list.items[1], act: .said(choice: 0), holds: true,
      names: NeedsCards.names(of: list.items[1]))
    let answering = ChatNeeds.thread(vela, answering: [Self.heldSend: held], reduced: false)
    #expect(answering?.id == Self.heldSend && answering?.act == .said(choice: 0))
    // held no longer, and its item gone: what waits stands again
    var done = held
    done.holds = false
    let calm = SparkEntries.entries(sparks: sparks, rows: [], items: [list.items[0]])
    let velaCalm = try #require(calm.first { $0.spark.id == Self.vela })
    let next = ChatNeeds.thread(velaCalm, answering: [Self.heldSend: done], reduced: false)
    #expect(next?.id == Self.question)
  }

  @Test("Answer in its pane finds the asking run on the board, or nothing (Q5)")
  func pane() throws {
    let feed = ChatFeed()
    let row = try ChatFeedTests.row(spark: nil)
    feed.board([row])
    let found = feed.run(row.runtimeRunId)?.runtimeRunId
    #expect(found == row.runtimeRunId)
    let none = feed.run("run-not-on-the-board")
    #expect(none == nil)
    #expect(ChatNeedsWords.answerInPane == "Answer in its pane")
    #expect(ChatNeedsWords.paneMissing == "Couldn't open its pane: it isn't on your field")
  }

  @Test("Answer in its pane opens only a run the field has a pane for: one on the board without one says so (Q5)")
  func paneOpens() throws {
    let feed = ChatFeed()
    let row = try ChatFeedTests.row(spark: nil)
    feed.board([row])
    let from: JSONValue = .object(["name": .string("claude·2"), "session": .string(row.runtimeRunId)])
    let asks = try Self.ask(["from": from])
    let opened = feed.pane(of: asks, opens: { $0 == row.runtimeRunId })?.runtimeRunId
    #expect(opened == row.runtimeRunId)
    // on the board, with no session card on the field (Found 5): nothing opens, so the card says it cannot
    let noPane = feed.pane(of: asks, opens: { _ in false })
    #expect(noPane == nil)
    // off the board, whatever the field says
    let gone = try Self.ask(["from": .object(["name": .string("claude·2"), "session": .string("run-gone")])])
    let off = feed.pane(of: gone, opens: { _ in true })
    #expect(off == nil)
    // no session named: nothing to open
    let none = try Self.ask(["from": .object(["name": .string("claude·2")])])
    let unnamed = feed.pane(of: none, opens: { _ in true })
    #expect(unnamed == nil)
  }

  @Test("a card whose desktop is away says so in the fact that holds, its acts withheld (Q8)")
  func away() throws {
    let list = try NeedsList(json: try #require(ChatFixtureDoor.fixture("needs-list.merged")))
    let item = try #require(list.items.first)
    let asleep = ChatAway(device: Self.home, name: "studio", standing: .asleep, carried: true)
    let line = ChatNeeds.away(of: item, in: [asleep], connected: true)
    #expect(line?.device == Self.home)
    let answering = ChatNeeds.away(of: item, in: [], connected: true)
    #expect(answering == nil)
    // with no door the home answers for every desktop: its one line stands for every card
    let none = ChatNeeds.away(of: item, in: [asleep], connected: false)
    #expect(none?.name == "studio")
    let phone = DeviceWord.current
    #expect(ChatNeedsWords.away("studio", .asleep, device: phone) == "studio is asleep · answer when it wakes")
    #expect(ChatNeedsWords.away("studio", .silent, device: phone) == "studio isn't answering · answer when it answers")
    let build = ChatNeedsWords.away("studio", .incompatible, device: phone)
    #expect(build == "studio runs a build \(phone.this) can't read · answer when it's updated")
  }

  @Test("an answer that comes back off screen is said on the note, only when it did not go as asked (Q4)")
  func offScreen() async throws {
    let door = Door()
    door.outcome = .failed("the agent's sign-in expired")
    let feed = await makeFeed(door, gate: Gate())
    feed.show(page: false, thread: nil)
    let asked = try item(feed, Self.heldSend)
    let names = NeedsCards.names(of: asked)
    feed.press(asked, choice: 0, spark: Self.vela, names: names)
    await settle { !feed.offScreen.isEmpty }
    let said = feed.offScreen.first?.text
    #expect(said == "You said Allow · Couldn't send Vela's words to claude·2: the agent's sign-in expired")
    let card = feed.answering[Self.heldSend]
    #expect(card == nil)
    // one that went as asked says nothing there: the flow says it
    door.outcome = .done(told: true)
    let question = try item(feed, Self.question)
    feed.press(question, choice: 0, spark: Self.vela, names: NeedsCards.names(of: question))
    await settle { door.count("needs.answer") == 2 }
    try? await Task.sleep(for: .milliseconds(50))
    #expect(feed.offScreen.count == 1)
    // heard, it goes
    if let note = feed.offScreen.first { feed.heard(note) }
    #expect(feed.offScreen.isEmpty)
  }

  @Test("a card that leaves the screen takes what it said with it; an answer still running stays")
  func leaves() async throws {
    let door = Door()
    let gate = Gate()
    let feed = await makeFeed(door, gate: gate)
    let asked = try item(feed, Self.question)
    feed.press(asked, choice: 0, spark: Self.vela, names: NeedsCards.names(of: asked))
    await settle { feed.answering[Self.question]?.act == .said(choice: 0) }
    feed.show(page: true, thread: "sp-9q2wloft1")
    let gone = feed.answering[Self.question]
    #expect(gone == nil)
    // one still running stays, to stand again or to be said on the note
    door.outcome = .held
    let other = try item(feed, Self.heldSend)
    feed.press(other, choice: 0, spark: Self.vela, names: NeedsCards.names(of: other))
    feed.show(page: true, thread: nil)
    let running = feed.answering[Self.heldSend]?.act
    #expect(running == .busy(choice: 0))
    door.release()
    gate.open()
  }

  @Test("the catalog's labels are the home's, asked once per door when a card first names an agent (Q1)")
  func labels() async throws {
    let door = Door()
    let feed = await makeFeed(door)
    #expect(door.count("agent.catalog") == 0)
    door.add("needs-item.held-spawn")
    feed.refresh()
    await settle { feed.label("claude") != nil }
    #expect(feed.label("claude") == "Claude Code")
    feed.refresh()
    await settle { door.count("needs.list") >= 3 }
    #expect(door.count("agent.catalog") == 1)
  }

  // MARK: - Helpers

  /// The contracts' agent's ask of Vela's with `fields` set (nil: removed), read as the phone reads an item.
  static func ask(_ fields: [String: JSONValue?]) throws -> NeedsItem {
    guard case .object(var json)? = ChatFixtureDoor.fixture("needs-item.agent-ask") else {
      throw HomeFixture.MissingFixture(name: "needs-item.agent-ask")
    }
    for (key, value) in fields { json[key] = value }
    return try NeedsItem(json: .object(json))
  }
}
