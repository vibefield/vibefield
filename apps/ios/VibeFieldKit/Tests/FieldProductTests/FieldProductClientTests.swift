import Foundation
import Testing

@testable import FieldProduct

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

@MainActor
private func makeClient(
  _ door: FakeDoor,
  maxBackoff: Duration = .milliseconds(1),
  callTimeout: Duration = .seconds(5)
) -> FieldProductClient {
  FieldProductClient(
    // The shape of a real dial target: the tailnet door is the same listener at
    // the C3 secret path, which is what `productEndpoint.url` carries.
    url: URL(string: "ws://studio.tail1234.ts.net/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM")!,
    transport: door,
    options: .init(maxBackoff: maxBackoff, callTimeout: callTimeout))
}

private func helloOnly(_ ack: JSONValue) -> FakeDoor.Script {
  { method, id, _ in
    method == "system.hello" ? [Frame.result(id: id, ack)] : []
  }
}

@MainActor
@Suite struct ProductHelloTests {
  @Test func helloIsTheFirstFrameAndCarriesTheContractsVersion() async throws {
    let ack = try Fixture.json("hello-ack.valid")
    let door = FakeDoor(script: helloOnly(ack))
    let client = makeClient(door)
    defer { client.close() }

    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }

    let frames = try #require(await door.latest?.frames)
    let first = try JSONValue.parse(Data(try #require(frames.first).utf8))
    #expect(first["method"]?.stringValue == "system.hello")
    #expect(first["params"]?["contractsVersion"]?.stringValue == "0.1.0")
    #expect(first["params"]?["clientKind"]?.stringValue == "ios")
    // The phone presents NO token on the tailnet door — WhoIs is the grant, and
    // a credential there would be wrong rather than merely absent (C5).
    #expect(first["params"]?.objectValue?.keys.contains("credential") == false)

    guard case .ready(let ready) = client.state else {
      Issue.record("expected ready, got \(client.state)")
      return
    }
    #expect(ready.serverKind == "fieldd")
    #expect(ready.has("terminal.attach"))
    #expect(!ready.has("agent.control"))
  }

  @Test func aTerminalRefusalAtHelloStopsInsteadOfRetryingForever() async throws {
    let door = FakeDoor { method, id, _ in
      method == "system.hello"
        ? [Frame.failure(id: id, kind: "UNAUTHORIZED", message: "no grant for this peer")]
        : []
    }
    let client = makeClient(door)
    defer { client.close() }

    client.connect()
    try await waitUntil("failed") { if case .failed = client.state { true } else { false } }

    guard case .failed(let error) = client.state else {
      Issue.record("expected failed, got \(client.state)")
      return
    }
    #expect(error.kind == "UNAUTHORIZED")
    #expect(error.message == "no grant for this peer")

    // And it stays stopped: asking again with the same version and the same
    // absent token can only be told the same thing.
    client.connect()
    try await Task.sleep(for: .milliseconds(50))
    #expect(await door.dials == 1)
  }

  @Test func aTransientRefusalAtHelloReDials() async throws {
    let ack = try Fixture.json("hello-ack.valid")
    let door = FakeDoor { method, id, _ in
      guard method == "system.hello" else { return [] }
      return [
        Frame.failure(
          id: id, kind: "UNAVAILABLE", message: "fieldd is still adopting", retryable: true,
          details: .object([
            "service": .string("agents"), "state": .string("adopting"),
          ]))
      ]
    }
    let client = makeClient(door)
    defer { client.close() }

    client.connect()
    try await waitUntil("a second dial") { await door.dials >= 2 }
    #expect(client.lastError?.kind == "UNAVAILABLE")
    #expect(client.lastError?.unavailable?.state == "adopting")
    _ = ack
  }

  @Test func aDialThatNeverConnectsBacksOffRatherThanSpinning() async throws {
    let door = FakeDoor(script: helloOnly(try Fixture.json("hello-ack.valid")))
    await door.refuseDials(2)
    let client = makeClient(door)
    defer { client.close() }

    client.connect()
    try await waitUntil("ready after two refused dials") {
      if case .ready = client.state { true } else { false }
    }
    #expect(await door.dials == 3)
  }

  @Test func readyThrowsTheDoorsOwnRefusalRatherThanATimeout() async throws {
    let door = FakeDoor { method, id, _ in
      method == "system.hello"
        ? [Frame.failure(id: id, kind: "INCOMPATIBLE", message: "contracts 0.1.0 vs 0.2.0")]
        : []
    }
    let client = makeClient(door)
    defer { client.close() }

    await #expect(throws: FieldProductError.self) { try await client.ready() }
  }

  /// The ladder is the TypeScript client's, to the millisecond: a healthy blip
  /// costs half a second and a dead door settles at the ceiling.
  @Test func theBackoffLadderIsFiveHundredMillisecondsDoubling() {
    let ceiling = Duration.seconds(10)
    #expect(FieldProductClient.backoff(attempt: 0, ceiling: ceiling) == .milliseconds(500))
    #expect(FieldProductClient.backoff(attempt: 1, ceiling: ceiling) == .seconds(1))
    #expect(FieldProductClient.backoff(attempt: 2, ceiling: ceiling) == .seconds(2))
    #expect(FieldProductClient.backoff(attempt: 4, ceiling: ceiling) == .seconds(8))
    #expect(FieldProductClient.backoff(attempt: 5, ceiling: ceiling) == ceiling)
    #expect(FieldProductClient.backoff(attempt: 400, ceiling: ceiling) == ceiling)
  }
}

@MainActor
@Suite struct ProductCallTests {
  @Test func aCallReadsItsAnswerThroughATolerantShape() async throws {
    let ack = try Fixture.json("hello-ack.valid")
    let devices = JSONValue.object(["devices": .array([try Fixture.json("device-slice.valid")])])
    let door = FakeDoor { method, id, _ in
      switch method {
      case "system.hello": [Frame.result(id: id, ack)]
      case "device.list": [Frame.result(id: id, devices)]
      default: []
      }
    }
    let client = makeClient(door)
    defer { client.close() }

    let result = try await client.call("device.list", as: DeviceListResult.self)
    #expect(result.devices.count == 1)
    #expect(result.devices[0].productEndpoint?.serve == "product")
  }

