import FieldProduct
import FieldRoutedTerminal
import Foundation
import GhostteaFrame
import Testing

@testable import FieldTerminal

/// The freeway's kit half on today's transport (`draft/thinking-freeway.md` §5):
/// a desktop's terminal LANES, over a real socket, against a cell door that
/// answers the way `field-native`'s does. A second session on the same cell
/// rides the legs the first one opened — one dial, one hello per channel — and
/// leaving a session parks it on its lane, so coming back is a demand and not a
/// dial.
@Suite(.serialized) struct LanesOverTheDoorTests {
  /// Attach `session` on `attachment` and walk the door through both legs'
  /// acknowledgements and a seed, the way the door test's first row does.
  ///
  /// `sessionHandle`/`viewHandle` are the TRF1 identity the frames leg declares
  /// for this session, the seed frame's by default. A second session on the same
  /// lane needs its OWN: the client refuses two live activations claiming one
  /// session handle and fails the lane (RoutedTerminalClient's identity rule), so
  /// a row that attaches two must give the second distinct handles.
  @MainActor
  private func attachToLive(
    _ attachment: TerminalAttachment, session: String, door: CellDoorHarness, attaches: Int,
    sessionHandle: String? = nil, viewHandle: String? = nil
  ) async throws {
    let frames = try LaneFrames.load()
    let identity = try decodeTRF1Frame(frames.seed)
    attachment.attach(sessionID: session, cols: 80, rows: 24, deviceName: "studio")
    try await AttachmentOverTheDoorTests.until("\(session)'s control attach") {
      await door.controlAttaches.count == attaches
    }
    let activation = try #require(await door.controlAttach).activationId
    await door.send(
      .controlLegAttached,
      Script.controlAttached(session: session, activation: activation, rights: ["input", "read"]),
      on: .control)
    try await AttachmentOverTheDoorTests.until("\(session)'s frames attach") {
      await door.framesAttach?.activationId == activation
    }
    await door.send(
      .framesLegAttached,
      Script.framesAttached(
        session: session, activation: activation,
        sessionHandle: sessionHandle ?? String(identity.sessionHandle),
        viewHandle: viewHandle ?? String(identity.viewHandle)),
      on: .frames)
  }

