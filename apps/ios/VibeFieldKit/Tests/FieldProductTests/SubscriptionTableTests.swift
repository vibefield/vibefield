import Foundation
import Testing

@testable import FieldProduct

// SP-2 (a) — the subscription TABLE: per subscription, a revision cursor, a
// resnapshot on a gap, and a cadence that rides every subscribe it sends. The
// repair is the tolerant reader's own (SP-L4, `rows.ts`): a gap re-subscribes —
// a rows table with the last cursor it applied — and there is no ack protocol
// anywhere. The caller never sees a frame that does not continue what it holds.

@MainActor
private func waitUntil(
  _ what: String, timeout: Duration = .seconds(5), _ condition: @MainActor () async -> Bool
) async throws {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if await condition() { return }
    try await Task.sleep(for: .milliseconds(2))
  }
  Issue.record("timed out waiting for \(what)")
}

/// What the callbacks saw, in order.
@MainActor
private final class Seen {
  private(set) var events: [String] = []
  func add(_ event: String) { events.append(event) }
}

/// A door that answers each subscribe with a NEW subId and whatever open
/// answer the test set last, recording the params every subscribe carried.
private final class TableScript: @unchecked Sendable {
  private let lock = NSLock()
  private var open: JSONValue
  private var trailing: (String) -> [String]
  private var asked: [JSONValue] = []

  init(open: JSONValue, trailing: @escaping (String) -> [String] = { _ in [] }) {
    self.open = open
    self.trailing = trailing
  }

  func set(open: JSONValue) { lock.withLock { self.open = open } }
  var subscribes: [JSONValue] { lock.withLock { asked } }

  func answer(id: Int64, params: JSONValue) -> [String] {
    lock.withLock {
      asked.append(params)
      let subId = "sub-\(asked.count)"
      return [Frame.result(id: id, .object(["subId": .string(subId), "snapshot": open]))]
        + trailing(subId)
    }
  }
}

private func tableDoor(_ script: TableScript, method: String = "agent.subscribe") throws -> FakeDoor {
  let ack = try Fixture.json("hello-ack.valid")
  return FakeDoor { asked, id, params in
    switch asked {
    case "system.hello": [Frame.result(id: id, ack)]
    case method: script.answer(id: id, params: params)
    default: []
    }
  }
}

@MainActor
private func tableClient(_ door: FakeDoor) -> FieldProductClient {
  FieldProductClient(
    url: URL(string: "ws://studio.tail1234.ts.net/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM")!,
    transport: door,
    options: .init(maxBackoff: .milliseconds(1), callTimeout: .seconds(5)))
}

/// The field fixture's own chain: the snapshot is at 64, the delta 64 → 66.
private let fieldEpoch = "fieldd-5d1e2a7c90b3f418.1"

private func fieldDelta(since: Int64, revision: Int64, epoch: String? = fieldEpoch) -> JSONValue {
  var fields: [String: JSONValue] = [
    "since": .int(since), "revision": .int(revision),
    "upserts": .array([]), "removed": .array([]),
  ]
  if let epoch { fields["epoch"] = .string(epoch) }
  return .object(fields)
}

private func fieldSnapshot(revision: Int64, epoch: String = fieldEpoch) -> JSONValue {
  .object(["epoch": .string(epoch), "revision": .int(revision), "rows": .array([])])
}

private func describe(snapshot payload: JSONValue) -> String {
  "snapshot:\(payload["revision"]?.intValue ?? -1)"
}

private func describe(delta payload: JSONValue) -> String {
  "delta:\(payload["since"]?.intValue ?? -1)->\(payload["revision"]?.intValue ?? -1)"
}

