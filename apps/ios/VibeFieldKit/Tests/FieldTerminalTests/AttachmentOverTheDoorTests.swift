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
  ///
  /// `attachLifetimeMs` is the attach grant's window. It is a parameter because
  /// the phone closes input a minute before that window ends unless a renewal
  /// lands, so a SHORT one is the only way to reach the closed-input face — or
  /// the renewal (P0-C) — without waiting nine real minutes (TM-r3, K-M1).
  static func ticketJSON(
    port: UInt16, sessionId: String = "sess-01J8Z3K9", attachLifetimeMs: Int64 = 600_000
  ) throws -> JSONValue {
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
      ticket["attachGrant"], from: now, lifetimeMs: attachLifetimeMs, sessionId: sessionId)
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
    //    the JOIN named on the CONTROL leg — the frames leg waits for the
    //    cell's acknowledgement (TPv3 §5.4, P0-H3: the control attach creates
    //    the activation, frames only binds it).
    let control = try await Self.value("the control leg to attach") { await door.controlAttach }
    let activation = control.activationId
    #expect(await door.framesAttach == nil)
    #expect(await door.helloCount[.control] == 1)
    #expect(await door.helloCount[.frames] == 1)
    // ONE mint for the pair: a ticket authorises a connection SET, not a leg.
    #expect(mints.count == 1)

    // 2. The cell acknowledges control, declaring the TRF1 identity the seed
    //    frame actually carries; the client then attaches frames on the SAME
    //    activation, and the cell acknowledges that too.
    await door.send(
      .controlLegAttached,
      Script.controlAttached(session: session, activation: activation, rights: ["input", "read"]),
      on: .control)
    let framesAttach = try await Self.value("the frames leg to attach") { await door.framesAttach }
    #expect(framesAttach.activationId == activation)
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

  /// DS-4b — the pane takes the seat when it gains FOCUS (presented and
  /// active): once when it is presented, and once more each time the app comes
  /// back to it — never on a mere resize of a pane that does not hold the
  /// seat. The take carries the grid the surface measured, not the 80 × 24
  /// the attach started with.
  @MainActor
  @Test func theFocusedPaneTakesTheSeatOncePerGain() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let session = "sess-01J8Z3K9"
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(), appearance: .default,
      door: { _ in try Self.ticketJSON(port: port, sessionId: session) })

    attachment.attach(sessionID: session, cols: 80, rows: 24, deviceName: "studio")
    attachment.setViewport(cols: 60, rows: 30)  // the surface measures before the leg attaches
    let control = try await Self.value("the control leg to attach") { await door.controlAttach }
    await door.send(
      .controlLegAttached,
      Script.controlAttached(
        session: session, activation: control.activationId, rights: ["geometry", "input", "read"]),
      on: .control)
    let take = try await Self.value("the take on focus") { await door.geometryVerbs.first }
    #expect(take["type"]?.stringValue == "ClaimGeometry")
    #expect(take["cols"]?.intValue == 60)
    #expect(take["rows"]?.intValue == 30)
    try await Task.sleep(for: .milliseconds(80))
    #expect(await door.geometryVerbs.count == 1, "once per gain")

    attachment.setViewport(cols: 70, rows: 30)
    try await Task.sleep(for: .milliseconds(80))
    #expect(await door.geometryVerbs.count == 1, "a resize is not a take")

    attachment.resumeFromForeground()
    try await Self.until("the second gain's take") { await door.geometryVerbs.count == 2 }
    await attachment.detach()
  }

  /// DS-4b — a grant without `geometry` sends no lease verb on focus.
  @MainActor
  @Test func aPaneWithoutTheGeometryRightTakesNothing() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let session = "sess-01J8Z3K9"
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(), appearance: .default,
      door: { _ in try Self.ticketJSON(port: port, sessionId: session) })
    attachment.attach(sessionID: session, cols: 80, rows: 24, deviceName: "studio")
    let control = try await Self.value("the control leg to attach") { await door.controlAttach }
    await door.send(
      .controlLegAttached,
      Script.controlAttached(
        session: session, activation: control.activationId, rights: ["input", "read"]),
      on: .control)
    _ = try await Self.value("the frames leg to attach") { await door.framesAttach }
    attachment.resumeFromForeground()
    try await Task.sleep(for: .milliseconds(120))
    #expect(await door.geometryVerbs.isEmpty)
    await attachment.detach()
  }

  /// SP-2 (g) — an attachment's two legs count against the phone's budget from
  /// the dial to the detach, so a second attachment's legs wait for these.
  @MainActor
  @Test func anAttachmentHoldsItsTwoLegsInThePhonesBudget() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let ledger = PhoneConnectionBudget()
    let session = "sess-01J8Z3K9"
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(), appearance: .default,
      door: { _ in try Self.ticketJSON(port: port, sessionId: session) }, budget: ledger)

    attachment.attach(sessionID: session, cols: 80, rows: 24, deviceName: "studio")
    _ = try await Self.value("the control leg to attach") { await door.controlAttach }
    #expect(ledger.inUse(.terminalLegs) == 2)
    await attachment.detach()
    #expect(ledger.inUse(.terminalLegs) == 0)
  }

  @MainActor
  @Test func aClosedWriteGrantNamesTheActRatherThanPromisingARenewal() async throws {
    // TM-r3, K-M1. The attach grant runs ten minutes and both ends close input
    // a minute early unless a renewal arrives. Until P0-C (2026-09-24) nothing
    // on this phone renewed one, so every long session reached this state;
    // since, it is reached when there is no renewal door (this row passes
    // none) or the renewal FAILED. Typing stops while the phase stays `.live`,
    // the scene keeps advancing, and the only sign used to be a keystroke going
    // nowhere under "the write grant is expiring — renewing it", a promise
    // about work nobody was doing.
    //
    // The grant here is stamped 30 s so the margin has already closed input,
    // which is the same state a nine-minute session reaches without the wait.
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }

    let frames = try LaneFrames.load()
    let identity = try decodeTRF1Frame(frames.seed)
    let session = "sess-01J8Z3K9"
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in
        try Self.ticketJSON(port: port, sessionId: session, attachLifetimeMs: 30_000)
      })

    attachment.attach(sessionID: session, cols: 80, rows: 24, deviceName: "studio")
    let control = try await Self.value("the control leg to attach") { await door.controlAttach }
    let activation = control.activationId
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

    let seedStamp = Script.stamp(1)
    await door.sendUnit(
      try Script.frame(
        session: session, activation: activation, sequence: 1, creditEpoch: 1,
        base: nil, result: seedStamp, payload: frames.seed))
    try await Self.until("the seed frame to reach the renderer") {
      await MainActor.run { attachment.frame == frames.seed }
    }
    // The cell says presenting AND input allowed. The cell is not the one that
    // closed input — this device is, on its own copy of the margin — which is
    // the whole shape of the state: both ends agree, nobody is at fault, and
    // the right simply ran out.
    await door.send(
      .cellActivationStatus,
      Script.status(session: session, activation: activation, sequence: 1, accepted: seedStamp),
      on: .control)
    try await Self.until("the card to go live") {
      await MainActor.run { attachment.phase == .live }
    }

    // Live, GRANTED input by the cell, and still not taking any.
    #expect(attachment.phase == .live)
    #expect(attachment.readWrite)
    #expect(!attachment.acceptsInput)
    #expect(attachment.writeGrantExpired)

    // The banner names the ACT, and offers it: `retryNow` re-mints and
    // re-attaches, which is what a renewal would have done without the round
    // trip. It does NOT cool the terminal — the scene is still advancing.
    let banner = try #require(attachment.banner)
    #expect(banner.title.contains("input has closed"))
    #expect(banner.title.contains("studio"))
    #expect(banner.detail?.contains("reattach") == true)
    #expect(banner.actions.contains(TerminalBanner.Action.retryNow))
    #expect(!banner.coolsTerminal)

    // …and a keystroke says the same true thing rather than promising a
    // renewal. No input reached the cell.
    attachment.typeText("ls\n")
    let note = try #require(attachment.notice)
    #expect(note == "the write grant has run out — reattach to type again")
    #expect(!note.contains("renewing"))
    #expect(await door.inputs.isEmpty)

    await attachment.detach()
  }

  /// What the renewal door was asked, off the main actor's waits — the `Mints`
  /// rule.
  @MainActor
  final class Renewals {
    private(set) var expected: [Int64] = []
    func record(_ generation: Int64) { expected.append(generation) }
  }

  @MainActor
  @Test func theRenewalDoorRenewsTheWriteGrantBeforeInputCloses() async throws {
    // P0-C (2026-09-24). With a renewal door the phone asks `renewAttach` ahead
    // of the cell's input margin and carries the renewed grant to the cell on
    // the SAME activation — over a real socket, through the attachment's own
    // wiring (`TerminalAttachment.renewalProvider` reading the door's raw
    // `{attachGrant}`). The grant is stamped so the renewal falls due at once.
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }

    let frames = try LaneFrames.load()
    let identity = try decodeTRF1Frame(frames.seed)
    let session = "sess-01J8Z3K9"
    let lifetime =
      Int64(RoutedTerminalContract.attachRenewalMarginMs) + RoutedTerminalClient.renewalHeadroomMs
      + 400
    let ticket = try Self.ticketJSON(port: port, sessionId: session, attachLifetimeMs: lifetime)
    let held = try #require(ticket["attachGrant"]?["claims"]?["grantGeneration"]?.intValue)
    let renewals = Renewals()
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(),
      appearance: .default,
      door: { _ in ticket },
      renewal: { _, generation, _ in
        renewals.record(generation)
        // fieldd's answer: the held grant, one generation on, ten minutes more
        guard var grant = ticket["attachGrant"]?.objectValue,
          var claims = grant["claims"]?.objectValue
        else { throw MissingFixture() }
        claims["grantGeneration"] = .int(generation + 1)
        claims["expiresAt"] = .int(Int64(Date().timeIntervalSince1970 * 1000) + 600_000)
        grant["claims"] = .object(claims)
        return .object(["attachGrant": .object(grant)])
      })

    attachment.attach(sessionID: session, cols: 80, rows: 24, deviceName: "studio")
    let control = try await Self.value("the control leg to attach") { await door.controlAttach }
    let activation = control.activationId
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

    try await Self.until("the renewed grant to reach the cell") {
      await door.controlAttaches.count == 2
    }
    let attaches = await door.controlAttaches
    // the SAME activation — a renewal, not a re-attach — at the next generation
    #expect(attaches[1]["activationId"]?.stringValue == activation)
    #expect(attaches[1]["attachGrant"]?["claims"]?["grantGeneration"]?.intValue == held + 1)
    #expect(renewals.expected == [held])
    #expect(!attachment.writeGrantExpired)

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
