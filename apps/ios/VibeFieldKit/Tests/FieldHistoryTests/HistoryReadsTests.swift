import FieldDesign
import FieldProduct
import Foundation
import Testing

@testable import FieldHistory

// SP-6 — the reader over a scripted door: a session's document from its page,
// the tail's frames move it and count the arrivals, a door that stops
// answering dims what was read and the cache replays it for a reader with no
// door at all. PJ-7 — the LEDGER is `HistoryProjects`' (HistoryProjectsTests):
// a desktop's reader asks only its standing, its documents and its search.

/// A door made of the goldens, with a script for the tail and a switch that
/// turns every later ask into a refusal.
@MainActor
private final class ScriptedDoor: HistoryDoor {
  var asked: [String] = []
  /// SE-P1 — what each `index.search` asked, in order
  var searched: [JSONValue] = []
  var refuse: FieldProductError?
  var tailSnapshot: JSONValue?
  var tailDeltas: [JSONValue] = []
  var deliverDelta: (@MainActor (JSONValue) -> Void)?
  var closed = false

  func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
    asked.append(method)
    if method == "index.search" { searched.append(params ?? .null) }
    if let refuse { throw refuse }
    switch method {
    case "index.status": return try Fixture.json("index-status.valid")
    case "index.projects": return try Fixture.json("index-projects.mesh")
    case "index.sessions": return try Fixture.json("index-sessions.valid")
    case "index.session": return try Fixture.json("index-session.valid")
    case "index.project": return try Fixture.json("index-project.valid")
    case "index.search": return try Fixture.json("index-search-result.valid")
    case "index.timeline":
      if params?["cursor"] != nil {
        throw FieldProductError(
          kind: "PRECONDITION_FAILED", message: "rewritten",
          details: .object(["service": .string("index"), "reason": .string("cursor-expired")]))
      }
      return try Fixture.json("index-timeline.valid")
    default: throw FieldProductError(kind: "NOT_FOUND", message: method)
    }
  }

  func tail(
    _ method: String, params: JSONValue?, shape: SubscriptionShape,
    onSnapshot: @escaping @MainActor (JSONValue) -> Void,
    onDelta: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> HistoryTailHandle {
    asked.append(method)
    if let refuse { throw refuse }
    #expect(shape.kind == .rows && shape.minIntervalMs == HistoryReads.tailIntervalMs)
    if let tailSnapshot { onSnapshot(tailSnapshot) }
    deliverDelta = onDelta
    return HistoryTailHandle { [weak self] in self?.deliverDelta = nil }
  }

  func close() { closed = true }
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

private func scratch() -> URL {
  let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("vf-history-\(UUID().uuidString)")
  try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

@Suite("the reads fill the values")
struct HistoryReadsTests {
  @Test("PJ-7 — a desktop's reader asks its standing and never the ledger")
  @MainActor
  func standingOnly() async throws {
    let door = ScriptedDoor()
    let reader = HistoryDesktopReader(deviceId: "dev-1", name: "studio", isHome: true, door: door, agentLabel: { "Agent \($0)" })
    reader.start()
    await settle("the standing") { door.asked.contains("index.status") }
    #expect(reader.standing == .connected)
    #expect(reader.corpus.desktop == "studio" && reader.corpus.deviceId == "dev-1")
    #expect(reader.corpus.projects.isEmpty)
    for method in ["index.projects", "index.sessions", "index.project", "project.list"] {
      #expect(!door.asked.contains(method), "\(method) is the ledger's, not a desktop reader's")
    }
  }

  @Test("a session: the header and the page make the document, the tail's delta moves it and counts the arrival, `seen` clears it")
  @MainActor
  func session() async throws {
    let door = ScriptedDoor()
    door.tailSnapshot = try Fixture.json("index-session-tail-open.snapshot")["snapshot"]
    let reader = HistoryDesktopReader(deviceId: "dev-1", name: "studio", door: door, agentLabel: { _ in "Claude Code" })
    reader.start()
    reader.need(.session(device: "dev-1", id: "s1"))
    await settle("the document and its tail") { reader.corpus.document("s1")?.liveSince != nil }
    let document = try #require(reader.corpus.document("s1"))
    #expect(document.turns.count == 1)
    #expect(document.agentName == "Claude Code")
    #expect(document.liveSince != nil)
    #expect(reader.arrivals["s1"] == nil)
    #expect(door.asked.contains("index.session.subscribe"))
    // a new row on the tail: an arrival; a patched row: not one
    var delta = try Fixture.json("index-session-tail-delta.valid").objectValue!
    var appended = try Fixture.json("index-timeline.valid")["entries"]!.arrayValue![2].objectValue!
    appended["timelineId"] = .string("t9")
    appended["ordinal"] = .int(99)
    appended["text"] = .string("the tail delivered this")
    delta["upserts"] = .array((delta["upserts"]?.arrayValue ?? []) + [.object(appended)])
    door.deliverDelta?(.object(delta))
    await settle("the arrival") { reader.arrivals["s1"] == 1 }
    let moved = try #require(reader.corpus.document("s1"))
    let delivered = moved.turns.first?.segments.contains { segment in
      if case .prose(let id, _, let text, _) = segment { return id == "t9" && text == "the tail delivered this" }
      return false
    }
    #expect(delivered == true)
    reader.need(.seen(device: "dev-1", session: "s1"))
    #expect(reader.arrivals["s1"] == nil)
    // the older page under a rewritten cursor: the head is read again, the document stands
    reader.need(.older(device: "dev-1", session: "s1"))
    await settle("the re-read") { door.asked.filter { $0 == "index.session" }.count == 2 }
    await settle("the document again") { reader.corpus.document("s1") != nil }
    // pause takes the tail, resume re-opens it
    reader.pause()
    #expect(door.deliverDelta == nil)
    reader.resume()
    await settle("the tail again") { door.deliverDelta != nil }
    reader.close()
    #expect(!door.closed, "a door the reader does not own is never closed by it")
  }

  @Test("search: the index's answer lands under the query, and a door that refuses dims what was read")
  @MainActor
  func searchAndRefusal() async throws {
    let door = ScriptedDoor()
    let reader = HistoryDesktopReader(deviceId: "dev-1", name: "studio", door: door, ownsDoor: true)
    reader.start()
    await settle("the standing") { door.asked.contains("index.status") }
    await reader.search("needle", kind: .prompts)
    #expect(reader.corpus.searchedQuery == "needle")
    #expect(reader.corpus.hits.count == 1)
    #expect(reader.corpus.recentSearches == ["needle"])
    #expect(FieldHistoryModel.visibleHits(query: "needle", kind: .prompts, in: reader.corpus).count == 1)
    door.refuse = FieldProductError(kind: "UNAVAILABLE", message: "the door is gone", retryable: true)
    await reader.search("other", kind: .any)
    #expect(reader.standing == .asleep)
    #expect(reader.corpus.hits.count == 1, "what was read stands")
    #expect(reader.failure == "the door is gone")
    #expect(reader.isReplaying)
    door.refuse = FieldProductError(
      kind: "INCOMPATIBLE", message: "another version", details: .object(["contractsVersion": .string("0.9.0")]))
    await reader.search("other", kind: .any)
    #expect(reader.standing == .incompatible(theirs: "0.9.0", ours: FieldProductContract.contractsVersion))
    reader.close()
    #expect(door.closed, "a door the reader owns is closed with it")
  }

  /// SE-2j (the S2 review's finding 5) — an answer is to its words AND its kind: Prompts' answer to "needle" holds
  /// prompts alone, so it never answers Everything with every kind; asking again with the kind changed asks the index
  /// again, without the kind.
  @Test("search: an answer is the words' and the kind's; another kind is unanswered until it is asked again")
  @MainActor
  func searchAnswersItsKind() async throws {
    let door = ScriptedDoor()
    let reader = HistoryDesktopReader(deviceId: "dev-1", name: "studio", door: door)
    reader.start()
    await settle("the standing") { door.asked.contains("index.status") }
    await reader.search("needle", kind: .prompts)
    let prompts = try #require(door.searched.last)
    #expect(prompts["kind"]?.stringValue == "user")
    #expect(reader.answered(kind: .prompts) == "needle")
    #expect(reader.answered(kind: .any) == nil, "prompts alone never answer every kind")
    await reader.search("needle", kind: .any)
    #expect(door.searched.count == 2)
    let everyKind = try #require(door.searched.last)
    #expect(everyKind["kind"] == nil)
    #expect(reader.answered(kind: .any) == "needle")
    #expect(reader.answered(kind: .prompts) == nil)
    reader.close()
  }

  /// SE-2j (the S2 review's finding 16) — an ask whose task was cancelled (newer words took over) lands nothing: an
  /// older answer arriving after a newer one would put the older words' lines and hits back.
  @Test("search: a cancelled ask lands nothing, in Live now or Everything")
  @MainActor
  func cancelledAskLandsNothing() async throws {
    let door = ScriptedDoor()
    let reader = HistoryDesktopReader(deviceId: "dev-1", name: "studio", door: door)
    reader.start()
    await settle("the standing") { door.asked.contains("index.status") }
    // the test runs on the main actor, so each task starts only at its `value`: cancelled before it runs
    let live = Task { await reader.searchLive("needle", nativeSessionIds: ["native-s0"]) }
    live.cancel()
    await live.value
    #expect(reader.live == nil)
    let past = Task { await reader.search("needle", kind: .any) }
    past.cancel()
    await past.value
    #expect(reader.corpus.searchedQuery == nil)
    #expect(reader.answered(kind: .any) == nil)
    reader.close()
  }

  /// SE-2j — the desktops stop asking once the ask is cancelled: no desktop is asked in a task that newer words
  /// replaced.
  @Test("search: the desktops ask nothing more once the ask is cancelled")
  @MainActor
  func desktopsStopOnceCancelled() async throws {
    let studio = ScriptedDoor()
    let loft = ScriptedDoor()
    let desktops = HistoryDesktops(cache: nil)
    desktops.attach(deviceId: "dev-1", name: "studio", isHome: true, door: studio, ownsDoor: false)
    desktops.attach(deviceId: "dev-2", name: "loft", isHome: false, door: loft, ownsDoor: false)
    await settle("both standings") { studio.asked.contains("index.status") && loft.asked.contains("index.status") }
    let live = Task { await desktops.searchLive("needle", runs: ["dev-1": ["native-s0"], "dev-2": ["native-l1"]]) }
    live.cancel()
    await live.value
    let past = Task { await desktops.search("needle", kind: .any) }
    past.cancel()
    await past.value
    #expect(studio.searched.isEmpty)
    #expect(loft.searched.isEmpty)
  }

  /// SE-P1 (SE-D4 A) — Live now's ask: the words over this desktop's live runs alone (`nativeSessionIds`), at the
  /// tailnet's page; the lines land by the run's native id, and Everything's hits, query and recent searches stand.
  @Test("live: the words are asked over the live runs, and the lines land by the run's native id")
  @MainActor
  func searchLive() async throws {
    let door = ScriptedDoor()
    let reader = HistoryDesktopReader(deviceId: "dev-1", name: "studio", door: door)
    reader.start()
    await settle("the standing") { door.asked.contains("index.status") }
    await reader.searchLive(" needle ", nativeSessionIds: ["native-s0", "native-s9"])
    let asked = try #require(door.searched.last)
    #expect(asked["q"]?.stringValue == "needle")
    let ids = (asked["nativeSessionIds"]?.arrayValue ?? []).compactMap { $0.stringValue }
    #expect(ids == ["native-s0", "native-s9"])
    #expect(asked["limit"]?.intValue == Int64(HistoryReads.listRows))
    #expect(asked["kind"] == nil, "Live now asks both sides of the conversation")
    let live = try #require(reader.live)
    #expect(live.query == "needle")
    let lines = live.lines["native-s0"] ?? []
    #expect(lines.map { $0.text } == ["needle in a haystack"])
    #expect(reader.corpus.hits.isEmpty, "Everything's hits are not Live now's")
    #expect(reader.corpus.searchedQuery == nil)
    #expect(reader.corpus.recentSearches.isEmpty)
    reader.close()
  }

  /// SE-P1 — no words, or no live run, asks nothing; an unanswered ask keeps the last lines (H-D7).
  @Test("live: nothing to ask asks nothing, and an unanswered ask keeps what was shown")
  @MainActor
  func searchLiveAsksOnlyWhatItCan() async throws {
    let door = ScriptedDoor()
    let reader = HistoryDesktopReader(deviceId: "dev-1", name: "studio", door: door)
    reader.start()
    await settle("the standing") { door.asked.contains("index.status") }
    await reader.searchLive("  ", nativeSessionIds: ["native-s0"])
    await reader.searchLive("needle", nativeSessionIds: [])
    #expect(door.searched.isEmpty)
    await reader.searchLive("needle", nativeSessionIds: ["native-s0"])
    #expect(door.searched.count == 1)
    door.refuse = FieldProductError(kind: "UNAVAILABLE", message: "the door is gone", retryable: true)
    await reader.searchLive("other", nativeSessionIds: ["native-s0"])
    let live = try #require(reader.live)
    #expect(live.query == "needle", "what was last shown stands")
    #expect(reader.standing == .asleep)
    reader.close()
  }

  /// SE-P1 — the desktops route each run's words to the desktop it runs on, skip a desktop that does not answer, and
  /// join every answer's lines for the words asked.
  @Test("live: each desktop is asked over its own runs, and the lines join across desktops")
  @MainActor
  func desktopsRouteTheLiveAsk() async throws {
    let studio = ScriptedDoor()
    let loft = ScriptedDoor()
    let desktops = HistoryDesktops(cache: nil)
    desktops.attach(deviceId: "dev-1", name: "studio", isHome: true, door: studio, ownsDoor: false)
    desktops.attach(deviceId: "dev-2", name: "loft", isHome: false, door: loft, ownsDoor: false)
    await settle("both standings") { studio.asked.contains("index.status") && loft.asked.contains("index.status") }
    await desktops.searchLive("needle", runs: ["dev-1": ["native-s0"], "dev-2": ["native-l1"], "dev-3": ["x"]])
    let toStudio = (studio.searched.last?["nativeSessionIds"]?.arrayValue ?? []).compactMap { $0.stringValue }
    let toLoft = (loft.searched.last?["nativeSessionIds"]?.arrayValue ?? []).compactMap { $0.stringValue }
    #expect(toStudio == ["native-s0"])
    #expect(toLoft == ["native-l1"])
    let lines = desktops.liveLines("needle")
    #expect(lines["native-s0"]?.count == 1)
    #expect(desktops.liveLines("other").isEmpty, "lines are the words' they answered")
  }

  @Test("the cache replays a document for a reader with no door, under the desktop's name and its read stamp")
  @MainActor
  func cacheReplay() async throws {
    let cache = HistoryCache(directory: scratch())
    let door = ScriptedDoor()
    door.tailSnapshot = try Fixture.json("index-session-tail-open.snapshot")["snapshot"]
    let online = HistoryDesktopReader(deviceId: "dev-1", name: "studio", door: door, cache: cache)
    online.start()
    online.need(.session(device: "dev-1", id: "s1"))
    await settle("the document") { online.corpus.document("s1") != nil }
    online.close()
    // airplane mode: a reader over no door
    let offline = HistoryDesktopReader(deviceId: "dev-1", name: "mini", door: nil, cache: cache)
    offline.start()
    #expect(offline.standing == .asleep)
    #expect(offline.corpus.desktop == "mini")
    #expect(offline.corpus.readAt.count == 5, "the hour this phone last read it")
    #expect(offline.corpus.documents.isEmpty, "documents replay on open")
    offline.need(.session(device: "dev-1", id: "s1"))
    #expect(offline.corpus.document("s1")?.title == "Named")
    #expect(
      FieldHistoryModel.scopeLine(offline.corpus, standing: offline.standing, device: .iPhone)
        == "mini is asleep · read \(offline.corpus.readAt)")
    #expect(FieldHistoryModel.liveHeader(offline.corpus, standing: offline.standing).count == nil)
  }

  /// SE-2o (the lead's ruling 24; DESIGN.md §8 "The phone's search", as amended) — recent searches retired from
  /// search, and nothing read them since search's page retired, so the cache keeps none: a ledger holds only what the
  /// phone reads again.
  @Test("a kept ledger holds no recent searches")
  func aLedgerKeepsNoRecentSearches() throws {
    let directory = scratch()
    let cache = HistoryCache(directory: directory)
    cache.keepLedger(.mock, device: "dev-1")
    let file = try #require(Self.ledgerFile(in: directory))
    let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: file))
    let kept = try #require(raw as? [String: Any])
    let corpus = try #require(kept["corpus"] as? [String: Any])
    let keepsRecent = corpus["recentSearches"] != nil
    #expect(!keepsRecent)
  }

  /// SE-2o — a ledger a phone kept before the retire carries `recentSearches`. The corpus's decoding is the synthesized
  /// one, which passes over a key it does not know, so the old file reads whole: never a crash, and never a cache
  /// dropped for it (an undecodable file is removed and read again from the desktop).
  @Test("a ledger kept with recent searches, before they retired, still reads whole")
  func aLedgerKeptWithRecentSearchesStillReads() throws {
    let directory = scratch()
    let cache = HistoryCache(directory: directory)
    cache.keepLedger(.mock, device: "dev-1")
    let file = try #require(Self.ledgerFile(in: directory))
    let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: file))
    var kept = try #require(raw as? [String: Any])
    var corpus = try #require(kept["corpus"] as? [String: Any])
    corpus["recentSearches"] = ["needle", "badge"]
    kept["corpus"] = corpus
    try JSONSerialization.data(withJSONObject: kept).write(to: file)
    let read = cache.ledger(device: "dev-1")
    let projects = read?.corpus.projects.map { $0.id }
    let expected = HistoryCorpus.mock.projects.map { $0.id }
    #expect(projects == expected)
  }

  /// The one ledger a scratch cache holds (`<device's hash>/ledger.json`).
  static func ledgerFile(in directory: URL) -> URL? {
    let names = FileManager.default.enumerator(atPath: directory.path)?.allObjects as? [String] ?? []
    return names.first { $0.hasSuffix("ledger.json") }.map { directory.appendingPathComponent($0) }
  }

  @Test("the desktops: the home first, a door replaced by the cache when it goes, the mock as one group")
  @MainActor
  func desktops() async throws {
    let cache = HistoryCache(directory: scratch())
    let group = HistoryDesktops(cache: cache)
    let laptop = ScriptedDoor()
    let studio = ScriptedDoor()
    group.attach(deviceId: "dev-2", name: "laptop", isHome: false, door: laptop, ownsDoor: true)
    group.attach(deviceId: "dev-1", name: "studio", isHome: true, door: studio, ownsDoor: false)
    #expect(group.readers.map(\.name) == ["studio", "laptop"])
    #expect(group.home == "dev-1")
    await settle("both standings") { laptop.asked.contains("index.status") && studio.asked.contains("index.status") }
    group.markOffline(deviceId: "dev-2", name: "laptop")
    #expect(laptop.closed)
    #expect(group.reader(for: "dev-2")?.isReplaying == true)
    group.allOffline()
    #expect(!studio.closed, "a shared door is the link's to close")
    let allReplaying = group.readers.allSatisfy { $0.isReplaying }
    #expect(allReplaying)
    group.mount(.fixed(corpus: .mock, standing: .connected))
    #expect(group.readers.count == 1 && group.readers[0].corpus.desktop == "studio")
    #expect(group.readers[0].corpus.projects.count == 7)
  }

  /// ITEM 130 — AP-D4 (ruled 2026-10-28): a sign-out clears what the field
  /// taught this phone. History's cache was never cleared (`clear()` had no
  /// caller), so a signed-out phone replayed the account that left, as asleep.
  @Test("signing out clears the cache: no reader, no ledger, nothing left on disk to replay")
  @MainActor
  func signingOutClearsTheCache() async throws {
    let cache = HistoryCache(directory: scratch())
    let door = ScriptedDoor()
    door.tailSnapshot = try Fixture.json("index-session-tail-open.snapshot")["snapshot"]
    let group = HistoryDesktops(cache: cache)
    group.attach(deviceId: "dev-1", name: "studio", isHome: true, door: door, ownsDoor: true)
    let online = try #require(group.reader(for: "dev-1"))
    online.need(.session(device: "dev-1", id: "s1"))
    await settle("the document") { online.corpus.document("s1") != nil }
    #expect(cache.bytes() > 0, "the phone kept what it read")

    group.signedOut()

    #expect(group.readers.isEmpty)
    #expect(group.home == nil)
    #expect(door.closed, "a door the reader owned is closed with it")
    #expect(cache.bytes() == 0, "nothing of the account is left on disk")
    // The mesh leaving after the sign-out replays nothing, and neither does
    // the next account's desktop of the same id.
    group.allOffline()
    group.markOffline(deviceId: "dev-1", name: "studio")
    let replay = try #require(group.reader(for: "dev-1"))
    replay.need(.session(device: "dev-1", id: "s1"))
    #expect(replay.corpus.document("s1") == nil)
    #expect(replay.corpus.projects.isEmpty)
  }
}

