import Foundation
import Testing

@testable import FieldProduct

// SP-2 (b) — the keepalive, on a clock the test moves.
//
// The door's sidecar reaps EACH DIRECTION of a served WebSocket after ten
// silent minutes (truffle `sidecar-slim` `idleCopy`), and an idle board sends
// nothing by design — so the door these rows drive keeps the sidecar's books:
// `FakeConnection` stamps when each direction last carried bytes, and a row
// reaps the socket the moment either direction has been silent for ten
// minutes, exactly as the sidecar would. Twelve minutes of a phone in a drawer
// is a loop of `advance` calls; nothing here waits on wall time but the few
// milliseconds it takes the client's own tasks to run.

/// What the tests count from inside a subscription's callbacks.
@MainActor
private final class Tally {
  var snapshots = 0
  var deltas = 0
}

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

/// The door's tick, as SP-1 sends it: a notification with no `id`.
private func tick(intervalMs: Int64 = 120_000) -> String {
  Frame.notification(
    method: "system.tick",
    params: .object(["at": .int(1_759_300_000_000), "intervalMs": .int(intervalMs)]))
}

/// A door that answers hello and the field subscription, and nothing else.
private func idleBoardDoor(clock: ManualProductClock, answersPings: Bool = true) throws -> FakeDoor {
  let ack = try Fixture.json("hello-ack.valid")
  let snapshot = try Fixture.json("agent-field-snapshot.valid")
  return FakeDoor(clock: clock, answersPings: answersPings) { method, id, _ in
    switch method {
    case "system.hello": [Frame.result(id: id, ack)]
    case "agent.subscribe":
      [Frame.result(id: id, .object(["subId": .string("sub-1"), "snapshot": snapshot]))]
    default: []
    }
  }
}

@MainActor
private func keptClient(_ door: FakeDoor, clock: ManualProductClock) -> FieldProductClient {
  FieldProductClient(
    url: URL(string: "ws://studio.tail1234.ts.net/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM")!,
    transport: door,
    options: .init(maxBackoff: .milliseconds(1), callTimeout: .seconds(5), clock: clock))
}

/// Run `total` of manual time in `step`s. After each step the client's timers
/// settle, the door does what `door` says, and the sidecar's reap is applied:
/// a direction silent for ten minutes is closed. Answers WHEN it reaped, or
/// nil for a socket that lived.
@MainActor
private func soak(
  _ socket: FakeConnection, clock: ManualProductClock, for total: Duration,
  step: Duration = .seconds(5), door: (Duration) async -> Void = { _ in }
) async -> Duration? {
  var elapsed = Duration.zero
  while elapsed < total {
    clock.advance(by: step)
    elapsed += step
    await settle(clock, parked: 2)
    await door(elapsed)
    if await socket.longestSilence(at: clock.now()) >= .seconds(600) {
      await socket.drop()
      return elapsed
    }
  }
  return nil
}

@MainActor
@Suite struct KeepaliveTests {
  /// SP-2's witness row: a phone left idle on an open door for twelve minutes —
  /// past the sidecar's ten — keeps it. The door ticks every two minutes as SP-1
  /// builds it; the phone pings after two minutes with nothing sent. No
  /// re-dial, no replay, no second snapshot.
  @Test func aTwelveMinuteIdleSoakKeepsTheDoor() async throws {
    let clock = ManualProductClock()
    let door = try idleBoardDoor(clock: clock)
    let client = keptClient(door, clock: clock)
    defer { client.close() }
    let tally = Tally()
    let handle = try await client.subscribe(
      "agent.subscribe", params: AgentSubscribeParams.phoneField.json,
      onSnapshot: { _ in tally.snapshots += 1 }, onDelta: { _ in tally.deltas += 1 })
    let socket = try #require(await door.latest)
    await settle(clock, parked: 2)

    var nextTick = Duration.seconds(120)
    let reapedAt = await soak(socket, clock: clock, for: .seconds(12 * 60)) { elapsed in
      guard elapsed >= nextTick else { return }
      await socket.deliver(tick())
      nextTick += .seconds(120)
    }

    #expect(reapedAt == nil, "the sidecar reaped a silent direction at \(String(describing: reapedAt))")
    #expect(await socket.isDropped == false)
    #expect(await door.dials == 1)
    #expect(client.silentDoorCloses == 0)
    #expect(await socket.pings >= 5)
    #expect(tally.snapshots == 1)
    if case .ready = client.state {} else { Issue.record("not ready after the soak: \(client.state)") }
    handle.cancel()
  }

