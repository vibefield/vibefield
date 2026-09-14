import FieldProduct
import FieldRoutedTerminal
import Foundation
import GhostteaFrame
import Testing

@testable import FieldTerminal

/// TM-5's witness: the phone's ATTACHMENT, over the routed client, over a real
/// socket, against a cell door that answers the way `field-native`'s does.
///
/// The ticket is built from the contracts' OWN golden
/// (`tp-remote-open-ticket.valid.json`, copied into this bundle and kept
/// byte-identical by `pnpm check:ios-fixtures`) with two edits, each stated
/// where it is made: the endpoints are pointed at the harness's loopback port
/// (the golden names a tailnet host this simulator cannot route to) and the
/// grant windows are re-stamped live (the golden's are fixed timestamps from
/// 2026-08-26 and the client refuses an expired grant BEFORE it dials, which is
/// exactly the check it should make). Everything else — the shape, the claims,
/// the rights, the route binding — is the golden's.
@Suite struct AttachmentOverTheDoorTests {
  // MARK: The ticket

  /// The golden, with live windows and a loopback authority.
  static func ticketJSON(port: UInt16, sessionId: String = "sess-01J8Z3K9") throws -> JSONValue {
    guard
      let url = Bundle.module.url(
        forResource: "tp-remote-open-ticket.valid", withExtension: "json", subdirectory: "Fixtures")
    else { throw MissingFixture() }
    var ticket = try #require(try JSONValue.parse(try Data(contentsOf: url)).objectValue)
    let boot = try #require(ticket["route"]?["cellBootId"]?.stringValue)

    ticket["endpoints"] = .object([
      "controlUrl": .string("ws://127.0.0.1:\(port)/cell/\(boot)/control"),
      "framesUrl": .string("ws://127.0.0.1:\(port)/cell/\(boot)/frames"),
    ])
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    ticket["transportGrant"] = try restamp(
      ticket["transportGrant"], from: now, lifetimeMs: 60_000, sessionId: nil)
    ticket["attachGrant"] = try restamp(
      ticket["attachGrant"], from: now, lifetimeMs: 600_000, sessionId: sessionId)
    return .object(ticket)
  }

  /// Move one grant's window onto the clock this test runs on, and nothing
  /// else. The MAC is NOT recomputed — this phone holds no key and never mints,
  /// and the harness verifies no MAC; what the golden pins here is the SHAPE the
  /// client reads, which is untouched.
  private static func restamp(
    _ grant: JSONValue?, from now: Int64, lifetimeMs: Int64, sessionId: String?
  ) throws -> JSONValue {
    var grant = try #require(grant?.objectValue)
    var claims = try #require(grant["claims"]?.objectValue)
    claims["issuedAt"] = .int(now - 1_000)
    claims["expiresAt"] = .int(now + lifetimeMs)
    if let sessionId { claims["sessionId"] = .string(sessionId) }
    grant["claims"] = .object(claims)
    return .object(grant)
  }

  struct MissingFixture: Error, CustomStringConvertible {
    var description: String { "tp-remote-open-ticket.valid.json is not in the test bundle" }
  }

  // MARK: Waiting