@Suite("the cache is an LRU under a bound")
struct HistoryCacheTests {
  @Test("keeps a ledger and documents by key, answers the newest for a session, and trims the least recently read")
  func lru() throws {
    let cache = HistoryCache(directory: scratch(), limitBytes: 6_000)
    let corpus = HistoryCorpus.mock
    cache.keepLedger(corpus, device: "dev-1", readAt: Date(timeIntervalSince1970: 1_000))
    let kept = try #require(cache.ledger(device: "dev-1"))
    #expect(kept.corpus.projects.count == 7)
    #expect(kept.corpus.documents.isEmpty, "a ledger is kept without its documents")
    #expect(kept.readAt == Date(timeIntervalSince1970: 1_000))
    let document = try #require(corpus.document("mt-2"))
    let a = HistoryCache.Key(device: "dev-1", session: "mt-2", stamp: "1")
    cache.keep(document, key: a, readAt: Date(timeIntervalSince1970: 2_000))
    #expect(cache.document(key: a)?.document.id == "mt-2")
    let b = HistoryCache.Key(device: "dev-1", session: "mt-2", stamp: "2")
    cache.keep(document, key: b, readAt: Date(timeIntervalSince1970: 3_000))
    #expect(cache.latestDocument(device: "dev-1", session: "mt-2")?.readAt == Date(timeIntervalSince1970: 3_000))
    // the bound: the document is ~5 KB, so the second keep evicts the first
    #expect(cache.bytes() <= 6_000 + 5_500)
    #expect(cache.document(key: a) == nil || cache.document(key: b) != nil)
    #expect(cache.document(key: b) != nil, "the file just written is spared")
    cache.clear()
    #expect(cache.ledger(device: "dev-1") == nil)
  }
}
