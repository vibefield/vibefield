import Foundation
import Testing

@testable import FieldProduct

// SP-2 (d) — roster-aware dialing: the roster is asked before EVERY dial, the
// first and every re-dial alike. A peer the roster calls asleep or gone is
// never dialled; one it calls awake or restarting always is (a restarting
// desktop's node answers while its daemon comes back, and the backoff ladder is
// exactly what it needs).

/// The roster's word for one peer, flipped by the test.
private final class RosterWord: @unchecked Sendable {
  private let lock = NSLock()
  private var online: Bool
  private(set) var asked = 0
  init(online: Bool) { self.online = online }
  func set(online: Bool) { lock.withLock { self.online = online } }
  var asks: Int { lock.withLock { asked } }
  var mayDial: @Sendable () async -> Bool {
    { [self] in
      lock.withLock {
        asked += 1
        return online
      }
    }
  }
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

@MainActor
private func rosterClient(_ door: FakeDoor, roster: RosterWord, clock: ManualProductClock? = nil)
  -> FieldProductClient
{
  FieldProductClient(
    url: URL(string: "ws://studio.tail1234.ts.net/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM")!,
    transport: door,
    options: .init(
      maxBackoff: .milliseconds(1), callTimeout: .seconds(5),
      clock: clock ?? ManualProductClock(), mayDial: roster.mayDial))
}

private func helloDoor(clock: ManualProductClock? = nil, answersPings: Bool = true) throws -> FakeDoor {
  let ack = try Fixture.json("hello-ack.valid")
  return FakeDoor(clock: clock, answersPings: answersPings) { method, id, _ in
    method == "system.hello" ? [Frame.result(id: id, ack)] : []
  }
}

@MainActor
@Suite struct RosterDialTests {
  /// A desktop the tailnet calls asleep is never dialled — not on the first
  /// connect and not on any re-dial — and the client says WHY, in the honest
  /// degraded shape, instead of spending a socket to find out.
  @Test func aPeerTheRosterCallsAsleepIsNeverDialled() async throws {
    let door = try helloDoor()
    let roster = RosterWord(online: false)
    let client = rosterClient(door, roster: roster)
    defer { client.close() }

    client.connect()
    try await waitUntil("the roster to be asked") { roster.asks >= 1 }
    try await Task.sleep(for: .milliseconds(50))
    #expect(await door.dials == 0)
    #expect(client.state == .reconnecting)
    #expect(client.lastError?.unavailable?.state == "asleep")

    // It wakes. The link watches the roster and says so with `connect()`.
    roster.set(online: true)
    client.connect()
    try await waitUntil("ready once awake") { if case .ready = client.state { true } else { false } }
    #expect(await door.dials == 1)
  }

  /// The socket drops while the roster says the desktop went to sleep: the
  /// client PARKS rather than climbing the backoff ladder against a machine
  /// that is not there.
  @Test func aDropWhileTheRosterSaysAsleepParksInsteadOfRedialing() async throws {
    let door = try helloDoor()
    let roster = RosterWord(online: true)
    let client = rosterClient(door, roster: roster)
    defer { client.close() }
    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }

    roster.set(online: false)
    await door.latest?.drop()
    try await waitUntil("the drop to be heard") { client.state == .reconnecting }
    try await Task.sleep(for: .milliseconds(80))  // dozens of 1 ms backoff rungs
    #expect(await door.dials == 1)
    #expect(client.parkedDials >= 1)

    roster.set(online: true)
    client.connect()
    try await waitUntil("a dial after the wake") { await door.dials == 2 }
    try await waitUntil("ready again") { if case .ready = client.state { true } else { false } }
  }

  /// SP-2 (b) + (d): a door that went silent is closed, and dialled again BY
  /// THE ROSTER — not at all while the tailnet calls its desktop asleep.
  @Test func aSilentDoorIsRedialledByTheRoster() async throws {
    let clock = ManualProductClock()
    let door = try helloDoor(clock: clock, answersPings: false)
    let roster = RosterWord(online: true)
    let client = rosterClient(door, roster: roster, clock: clock)
    defer { client.close() }
    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    await settle(clock, parked: 2)

    roster.set(online: false)
    for _ in 0..<62 {  // 310 s: past 2.5 × 120 s
      clock.advance(by: .seconds(5))
      await settle(clock, parked: 2)
    }
    try await waitUntil("the silent door closed") { client.silentDoorCloses == 1 }
    try await Task.sleep(for: .milliseconds(50))
    #expect(await door.dials == 1)
    #expect(client.parkedDials >= 1)
    #expect(client.lastError?.unavailable?.state == "asleep")
  }

  /// A caller waiting on `ready()` for a desktop the roster calls asleep is
  /// TOLD, rather than left waiting for a dial that will not happen.
  @Test func aReadyWaiterOnAnAsleepDesktopIsToldWhy() async throws {
    let door = try helloDoor()
    let roster = RosterWord(online: false)
    let client = rosterClient(door, roster: roster)
    defer { client.close() }

    do {
      try await client.ready()
      Issue.record("ready() returned for a desktop the roster calls asleep")
    } catch let error as FieldProductError {
      #expect(error.unavailable?.state == "asleep")
      #expect(error.retryable)
    }
    #expect(await door.dials == 0)
  }

  /// RESTARTING is dialled: its node is on the tailnet and its daemon is coming
  /// back, so refused dials climb the ladder until the door answers.
  @Test func aRestartingDesktopIsStillDialled() async throws {
    let door = try helloDoor()
    await door.refuseDials(2)
    let roster = RosterWord(online: true)
    let client = rosterClient(door, roster: roster)
    defer { client.close() }

    client.connect()
    try await waitUntil("ready after the daemon came back") {
      if case .ready = client.state { true } else { false }
    }
    #expect(await door.dials == 3)
    #expect(roster.asks >= 3)
  }
}
