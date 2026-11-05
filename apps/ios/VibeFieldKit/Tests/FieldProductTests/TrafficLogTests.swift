import Foundation
import Testing

@testable import FieldProduct

// SP-2 (h) — each subscription's bytes per second, one debug line per ten
// seconds per subscription that received anything, and nothing at all from one
// that is idle (an idle board costs nothing, and neither does its log).

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

/// Every line the client wrote, and every frame the door sent a subscription.
private final class Recorded: @unchecked Sendable {
  private let lock = NSLock()
  private var traffic: [SubscriptionTraffic] = []
  private var sent: [String: [String]] = [:]
  func add(_ line: SubscriptionTraffic) { lock.withLock { traffic.append(line) } }
  var lines: [SubscriptionTraffic] { lock.withLock { traffic } }
  func sent(_ frame: String, to subId: String) -> String {
    lock.withLock { sent[subId, default: []].append(frame) }
    return frame
  }
  func bytes(to subId: String) -> Int {
    lock.withLock { sent[subId, default: []].reduce(0) { $0 + $1.utf8.count } }
  }
  func clear(_ subId: String) { lock.withLock { sent[subId] = [] } }
}

@MainActor
@Suite struct TrafficLogTests {
  @Test func eachSubscriptionLogsItsBytesPerSecondOncePerTenSeconds() async throws {
    let clock = ManualProductClock()
    let recorded = Recorded()
    let ack = try Fixture.json("hello-ack.valid")
    let snapshot = try Fixture.json("agent-field-snapshot.valid")
    let door = FakeDoor(clock: clock) { method, id, _ in
      switch method {
      case "system.hello": return [Frame.result(id: id, ack)]
      case "agent.subscribe":
        return [
          recorded.sent(
            Frame.result(id: id, .object(["subId": .string("sub-a"), "snapshot": snapshot])),
            to: "sub-a")
        ]
      case "device.subscribe":
        return [
          recorded.sent(
            Frame.result(id: id, .object(["subId": .string("sub-d"), "snapshot": .array([])])),
            to: "sub-d")
        ]
      default: return []
      }
    }
    let client = FieldProductClient(
      url: URL(string: "ws://studio.tail1234.ts.net/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM")!,
      transport: door,
      options: .init(
        maxBackoff: .milliseconds(1), callTimeout: .seconds(5), clock: clock,
        trafficLog: { recorded.add($0) }, logLabel: "dev-studio"))
    defer { client.close() }
    let board = try await client.subscribe(
      "agent.subscribe", params: nil, shape: .snapshotDelta(), onSnapshot: { _ in },
      onDelta: { _ in })
    let roster = try await client.subscribe(
      "device.subscribe", params: nil, onSnapshot: { _ in }, onDelta: { _ in })
    let socket = try #require(await door.latest)

    func delta(_ since: Int64) -> String {
      Frame.subscriptionEvent(
        method: "agent.subscribe.delta", subId: "sub-a",
        payload: .object([
          "epoch": .string("fieldd-5d1e2a7c90b3f418.1"), "since": .int(since),
          "revision": .int(since + 1), "upserts": .array([]), "removed": .array([]),
        ]))
    }

    // Window one: both open answers at 0 s, three board deltas at 2, 4, 6 s.
    var revision: Int64 = 64
    for second in 1...9 {
      clock.advance(by: .seconds(1))
      if [2, 4, 6].contains(second) {
        await socket.deliver(recorded.sent(delta(revision), to: "sub-a"))
        revision += 1
      }
      await settle(clock, parked: 3)
    }
    #expect(recorded.lines.isEmpty, "nothing is written before the window closes")
    let boardBytes = recorded.bytes(to: "sub-a")
    let rosterBytes = recorded.bytes(to: "sub-d")
    recorded.clear("sub-a")
    clock.advance(by: .seconds(1))  // 10 s: the window closes
    try await waitUntil("a line for each subscription") { recorded.lines.count == 2 }
    let first = recorded.lines.sorted { $0.method < $1.method }
    #expect(first.map(\.method) == ["agent.subscribe", "device.subscribe"])
    try #require(first.count == 2)
    #expect(first[0].frames == 4)
    #expect(first[0].bytes == boardBytes)
    #expect(first[0].bytesPerSecond == Double(boardBytes) / 10)
    #expect(first[0].subId == "sub-a")
    #expect(first[0].line.contains("door[dev-studio] agent.subscribe sub-a"))
    #expect(first[0].line.contains("B/s"))
    #expect(first[1].frames == 1)
    #expect(first[1].bytes == rosterBytes)

    // Window two: the board alone, two deltas — so the roster writes NOTHING.
    for second in 11...30 {
      clock.advance(by: .seconds(1))
      if [12, 14].contains(second) {
        await socket.deliver(recorded.sent(delta(revision), to: "sub-a"))
        revision += 1
      }
      await settle(clock, parked: 2)
    }
    try await waitUntil("the board's second line") { recorded.lines.count == 3 }
    let lines = recorded.lines
    try #require(lines.count == 3)
    let second = lines[2]
    #expect(second.method == "agent.subscribe")
    #expect(second.frames == 2)
    #expect(second.bytes == recorded.bytes(to: "sub-a"))

    // An idle minute writes nothing at all.
    for _ in 0..<6 {
      clock.advance(by: .seconds(10))
      await settle(clock, parked: 2)
    }
    try await Task.sleep(for: .milliseconds(30))
    #expect(recorded.lines.count == 3)
    board.cancel()
    roster.cancel()
  }

