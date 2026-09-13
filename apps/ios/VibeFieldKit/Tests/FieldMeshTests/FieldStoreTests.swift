import FieldProduct
import Foundation
import Testing

@testable import FieldMesh

@MainActor
func waitUntil(
  _ what: String, timeout: Duration = .seconds(5), _ condition: @MainActor () async -> Bool
) async throws {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if await condition() { return }
    try await Task.sleep(for: .milliseconds(2))
  }
  Issue.record("timed out waiting for \(what)")
}

/// A store reading `field.devices.v1`, with both peers listening.
@MainActor
private func standingStore(
  peers: [FieldStorePeer], storeId: String = "field.devices.v1"
) async throws -> (FieldStore, MeshRehearsal) {
  let mesh = MeshRehearsal()
  await mesh.set(peers: peers)
  let store = FieldStore(doors: await mesh.doors())
  store.subscribe(storeId)
  try await waitUntil("both streams to be listening") { await mesh.isListening }
  return (store, mesh)
}

@MainActor
@Suite struct FieldStoreStartTests {
  @Test func itAsksEveryOnlinePeerForItsSliceAndNobodyElse() async throws {
    let (store, mesh) = try await standingStore(peers: [studio, laptop, asleep])
    defer { store.unsubscribe() }

    try await waitUntil("two requests") { await mesh.sent.count == 2 }
    let sent = await mesh.sent
    #expect(sent.map(\.peerId).sorted() == ["node-laptop", "node-studio"])
    #expect(sent.allSatisfy { $0.namespace == "ss:field.devices.v1" })
    #expect(sent.allSatisfy { $0.msgType == "request" })
    // The payload is serde's tagged shape, which is what the Rust reads.
    #expect(sent.allSatisfy { $0.payload == .object(["type": .string("request")]) })
    #expect(await mesh.requests(to: "node-asleep") == 0)
  }

  /// A peer that cannot be asked costs its own slice and nothing else — the
  /// same rule `RemoteSessionField` holds about a host that refuses a listing.
  @Test func aPeerThatCannotBeAskedIsNotedAndTheRestAreStillAsked() async throws {
    let mesh = MeshRehearsal()
    await mesh.set(peers: [studio, laptop])
    await mesh.refuse("node-studio")
    let store = FieldStore(doors: await mesh.doors())
    defer { store.unsubscribe() }

    store.subscribe("field.devices.v1")
    try await waitUntil("the laptop to be asked") { await mesh.requests(to: "node-laptop") == 1 }
    try await waitUntil("a note") { !store.notes.isEmpty }
    #expect(store.notes.contains { $0.contains("node-studio") })
  }

  @Test func aJoiningPeerIsAskedOnceHoweverOftenTheNetmapTicks() async throws {
    let (store, mesh) = try await standingStore(peers: [])
    defer { store.unsubscribe() }

    await mesh.emit(.upsert(studio))
    try await waitUntil("the joiner to be asked") { await mesh.requests(to: "node-studio") == 1 }

    // The same peer again — a netmap tick, not a join.
    await mesh.emit(.upsert(studio))
    await mesh.emit(.upsert(FieldStorePeer(id: "node-studio", deviceId: nil, online: true)))
    try await Task.sleep(for: .milliseconds(60))
    #expect(await mesh.requests(to: "node-studio") == 1)

    // An offline upsert is not a joiner at all.
    await mesh.emit(.upsert(asleep))
    try await Task.sleep(for: .milliseconds(40))
    #expect(await mesh.requests(to: "node-asleep") == 0)
  }

  @Test func aStoreNobodyIsReadingIsNotAStoreThatIsEmpty() async throws {
    let mesh = MeshRehearsal()
    let store = FieldStore(doors: await mesh.doors())
    #expect(store.state == .closed)
    #expect(store.storeId == nil)
    store.subscribe("field.agents.v1")
    #expect(store.state == .reading(storeId: "field.agents.v1"))
    #expect(store.slices.isEmpty)
    store.unsubscribe()
    #expect(store.state == .closed)
  }
}