@MainActor
@Suite struct SubscriptionTableTests {
  /// The whole repair: a contiguous delta moves the cursor; a delta whose
  /// `since` is not the cursor is a GAP — it never reaches the caller, the old
  /// subscription is let go, and a fresh snapshot replaces what the caller
  /// held. The new subscription then carries on from the snapshot's revision.
  @Test func aGapIsRepairedByAFreshSnapshotAndTheGappedDeltaNeverReachesTheCaller() async throws {
    let script = TableScript(open: try Fixture.json("agent-field-snapshot.valid"))
    let door = try tableDoor(script)
    let client = tableClient(door)
    defer { client.close() }
    let seen = Seen()
    let handle = try await client.subscribe(
      "agent.subscribe", params: AgentSubscribeParams.phoneField.json,
      shape: .snapshotDelta(minIntervalMs: 250),
      onSnapshot: { seen.add(describe(snapshot: $0)) }, onDelta: { seen.add(describe(delta: $0)) })
    #expect(handle.cursor == SubscriptionCursor(epoch: fieldEpoch, revision: 64))

    await door.latest?.deliver(
      Frame.subscriptionEvent(
        method: "agent.subscribe.delta", subId: "sub-1",
        payload: try Fixture.json("agent-field-delta.valid")))
    try await waitUntil("the contiguous delta") { seen.events.count == 2 }
    #expect(handle.cursor?.revision == 66)

    script.set(open: fieldSnapshot(revision: 71))
    await door.latest?.deliver(
      Frame.subscriptionEvent(
        method: "agent.subscribe.delta", subId: "sub-1", payload: fieldDelta(since: 70, revision: 71)))
    try await waitUntil("the fresh snapshot") { seen.events.count == 3 }
    #expect(seen.events == ["snapshot:64", "delta:64->66", "snapshot:71"])
    #expect(handle.resnapshots == 1)
    #expect(handle.cursor?.revision == 71)
    let methods = await door.latest?.methods ?? []
    #expect(methods.filter { $0 == "agent.subscribe" }.count == 2)
    #expect(methods.contains("system.unsubscribe"))

    // The NEW subscription carries on from the snapshot's revision.
    await door.latest?.deliver(
      Frame.subscriptionEvent(
        method: "agent.subscribe.delta", subId: "sub-2", payload: fieldDelta(since: 71, revision: 72)))
    try await waitUntil("the next delta") { seen.events.count == 4 }
    #expect(handle.cursor?.revision == 72)
    #expect(handle.resnapshots == 1)
    handle.cancel()
  }

  /// A delta from ANOTHER chain — a different epoch, the same numbers — is a
  /// gap too: two chains' revisions are never compared (DS-3).
  @Test func aDeltaFromAnotherChainIsAGapEvenWhenItsNumbersFit() async throws {
    let script = TableScript(open: fieldSnapshot(revision: 64))
    let door = try tableDoor(script)
    let client = tableClient(door)
    defer { client.close() }
    let seen = Seen()
    let handle = try await client.subscribe(
      "agent.subscribe", params: nil, shape: .snapshotDelta(),
      onSnapshot: { seen.add(describe(snapshot: $0)) }, onDelta: { seen.add(describe(delta: $0)) })

    script.set(open: fieldSnapshot(revision: 3, epoch: "fieldd-another-boot.1"))
    await door.latest?.deliver(
      Frame.subscriptionEvent(
        method: "agent.subscribe.delta", subId: "sub-1",
        payload: fieldDelta(since: 64, revision: 65, epoch: "fieldd-another-boot.1")))
    try await waitUntil("the other chain's snapshot") { seen.events.count == 2 }
    #expect(seen.events == ["snapshot:64", "snapshot:3"])
    #expect(handle.cursor == SubscriptionCursor(epoch: "fieldd-another-boot.1", revision: 3))
    handle.cancel()
  }

  /// The open answer is APPLIED before any frame after it, so a delta in the
  /// same breath as the answer continues the snapshot rather than looking like
  /// a gap against a cursor not yet set.
  @Test func aDeltaInTheSameBreathAsTheOpenAnswerFollowsItsSnapshot() async throws {
    let script = TableScript(open: fieldSnapshot(revision: 64)) { subId in
      [
        Frame.subscriptionEvent(
          method: "agent.subscribe.delta", subId: subId, payload: fieldDelta(since: 64, revision: 66))
      ]
    }
    let door = try tableDoor(script)
    let client = tableClient(door)
    defer { client.close() }
    let seen = Seen()
    let handle = try await client.subscribe(
      "agent.subscribe", params: nil, shape: .snapshotDelta(),
      onSnapshot: { seen.add(describe(snapshot: $0)) }, onDelta: { seen.add(describe(delta: $0)) })
    try await waitUntil("snapshot and delta") { seen.events.count == 2 }
    #expect(seen.events == ["snapshot:64", "delta:64->66"])
    #expect(handle.resnapshots == 0)
    handle.cancel()
  }

