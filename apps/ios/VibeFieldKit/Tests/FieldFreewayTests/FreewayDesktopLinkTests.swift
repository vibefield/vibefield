import FieldProduct
import Foundation
import Testing

@testable import FieldFreeway

/// The test's mesh: every dial is a fresh in-memory connection whose far end is handed to the row
/// as a scripted host, and every approval is numbered.
final class TestMesh: @unchecked Sendable {
  let hosts: AsyncStream<ScriptedHost>
  private let arrivals: AsyncStream<ScriptedHost>.Continuation
  private let lock = NSLock()
  private var dialCount = 0
  private var approvalCount = 0

  init() {
    let (stream, continuation) = AsyncStream<ScriptedHost>.makeStream()
    hosts = stream
    arrivals = continuation
  }

  var dials: Int { lock.withLock { dialCount } }
  var approvals: Int { lock.withLock { approvalCount } }

  func dial() -> any FreewayByteStream {
    let (phone, far) = MemoryStream.pair()
    lock.withLock { dialCount += 1 }
    arrivals.yield(ScriptedHost(far))
    return phone
  }

  func approve() -> JSONValue {
    let count = lock.withLock {
      approvalCount += 1
      return approvalCount
    }
    return .object([
      "approval": .object(["mac": .string("a\(count)")]), "expiresAt": .int(1_787_790_600_000),
    ])
  }

  func dialing() -> FreewayDesktopLink.Dialing {
    FreewayDesktopLink.Dialing(
      dial: { self.dial() }, host: "desk.tail1234.ts.net", deviceId: "dev-desk",
      approve: { self.approve() }, deviceName: "phone")
  }
}

/// A host that takes the dial: the upgrade, the hello (its approval's mac returned), the welcome.
func take(_ host: ScriptedHost) async throws -> String? {
  try await host.upgrade()
  let hello = try await host.nextLink()
  try await host.welcome()
  return hello["approval"]?["mac"]?.stringValue
}

func fast(_ adjust: (inout FreewayDesktopLink.Timing) -> Void = { _ in }) -> FreewayDesktopLink.Timing {
  var timing = FreewayDesktopLink.Timing()
  timing.backoffFloorMs = 20
  timing.backoffCeilingMs = 80
  timing.jitter = { _ in 0 }
  adjust(&timing)
  return timing
}

@Suite("a desktop's link, kept (FreewayDesktopLink)", .timeLimit(.minutes(1)))
struct FreewayDesktopLinkTests {
  @Test("the first ask dials with a fresh approval; the next ask is the same link, no dial")
  func firstAsk() async throws {
    let mesh = TestMesh()
    let desktop = FreewayDesktopLink(mesh.dialing(), timing: fast())
    var hosts = mesh.hosts.makeAsyncIterator()
    let asking = Task { try await desktop.link() }
    let host = try #require(await hosts.next())
    #expect(try await within(5, "the hello") { try await take(host) } == "a1")
    let link = try await within(5, "the link") { try await asking.value }
    #expect(try await desktop.link() === link)
    #expect(mesh.dials == 1)
    guard case .up(let welcome) = await desktop.state else {
      Issue.record("up")
      return
    }
    #expect(welcome.deviceId == "dev-desk")
    await desktop.stop()
  }

  @Test("a link that ends is dialed again on the backoff, with a fresh approval")
  func redial() async throws {
    let mesh = TestMesh()
    let desktop = FreewayDesktopLink(mesh.dialing(), timing: fast())
    var hosts = mesh.hosts.makeAsyncIterator()
    let asking = Task { try await desktop.link() }
    let first = try #require(await hosts.next())
    _ = try await within(5, "the first hello") { try await take(first) }
    let link = try await within(5, "the link") { try await asking.value }
    try await first.close(code: 4410, reason: "PEER_GONE")
    let second = try #require(await hosts.next())
    #expect(try await within(5, "the second hello") { try await take(second) } == "a2")
    let again = try await within(5, "the second link") { try await desktop.link() }
    #expect(again !== link)
    #expect(mesh.dials == 2)
    await desktop.stop()
  }