@MainActor
@Suite struct FieldStoreApplyTests {
  @Test func aFullFromAPeerLandsAsThatPeersSlice() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "full",
        payload: sliceFrame(
          "full", deviceId: "dev-studio", version: 3,
          data: .object(["name": .string("studio")]))))
    try await waitUntil("the slice") { store.slices["dev-studio"] != nil }

    let slice = try #require(store.slices["dev-studio"])
    #expect(slice.version == 3)
    #expect(slice.updatedAt == 1_757_808_000_000)
    #expect(slice.data["name"]?.stringValue == "studio")
    #expect(slice.sentBy == "dev-studio")
  }

  /// The store's whole conflict rule: per-device, monotonic, newer wins and
  /// everything else is a replay.
  @Test func onlyANewerVersionReplacesASlice() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }

    for version in [5, 7] as [Int64] {
      await mesh.deliver(
        inbound(
          from: "node-studio", deviceId: "dev-studio", msgType: "update",
          payload: sliceFrame(
            "update", deviceId: "dev-studio", version: version,
            data: .object(["v": .int(version)]))))
    }
    try await waitUntil("v7") { store.slices["dev-studio"]?.version == 7 }

    // A replay, and the same version again: both are refused, and said so.
    for version in [6, 7] as [Int64] {
      await mesh.deliver(
        inbound(
          from: "node-studio", deviceId: "dev-studio", msgType: "update",
          payload: sliceFrame(
            "update", deviceId: "dev-studio", version: version,
            data: .object(["v": .int(version)]))))
    }
    try await waitUntil("two refusals") { store.notes.count == 2 }
    #expect(store.slices["dev-studio"]?.version == 7)
    #expect(store.slices["dev-studio"]?.data["v"] == .int(7))
    #expect(store.notes.contains { $0.contains("v6") })
    #expect(store.notes.contains { $0.contains("not newer than v7") })
  }

  @Test func slicesAreFiledPerDeviceAndDoNotCollide() async throws {
    let (store, mesh) = try await standingStore(peers: [studio, laptop])
    defer { store.unsubscribe() }

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "full",
        payload: sliceFrame("full", deviceId: "dev-studio", version: 1, data: .object([:]))))
    await mesh.deliver(
      inbound(
        from: "node-laptop", deviceId: "dev-laptop", msgType: "full",
        payload: sliceFrame("full", deviceId: "dev-laptop", version: 1, data: .object([:]))))
    try await waitUntil("both slices") { store.slices.count == 2 }
    #expect(store.slices.keys.sorted() == ["dev-laptop", "dev-studio"])
  }

  @Test func clearDropsASliceAndSaysWhy() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "full",
        payload: sliceFrame("full", deviceId: "dev-studio", version: 1, data: .object([:]))))
    try await waitUntil("the slice") { store.slices["dev-studio"] != nil }

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "clear",
        payload: clearFrame(deviceId: "dev-studio")))
    try await waitUntil("the slice to go") { store.slices.isEmpty }
    #expect(store.notes.contains { $0.contains("cleared") })
  }

  @Test func aPeerGoingOfflineTakesItsSliceWithIt() async throws {
    let (store, mesh) = try await standingStore(peers: [studio, laptop])
    defer { store.unsubscribe() }

    for (peer, device) in [("node-studio", "dev-studio"), ("node-laptop", "dev-laptop")] {
      await mesh.deliver(
        inbound(
          from: peer, deviceId: device, msgType: "full",
          payload: sliceFrame("full", deviceId: device, version: 1, data: .object([:]))))
    }
    try await waitUntil("both slices") { store.slices.count == 2 }

    await mesh.emit(.left(studio))
    try await waitUntil("the studio slice to go") { store.slices["dev-studio"] == nil }
    #expect(store.slices["dev-laptop"] != nil)
    #expect(store.notes.contains { $0.contains("the peer left") })
  }

  /// A peer on its way out may have shed its durable id already. The id it was
  /// ASKED under stands in — otherwise a departure silently keeps a dead
  /// desktop's board on the field.
  @Test func aPeerThatLeavesWithoutItsDurableIdIsStillMatched() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }
    try await waitUntil("the ask") { await mesh.requests(to: "node-studio") == 1 }

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "full",
        payload: sliceFrame("full", deviceId: "dev-studio", version: 1, data: .object([:]))))
    try await waitUntil("the slice") { store.slices["dev-studio"] != nil }

    await mesh.emit(.left(FieldStorePeer(id: "node-studio", deviceId: nil, online: false)))
    try await waitUntil("the slice to go") { store.slices.isEmpty }
  }

  @Test func aMalformedMessageIsIgnoredWithAReasonAndNeverFatal() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }

    for payload in [
      Data("not json".utf8),
      Data("[]".utf8),
      (try? JSONValue.object(["type": .string("teleport")]).encoded()) ?? Data(),
      // An update with no version is not an update — a slice with no place in
      // the ordering cannot be filed.
      (try? JSONValue.object([
        "type": .string("update"), "device_id": .string("dev-studio"),
        "data": .object([:]),
      ]).encoded()) ?? Data(),
    ] {
      await mesh.deliver(
        inbound(from: "node-studio", deviceId: "dev-studio", msgType: "update", payload: payload))
    }
    try await waitUntil("four reasons") { store.notes.count == 4 }
    #expect(store.slices.isEmpty)
    #expect(store.notes.allSatisfy { $0.contains("ignored") })
    #expect(store.state == .reading(storeId: "field.devices.v1"))
  }

  /// The phone owns no slice, so a peer asking for one is heard and not
  /// answered. Nothing is sent, and nothing is recorded as wrong.
  @Test func aRequestFromAPeerIsHeardAndNotAnswered() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }
    try await waitUntil("our own ask") { await mesh.sent.count == 1 }

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "request",
        payload: (try? StoreSyncMessage.requestPayload.encoded()) ?? Data()))
    try await Task.sleep(for: .milliseconds(60))
    #expect(await mesh.sent.count == 1)
    #expect(store.notes.isEmpty)
  }

  /// REFUSED, not counted. The review put a real cost on the old behaviour:
  /// any peer could publish a slice claiming another desktop, at a version
  /// high enough to win forever, carrying its own `productEndpoint.url` — and
  /// this phone's dial target for that desktop became the attacker's. truffle
  /// authenticates the sender at hello, so the check is one comparison.
  @Test func aSliceClaimingAnotherDevicesIdIsRefused() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "update",
        payload: sliceFrame(
          "update", deviceId: "dev-laptop", version: 9_000_000,
          data: .object(["productEndpoint": .object(["url": .string("ws://evil/t/x")])]))))
    try await waitUntil("the refusal") { store.attributionRefusals == 1 }
    #expect(store.slices["dev-laptop"] == nil)
    #expect(store.slices.isEmpty)
    #expect(store.notes.contains { $0.contains("claimed dev-laptop") })
  }

  /// A `clear` is a WRITE about somebody's slice and was not checked at all:
  /// any peer could evict any desktop's board.
  @Test func aClearForAnotherDevicesSliceIsRefused() async throws {
    let (store, mesh) = try await standingStore(peers: [studio, laptop])
    defer { store.unsubscribe() }

    await mesh.deliver(
      inbound(
        from: "node-laptop", deviceId: "dev-laptop", msgType: "full",
        payload: sliceFrame("full", deviceId: "dev-laptop", version: 1, data: .object([:]))))
    try await waitUntil("the laptop's slice") { store.slices["dev-laptop"] != nil }

    // studio tries to evict it.
    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "clear",
        payload: clearFrame(deviceId: "dev-laptop")))
    try await waitUntil("the refusal") { store.attributionRefusals == 1 }
    #expect(store.slices["dev-laptop"] != nil)

    // Its owner may, of course.
    await mesh.deliver(
      inbound(
        from: "node-laptop", deviceId: "dev-laptop", msgType: "clear",
        payload: clearFrame(deviceId: "dev-laptop")))
    try await waitUntil("the owner's clear") { store.slices["dev-laptop"] == nil }
  }

  /// A message this reader cannot attribute is refused too. Every inbound
  /// message rides a hello-authenticated session, so a sender with no identity
  /// is itself the anomaly — and an unattributable write is exactly the hole
  /// the check above closes.
  @Test func anUnattributableMessageIsRefused() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }

    await mesh.deliver(
      inbound(
        from: "node-nobody", deviceId: nil, msgType: "update",
        payload: sliceFrame("update", deviceId: "dev-studio", version: 1, data: .object([:]))))
    try await waitUntil("the refusal") { store.attributionRefusals == 1 }
    #expect(store.slices.isEmpty)
    #expect(store.notes.contains { $0.contains("no identity") })
  }

  /// The id a peer was ASKED under stands in when the message itself carries
  /// none — the same fallback a departing peer gets.
  @Test func theAskedIdentityStandsInForAMessageThatCarriesNone() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }
    try await waitUntil("the ask") { await mesh.requests(to: "node-studio") == 1 }

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: nil, msgType: "update",
        payload: sliceFrame("update", deviceId: "dev-studio", version: 1, data: .object([:]))))
    try await waitUntil("the slice") { store.slices["dev-studio"] != nil }
    #expect(store.attributionRefusals == 0)
  }
}

