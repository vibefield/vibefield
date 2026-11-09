import FieldDesign
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// IOS-12c (PC-D2, PC-L1, PC-L2, PC-L4, PC-L5; DESIGN.md §8 "The phone's Chat" → the thread; §9 "Chat on the phone") —
/// the thread on the phone. It reads its spark's record through the home (one reader per open thread), draws the
/// Mac's own fold, and sends your words as the Mac's Send does: the bubble at the press, a sleeping spark woken first,
/// and a lost answer asked once more by the same request id. While its desktop is away nothing is sent behind you.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("The thread reads its spark through the home, and your words go as yours")
@MainActor
struct ChatThreadTests {
  static let vela = "sp-7k2m9q4x"
  static let kiwi = "sp-9q2wloft1"
  static let studio = "dev-01HQ9S7UD1"
  static let loft = "dev-01HQ9S7XZ2"

  /// A scripted reader: its reading is the test's, and every ask is counted.
  final class Reader: ChatThreadReader {
    var reading: SparkTranscriptReading
    var started = 0
    var whole = 0
    var reconnects = 0
    var cancelled = 0
    init(_ reading: SparkTranscriptReading) { self.reading = reading }
    func start() { started += 1 }
    func readWhole() { whole += 1 }
    func reconnected() { reconnects += 1 }
    func cancel() { cancelled += 1 }
  }

  /// The home's door, scripted: the merged lists, the wake, the say's answers in turn, and the readers it made.
  final class Door: ChatDoor {
    var calls: [(method: String, params: JSONValue?)] = []
    var readers: [(spark: String, device: String?, whole: Bool, reader: Reader)] = []
    /// each say's answer in turn: its receipt's state, or the refusal thrown; "queued" once they run out
    var says: [Result<String, FieldProductError>] = []
    var wakeRefusal: FieldProductError?
    /// runs at each say, before it answers: what stands then
    var atSay: (() -> Void)?

    func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
      calls.append((method, params))
      switch method {
      case "compose.sparks.list": return ChatFixtureDoor.fixture("compose-sparks-list.merged") ?? .null
      case "needs.list": return ChatFixtureDoor.fixture("needs-list.merged") ?? .null
      case "compose.sparks.open":
        if let wakeRefusal { throw wakeRefusal }
        return .object(["spark": .object([:])])
      case SparkSay.method:
        atSay?()
        let next: Result<String, FieldProductError> = says.isEmpty ? .success("queued") : says.removeFirst()
        switch next {
        case .failure(let refusal): throw refusal
        case .success(let state):
          return .object([
            "spark": params?["spark"] ?? .null, "requestId": params?["requestId"] ?? .null,
            "state": .string(state), "queued": .bool(true),
          ])
        }
      case "agents.profileSets.list": return ChatFixtureDoor.fixture("agents-profile-sets.meters") ?? .null
      case "agent.models": return ChatFixtureDoor.fixture("agent-models.valid") ?? .null
      default:
        return .null
      }
    }

    func watch(
      _ method: String, params: JSONValue?, onFrame: @escaping @MainActor (JSONValue) -> Void
    ) async throws -> any ChatWatch {
      ChatFeedTests.Door.Watch()
    }

    func reader(spark: String, device: String?, whole: Bool, held: SparkTranscriptReading) -> any ChatThreadReader {
      let reader = Reader(held)
      readers.append((spark, device, whole, reader))
      return reader
    }

