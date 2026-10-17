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
  @MainActor
  private func attachToLive(
    _ attachment: TerminalAttachment, session: String, door: CellDoorHarness, attaches: Int
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
        sessionHandle: String(identity.sessionHandle), viewHandle: String(identity.viewHandle)),
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
}