  /// A door from before SP-1 never ticks. The phone's ping is bytes in its own
  /// direction and the door's pong is bytes in the other, so the same twelve
  /// minutes keep this door too — and the pong is the frame the receive
  /// deadline needed, so a quiet old door is never called dead.
  @Test func aDoorThatNeverTicksIsKeptByThePhonesOwnPing() async throws {
    let clock = ManualProductClock()
    let door = try idleBoardDoor(clock: clock)
    let client = keptClient(door, clock: clock)
    defer { client.close() }
    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    let socket = try #require(await door.latest)
    await settle(clock, parked: 2)

    let reapedAt = await soak(socket, clock: clock, for: .seconds(12 * 60))

    #expect(reapedAt == nil, "the sidecar reaped a silent direction at \(String(describing: reapedAt))")
    #expect(await door.dials == 1)
    #expect(client.silentDoorCloses == 0)
    #expect(await socket.pings >= 5)
  }

  /// DS wave 2 landing — the ping follows the door's OWN interval. A door that
  /// announces a short tick (30 s) and then stops ticking is dead to the
  /// receive deadline at 75 s; a ping fixed at 120 s would come too late, and
  /// the client would close a door whose pong could have kept it. The ping
  /// fires after `min(announced interval, 120 s)` — the cap stays, so a long
  /// announced interval can never outlast the sidecar's ten minutes.
  @Test func aDoorThatAnnouncesAShortIntervalThenGoesQuietIsKeptByThePing() async throws {
    let clock = ManualProductClock()
    let door = try idleBoardDoor(clock: clock)
    let client = keptClient(door, clock: clock)
    defer { client.close() }
    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    let socket = try #require(await door.latest)
    await socket.deliver(tick(intervalMs: 30_000))  // the door's one and only tick
    await settle(clock, parked: 2)

    let reapedAt = await soak(socket, clock: clock, for: .seconds(6 * 60))

    #expect(reapedAt == nil, "the sidecar reaped a silent direction at \(String(describing: reapedAt))")
    #expect(await door.dials == 1, "the door was closed between pings and dialled again")
    #expect(client.silentDoorCloses == 0)
    // one ping per 30 s of silence, not one per 120 s
    #expect(await socket.pings >= 10)
  }

  /// A door that goes quiet — no tick, no pong, nothing — is dead at two and a
  /// half intervals (2.5 × 120 s before the first tick names one), and the
  /// client closes it and dials again rather than sitting on a corpse until the
  /// next call times out.
  @Test func aSilentDoorIsClosedAndDialedAgainAtTwoAndAHalfIntervals() async throws {
    let clock = ManualProductClock()
    let door = try idleBoardDoor(clock: clock, answersPings: false)
    let client = keptClient(door, clock: clock)
    defer { client.close() }
    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    let first = try #require(await door.latest)
    await settle(clock, parked: 2)

    for _ in 0..<59 {  // 295 s: inside the deadline
      clock.advance(by: .seconds(5))
      await settle(clock, parked: 2)
    }
    #expect(await door.dials == 1)
    #expect(client.silentDoorCloses == 0)

    clock.advance(by: .seconds(10))  // 305 s: past it
    try await waitUntil("the deadline to close the door and dial again") {
      await door.dials == 2
    }
    #expect(client.silentDoorCloses == 1)
    #expect(await first.isDropped)
  }

  /// ANY inbound frame is liveness — including a notification this build has
  /// never heard of, which is a frame and never an error.
  @Test func anyInboundFrameResetsTheDeadlineEvenOneThisBuildHasNeverHeardOf() async throws {
    let clock = ManualProductClock()
    let door = try idleBoardDoor(clock: clock, answersPings: false)
    let client = keptClient(door, clock: clock)
    defer { client.close() }
    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    let socket = try #require(await door.latest)
    await settle(clock, parked: 2)

    let unheardOf = Frame.notification(
      method: "x.vendor.somethingNew", params: .object(["n": .int(1)]))
    var elapsed = Duration.zero
    while elapsed < .seconds(595) {
      clock.advance(by: .seconds(5))
      elapsed += .seconds(5)
      await settle(clock, parked: 2)
      if elapsed == .seconds(200) || elapsed == .seconds(400) { await socket.deliver(unheardOf) }
    }
    // 595 s from the hello, 195 s from the last frame: alive, ready, no error.
    #expect(await door.dials == 1)
    #expect(client.lastError == nil)
    if case .ready = client.state {} else { Issue.record("not ready: \(client.state)") }

    // 705 s: 305 s after the last frame — now it is dead.
    for _ in 0..<22 {
      clock.advance(by: .seconds(5))
      await settle(clock, parked: 2)
    }
    try await waitUntil("the deadline measured from the last frame") { await door.dials == 2 }
  }