  @MainActor
  @Test func aSecondSessionOnTheSameCellRidesTheLegsAlreadyUp() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let mints = AttachmentOverTheDoorTests.Mints()
    let lanes = TerminalLanes(
      transport: URLSessionRoutedTransport(),
      door: { asked in
        mints.record()
        return try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: asked)
      })

    let first = TerminalAttachment(lanes: lanes, appearance: .default, scene: .init(applying: { _ in true }))
    try await attachToLive(first, session: "sess-a", door: door, attaches: 1)
    let second = TerminalAttachment(lanes: lanes, appearance: .default, scene: .init(applying: { _ in true }))
    try await attachToLive(second, session: "sess-b", door: door, attaches: 2)

    // ONE connection set for both: a ticket per session (its attach grant),
    // but no second dial and no second hello.
    #expect(await door.helloCount[.control] == 1)
    #expect(await door.helloCount[.frames] == 1)
    #expect(lanes.openLanes == 1)
    #expect(mints.count == 2)
    lanes.closeAll()
  }

  @MainActor
  @Test func leavingParksAndComingBackIsADemandNotADial() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let mints = AttachmentOverTheDoorTests.Mints()
    let lanes = TerminalLanes(
      transport: URLSessionRoutedTransport(),
      door: { asked in
        mints.record()
        return try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: asked)
      })
    let attachment = TerminalAttachment(
      lanes: lanes, appearance: .default, scene: .init(applying: { _ in true }))
    try await attachToLive(attachment, session: "sess-a", door: door, attaches: 1)

    await attachment.detach()
    try await AttachmentOverTheDoorTests.until("the park") {
      await door.demands.last?["demand"]?["mode"]?.stringValue == "none"
    }
    #expect(attachment.phase == .idle)

    attachment.attach(sessionID: "sess-a", cols: 80, rows: 24, deviceName: "studio")
    try await AttachmentOverTheDoorTests.until("the demand to come back") {
      await door.demands.last?["demand"]?["mode"]?.stringValue == "live"
    }
    // Nothing was minted or dialed for the way back.
    #expect(mints.count == 1)
    #expect(await door.helloCount[.control] == 1)
    #expect(await door.controlAttaches.count == 1)
    lanes.closeAll()
  }

  /// P6 (2026-10-17) — a lane left carrying no session closes: its legs held
  /// two of the phone's leg slots for no one, and it went on watching attaches
  /// nobody would make. One session let go of two keeps the lane.
  @MainActor
  @Test func aLaneWhoseLastSessionIsReleasedCloses() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let lanes = TerminalLanes(
      transport: URLSessionRoutedTransport(),
      door: { asked in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: asked) })
    let first = TerminalAttachment(
      lanes: lanes, appearance: .default, scene: .init(applying: { _ in true }))
    try await attachToLive(first, session: "sess-a", door: door, attaches: 1)
    let second = TerminalAttachment(
      lanes: lanes, appearance: .default, scene: .init(applying: { _ in true }))
    try await attachToLive(second, session: "sess-b", door: door, attaches: 2)

    first.release()
    #expect(lanes.openLanes == 1)
    second.release()
    #expect(lanes.openLanes == 0)
  }

  /// The sweep's P1 (2026-10-17): a session reopened on its lane — the
  /// freeway's fast path, "back on its lane — no mint, no dial" — must still
  /// PAINT. Its sink and re-mint were keyed to the tap that made them, so the
  /// re-tap's new counter turned every later frame into a refusal and the card
  /// read live over a frozen screen. The row above stopped at the demand and
  /// never sent a frame, which is how that shipped; this one sends one after
  /// the re-tap.
  @MainActor
  @Test func aSessionReopenedOnItsLaneStillPaints() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let frames = try LaneFrames.load()
    let lanes = TerminalLanes(
      transport: URLSessionRoutedTransport(),
      door: { asked in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: asked) })
    let rendered = AttachmentOverTheDoorTests.RenderedFrames()
    let attachment = TerminalAttachment(lanes: lanes, appearance: .default, scene: rendered.scene)
    try await attachToLive(attachment, session: "sess-a", door: door, attaches: 1)
    let activation = try #require(await door.controlAttach).activationId
    await door.sendUnit(
      try Script.frame(
        session: "sess-a", activation: activation, sequence: 1, creditEpoch: 1, base: nil,
        result: Script.stamp(1), payload: frames.seed))
    try await AttachmentOverTheDoorTests.until("the seed to paint") {
      await MainActor.run { rendered.frames.count == 1 }
    }

    // The re-tap: the same session, its legs whole — the fast path.
    attachment.attach(sessionID: "sess-a", cols: 80, rows: 24, deviceName: "studio")
    await door.sendUnit(
      try Script.frame(
        session: "sess-a", activation: activation, sequence: 2, creditEpoch: 1, base: nil,
        result: Script.stamp(2), payload: frames.seed))
    try await AttachmentOverTheDoorTests.until("a frame after the re-tap to paint") {
      await MainActor.run { rendered.frames.count == 2 }
    }
    lanes.closeAll()
  }

  /// F1's keyring (`draft/thinking-freeway.md` §6): a session whose cell's legs
  /// are already up attaches on the ticket a keyring held for it — no mint —
  /// and a held ticket never reaches a hello: with no legs up the door mints
  /// and the held one goes unused. A session let go goes back to the keyring.
  @MainActor
  @Test func aHeldTicketRidesLegsAlreadyUpAndNeverAHello() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let mints = AttachmentOverTheDoorTests.Mints()
    let keys = HeldKeys(tickets: [
      "sess-a": try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: "sess-a"),
      "sess-b": try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: "sess-b"),
    ])
    let lanes = TerminalLanes(
      transport: URLSessionRoutedTransport(),
      door: { asked in
        mints.record()
        return try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: asked)
      },
      keyring: keys.keyring)

    // No legs up yet: sess-a's held ticket is taken and goes unused; the door mints.
    let first = TerminalAttachment(
      lanes: lanes, appearance: .default, scene: .init(applying: { _ in true }))
    try await attachToLive(first, session: "sess-a", door: door, attaches: 1)
    #expect(mints.count == 1)
    // The legs are up: sess-b attaches on its held ticket — no mint, no second hello.
    let second = TerminalAttachment(
      lanes: lanes, appearance: .default, scene: .init(applying: { _ in true }))
    try await attachToLive(second, session: "sess-b", door: door, attaches: 2)
    #expect(mints.count == 1)
    #expect(await door.helloCount[.control] == 1)
    #expect(await door.helloCount[.frames] == 1)
    #expect(keys.taken == ["sess-a", "sess-b"])

    first.release()
    second.release()
    #expect(keys.released == ["sess-a", "sess-b"])
  }

  /// F1's focus (§5): the cell of a session that takes the seat — opened, or
  /// back on its lane on the same attachment — is said to be the one the person
  /// is looking at.
  @MainActor
  @Test func theCellASessionOpensOrComesBackOnIsSaidFocused() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let cells = FocusedCells()
    let lanes = TerminalLanes(
      transport: URLSessionRoutedTransport(),
      door: { asked in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: asked) },
      focused: { cells.said.append($0) })
    let cell = try #require(
      try AttachmentOverTheDoorTests.ticketJSON(port: port)["route"]?["cellBootId"]?.stringValue)
    let attachment = TerminalAttachment(
      lanes: lanes, appearance: .default, scene: .init(applying: { _ in true }))
    try await attachToLive(attachment, session: "sess-a", door: door, attaches: 1)
    #expect(cells.said == [cell])
    await attachment.detach()
    attachment.attach(sessionID: "sess-a", cols: 80, rows: 24, deviceName: "studio")
    try await AttachmentOverTheDoorTests.until("the demand to come back") {
      await door.demands.last?["demand"]?["mode"]?.stringValue == "live"
    }
    #expect(cells.said == [cell, cell])
    lanes.closeAll()
  }

  /// C5 — the cell's refusal of one session's input is said on THAT session's
  /// card: one lane's client carries both sessions, and the refusal names the
  /// session and activation it turned away.
  @MainActor
  @Test func aCellRefusalIsSaidOnTheCardOfTheSessionItNames() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let lanes = TerminalLanes(
      transport: URLSessionRoutedTransport(),
      door: { asked in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: asked) })
    let first = TerminalAttachment(
      lanes: lanes, appearance: .default, scene: .init(applying: { _ in true }))
    try await attachToLive(first, session: "sess-a", door: door, attaches: 1)
    let second = TerminalAttachment(
      lanes: lanes, appearance: .default, scene: .init(applying: { _ in true }))
    // sess-b's own TRF1 identity: on one lane the client fails the whole lane
    // when two activations claim one session handle, and the refusal below
    // would then reach closed legs.
    let seed = try decodeTRF1Frame(LaneFrames.load().seed)
    try await attachToLive(
      second, session: "sess-b", door: door, attaches: 2,
      sessionHandle: String(seed.sessionHandle &+ 1), viewHandle: String(seed.viewHandle &+ 1))
    let activation = try #require(await door.controlAttach).activationId

    await door.send(
      .inputRefused,
      [
        "sessionId": .string("sess-b"), "activationId": .string(activation),
        "leaseEpoch": .int(0), "inputSequence": .int(1), "reason": .string("lagging"),
      ],
      on: .control)
    try await AttachmentOverTheDoorTests.until("the refusal on sess-b's card") {
      await MainActor.run { second.notice != nil }
    }
    #expect(second.notice == TerminalAttachment.cellRefusalWords("lagging"))
    #expect(first.notice == nil)
    lanes.closeAll()
  }
}

/// The cells a row's lanes said were focused, in order.
@MainActor
final class FocusedCells {
  var said: [String] = []
}

/// A keyring a row fills by hand: what it holds, what was taken, what was let go.
@MainActor
final class HeldKeys {
  var tickets: [String: JSONValue]
  private(set) var taken: [String] = []
  private(set) var released: [String] = []

  init(tickets: [String: JSONValue]) { self.tickets = tickets }

  var keyring: TerminalLanes.Keyring {
    TerminalLanes.Keyring(
      take: { [self] session in
        taken.append(session)
        return tickets.removeValue(forKey: session)
      },
      release: { [self] session in released.append(session) })
  }
}
