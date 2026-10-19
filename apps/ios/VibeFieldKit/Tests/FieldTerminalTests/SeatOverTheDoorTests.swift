import FieldProduct
import FieldRoutedTerminal
import Foundation
import Testing

@testable import FieldTerminal

/// item 42 — the live card's model reads the seat its cell announced
/// (`TerminalAttachment.seat`), over a real socket against a door that answers
/// the way `field-native`'s does: nothing before the cell says; this phone's
/// own hold, by the client its ticket's grant named; another device's, with the
/// face fieldd minted into that device's grant and the size it sized the PTY
/// to; and nothing again once the attachment lets the session go.
///
/// The reader and the fold are held to the contracts' goldens in the routed
/// bundle (`GeometryStateReaderTests`, `SeatTests`); what this row witnesses is
/// the seam the card reads. The door's accept negotiates what it always does:
/// the client reads `GeometryState` on its control leg whatever the accept
/// echoed, as it reads `SessionEvent`, so the row needs no new door.
@Suite struct SeatOverTheDoorTests {
  static let session = "sess-01J8Z3K9"
  /// The client the golden ticket's grants name (`tp-remote-open-ticket.valid`).
  static let ticketClient = "tailnet:james@example.com"

  /// A `GeometryState` as `field-native`'s door writes one.
  static func announced(
    _ holder: RoutedGeometryStateHolder, revision: Int64, cols: Int, rows: Int
  ) -> [String: JSONValue] {
    var fields = holder.holder.json.objectValue ?? [:]
    if let face = holder.face {
      var written: [String: JSONValue] = ["kind": .string(face.kind), "name": .string(face.name)]
      if let os = face.os { written["os"] = .string(os) }
      fields["face"] = .object(written)
    }
    return [
      "sessionId": .string(session), "holder": .object(fields),
      "geometryRevision": .int(revision), "cols": .int(Int64(cols)), "rows": .int(Int64(rows)),
    ]
  }

  /// An EMPTY seat's `GeometryState`: the holder null, the size the PTY was
  /// left at.
  static func emptied(revision: Int64, cols: Int, rows: Int) -> [String: JSONValue] {
    [
      "sessionId": .string(session), "holder": .null,
      "geometryRevision": .int(revision), "cols": .int(Int64(cols)), "rows": .int(Int64(rows)),
    ]
  }

  @MainActor
  @Test func theCardsModelReadsTheSeatAndLosesItWithTheSession() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(), appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: Self.session) })

    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")
    let control = try await AttachmentOverTheDoorTests.value("the control attach") {
      await door.controlAttach
    }
    await door.send(
      .controlLegAttached,
      Script.controlAttached(
        session: Self.session, activation: control.activationId, rights: ["input", "read"]),
      on: .control)
    #expect(attachment.seat == nil, "nothing is known before the cell says")

    // This phone holds it: the holder's client is the one its ticket named.
    let phone = RoutedGeometryStateHolder(
      holder: RoutedGeometryHolder(
        clientId: Self.ticketClient, viewId: "phone-lane-1", holderGeneration: 1),
      face: RoutedGeometryHolderFace(kind: "phone", name: "iPhone 16 Pro", os: "ios"))
    await door.send(
      .geometryState, Self.announced(phone, revision: 1, cols: 46, rows: 30), on: .control)
    try await AttachmentOverTheDoorTests.until("this phone's seat on the card's model") {
      await MainActor.run { attachment.seat?.driver == .mine(phone) }
    }

    // A desktop window takes it, at its own size.
    let studio = RoutedGeometryStateHolder(
      holder: RoutedGeometryHolder(
        clientId: "win-desk-incarnation-1", viewId: "view-desk", holderGeneration: 2),
      face: RoutedGeometryHolderFace(kind: "window", name: "studio", os: "macos"))
    await door.send(
      .geometryState, Self.announced(studio, revision: 2, cols: 120, rows: 40), on: .control)
    try await AttachmentOverTheDoorTests.until("another device's seat on the card's model") {
      await MainActor.run { attachment.seat?.driver == .another(studio) }
    }
    #expect(attachment.seat?.cols == 120)
    #expect(attachment.seat?.rows == 40)

    // The card's cache lets the session go for good: the seat goes with it.
    attachment.release()
    #expect(attachment.seat == nil)
  }

  /// item 42 — the let-go take (`takeEmptySeat`): a window took the seat and
  /// let it go, and the card on the screen takes the empty seat itself. It is
  /// the take a focus gain sends — the grid the surface measured, not the size
  /// the window left the PTY at — said in its own line, so the console tells a
  /// let-go from a touch (`engage`).
  @MainActor
  @Test func theEmptySeatIsTakenInItsOwnWords() async throws {
    let door = CellDoorHarness()
    let port = try await door.start()
    defer { Task { await door.stop() } }
    let lines = AttachLogTests.Lines()
    let attachment = TerminalAttachment(
      transport: URLSessionRoutedTransport(), appearance: .default,
      door: { _ in try AttachmentOverTheDoorTests.ticketJSON(port: port, sessionId: Self.session) },
      log: lines.log)

    attachment.attach(sessionID: Self.session, cols: 80, rows: 24, deviceName: "studio")
    attachment.setViewport(cols: 46, rows: 30)  // the surface measures before the leg attaches
    let control = try await AttachmentOverTheDoorTests.value("the control attach") {
      await door.controlAttach
    }
    await door.send(
      .controlLegAttached,
      Script.controlAttached(
        session: Self.session, activation: control.activationId,
        rights: ["geometry", "input", "read"]),
      on: .control)
    _ = try await AttachmentOverTheDoorTests.value("the take on focus") {
      await door.geometryVerbs.first
    }

    // A window takes the seat at its own size, then lets it go.
    let studio = RoutedGeometryStateHolder(
      holder: RoutedGeometryHolder(
        clientId: "win-desk-incarnation-1", viewId: "view-desk", holderGeneration: 2),
      face: RoutedGeometryHolderFace(kind: "window", name: "studio", os: "macos"))
    await door.send(
      .geometryState, Self.announced(studio, revision: 2, cols: 120, rows: 40), on: .control)
    await door.send(.geometryState, Self.emptied(revision: 3, cols: 120, rows: 40), on: .control)
    try await AttachmentOverTheDoorTests.until("the window's let-go on the card's model") {
      await MainActor.run { attachment.seat?.driver == .nobody(letGo: studio) }
    }
    #expect(await door.geometryVerbs.count == 1, "an announcement alone sends no verb")

    attachment.takeEmptySeat()
    try await AttachmentOverTheDoorTests.until("the empty seat's take") {
      await door.geometryVerbs.count == 2
    }
    let take = await door.geometryVerbs[1]
    #expect(take["type"]?.stringValue == "ClaimGeometry")
    #expect(take["cols"]?.intValue == 46)
    #expect(take["rows"]?.intValue == 30)
    #expect(lines.count("the seat is empty — taking it session=\(Self.session)") == 1)
    #expect(lines.count("engaged — taking the seat") == 0, "a let-go is not a touch")
    await attachment.detach()
  }
}