@MainActor
@Suite struct FieldStoreReadingTests {
  /// `field.devices.v1` is the store this whole slice exists for: it is where
  /// the phone learns a desktop's capability URL.
  @Test func aDeviceSliceReadsAsTheDoorItCarries() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }

    let deviceSlice = JSONValue.object([
      "deviceId": .string("dev-studio"),
      "name": .string("James MacBook Pro"),
      "platform": .string("darwin"),
      "headless": .bool(false),
      "fielddVersion": .string("0.1.0"),
      "contractsVersion": .string("0.1.0"),
      "capabilities": .object([
        "terminalHost": .bool(true), "docHost": .bool(true), "push": .bool(false),
      ]),
      "productEndpoint": .object([
        "serve": .string("product"),
        "url": .string("http://mac.tail1234.ts.net:443/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM"),
      ]),
      "bootId": .string("fieldd-a1b2c3d4e5f60718"),
      "publishedAt": .int(1_757_808_000_000),
    ])
    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "full",
        payload: sliceFrame("full", deviceId: "dev-studio", version: 1, data: deviceSlice)))
    try await waitUntil("the slice") { store.slices["dev-studio"] != nil }

    let device = try #require(store.slices["dev-studio"]).decode(DeviceInfo.self)
    #expect(device.name == "James MacBook Pro")
    #expect(device.productURL?.path.hasPrefix("/t/") == true)

    let all = store.decodeAll(DeviceInfo.self)
    #expect(all.values.count == 1)
    #expect(all.failed.isEmpty)
  }

  /// One desktop on a shape this build cannot read must not make the whole
  /// roster look empty.
  @Test func oneUnreadableSliceIsNamedAndTheRestStillRead() async throws {
    let (store, mesh) = try await standingStore(peers: [studio, laptop])
    defer { store.unsubscribe() }

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "full",
        payload: sliceFrame(
          "full", deviceId: "dev-studio", version: 1,
          data: .object([
            "deviceId": .string("dev-studio"), "name": .string("studio"),
            "platform": .string("darwin"),
          ]))))
    await mesh.deliver(
      inbound(
        from: "node-laptop", deviceId: "dev-laptop", msgType: "full",
        payload: sliceFrame(
          "full", deviceId: "dev-laptop", version: 1,
          data: .object(["somethingElse": .bool(true)]))))
    try await waitUntil("both slices") { store.slices.count == 2 }

    let all = store.decodeAll(DeviceInfo.self)
    #expect(all.values.keys.sorted() == ["dev-studio"])
    #expect(all.failed.count == 1)
    #expect(all.failed[0].contains("dev-laptop"))
  }

  /// The board, when it lands: `field.agents.v1` carries §10.1's slice.
  ///
  /// The payload here is deliberately MINIMAL and hand-built — what is under
  /// test is the store carrying a board through, not the board's own shape.
  /// The shape is pinned against the contracts' goldens in `FieldProductTests`,
  /// which is where those files live; duplicating them into this bundle would
  /// give one fixture two homes and one of them would go stale.
  @Test func anAgentFieldSliceReadsAsABoardWithItsExpiry() async throws {
    let (store, mesh) = try await standingStore(peers: [studio], storeId: "field.agents.v1")
    defer { store.unsubscribe() }

    let board = JSONValue.object([
      "v": .int(1),
      "deviceId": .string("dev-studio"),
      "publishedAt": .int(1_757_808_000_000),
      "expiresAt": .int(1_757_808_030_000),
      "revision": .int(7),
      "rows": .array([
        .object([
          "runtimeRunId": .string("run-1"), "revision": .int(2),
          "kind": .string("claude"), "label": .string("Claude"),
          "tier": .string("managed"), "device": .string("dev-studio"),
          "status": .string("blocked"),
          "statusSince": .string("2026-09-13T12:00:00.000Z"),
          "stateChangedAt": .string("2026-09-13T12:00:00.000Z"),
          "createdAt": .string("2026-09-13T11:00:00.000Z"),
          "alive": .bool(true),
          "blockers": .array([
            .object([
              "id": .string("permission-1"), "kind": .string("permission"),
              "since": .string("2026-09-13T12:00:00.000Z"), "tool": .string("Bash"),
            ])
          ]),
        ])
      ]),
    ])
    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "update",
        payload: sliceFrame("update", deviceId: "dev-studio", version: 9, data: board)))
    try await waitUntil("the board") { store.slices["dev-studio"] != nil }

    let decoded = try #require(store.slices["dev-studio"]).decode(AgentFieldSlice.self)
    #expect(decoded.revision == 7)
    #expect(decoded.rows.count == 1)
    #expect(decoded.rows[0].blockers.first?.tool == "Bash")
    #expect(decoded.expiresAt - decoded.publishedAt == 30_000)
  }
}