  @Test("a Restarting is waited out before the next dial")
  func restarting() async throws {
    let mesh = TestMesh()
    let desktop = FreewayDesktopLink(mesh.dialing(), timing: fast())
    var hosts = mesh.hosts.makeAsyncIterator()
    let asking = Task { try await desktop.link() }
    let first = try #require(await hosts.next())
    _ = try await within(5, "the hello") { try await take(first) }
    _ = try await within(5, "the link") { try await asking.value }
    try await first.sendLink(
      .object([
        "type": .string("Restarting"), "reason": .string("update"),
        "planes": .array([.string("field-native")]), "at": .int(1), "ttlMs": .int(400),
      ]))
    try await first.close(code: 4503, reason: "RESTARTING")
    let ended = Date()
    _ = try #require(await hosts.next())
    #expect(Date().timeIntervalSince(ended) >= 0.35, "the host said when it would be back")
    await desktop.stop()
  }

  @Test("a wake dials at once instead of waiting out the backoff")
  func wake() async throws {
    let mesh = TestMesh()
    let desktop = FreewayDesktopLink(
      mesh.dialing(), timing: fast { $0.backoffFloorMs = 30_000; $0.backoffCeilingMs = 30_000 })
    var hosts = mesh.hosts.makeAsyncIterator()
    let asking = Task { try await desktop.link() }
    let first = try #require(await hosts.next())
    _ = try await within(5, "the hello") { try await take(first) }
    _ = try await within(5, "the link") { try await asking.value }
    try await first.close(code: 4409, reason: "SUPERSEDED")
    while true {
      if case .waiting = await desktop.state { break }
      try await Task.sleep(nanoseconds: 5_000_000)
    }
    let woke = Date()
    await desktop.wake()
    _ = try #require(await hosts.next())
    #expect(Date().timeIntervalSince(woke) < 5)
    await desktop.stop()
  }

  @Test("the approval is renewed on the link at the renewal point")
  func renewal() async throws {
    let mesh = TestMesh()
    let desktop = FreewayDesktopLink(mesh.dialing(), timing: fast { $0.renewAfterMs = 50 })
    var hosts = mesh.hosts.makeAsyncIterator()
    let asking = Task { try await desktop.link() }
    let host = try #require(await hosts.next())
    _ = try await within(5, "the hello") { try await take(host) }
    _ = try await within(5, "the link") { try await asking.value }
    let renew = try await within(5, "the renew") { try await host.nextLink() }
    #expect(renew["type"]?.stringValue == "Renew")
    #expect(renew["approval"]?["mac"]?.stringValue == "a2")
    try await host.sendLink(
      .object(["type": .string("Renewed"), "approvalExpiresAt": .int(1_787_799_000_000)]))
    await desktop.stop()
  }

  @Test("a dial that never answers is abandoned at the deadline and dialed again")
  func deadline() async throws {
    let mesh = TestMesh()
    let desktop = FreewayDesktopLink(mesh.dialing(), timing: fast { $0.connectDeadlineMs = 100 })
    var hosts = mesh.hosts.makeAsyncIterator()
    let asking = Task { try await desktop.link() }
    _ = try #require(await hosts.next())  // takes the connection, never answers the upgrade
    await #expect(throws: (any Error).self) { try await within(5, "the abandoned dial") { try await asking.value } }
    let second = try #require(await hosts.next())
    _ = try await within(5, "the second hello") { try await take(second) }
    _ = try await within(5, "the link") { try await desktop.link() }
    await desktop.stop()
  }

  @Test("stopped, it closes the link and dials no more")
  func stop() async throws {
    let mesh = TestMesh()
    let desktop = FreewayDesktopLink(mesh.dialing(), timing: fast())
    var hosts = mesh.hosts.makeAsyncIterator()
    let asking = Task { try await desktop.link() }
    let host = try #require(await hosts.next())
    _ = try await within(5, "the hello") { try await take(host) }
    _ = try await within(5, "the link") { try await asking.value }
    await desktop.stop()
    #expect(try await within(5, "the close") { try await host.nextClose() } == 1000)
    try await Task.sleep(nanoseconds: 200_000_000)
    #expect(mesh.dials == 1)
    await #expect(throws: CancellationError.self) { try await desktop.link() }
  }
}