  @Test func aRefusedCallThrowsTheTaxonomyWord() async throws {
    let ack = try Fixture.json("hello-ack.valid")
    let door = FakeDoor { method, id, _ in
      switch method {
      case "system.hello": [Frame.result(id: id, ack)]
      default: [Frame.failure(id: id, kind: "FORBIDDEN_SCOPE", message: "agent.control")]
      }
    }
    let client = makeClient(door)
    defer { client.close() }

    do {
      _ = try await client.call("agent.interrupt")
      Issue.record("expected a refusal")
    } catch let error as FieldProductError {
      #expect(error.kind == "FORBIDDEN_SCOPE")
      #expect(!error.isTerminal)
    }
  }

  /// A door that hears a call and says nothing is the phone's own failure mode:
  /// a radio that wandered off keeps a socket that is open and dead. A desktop
  /// never needed this; a phone does.
  @Test func aCallThatIsNeverAnsweredTimesOutInsteadOfHanging() async throws {
    let ack = try Fixture.json("hello-ack.valid")
    let door = FakeDoor { method, id, _ in
      method == "system.hello" ? [Frame.result(id: id, ack)] : []
    }
    let client = makeClient(door, callTimeout: .milliseconds(80))
    defer { client.close() }

    do {
      _ = try await client.call("agent.list")
      Issue.record("expected a timeout")
    } catch let error as FieldProductError {
      #expect(error.kind == "TIMEOUT")
      #expect(error.retryable)
    }
  }

  @Test func anUnreadableFrameIsNotedAndNeverFatal() async throws {
    let ack = try Fixture.json("hello-ack.valid")
    let door = FakeDoor(script: helloOnly(ack))
    let client = makeClient(door)
    defer { client.close() }

    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    await door.latest?.deliver("{ this is not json")
    try await waitUntil("a note") { !client.tolerantNotes.isEmpty }
    #expect(client.tolerantNotes.contains { $0.contains("unreadable frame") })
    if case .ready = client.state {} else { Issue.record("the client should still be ready") }
  }