@MainActor
@Suite struct FieldStoreLifecycleTests {
  @Test func unsubscribingForgetsWhatItWasTold() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "full",
        payload: sliceFrame("full", deviceId: "dev-studio", version: 1, data: .object([:]))))
    try await waitUntil("the slice") { store.slices["dev-studio"] != nil }

    store.unsubscribe()
    #expect(store.slices.isEmpty)
    #expect(store.state == .closed)

    // And a message from the old stream lands on nobody.
    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "full",
        payload: sliceFrame("full", deviceId: "dev-studio", version: 2, data: .object([:]))))
    try await Task.sleep(for: .milliseconds(60))
    #expect(store.slices.isEmpty)
  }

  @Test func subscribingTwiceToTheSameStoreDoesNotAskTwice() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }
    try await waitUntil("the first ask") { await mesh.sent.count == 1 }

    store.subscribe("field.devices.v1")
    try await Task.sleep(for: .milliseconds(60))
    #expect(await mesh.sent.count == 1)
  }

  /// Slices are per-store; keeping the old ones would file one store's answers
  /// under another's name.
  @Test func movingToAnotherStoreStartsClean() async throws {
    let (store, mesh) = try await standingStore(peers: [studio])
    defer { store.unsubscribe() }

    await mesh.deliver(
      inbound(
        from: "node-studio", deviceId: "dev-studio", msgType: "full",
        payload: sliceFrame("full", deviceId: "dev-studio", version: 1, data: .object([:]))))
    try await waitUntil("the slice") { store.slices["dev-studio"] != nil }

    store.subscribe("terminal.v1.hosts")
    #expect(store.slices.isEmpty)
    #expect(store.state == .reading(storeId: "terminal.v1.hosts"))
    try await waitUntil("an ask on the new namespace") {
      await mesh.sent.contains { $0.namespace == "ss:terminal.v1.hosts" }
    }
  }

  @Test func theNamespaceIsTrufflesOwn() {
    #expect(FieldStore.namespace(for: "field.agents.v1") == "ss:field.agents.v1")
    #expect(FieldStore.namespace(for: "terminal.v1.hosts") == "ss:terminal.v1.hosts")
  }
}