  /// A rows table (`rows.ts`) re-subscribes after a gap WITH THE LAST CURSOR IT
  /// APPLIED, so a source whose journal still covers it answers `resumed` — the
  /// caller's copy stands, and only what it missed follows.
  @Test func aRowsTableResumesFromItsCursorAfterAGap() async throws {
    let script = TableScript(
      open: .object([
        "snapshot": .object([
          "epoch": .string("e1"), "revision": .int(3), "rows": .array([.object(["id": .string("a")])]),
        ])
      ]))
    let door = try tableDoor(script, method: "x.rows.subscribe")
    let client = tableClient(door)
    defer { client.close() }
    let seen = Seen()
    let handle = try await client.subscribe(
      "x.rows.subscribe", params: .object(["family": .string("vibe-field")]),
      shape: .rows(minIntervalMs: 500),
      onSnapshot: { seen.add(describe(snapshot: $0)) }, onDelta: { seen.add(describe(delta: $0)) })
    #expect(handle.cursor == SubscriptionCursor(epoch: "e1", revision: 3))

    await door.latest?.deliver(
      Frame.subscriptionEvent(
        method: "x.rows.delta", subId: "sub-1", payload: fieldDelta(since: 3, revision: 4, epoch: "e1")))
    try await waitUntil("the delta") { seen.events.count == 2 }

    script.set(open: .object(["resumed": .object(["epoch": .string("e1"), "revision": .int(4)])]))
    await door.latest?.deliver(
      Frame.subscriptionEvent(
        method: "x.rows.delta", subId: "sub-1", payload: fieldDelta(since: 6, revision: 7, epoch: "e1")))
    try await waitUntil("the re-subscribe") { script.subscribes.count == 2 }
    let subscribes = script.subscribes
    try #require(subscribes.count == 2)
    let resume = subscribes[1]
    #expect(resume["since"]?["epoch"]?.stringValue == "e1")
    #expect(resume["since"]?["revision"]?.intValue == 4)
    #expect(resume["family"]?.stringValue == "vibe-field")
    #expect(resume["minIntervalMs"]?.intValue == 500)

    await door.latest?.deliver(
      Frame.subscriptionEvent(
        method: "x.rows.delta", subId: "sub-2", payload: fieldDelta(since: 4, revision: 7, epoch: "e1")))
    try await waitUntil("what was missed") { seen.events.count == 3 }
    #expect(seen.events == ["snapshot:3", "delta:3->4", "delta:4->7"])
    #expect(handle.cursor == SubscriptionCursor(epoch: "e1", revision: 7))
    handle.cancel()
  }

  /// A snapshot bigger than a page arrives as pages sharing one cursor, and the
  /// caller is handed it ONCE, whole.
  @Test func aPagedRowsSnapshotIsHandedOverOnceAndWhole() async throws {
    func page(_ id: String, more: Bool) -> JSONValue {
      var fields: [String: JSONValue] = [
        "epoch": .string("e1"), "revision": .int(9), "rows": .array([.object(["id": .string(id)])]),
      ]
      if more { fields["more"] = .bool(true) }
      return .object(fields)
    }
    let script = TableScript(open: .object(["snapshot": page("a", more: true)])) { subId in
      [
        Frame.subscriptionEvent(method: "x.rows.snapshot", subId: subId, payload: page("b", more: true)),
        Frame.subscriptionEvent(method: "x.rows.snapshot", subId: subId, payload: page("c", more: false)),
      ]
    }
    let door = try tableDoor(script, method: "x.rows.subscribe")
    let client = tableClient(door)
    defer { client.close() }
    var handed: [JSONValue] = []
    let handle = try await client.subscribe(
      "x.rows.subscribe", params: nil, shape: .rows(),
      onSnapshot: { handed.append($0) }, onDelta: { _ in })
    try await waitUntil("the assembled snapshot") { !handed.isEmpty }
    try await Task.sleep(for: .milliseconds(30))
    #expect(handed.count == 1)
    let ids = handed.first?["rows"]?.arrayValue?.compactMap { $0["id"]?.stringValue }
    #expect(ids == ["a", "b", "c"])
    #expect(handed.first?["more"] == nil)
    #expect(handle.cursor == SubscriptionCursor(epoch: "e1", revision: 9))
    handle.cancel()
  }