  /// PG-9 S4b — a whole-board snapshot mid-stream (the home's PG-1c resync of a phone behind its cap, or an owner's
  /// reset) is counted as a RESET in its window, beside the frames and the bytes: M2's reading under the link
  /// conditioner is how many whole boards crossed, not only how many bytes.
  @Test func aMidStreamSnapshotIsCountedAsAResetInItsWindow() async throws {
    let clock = ManualProductClock()
    let recorded = Recorded()
    let ack = try Fixture.json("hello-ack.valid")
    let open = try Fixture.json("agent-remote-mesh-open.valid")
    let door = FakeDoor(clock: clock) { method, id, _ in
      switch method {
      case "system.hello": return [Frame.result(id: id, ack)]
      case "agent.subscribe":
        return [
          recorded.sent(
            Frame.result(id: id, .object(["subId": .string("sub-m"), "snapshot": open])), to: "sub-m")
        ]
      default: return []
      }
    }
    let client = FieldProductClient(
      url: URL(string: "ws://studio.tail1234.ts.net/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM")!,
      transport: door,
      options: .init(
        maxBackoff: .milliseconds(1), callTimeout: .seconds(5), clock: clock,
        trafficLog: { recorded.add($0) }, logLabel: "dev-studio"))
    defer { client.close() }
    let board = try await client.subscribe(
      "agent.subscribe", params: nil, onSnapshot: { _ in }, onDelta: { _ in })
    let socket = try #require(await door.latest)
    for second in 1...9 {
      clock.advance(by: .seconds(1))
      if second == 3 {
        // the home's resync: the whole mesh again, as one `.snapshot`
        await socket.deliver(
          recorded.sent(
            Frame.subscriptionEvent(method: "agent.subscribe.snapshot", subId: "sub-m", payload: open), to: "sub-m"))
      }
      if second == 5 {
        let frame = JSONValue.object([
          "device": .string("dev-01HQ9S7UD1"), "state": .string("live"), "asOf": .string("x"),
        ])
        await socket.deliver(
          recorded.sent(
            Frame.subscriptionEvent(method: "agent.subscribe.delta", subId: "sub-m", payload: frame), to: "sub-m"))
      }
      await settle(clock, parked: 3)
    }
    clock.advance(by: .seconds(1))
    try await waitUntil("the window's line") { recorded.lines.count == 1 }
    let line = try #require(recorded.lines.first)
    #expect(line.frames == 3)
    #expect(line.resets == 1)
    #expect(line.bytes == recorded.bytes(to: "sub-m"))
    #expect(line.line.contains("3 frames, 1 reset,"))
    board.cancel()
  }
}