    func count(_ method: String) -> Int { calls.filter { $0.method == method }.count }
  }

  /// A feed on the scripted door, heard once, and its entries over `rows` (Vela's own run on studio by default).
  func heard(_ door: Door) async -> ChatFeed {
    let feed = ChatFeed()
    feed.attach(door, home: Self.studio)
    for _ in 0..<200 where !(feed.reading.heard && feed.reading.needsHeard) {
      try? await Task.sleep(for: .milliseconds(10))
    }
    return feed
  }

  func entries(_ feed: ChatFeed, rows: [AgentRemoteRow]? = nil) throws -> [SparkEntry] {
    let board = try rows ?? [ChatFeedTests.row(spark: Self.vela)]
    return SparkEntries.entries(sparks: feed.reading.sparks, rows: board, items: feed.reading.items)
  }

  func entry(_ spark: String, in entries: [SparkEntry]) throws -> SparkEntry {
    try #require(entries.first { $0.spark.id == spark })
  }

  /// One run and its lines, read as the reader reads them.
  static func reading(you requestId: String?) -> SparkTranscriptReading {
    let run = SparkTranscriptRun(runtimeRunId: "run-sp-7k2m9q4x", startedAt: "2026-11-06T09:00:00.000Z", fresh: true)
    var you: [String: JSONValue] = [
      "v": .int(1), "seq": .int(2), "mac": .string(String(repeating: "5b2e", count: 16)), "kind": .string("you"),
      "at": .string("2026-11-06T09:01:00.000Z"), "via": .string("chat"), "text": .string("Look at the composer test"),
      "state": .string("delivered"),
    ]
    if let requestId { you["requestId"] = .string(requestId) }
    return SparkTranscriptReading.of(runs: [run], raw: [run.runtimeRunId: [.object(you)]])
  }

  static let lost = FieldProductError(kind: "UNAVAILABLE", message: "the socket closed", retryable: true)

  // MARK: - The ledger

  @Test("PC-L5: opening a thread reads it, so its dots clear; one left while it needs you keeps its orange")
  func ledger() async throws {
    let door = Door()
    let feed = await heard(door)
    let asks = try entries(feed)
    let velaAsks = try entry(Self.vela, in: asks)
    #expect(velaAsks.needsYou)
    var ledger = ThreadLedger()
    ledger.read(asks)
    // the need ends while the thread is not on screen: its orange stays
    let answered = SparkEntries.entries(
      sparks: feed.reading.sparks, rows: [try ChatFeedTests.row(spark: Self.vela)], items: [])
    ledger.read(answered)
    let velaAnswered = try entry(Self.vela, in: answered)
    #expect(ledger.mark(of: velaAnswered) == .needs)
    // open on another page: not on screen, nothing clears
    ledger.show(ChatThreads.onScreen(tab: .field, thread: Self.vela), answered)
    #expect(ledger.mark(of: velaAnswered) == .needs)
    // open on Chat: read
    let shown = ChatThreads.onScreen(tab: .chat, thread: Self.vela)
    #expect(shown == Self.vela)
    ledger.show(shown, answered)
    #expect(ledger.mark(of: velaAnswered) == nil)
    // shown while it needs you, then left: the orange is latched again
    ledger.show(shown, asks)
    ledger.show(ChatThreads.onScreen(tab: .chat, thread: nil), asks)
    ledger.read(answered)
    #expect(ledger.mark(of: velaAnswered) == .needs)
  }

  // MARK: - The reader

  @Test("one reader per open thread, asked of the home with the spark's desktop, closed when the thread leaves")
  func oneReader() async throws {
    let door = Door()
    let feed = await heard(door)
    let thread = ChatThread(spark: Self.vela, feed: feed)
    thread.open(device: Self.studio)
    thread.open(device: Self.studio)
    #expect(door.readers.count == 1)
    let first = try #require(door.readers.first)
    #expect(first.spark == Self.vela)
    #expect(first.device == Self.studio)
    #expect(!first.whole)
    #expect(first.reader.started == 1)
    // the record moves, then the thread leaves: the reader closes, and its reading is held for the next open
    first.reader.reading = Self.reading(you: nil)
    thread.close()
    #expect(first.reader.cancelled == 1)
    #expect(thread.reader == nil)
    thread.open(device: Self.studio)
    #expect(door.readers.count == 2)
    let second = try #require(door.readers.last)
    #expect(second.reader.reading == Self.reading(you: nil))
  }

  @Test("with no door nothing is read, and a door handed over reads again with the reading held")
  func noDoor() async throws {
    let door = Door()
    let feed = await heard(door)
    let thread = ChatThread(spark: Self.vela, feed: feed)
    thread.open(device: Self.studio)
    let first = try #require(door.readers.first)
    first.reader.reading = Self.reading(you: nil)
    feed.attach(nil, home: nil)
    thread.redial(device: Self.studio)
    #expect(first.reader.cancelled == 1)
    #expect(thread.reader == nil)
    #expect(thread.reading == Self.reading(you: nil))
    feed.attach(door, home: Self.studio)
    thread.redial(device: Self.studio)
    #expect(door.readers.count == 2)
    let again = try #require(door.readers.last)
    #expect(again.reader.reading == Self.reading(you: nil))
  }

  @Test("Earlier conversations asks every run once, and the flow opens them")
  func earlier() async throws {
    let door = Door()
    let feed = await heard(door)
    let thread = ChatThread(spark: Self.vela, feed: feed)
    thread.open(device: Self.studio)
    thread.showEarlier()
    thread.showEarlier()
    let reader = try #require(door.readers.first?.reader)
    #expect(reader.whole == 1)
    #expect(thread.earlier)
  }

  @Test("the flow says its reading: Reading… first, then fieldd's refusal in its words with the desktop it names")
  func readingStates() async throws {
    let door = Door()
    let feed = await heard(door)
    let vela = try entry(Self.vela, in: entries(feed))
    let thread = ChatThread(spark: Self.vela, feed: feed)
    thread.open(device: Self.studio)
    #expect(thread.flow(vela, now: 0) == .reading)
    #expect(ChatFlowWords.reading("Vela") == "Reading Vela's conversation…")
    let reader = try #require(door.readers.first?.reader)
    reader.reading = .unreadable(reason: "loft has not published its doors", device: Self.loft)
    #expect(thread.flow(vela, now: 0) == .unreadable(reason: "loft has not published its doors", device: Self.loft))
  }

  // MARK: - Send

  @Test("a press stands its bubble at once with no receipt, then ONE say to the spark's desktop, by a fresh id")
  func press() async throws {
    let door = Door()
    let feed = await heard(door)
    let vela = try entry(Self.vela, in: entries(feed))
    #expect(vela.awake)
    let thread = ChatThread(spark: Self.vela, feed: feed, requestId: { "say-test-00000001" })
    var standing: [ChatPendingSay] = []
    door.atSay = { standing = feed.sends.of(Self.vela) }
    thread.draft = "Look at the composer test"
    let outcome = await thread.send(vela, away: nil)
    let says = door.calls.filter { $0.method == SparkSay.method }
    #expect(says.count == 1)
    let params = says.first?.params
    #expect(
      params
        == .object([
          "spark": .string(Self.vela), "text": .string("Look at the composer test"),
          "requestId": .string("say-test-00000001"), "device": .string(Self.studio),
        ]))
    // at the say, the bubble already stood, with no receipt
    let stoodIds = standing.map { $0.requestId }
    #expect(stoodIds == ["say-test-00000001"])
    #expect(standing.first?.state == nil)
    // answered: the receipt is the say's, the sent words leave the draft, and the note says nothing
    guard case .queued(let receipt)? = outcome else {
      Issue.record("the send was not queued: \(String(describing: outcome))")
      return
    }
    #expect(receipt.state == "queued")
    let after = feed.sends.of(Self.vela).map { $0.state }
    #expect(after == ["queued"])
    #expect(thread.draft == "")
    #expect(thread.sendNote == nil)
    #expect(!thread.busy)
  }

  @Test("a lost answer is asked once more by the SAME id; the record's line with that id lets the bubble go")
  func lostAnswer() async throws {
    let door = Door()
    door.says = [.failure(Self.lost), .success("delivered")]
    let feed = await heard(door)
    let vela = try entry(Self.vela, in: entries(feed))
    let thread = ChatThread(spark: Self.vela, feed: feed, requestId: { "say-test-00000002" })
    thread.open(device: Self.studio)
    thread.draft = "Look at the composer test"
    let outcome = await thread.send(vela, away: nil)
    let ids = door.calls.filter { $0.method == SparkSay.method }.map { $0.params?["requestId"]?.stringValue }
    #expect(ids == ["say-test-00000002", "say-test-00000002"])
    guard case .queued? = outcome else {
      Issue.record("the send was not queued: \(String(describing: outcome))")
      return
    }
    #expect(feed.sends.of(Self.vela).count == 1)
    let reader = try #require(door.readers.first?.reader)
    reader.reading = Self.reading(you: "say-test-00000002")
    thread.settleRecord()
    #expect(feed.sends.of(Self.vela).isEmpty)
  }

  @Test("a refusal that is not the connection's is said once in fieldd's words: no bubble, the draft as typed")
  func refused() async throws {
    let door = Door()
    door.says = [.failure(FieldProductError(kind: "NOT_FOUND", message: "Vela's session ended"))]
    let feed = await heard(door)
    let vela = try entry(Self.vela, in: entries(feed))
    let thread = ChatThread(spark: Self.vela, feed: feed, requestId: { "say-test-00000003" })
    thread.draft = "Look at the composer test"
    let outcome = await thread.send(vela, away: nil)
    #expect(door.count(SparkSay.method) == 1)
    #expect(outcome == .failed("Vela's session ended"))
    #expect(feed.sends.of(Self.vela).isEmpty)
    #expect(thread.draft == "Look at the composer test")
    #expect(thread.sendNote == "Couldn't send to Vela: Vela's session ended")
  }

  @Test("longer than the door takes is never sent; words typed while a send ran stay in the draft")
  func bounds() async throws {
    var stood = false
    let deps = ChatSend.Deps(
      needsWake: false, wake: {}, say: { _, _ in throw Self.lost }, sending: { _ in stood = true })
    let long = String(repeating: "a", count: SparkSay.wordsMax + 1)
    let outcome = await ChatSend.send(deps, text: long, requestId: "say-test-00000004")
    #expect(outcome == .tooLarge)
    #expect(!stood)
    #expect(ChatThreadWords.sendNote(.tooLarge, name: "Vela") == "Not sent — a message holds 32,000 characters at most")
    // re-read at IOS-12f's M-f2 (the 02:24:16Z ruling): the draft is parts now, and what stays has its leading space
    // trimmed, as the Mac's `draftAfterSend` has always had it
    let sent: [ChatDraftPart] = [.text("Look")]
    #expect(ChatDraft.after(sent: sent, now: [ChatDraftPart.text("Look again")]) == [ChatDraftPart.text("again")])
    #expect(ChatDraft.after(sent: sent, now: [ChatDraftPart.text("Look")]).isEmpty)
    #expect(ChatDraft.after(sent: sent, now: [ChatDraftPart.text("Lo0k")]) == [ChatDraftPart.text("Lo0k")])
  }

  @Test("Q7: while its desktop is away nothing is said; the draft waits under its line, and goes as typed after")
  func away() async throws {
    let door = Door()
    let feed = await heard(door)
    let vela = try entry(Self.vela, in: entries(feed))
    let thread = ChatThread(spark: Self.vela, feed: feed, requestId: { "say-test-00000005" })
    thread.draft = "Look at the composer test"
    for standing in [ChatAway.Standing.asleep, .silent, .incompatible] {
      let away = ChatAway(device: Self.studio, name: "studio", standing: standing, carried: true)
      let outcome = await thread.send(vela, away: away)
      #expect(outcome == nil)
    }
    #expect(door.count(SparkSay.method) == 0)
    #expect(thread.draft == "Look at the composer test")
    #expect(feed.sends.of(Self.vela).isEmpty)
    #expect(ChatThreadWords.draftWaits("studio", .asleep) == "Waits here until studio wakes")
    #expect(ChatThreadWords.draftWaits("studio", .silent) == "Waits here until studio answers")
    #expect(ChatThreadWords.draftWaits("studio", .incompatible) == "Waits here until studio is updated")
    // the desktop answers: Send returns, with the draft as typed
    _ = await thread.send(vela, away: nil)
    let text = door.calls.first { $0.method == SparkSay.method }?.params?["text"]?.stringValue
    #expect(text == "Look at the composer test")
  }

  @Test("the thread's away line is its spark's desktop's, or with no door the home's, which stands for every one")
  func awayLine() async throws {
    let door = Door()
    let feed = await heard(door)
    let kiwi = try #require(feed.reading.sparks.first { $0.id == Self.kiwi })
    let loftAsleep = ChatAway(device: Self.loft, name: "loft", standing: .asleep, carried: true)
    let miniAsleep = ChatAway(device: "dev-01HQ9S7Y44", name: "mini", standing: .asleep, carried: false)
    #expect(ChatThreads.away(of: kiwi, in: [miniAsleep, loftAsleep], connected: true) == loftAsleep)
    #expect(ChatThreads.away(of: kiwi, in: [miniAsleep], connected: true) == nil)
    let home = ChatAway(device: Self.studio, name: "studio", standing: .silent, carried: true)
    #expect(ChatThreads.away(of: kiwi, in: [home], connected: false) == home)
  }

  @Test("asleep, a send wakes it first and its bubble says Waking ‹name›…; a refused wake says so and sends nothing")
  func asleep() async throws {
    let door = Door()
    let feed = await heard(door)
    let kiwi = try entry(Self.kiwi, in: entries(feed))
    #expect(!kiwi.awake)
    let thread = ChatThread(spark: Self.kiwi, feed: feed, requestId: { "say-test-00000006" })
    var standing: [ChatPendingSay] = []
    door.atSay = { standing = feed.sends.of(Self.kiwi) }
    let before = door.calls.count
    thread.draft = "Pick up where you left off"
    _ = await thread.send(kiwi, away: nil)
    let acts = door.calls.dropFirst(before).map { $0.method }
      .filter { $0 != "compose.sparks.list" && $0 != "needs.list" }
    #expect(acts == ["compose.sparks.open", SparkSay.method])
    #expect(standing.first?.state == "waking")
    let waking = ChatFlows.receipt("waking", ChatFlowSpark(entry: kiwi), last: true)
    #expect(waking?.words == "Waking Kiwi…")
    // refused: said in fieldd's words, nothing said to it, no bubble left
    door.wakeRefusal = FieldProductError(kind: "UNAVAILABLE", message: "loft is asleep")
    let says = door.count(SparkSay.method)
    thread.draft = "Again"
    let refused = await thread.send(kiwi, away: nil)
    #expect(refused == .wakeRefused("loft is asleep"))
    #expect(door.count(SparkSay.method) == says)
    #expect(thread.sendNote == "Couldn't wake Kiwi: loft is asleep")
    #expect(thread.draft == "Again")
  }

  // MARK: - The head and ⋯

  @Test("the head offers Wake while it sleeps; Wake refused is said in the status's place until the next act")
  func headWake() async throws {
    let door = Door()
    let feed = await heard(door)
    let all = try entries(feed)
    let vela = try entry(Self.vela, in: all)
    let kiwi = try entry(Self.kiwi, in: all)
    #expect(ChatThreadActs.head(vela) == nil)
    #expect(ChatThreadActs.head(kiwi) == .wake)
    let thread = ChatThread(spark: Self.kiwi, feed: feed)
    door.wakeRefusal = FieldProductError(kind: "UNAVAILABLE", message: "loft is asleep")
    await thread.wake(kiwi.spark)
    #expect(thread.headNote == "Couldn't wake Kiwi: loft is asleep")
    #expect(!thread.waking)
    #expect(!thread.busy)
    door.wakeRefusal = nil
    await thread.wake(kiwi.spark)
    #expect(thread.headNote == nil)
  }

  @Test("⋯ offers Open its pane only while its own run is live on the board, then Wake while it sleeps")
  func menu() async throws {
    let door = Door()
    let feed = await heard(door)
    let live = try entries(feed)
    let velaLive = try entry(Self.vela, in: live)
    let kiwiAsleep = try entry(Self.kiwi, in: live)
    #expect(ChatThreadActs.menu(velaLive) == [.openPane])
    #expect(ChatThreadActs.menu(kiwiAsleep) == [.wake])
    let ended = try entries(feed, rows: [ChatFeedTests.row(spark: Self.vela, alive: false)])
    let velaEnded = try entry(Self.vela, in: ended)
    #expect(ChatThreadActs.menu(velaEnded) == [.wake])
    #expect(ChatThreadWords.openPane == "Open its pane")
  }

  // MARK: - The page

  @Test("scrolled up, rows that land raise the arrival pill by their count; at the foot, or redrawn, nothing is new")
  func arrival() {
    func act(_ key: String) -> ChatFlowItem { .act(key: key, what: "wake", words: key, lead: false, crew: nil) }
    var arrival = ChatArrival()
    arrival.read([act("a")], atFoot: true)
    arrival.read([act("a"), act("b"), act("c")], atFoot: false)
    #expect(arrival.count == 2)
    arrival.read([act("a"), act("b"), act("c")], atFoot: false)
    #expect(arrival.count == 2)
    arrival.read([act("a"), act("b"), act("c"), act("d")], atFoot: false)
    #expect(arrival.count == 3)
    arrival.read([act("a"), act("b"), act("c"), act("d")], atFoot: true)
    #expect(arrival.count == 0)
    #expect(ChatThreadWords.arrival(3) == "3 new ↓")
  }

  @Test("a key the fold repeats is its own row on the page: the first keeps the key, each repeat its count after it")
  func drawnRows() {
    // two runs of one conversation each number their lines from 1, so the fold can key two rows alike (the at-rest
    // golden repeats three): rows sharing one identity are drawn one in the other's place, the other left blank
    func act(_ key: String, _ words: String) -> ChatFlowItem {
      .act(key: key, what: "wake", words: words, lead: false, crew: nil)
    }
    let items = [act("day:a", "one"), act("you:a:2", "two"), act("day:a", "three"), act("you:a:2", "four")]
    let rows = ChatThreads.drawn(items)
    let ids = rows.map { $0.id }
    #expect(ids == ["day:a", "you:a:2", "day:a#1", "you:a:2#1"])
    let drawnItems = rows.map { $0.item }
    #expect(drawnItems == items)
  }

  @Test("a bubble says its words, then its receipt")
  func bubbleLabel() {
    #expect(ChatThreadWords.bubble("Look at it", receipt: ChatReceipt("Delivered")) == "Look at it, Delivered")
    #expect(ChatThreadWords.bubble("Look at it", receipt: nil) == "Look at it")
  }

  // MARK: - IOS-12f's M-f2: the draft and @

  static let sessionChip = ChatDraftChip.session(
    ChatSessionChip(
      id: "session:run-1", session: "run-1", agent: "agent-a", label: "Agent A", handle: "vibe-field",
      project: "vibe-field"))

  @Test("M-f2: a send carries its chips as spans of its words, the bubble holds them, and they leave the draft")
  func sendCarriesChips() async throws {
    let door = Door()
    let feed = await heard(door)
    let vela = try entry(Self.vela, in: entries(feed))
    let thread = ChatThread(spark: Self.vela, feed: feed, requestId: { "say-test-00000001" })
    var standing: [ChatPendingSay] = []
    door.atSay = { standing = feed.sends.of(Self.vela) }
    thread.parts = [.text("Ask "), .chip(Self.sessionChip), .text(" what changed")]
    let message = ChatDraft.message(thread.parts)
    let outcome = await thread.send(vela, away: nil)
    guard case .queued(_)? = outcome else {
      Issue.record("the send was not queued: \(String(describing: outcome))")
      return
    }
    let params = door.calls.first { $0.method == SparkSay.method }?.params
    let text = params?["text"]?.stringValue
    #expect(text == message.text)
    let spans = params?["chips"]?.arrayValue ?? []
    #expect(spans.count == 1)
    let stood = standing.first?.chips
    #expect(stood == message.chips)
    #expect(thread.parts.isEmpty)
  }

  @Test("M-f2 Q2: @ opens for a spark on the home, and on another desktop it types as an @")
  func atOnTheHomeAlone() async throws {
    let door = Door()
    let feed = await heard(door)
    let listed = try entries(feed)
    let vela = try entry(Self.vela, in: listed)
    let kiwi = try entry(Self.kiwi, in: listed)
    let thread = ChatThread(spark: Self.vela, feed: feed)
    thread.draft = "ask @co"
    thread.caret = 7
    let here = thread.atPlace(of: vela.spark)
    #expect(here == ChatAtPlace(index: 0, at: 4, query: "co", offset: 4))
    let there = thread.atPlace(of: kiwi.spark)
    #expect(there == nil)
    thread.caret = 2
    let off = thread.atPlace(of: vela.spark)
    #expect(off == nil)
  }

  @Test("M-f2: a session taken stands where the @ was, the caret past it and its space")
  func takeSession() async throws {
    let door = Door()
    let feed = await heard(door)
    let vela = try entry(Self.vela, in: entries(feed))
    let thread = ChatThread(spark: Self.vela, feed: feed)
    thread.draft = "ask @ve now"
    thread.caret = 7
    let place = try #require(thread.atPlace(of: vela.spark))
    let row = ChatAtSessionRow(
      id: "session:run-1", session: "run-1", agent: "agent-a", label: "Agent A", handle: "vibe-field",
      project: "vibe-field", word: .working)
    thread.take(row, at: place)
    #expect(thread.parts == [ChatDraftPart.text("ask "), .chip(Self.sessionChip), .text(" now")])
    #expect(thread.caret == 6)
    let after = thread.atPlace(of: vela.spark)
    #expect(after == nil)
  }

  @Test("M-f2: a tap outside folds the list and keeps the words, until the caret stands on another @")
  func foldHolds() async throws {
    let door = Door()
    let feed = await heard(door)
    let vela = try entry(Self.vela, in: entries(feed))
    let thread = ChatThread(spark: Self.vela, feed: feed)
    thread.draft = "@"
    thread.caret = 1
    thread.foldAt()
    thread.atMoved()
    let folded = thread.atPlace(of: vela.spark)
    #expect(folded == nil)
    #expect(thread.draft == "@")
    thread.draft = "x @"
    thread.caret = 3
    thread.atMoved()
    let open = thread.atPlace(of: vela.spark)
    #expect(open == ChatAtPlace(index: 0, at: 2, query: "", offset: 2))
  }

  @Test("M-f2 Q4: an agent taken opens its menu, a model chosen is its chip's, and the chip gone folds the menu")
  func agentMenu() async throws {
    let door = Door()
    let feed = await heard(door)
    let vela = try entry(Self.vela, in: entries(feed))
    let thread = ChatThread(spark: Self.vela, feed: feed)
    thread.draft = "@"
    thread.caret = 1
    let place = try #require(thread.atPlace(of: vela.spark))
    let row = ChatAtAgentRow(
      id: "agent:agent-a:native", agent: "agent-a", label: "Agent A",
      profile: ChatAtProfile(id: "native", name: "This Mac"), pill: "This Mac")
    await thread.take(row, at: place)
    let menu = try #require(thread.menu)
    #expect(menu.offset == 0)
    var modelId: String?
    for each in thread.menuRows(menu) {
      if case .model(let id?, _, _) = each {
        modelId = id
        break
      }
    }
    let id = try #require(modelId)
    thread.chooseModel(id)
    let chosen = try #require(thread.menu)
    let selected = chosen.chip.model?.selection?.modelId
    #expect(selected == id)
    let first = thread.parts.first
    #expect(first == ChatDraftPart.chip(.agent(chosen.chip)))
    thread.partsMoved()
    #expect(thread.menu == chosen)
    thread.parts = []
    thread.partsMoved()
    #expect(thread.menu == nil)
  }

  @Test("M-f2 Q3: @ reads the runs of the spark's own desktop, and says it is reading until the board is live")
  func atBoard() async throws {
    let door = Door()
    let feed = await heard(door)
    let vela = try entry(Self.vela, in: entries(feed))
    guard case .reading = feed.atBoard(of: vela.spark) else {
      Issue.record("the board was read before it was live")
      return
    }
    let row = try ChatFeedTests.row(spark: nil)
    feed.board([row], live: true)
    guard case .read(let runs) = feed.atBoard(of: vela.spark) else {
      Issue.record("the live board was not read")
      return
    }
    #expect(runs.count == (row.device == vela.spark.device ? 1 : 0))
  }
}