  /// The cadence is the table's, per subscription, and rides EVERY subscribe
  /// it sends — the first, and the replay after a re-dial.
  @Test func theCadenceRidesEverySubscribe() async throws {
    let script = TableScript(open: fieldSnapshot(revision: 1))
    let door = try tableDoor(script)
    let client = tableClient(door)
    defer { client.close() }
    let handle = try await client.subscribe(
      "agent.subscribe", params: .object(["projection": .string("field")]),
      shape: .snapshotDelta(minIntervalMs: 250), onSnapshot: { _ in }, onDelta: { _ in })
    await door.latest?.drop()
    try await waitUntil("the replay") { script.subscribes.count == 2 }
    for params in script.subscribes {
      #expect(params["minIntervalMs"]?.intValue == 250)
      #expect(params["projection"]?.stringValue == "field")
    }
    handle.cancel()
  }

  /// A door whose open answer names NO revision gives the table nothing to
  /// continue from. Its frames pass through untracked — the owner's own checks
  /// stand — and the table never re-subscribes on every frame of a door that
  /// will never name one (a storm on a metered radio).
  @Test func aSnapshotNamingNoRevisionPassesFramesThroughInsteadOfStorming() async throws {
    let script = TableScript(open: .object(["rows": .array([])]))
    let door = try tableDoor(script)
    let client = tableClient(door)
    defer { client.close() }
    let seen = Seen()
    let handle = try await client.subscribe(
      "agent.subscribe", params: nil, shape: .snapshotDelta(),
      onSnapshot: { seen.add(describe(snapshot: $0)) }, onDelta: { seen.add(describe(delta: $0)) })
    #expect(handle.cursor == nil)
    for since in Int64(1)...3 {
      await door.latest?.deliver(
        Frame.subscriptionEvent(
          method: "agent.subscribe.delta", subId: "sub-1",
          payload: fieldDelta(since: since, revision: since + 1)))
    }
    try await waitUntil("three frames through") { seen.events.count == 4 }
    try await Task.sleep(for: .milliseconds(30))
    #expect(script.subscribes.count == 1)
    #expect(handle.resnapshots == 0)
    #expect(client.tolerantNotes.contains { $0.contains("names no revision") })
    handle.cancel()
  }

  /// The pure half: when a delta continues a cursor, and when it is a gap.
  @Test func theCursorContinuesOnlyWhatItHolds() {
    let held = SubscriptionCursor(epoch: "e1", revision: 5)
    let next = held.after(delta: fieldDelta(since: 5, revision: 6, epoch: "e1"), kind: .snapshotDelta)
    #expect(next == SubscriptionCursor(epoch: "e1", revision: 6))
    #expect(held.after(delta: fieldDelta(since: 4, revision: 6, epoch: "e1"), kind: .snapshotDelta) == nil)
    #expect(held.after(delta: fieldDelta(since: 5, revision: 6, epoch: "e2"), kind: .snapshotDelta) == nil)
    // The field board's epoch is optional on the wire: an epoch-less delta
    // continues by its numbers alone, keeping the epoch the cursor held.
    #expect(
      held.after(delta: fieldDelta(since: 5, revision: 7, epoch: nil), kind: .snapshotDelta)
        == SubscriptionCursor(epoch: "e1", revision: 7))
    // A rows table's epoch IS its identity: an absent one continues nothing.
    #expect(held.after(delta: fieldDelta(since: 5, revision: 6, epoch: nil), kind: .rows) == nil)
    #expect(held.after(delta: .object(["revision": .int(6)]), kind: .snapshotDelta) == nil)
    #expect(
      SubscriptionCursor.of(snapshot: fieldSnapshot(revision: 9))
        == SubscriptionCursor(epoch: fieldEpoch, revision: 9))
    #expect(SubscriptionCursor.of(snapshot: .object(["rows": .array([])])) == nil)
  }
}
