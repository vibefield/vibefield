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
  var refuse: FieldProductError?
  var tailSnapshot: JSONValue?
  var tailDeltas: [JSONValue] = []
  var deliverDelta: (@MainActor (JSONValue) -> Void)?
  var closed = false

  func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
    asked.append(method)
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
    #expect(FieldHistoryModel.scopeLine(offline.corpus, standing: offline.standing) == "mini is asleep · read \(offline.corpus.readAt)")
    #expect(FieldHistoryModel.liveHeader(offline.corpus, standing: offline.standing).count == nil)
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