  /// The tick says how often the next one comes, and that is what the deadline
  /// is measured in from then on.
  @Test func theTickSetsTheIntervalTheDeadlineIsMeasuredIn() async throws {
    let clock = ManualProductClock()
    let door = try idleBoardDoor(clock: clock, answersPings: false)
    let client = keptClient(door, clock: clock)
    defer { client.close() }
    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    let socket = try #require(await door.latest)
    await socket.deliver(tick(intervalMs: 20_000))
    try await waitUntil("the tick's interval") { client.doorTickIntervalMs == 20_000 }
    await settle(clock, parked: 2)

    for _ in 0..<9 {  // 45 s
      clock.advance(by: .seconds(5))
      await settle(clock, parked: 2)
    }
    #expect(await door.dials == 1)
    clock.advance(by: .seconds(10))  // 55 s: past 2.5 × 20 s
    try await waitUntil("a deadline of fifty seconds") { await door.dials == 2 }
  }

  /// A tick this client cannot measure a deadline in is noted and never
  /// applied — the tolerant reader's answer to a value it cannot use.
  @Test func aTickThisClientCannotMeasureIsNotedNotApplied() async throws {
    let clock = ManualProductClock()
    let door = try idleBoardDoor(clock: clock)
    let client = keptClient(door, clock: clock)
    defer { client.close() }
    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    let socket = try #require(await door.latest)
    await socket.deliver(tick(intervalMs: 20_000))
    try await waitUntil("the first tick") { client.doorTickIntervalMs == 20_000 }
    await socket.deliver(tick(intervalMs: 5))
    try await waitUntil("a note about the tick") {
      client.tolerantNotes.contains { $0.contains("system.tick") }
    }
    #expect(client.doorTickIntervalMs == 20_000)
    if case .ready = client.state {} else { Issue.record("not ready: \(client.state)") }
  }

  /// SP-2 (c) — a suspended app reads no frames and sends no pings, so its
  /// keepalive is paused with it: a deadline measured across a suspension would
  /// call a healthy door dead on the way back — every door at once. Back, the
  /// deadline starts FRESH and one ping goes at once, so a socket that died
  /// while the phone was away is found by asking.
  @Test func aPausedKeepaliveNeverCallsASuspendedDoorDead() async throws {
    let clock = ManualProductClock()
    let door = try idleBoardDoor(clock: clock, answersPings: false)
    let client = keptClient(door, clock: clock)
    defer { client.close() }
    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    let socket = try #require(await door.latest)
    await settle(clock, parked: 2)

    client.pauseKeepalive()
    await settle(clock, parked: 0)
    for _ in 0..<30 {  // thirty minutes away
      clock.advance(by: .seconds(60))
      await settle(clock, parked: 0)
    }
    #expect(await door.dials == 1)
    #expect(client.silentDoorCloses == 0)
    #expect(await socket.pings == 0)

    client.resumeKeepalive()
    try await waitUntil("a ping the moment the phone is back") { await socket.pings == 1 }
    await settle(clock, parked: 2)
    for _ in 0..<59 {  // 295 s after coming back: the deadline started fresh
      clock.advance(by: .seconds(5))
      await settle(clock, parked: 2)
    }
    #expect(await door.dials == 1)
    clock.advance(by: .seconds(10))
    try await waitUntil("the fresh deadline to bite") { await door.dials == 2 }
  }

  /// The pure half, pinned: 2.5 intervals, the registry's interval until the
  /// door names its own, and two minutes of silence before a ping.
  @Test func theNumbersAreTheRegistrysAndTwoAndAHalfIntervals() {
    let keepalive = ProductKeepalive()
    #expect(FieldProductContract.doorTickIntervalMs == 120_000)
    #expect(keepalive.receiveDeadline(intervalMs: nil) == .seconds(300))
    #expect(keepalive.receiveDeadline(intervalMs: 20_000) == .seconds(50))
    #expect(keepalive.pingAfter == .seconds(120))
    #expect(keepalive.pingAfter < .seconds(600))
    // the ping follows the door's own interval, capped at two minutes
    #expect(keepalive.pingAfter(intervalMs: nil) == .seconds(120))
    #expect(keepalive.pingAfter(intervalMs: 30_000) == .seconds(30))
    #expect(keepalive.pingAfter(intervalMs: 120_000) == .seconds(120))
    #expect(keepalive.pingAfter(intervalMs: 600_000) == .seconds(120))
  }
}
