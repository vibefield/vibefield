import Foundation
import Testing

@testable import FieldProduct

/// F0 (the freeway, 2026-10-16) — the door's round trip, measured: one protocol
/// ping at hello, timed to its pong, named in a line the device console carries.
/// Opt-in, so every other suite's ping accounting stays exactly what it was.
@MainActor
@Suite struct DoorRoundTripTests {
  /// What the client said about each measurement.
  final class Lines: @unchecked Sendable {
    private let lock = NSLock()
    private var said: [(String?, Duration)] = []
    func record(_ label: String?, _ took: Duration) {
      lock.withLock { said.append((label, took)) }
    }
    var count: Int { lock.withLock { said.count } }
    var labels: [String?] { lock.withLock { said.map(\.0) } }
  }

  private func door() throws -> FakeDoor {
    let ack = try Fixture.json("hello-ack.valid")
    return FakeDoor { method, id, _ in
      method == "system.hello" ? [Frame.result(id: id, ack)] : []
    }
  }

  private func waitUntil(_ what: String, _ condition: () async -> Bool) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(5))
    while ContinuousClock.now < deadline {
      if await condition() { return }
      try await Task.sleep(for: .milliseconds(2))
    }
    Issue.record("timed out waiting for \(what)")
  }

  @Test func aPhonesDoorIsMeasuredAtHello() async throws {
    let door = try door()
    let lines = Lines()
    let client = FieldProductClient(
      url: URL(string: "ws://studio.tail1234.ts.net/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM")!,
      transport: door,
      options: .init(
        callTimeout: .seconds(5), measuresRoundTrip: true,
        roundTripLog: { label, took in lines.record(label, took) }, logLabel: "dev-studio"))
    defer { client.close() }
    client.connect()
    try await waitUntil("the first measurement") { lines.count == 1 }
    #expect(lines.labels == ["dev-studio"])
    #expect(client.roundTrip != nil)
    #expect(await door.latest?.pings == 1)
  }

  @Test func aDoorIsNotMeasuredUnlessAsked() async throws {
    let door = try door()
    let client = FieldProductClient(
      url: URL(string: "ws://studio.tail1234.ts.net/t/3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM")!,
      transport: door, options: .init(callTimeout: .seconds(5)))
    defer { client.close() }
    client.connect()
    try await waitUntil("ready") { if case .ready = client.state { true } else { false } }
    try await Task.sleep(for: .milliseconds(50))
    #expect(client.roundTrip == nil)
    #expect(await door.latest?.pings == 0)
  }

  @Test func theLineNamesTheDoorAndTheMilliseconds() {
    #expect(
      DoorRoundTrip.line(label: "dev-studio", .milliseconds(12)) == "door[dev-studio] round trip 12 ms")
    #expect(DoorRoundTrip.line(label: nil, .microseconds(11_900)) == "door round trip 11 ms")
  }
}