  /// Wait for something to become true, bounded, and FAIL AS ITSELF on a
  /// timeout — a wait that gave up silently would be reported as whatever
  /// expectation ran next, which is how a flake gets blamed on the wrong line.
  static func until(
    _ what: String, timeout: Duration = .seconds(5), _ condition: @Sendable () async -> Bool
  ) async throws {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
      if await condition() { return }
      try await Task.sleep(for: .milliseconds(10))
    }
    Issue.record("timed out waiting for \(what)")
    throw TimedOut(what: what)
  }

  /// The same, for a value that arrives rather than a flag that flips.
  static func value<T: Sendable>(
    _ what: String, timeout: Duration = .seconds(5), _ read: @Sendable () async -> T?
  ) async throws -> T {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
      if let value = await read() { return value }
      try await Task.sleep(for: .milliseconds(10))
    }
    Issue.record("timed out waiting for \(what)")
    throw TimedOut(what: what)
  }

  struct TimedOut: Error { let what: String }

  /// How many tickets the door has been asked for. A counter rather than a
  /// captured `var` because the waits below run off the main actor and Swift 6
  /// is right to refuse a mutable capture across that line.
  @MainActor
  final class Mints {
    private(set) var count = 0
    /// Whether the NEXT mint is refused — for the rows where the door changes
    /// its mind partway through a session.
    var refusing = false
    func record() { count += 1 }
  }

  /// The daemon's refusal for a desktop that has stopped carrying its terminal
  /// doors onto the tailnet — the one `doorWords` turns into a sentence.
  static func doorsNotPublished() -> FieldProductError {
    FieldProductError(
      kind: "UNAVAILABLE",
      message: "this device is not publishing its terminal doors on the tailnet",
      retryable: true,
      details: .object([
        "service": .string("terminal"), "state": .string("doors_not_published"),
      ]))
  }

  // MARK: The witness

  @MainActor
  @Test func aLiveSessionPaintsTheRendererAndTakesAKeystroke() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }

    let frames = try LaneFrames.load()
    let identity = try decodeTRF1Frame(frames.seed)
    let session = "sess-01J8Z3K9"
    let mints = Mints()

    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { asked in
        #expect(asked == session)
        mints.record()
        return try Self.ticketJSON(port: port, sessionId: session)
      })

    attachment.attach(sessionID: session, cols: 80, rows: 24, deviceName: "studio")

    // 1. Both legs dial, both hellos land, and the client attaches the session
    //    the JOIN named — ONE activation across the two of them.
    let control = try await Self.value("the control leg to attach") { await door.controlAttach }
    let framesAttach = try await Self.value("the frames leg to attach") { await door.framesAttach }
    let activation = control.activationId
    #expect(framesAttach.activationId == activation)
    #expect(await door.helloCount[.control] == 1)
    #expect(await door.helloCount[.frames] == 1)
    // ONE mint for the pair: a ticket authorises a connection SET, not a leg.
    #expect(mints.count == 1)

    // 2. The cell acknowledges both legs, declaring the TRF1 identity the seed
    //    frame actually carries.
    await door.send(
      .controlLegAttached,
      Script.controlAttached(session: session, activation: activation, rights: ["input", "read"]),
      on: .control)
    await door.send(
      .framesLegAttached,
      Script.framesAttached(
        session: session, activation: activation,
        sessionHandle: String(identity.sessionHandle), viewHandle: String(identity.viewHandle)),
      on: .frames)

    // 3. The seed frame. It reaches the renderer's frame path BYTE FOR BYTE —
    //    the cell rendered it once, and nothing on this device re-encodes it.
    let seedStamp = Script.stamp(1)
    let unit = try Script.frame(
      session: session, activation: activation, sequence: 1, creditEpoch: 1,
      base: nil, result: seedStamp, payload: frames.seed)
    await door.sendUnit(unit)
    try await Self.until("the seed frame to reach the renderer") {
      await MainActor.run { attachment.frame == frames.seed }
    }

    // 4. The cell says it is presenting and input is allowed; only then is the
    //    card live and only then may a keystroke leave this device.
    await door.send(
      .cellActivationStatus,
      Script.status(session: session, activation: activation, sequence: 1, accepted: seedStamp),
      on: .control)
    try await Self.until("the card to go live") {
      await MainActor.run { attachment.phase == .live }
    }
    #expect(attachment.readWrite)
    #expect(attachment.acceptsInput)

    attachment.typeText("ls\n")
    let input = try await Self.value("the keystroke to land on the control leg") {
      await door.inputs.first
    }
    #expect(input["op"]?["kind"]?.stringValue == "text")
    #expect(input["op"]?["text"]?.stringValue == "ls\n")
    #expect(input["activationId"]?.stringValue == activation)
    // It rode the CONTROL leg, which is where every verb goes; the frames leg
    // carries bytes in one direction only.
    #expect(await door.inputs.count == 1)

    await attachment.detach()
    #expect(attachment.phase == TerminalPhase.idle)
  }

  @MainActor
  @Test func aLostLegReMintsRatherThanReDialing() async throws {
    // The rule TM-4 found in the cell and this slice has to honour end to end:
    // a transport grant's `(nonce, channel)` is CONSUMED at first use, so a leg
    // replacement is a fresh mint through the product door — never a re-dial
    // with the ticket in hand, which could only ever earn a refusal.
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }

    let session = "sess-01J8Z3K9"
    let mints = Mints()
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in
        mints.record()
        return try Self.ticketJSON(port: port, sessionId: session)
      })

    attachment.attach(sessionID: session, cols: 80, rows: 24, deviceName: "studio")
    let first = try await Self.value("the first attach") { await door.controlAttach?.activationId }
    #expect(mints.count == 1)

    await door.rotate()
    await door.hangUp(.frames, code: 1001)

    // A second MINT — not a second dial with the same ticket.
    try await Self.until("a re-mint through the product door") {
      await MainActor.run { mints.count >= 2 }
    }
    let second = try await Self.value("the replacement attach") {
      await door.controlAttach?.activationId
    }
    // And a NEW activation: the client mints one per attempt and never reuses
    // an id, so a replacement can never be mistaken for the set it replaced.
    #expect(second != first)

    await attachment.detach()
  }

  @MainActor
  @Test func aReMintTheDoorRefusesReachesTheCardRatherThanConnectingForever() async throws {
    // TM-r3, K-M2. The first attach's refusal has always reached a face. A
    // refusal on the RE-mint — the desktop stopped publishing its doors while
    // this session was live — did not: the client retried forever under
    // `.reconnecting`, the card read "connecting over the mesh…" with no banner
    // and no end, and `doorRefusal` was being kept for a `.refused` phase that
    // only the first attach could ever set.
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }

    let session = "sess-01J8Z3K9"
    let mints = Mints()
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in
        mints.record()
        if mints.refusing { throw Self.doorsNotPublished() }
        return try Self.ticketJSON(port: port, sessionId: session)
      })

    attachment.attach(sessionID: session, cols: 80, rows: 24, deviceName: "studio")
    _ = try await Self.value("the first attach") { await door.controlAttach?.activationId }
    // The precondition, pinned: a live session carries no banner, so the one
    // below is the refusal arriving and not a banner that was always there.
    #expect(mints.count == 1)
    #expect(attachment.banner == nil)

    mints.refusing = true
    await door.rotate()
    await door.hangUp(.frames, code: 1001)

    try await Self.until("the refused re-mint to reach the face") {
      await MainActor.run {
        if case .refused = attachment.phase { return true }
        return false
      }
    }
    #expect(mints.count >= 2)
    #expect(
      attachment.phase
        == TerminalPhase.refused("studio is not publishing its terminal doors on the tailnet"))
    let banner = try #require(attachment.banner)
    #expect(banner.title == "studio is not publishing its terminal doors on the tailnet")
    #expect(banner.coolsTerminal)
    #expect(banner.actions.contains(TerminalBanner.Action.retryNow))

    // …and the refusal RETIRES when the door starts answering again. Without
    // this the card would keep a stale refusal over a session that reconnected,
    // which is the same lie in the other direction.
    mints.refusing = false
    try await Self.until("the card to leave the refusal behind") {
      await MainActor.run {
        if case .refused = attachment.phase { return false }
        return true
      }
    }
    await attachment.detach()
  }

  @MainActor
  @Test func aDesktopNotPublishingItsDoorsSaysSoRatherThanShowingABlank() async throws {
    // The face this slice exists to give: fieldd answered, and its answer is
    // that this device is not carrying its terminal doors onto the tailnet. No
    // socket is opened — there is nothing to dial — and the card says the
    // daemon's own fact in words a person can act on.
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in
        throw FieldProductError(
          kind: "UNAVAILABLE",
          message: "this device is not publishing its terminal doors on the tailnet",
          retryable: true,
          details: .object([
            "service": .string("terminal"), "state": .string("doors_not_published"),
          ]))
      })

    attachment.attach(sessionID: "sess-1", cols: 80, rows: 24, deviceName: "studio")
    try await Self.until("the refusal to reach the face") {
      await MainActor.run {
        if case .refused = attachment.phase { return true }
        return false
      }
    }
    #expect(
      attachment.phase
        == TerminalPhase.refused("studio is not publishing its terminal doors on the tailnet"))
    let banner = try #require(attachment.banner)
    #expect(banner.title == "studio is not publishing its terminal doors on the tailnet")
    #expect(banner.coolsTerminal)
    #expect(banner.actions.contains(TerminalBanner.Action.retryNow))
    #expect(attachment.frame == nil)
  }

  @MainActor
  @Test func aGrantOutsideItsWindowIsRefusedBeforeASocketIsSpent() async throws {
    // The client's own pre-dial check, reached through the attachment: a grant
    // outside its window earns a SILENT `1008` at the real door, which carries
    // no reason at all — so it is named here instead of guessed at afterwards.
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }

    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in
        // The golden's OWN fixed timestamps, unmoved: they expired in 2026-08.
        guard
          let url = Bundle.module.url(
            forResource: "tp-remote-open-ticket.valid", withExtension: "json",
            subdirectory: "Fixtures")
        else { throw MissingFixture() }
        var ticket = try #require(try JSONValue.parse(try Data(contentsOf: url)).objectValue)
        let boot = try #require(ticket["route"]?["cellBootId"]?.stringValue)
        ticket["endpoints"] = .object([
          "controlUrl": .string("ws://127.0.0.1:\(port)/cell/\(boot)/control"),
          "framesUrl": .string("ws://127.0.0.1:\(port)/cell/\(boot)/frames"),
        ])
        return .object(ticket)
      })

    attachment.attach(sessionID: "sess-01J8Z3K9", cols: 80, rows: 24, deviceName: "studio")
    try await Self.until("the stale grant to reach a face") {
      await MainActor.run {
        if case .refused = attachment.phase { return true }
        return false
      }
    }
    #expect(
      attachment.phase
        == TerminalPhase.refused("the ticket's transport grant is not currently valid"))
    // And NOTHING was dialed: the refusal happened before a socket was spent.
    #expect(await door.accepted == 0)
  }
}