  @Test func fieldsTheAckCarriesAndThisBuildDoesNotReadAreNoted() async throws {
    let door = FakeDoor(script: helloOnly(try Fixture.json("hello-ack.terminal")))
    let client = makeClient(door)
    defer { client.close() }

    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    #expect(client.tolerantNotes.contains { $0.contains("HelloAck") && $0.contains("terminal") })
  }
}

@MainActor
@Suite struct ProductSubscriptionTests {
  /// The whole state machine in one run: snapshot, deltas, a drop, a FRESH
  /// snapshot on the new socket, and an unsubscribe that really stops it.
  @Test func snapshotThenDeltasThenAReconnectThatReSnapshots() async throws {
    let ack = try Fixture.json("hello-ack.valid")
    let snapshot = try Fixture.json("agent-field-snapshot.valid")
    let delta = try Fixture.json("agent-field-delta.valid")
    let door = FakeDoor { method, id, params in
      switch method {
      case "system.hello": return [Frame.result(id: id, ack)]
      case "agent.subscribe":
        // The phone asks for the FIELD projection at the phone's cadence.
        #expect(params["projection"]?.stringValue == "field")
        #expect(params["minIntervalMs"] == .int(250))
        return [
          Frame.result(id: id, .object(["subId": .string("sub-1"), "snapshot": snapshot]))
        ]
      default: return []
      }
    }
    let client = makeClient(door)
    defer { client.close() }

    let snapshots = Counter()
    let deltas = Counter()
    let handle = try await client.subscribe(
      "agent.subscribe", params: AgentSubscribeParams.phoneField.json,
      onSnapshot: { payload in
        snapshots.record((try? AgentFieldSnapshot(json: payload))?.rows.count ?? -1)
      },
      onDelta: { payload in
        deltas.record((try? AgentFieldDelta(json: payload))?.upserts.count ?? -1)
      })

    #expect(handle.subId == "sub-1")
    #expect(snapshots.values == [5])

    await door.latest?.deliver(
      Frame.subscriptionEvent(
        method: "agent.subscribe.delta", subId: "sub-1", payload: delta))
    try await waitUntil("the first delta") { deltas.values.count == 1 }
    #expect(deltas.values == [2])

    // The socket dies. The board on screen is the last one that WAS true; the
    // client re-dials, re-hellos, and replays the subscription for a snapshot.
    let firstConnection = try #require(await door.connection(0))
    await firstConnection.drop()
    try await waitUntil("a second dial") { await door.dials == 2 }
    try await waitUntil("a fresh snapshot") { snapshots.values.count == 2 }
    #expect(snapshots.values == [5, 5])
    #expect(await door.connection(1)?.methods == ["system.hello", "agent.subscribe"])

    // A delta on the NEW socket routes to the same handler through the new subId.
    await door.latest?.deliver(
      Frame.subscriptionEvent(
        method: "agent.subscribe.delta", subId: "sub-1", payload: delta))
    try await waitUntil("a delta after the reconnect") { deltas.values.count == 2 }

    // And unsubscribing really stops it: the door is told, and a delta that
    // arrives afterwards routes to nobody.
    handle.cancel()
    try await waitUntil("the unsubscribe frame") {
      await door.latest?.methods.contains("system.unsubscribe") == true
    }
    await door.latest?.deliver(
      Frame.subscriptionEvent(
        method: "agent.subscribe.delta", subId: "sub-1", payload: delta))
    try await Task.sleep(for: .milliseconds(50))
    #expect(deltas.values.count == 2)
  }

  /// A delta that lands in the very frame after the subscribe response must not
  /// be dropped — the route is installed before the caller is resumed, which is
  /// the one ordering rule this client cannot get wrong.
  @Test func aDeltaInTheSameBreathAsTheSubscribeResponseIsNotLost() async throws {
    let ack = try Fixture.json("hello-ack.valid")
    let snapshot = try Fixture.json("agent-field-snapshot.valid")
    let delta = try Fixture.json("agent-field-delta.valid")
    let door = FakeDoor { method, id, _ in
      switch method {
      case "system.hello": [Frame.result(id: id, ack)]
      case "agent.subscribe": [
        Frame.result(id: id, .object(["subId": .string("sub-1"), "snapshot": snapshot])),
        Frame.subscriptionEvent(method: "agent.subscribe.delta", subId: "sub-1", payload: delta),
      ]
      default: []
      }
    }
    let client = makeClient(door)
    defer { client.close() }

    let deltas = Counter()
    _ = try await client.subscribe(
      "agent.subscribe", params: nil, onSnapshot: { _ in },
      onDelta: { _ in deltas.record(1) })
    try await waitUntil("the delta that raced the response") { deltas.values.count == 1 }
  }

  @Test func aRefusedSubscribeLeavesNoOrphanToReplay() async throws {
    let ack = try Fixture.json("hello-ack.valid")
    let door = FakeDoor { method, id, _ in
      switch method {
      case "system.hello": [Frame.result(id: id, ack)]
      default: [Frame.failure(id: id, kind: "FORBIDDEN_SCOPE", message: "agent.read")]
      }
    }
    let client = makeClient(door)
    defer { client.close() }

    await #expect(throws: FieldProductError.self) {
      _ = try await client.subscribe(
        "agent.subscribe", params: nil, onSnapshot: { _ in }, onDelta: { _ in })
    }

    // Drop the socket: a replay of the refused subscription would be a second
    // ask nobody is waiting for.
    await door.connection(0)?.drop()
    try await waitUntil("a second dial") { await door.dials == 2 }
    try await waitUntil("hello on the new socket") {
      await door.connection(1)?.methods.contains("system.hello") == true
    }
    try await Task.sleep(for: .milliseconds(50))
    #expect(await door.connection(1)?.methods == ["system.hello"])
  }

  @Test func aClosedClientStopsDialingAndFailsItsWaiters() async throws {
    let door = FakeDoor(script: helloOnly(try Fixture.json("hello-ack.valid")))
    let client = makeClient(door)

    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    client.close()
    #expect(client.state == .closed)

    await #expect(throws: FieldProductError.self) { try await client.ready() }
    try await Task.sleep(for: .milliseconds(50))
    #expect(await door.dials == 1)
  }
}

/// A main-actor tally the subscription callbacks can write to. `@Observable`
/// models hand their callbacks main-actor isolation, so this needs no lock.
@MainActor
private final class Counter {
  private(set) var values: [Int] = []
  func record(_ value: Int) { values.append(value) }
}
