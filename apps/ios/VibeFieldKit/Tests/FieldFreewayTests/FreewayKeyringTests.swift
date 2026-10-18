import FieldProduct
import Foundation
import Testing

@testable import FieldFreeway

/// A clock a row moves by hand.
final class HandClock: @unchecked Sendable {
  private let lock = NSLock()
  private var ms: Int64

  init(_ ms: Int64) { self.ms = ms }

  var now: Int64 { lock.withLock { ms } }
  func set(_ value: Int64) { lock.withLock { ms = value } }
}

/// The golden ticket's issue time: its transport grant lives to +60 s, its attach grant to +120 s.
private let issued: Int64 = 1_787_788_800_000
/// The golden's one ticket, and its one refusal.
private let ticketed = "sess-01J8Z3K9"
private let refused = "sess-01J8Z4QX"

@MainActor
private func keyring(_ link: FreewayLink?, clock: HandClock) -> FreewayKeyring {
  var timing = FreewayKeyring.Timing()
  timing.now = { clock.now }
  return FreewayKeyring(link: { link }, timing: timing)
}

/// Wait a bounded while for what the keyring's own task brings about.
@MainActor
private func eventually(_ what: String, _ condition: () -> Bool) async throws {
  for _ in 0..<500 {
    if condition() { return }
    try await Task.sleep(nanoseconds: 10_000_000)
  }
  Issue.record("never: \(what)")
}

@Suite("the keyring: tickets held before the tap (FreewayKeyring)", .timeLimit(.minutes(1)))
@MainActor
struct FreewayKeyringTests {
  @Test("a listed session's ticket is minted on the standing link and handed out once; a refused one holds nothing")
  func heldOnce() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let keys = keyring(link, clock: HandClock(issued))
    keys.want([ticketed, refused])
    let (_, open) = try await answerOpen(host, with: try golden("freeway-opened.tickets"))
    #expect(open["kind"]?.stringValue == "terminal-tickets")
    #expect(open["sessionIds"] == .array([.string(ticketed), .string(refused)]))
    try await eventually("the ticket held") { keys.heldTickets == [ticketed] }
    let expected = try golden("freeway-opened.tickets")["tickets"]?.arrayValue?.first?["ticket"]
    #expect(await keys.take(ticketed) == expected)
    #expect(await keys.take(ticketed) == nil, "a held ticket is handed out once")
    #expect(await keys.take(refused) == nil)
    await link.close()
  }

  @Test("a session an attachment holds is never asked for, and is again once released")
  func held() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let keys = keyring(link, clock: HandClock(issued))
    keys.want([ticketed, refused])
    _ = try await answerOpen(host, with: try golden("freeway-opened.tickets"))
    try await eventually("the ticket held") { keys.heldTickets == [ticketed] }
    _ = await keys.take(ticketed)
    // a pass asks only for what no attachment holds, and keeps nothing the host says of the held
    let pass = Task { await keys.mint() }
    let (_, open) = try await answerOpen(host, with: try golden("freeway-opened.tickets"))
    #expect(open["sessionIds"] == .array([.string(refused)]))
    await pass.value
    #expect(keys.heldTickets.isEmpty)
    keys.release(ticketed)
    let (_, again) = try await answerOpen(host, with: try golden("freeway-opened.tickets"))
    #expect(again["sessionIds"] == .array([.string(ticketed), .string(refused)]))
    try await eventually("held again") { keys.heldTickets == [ticketed] }
    await link.close()
  }

  @Test("a pass mints again a ticket that would run out before the next one, and one inside its margin is not handed out")
  func margin() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let clock = HandClock(issued)
    let keys = keyring(link, clock: clock)
    keys.want([ticketed])
    _ = try await answerOpen(host, with: try golden("freeway-opened.tickets"))
    try await eventually("the ticket held") { keys.heldTickets == [ticketed] }
    // 30 s on, 15 s of its usable life left: the next pass would come after it, so this one mints
    clock.set(issued + 30_000)
    let pass = Task { await keys.mint() }
    let (_, open) = try await answerOpen(host, with: try golden("freeway-opened.tickets"))
    #expect(open["sessionIds"] == .array([.string(ticketed)]))
    await pass.value
    // the transport grant's expiry less the margin has passed: nothing is handed out
    clock.set(issued + 45_001)
    #expect(await keys.take(ticketed) == nil)
    await link.close()
  }

  @Test("a tap during a pass asking for its session waits for that answer and takes its ticket; nothing is asked for the session after")
  func tapDuringAsk() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let keys = keyring(link, clock: HandClock(issued))
    keys.want([ticketed])
    // the ask is out and not yet answered when the tap comes
    let open = try await within(5, "the ask") { try await host.nextFrame() }
    let taking = Task { await keys.take(ticketed) }
    try await eventually("the tap") { keys.held.contains(ticketed) }
    try await host.sendJSON(.opened, stream: open.stream, try golden("freeway-opened.tickets"))
    let expected = try golden("freeway-opened.tickets")["tickets"]?.arrayValue?.first?["ticket"]
    #expect(await taking.value == expected, "the tap takes the ticket of the ask it waited for")
    // held from here: a pass has nothing to ask for it, so it does not wait on an answer
    try await within(2, "a pass with nothing to ask") { await keys.mint() }
    await link.close()
  }

  @Test("a session no longer listed lets its ticket go")
  func unlisted() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let keys = keyring(link, clock: HandClock(issued))
    keys.want([ticketed])
    _ = try await answerOpen(host, with: try golden("freeway-opened.tickets"))
    try await eventually("the ticket held") { keys.heldTickets == [ticketed] }
    keys.want([])
    #expect(keys.heldTickets.isEmpty)
    #expect(await keys.take(ticketed) == nil)
    await link.close()
  }

  @Test("with no link standing, a pass mints nothing and dials nothing")
  func noLink() async throws {
    let keys = keyring(nil, clock: HandClock(issued))
    keys.want([ticketed])
    await keys.mint()
    #expect(keys.heldTickets.isEmpty)
    #expect(await keys.take(ticketed) == nil)
  }
}
