import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

// item 42 (DESIGN.md §8 "A session another device is driving") — the cell says
// who holds a session's geometry seat (`GeometryState`, behind the negotiated
// `geometry-events`), and the phone keeps it on the session: held by THIS
// client, by another, or by nobody, and once another client lets go, who that
// was. The fold is the receiver's rule as the contract states it (strictly
// older ignored, equal replaces); the client adds "this client" and drops the
// seat with its session. The desktop's twin is field-app's `session-seat.ts`.

private let session = "sess-01J8Z3K9"
/// The client every `TicketFactory` grant names unless told otherwise (the MAC
/// vector's).
private let ownClient = "win-3c4d-incarnation-2"

private func seatHolder(
  _ clientId: String, view: String, generation: Int64, face: RoutedGeometryHolderFace?
) -> RoutedGeometryStateHolder {
  RoutedGeometryStateHolder(
    holder: RoutedGeometryHolder(clientId: clientId, viewId: view, holderGeneration: generation),
    face: face)
}

/// This phone, holding through the view its lane opened with.
private let phone = seatHolder(
  ownClient, view: "view-1", generation: 1,
  face: RoutedGeometryHolderFace(kind: "phone", name: "iPhone 16 Pro", os: "ios"))
/// A desktop's window: another client.
private let studio = seatHolder(
  "win-desk-incarnation-1", view: "view-desk", generation: 3,
  face: RoutedGeometryHolderFace(kind: "window", name: "Mac Studio", os: "macos"))

/// A `GeometryState` body DERIVED from the held golden
/// (`tp-geometry-state.held.json`): its shape, with the fields a row varies.
/// A nil holder is the empty seat, spelled `null` as the cell spells it, never
/// absent.
private func announced(
  _ holder: RoutedGeometryStateHolder?, revision: Int64, cols: Int = 46, rows: Int = 30
) throws -> [String: JSONValue] {
  guard var body = try Vector.json("tp-geometry-state.held").objectValue else {
    throw Vector.Failure.missing("tp-geometry-state.held")
  }
  body["sessionId"] = .string(session)
  body["holder"] = holder.map(wire) ?? .null
  body["geometryRevision"] = .int(revision)
  body["cols"] = .int(Int64(cols))
  body["rows"] = .int(Int64(rows))
  return body
}

/// A holder as the cell writes one: the triple, and the face when there is
/// one, its `os` omitted when it has none.
private func wire(_ holder: RoutedGeometryStateHolder) -> JSONValue {
  var fields = holder.holder.json.objectValue ?? [:]
  if let face = holder.face {
    var written: [String: JSONValue] = ["kind": .string(face.kind), "name": .string(face.name)]
    if let os = face.os { written["os"] = .string(os) }
    fields["face"] = .object(written)
  }
  return .object(fields)
}

/// Every line a client writes, with its level.
private final class Lines: @unchecked Sendable {
  private let lock = NSLock()
  private var written: [(level: TerminalAttachLog.Level, line: String)] = []

  var log: TerminalAttachLog {
    TerminalAttachLog { [self] level, line in
      lock.lock()
      written.append((level, line))
      lock.unlock()
    }
  }

  var all: [String] {
    lock.lock()
    defer { lock.unlock() }
    return written.map(\.line)
  }

  var errors: [String] {
    lock.lock()
    defer { lock.unlock() }
    return written.filter { $0.level == .error }.map(\.line)
  }
}

@Suite struct SeatFoldTests {
  private func state(
    _ holder: RoutedGeometryStateHolder?, revision: Int64, cols: Int = 46, rows: Int = 30
  ) throws -> RoutedGeometryState {
    try RoutedGeometryState(
      json: .object(try announced(holder, revision: revision, cols: cols, rows: rows)))
  }

  /// A revision strictly BELOW the one held is stale — the cell announces
  /// outside its lock, so two announcements of one session can cross — and
  /// changes nothing, whatever it says.
  @Test func aStrictlyOlderRevisionIsIgnored() throws {
    let held = try RoutedSessionSeat.fold(nil, state(studio, revision: 9), mine: false)
    let older = try RoutedSessionSeat.fold(
      held, state(nil, revision: 8, cols: 80, rows: 24), mine: false)
    #expect(older == held)
    let olderMine = try RoutedSessionSeat.fold(held, state(phone, revision: 8), mine: true)
    #expect(olderMine == held)
  }

  /// An EQUAL revision replaces, in arrival order: DS-4d's
  /// `DESTINATION_INELIGIBLE` on an empty seat resizes the PTY without moving
  /// the revision, so that state arrives at the revision already held. A newer
  /// one replaces too.
  @Test func anEqualRevisionReplacesAndSoDoesANewerOne() throws {
    let empty = try RoutedSessionSeat.fold(nil, state(nil, revision: 10), mine: false)
    let resized = try RoutedSessionSeat.fold(
      empty, state(nil, revision: 10, cols: 80, rows: 24), mine: false)
    #expect(
      resized == RoutedSessionSeat(driver: .nobody(letGo: nil), revision: 10, cols: 80, rows: 24))
    let taken = try RoutedSessionSeat.fold(resized, state(studio, revision: 11), mine: false)
    #expect(taken == RoutedSessionSeat(driver: .another(studio), revision: 11, cols: 46, rows: 30))
  }

  /// Whether a holder is THIS client is the client's fact, handed to the fold:
  /// the same holder is mine or another's by it alone, and an empty seat is
  /// nobody's whatever it says.
  @Test func mineOrAnotherIsTheClientsFact() throws {
    let heldByPhone = try state(phone, revision: 1)
    #expect(RoutedSessionSeat.fold(nil, heldByPhone, mine: true).driver == .mine(phone))
    #expect(RoutedSessionSeat.fold(nil, heldByPhone, mine: false).driver == .another(phone))
    let heldByNobody = try state(nil, revision: 1)
    #expect(RoutedSessionSeat.fold(nil, heldByNobody, mine: true).driver == .nobody(letGo: nil))
  }

  /// When ANOTHER client lets go, the empty seat remembers it, face and all, at
  /// the size it left the PTY — through a resize of the empty seat and a newer
  /// empty state — and a seat taken again forgets it. This client letting go
  /// is nobody's let-go, and neither is a seat first heard empty.
  @Test func anEmptySeatRemembersTheOtherClientThatLetGo() throws {
    let held = try RoutedSessionSeat.fold(
      nil, state(studio, revision: 3, cols: 100, rows: 28), mine: false)
    let letGo = try RoutedSessionSeat.fold(
      held, state(nil, revision: 4, cols: 100, rows: 28), mine: false)
    #expect(
      letGo == RoutedSessionSeat(driver: .nobody(letGo: studio), revision: 4, cols: 100, rows: 28))
    #expect(letGo.description == "another client let it go at 100×28, r4")
    let resized = try RoutedSessionSeat.fold(
      letGo, state(nil, revision: 4, cols: 80, rows: 24), mine: false)
    #expect(resized.driver == .nobody(letGo: studio))
    let later = try RoutedSessionSeat.fold(
      resized, state(nil, revision: 5, cols: 80, rows: 24), mine: false)
    #expect(later.driver == .nobody(letGo: studio))
    let retaken = try RoutedSessionSeat.fold(later, state(phone, revision: 6), mine: true)
    #expect(retaken.driver == .mine(phone))

    let thisPhones = try RoutedSessionSeat.fold(nil, state(phone, revision: 1), mine: true)
    let thisPhoneLetGo = try RoutedSessionSeat.fold(
      thisPhones, state(nil, revision: 2), mine: false)
    #expect(thisPhoneLetGo.driver == .nobody(letGo: nil))
    let firstHeardEmpty = try RoutedSessionSeat.fold(nil, state(nil, revision: 1), mine: false)
    #expect(firstHeardEmpty.driver == .nobody(letGo: nil))
  }
}

@MainActor
@Suite(.serialized) struct SeatAnnouncementTests {
  private func makeClient(_ transport: ScriptedTransport, log: TerminalAttachLog = .silent)
    -> RoutedTerminalClient
  {
    RoutedTerminalClient(
      transport: transport, sink: RoutedFrameRecorder(), options: .init(viewId: "view-1", log: log))
  }

  /// Bring the client to `attached` on legs whose CONTROL accept negotiated
  /// `geometry-events` — the one leg the cell announces a seat on.
  private func attached(
    _ client: RoutedTerminalClient, _ transport: ScriptedTransport, legGeneration: Int64 = 1
  ) async throws -> (control: ScriptedConnection, activation: String) {
    let control = transport.connection(for: "/control")
    let frames = transport.connection(for: "/frames")
    try await settle("two hellos") {
      let onControl = await control.sentTags().contains("ConnectionHello")
      let onFrames = await frames.sentTags().contains("ConnectionHello")
      return onControl && onFrames
    }
    try await control.deliver(
      .connectionAccepted,
      try Script.accepted(
        channel: .control, legGeneration: legGeneration,
        capabilities: ["resume", "session-events", "geometry-events"]))
    try await frames.deliver(
      .connectionAccepted, try Script.accepted(channel: .frames, legGeneration: legGeneration))
    let attach = try await settled("the control attach") {
      await control.lastSent("AttachControlLeg")
    }
    let activation = attach["activationId"]?.stringValue ?? ""
    try await control.deliver(
      .controlLegAttached,
      Script.controlAttached(
        session: session, activation: activation, rights: ["geometry", "input", "read"]))
    try await settle("the frames attach") { await frames.lastSent("AttachFramesLeg") != nil }
    try await frames.deliver(
      .framesLegAttached, Script.framesAttached(session: session, activation: activation))
    try await settle("attached") { client.state == .attached }
    return (control, activation)
  }

  /// Everything delivered before this has been HANDLED: the control leg is
  /// read in order, and a status the client keeps is the mark. An absence is
  /// evidence only once what could have caused it has been read.
  private func drained(
    _ client: RoutedTerminalClient, _ control: ScriptedConnection, activation: String,
    mark: Int64
  ) async throws {
    try await control.deliver(
      .cellActivationStatus,
      Script.status(session: session, activation: activation, sequence: mark))
    try await settle("the leg read through mark \(mark)") {
      client.sessions[session]?.status?.cellStatusSequence == mark
    }
  }

  /// A client attached, with the seat the cell announced held by another.
  private func heldElsewhere(_ transport: ScriptedTransport) async throws
    -> (client: RoutedTerminalClient, control: ScriptedConnection)
  {
    let client = makeClient(transport)
    client.open(try TicketFactory.make(sessionId: session))
    let live = try await attached(client, transport)
    try await live.control.deliver(.geometryState, try announced(studio, revision: 3))
    try await settle("another's") { client.sessions[session]?.seat?.driver == .another(studio) }
    return (client, live.control)
  }

  /// `geometry-events` is advertised on the CONTROL hello — the leg the cell
  /// announces a seat on — beside `resume`, `session-events` and C5's
  /// `input-refusals`, and nothing else new.
  @Test func theControlHelloAdvertisesGeometryEvents() async throws {
    let transport = ScriptedTransport()
    let client = makeClient(transport)
    defer { client.close() }
    client.open(try TicketFactory.make(sessionId: session))
    let control = transport.connection(for: "/control")
    let hello = try await settled("the control hello") {
      await control.lastSent("ConnectionHello")
    }
    #expect(hello["channel"]?.stringValue == "control")
    #expect(
      hello["capabilities"]?.arrayValue?.compactMap(\.stringValue)
        == [
          "resume", "session-events", RoutedTerminalContract.geometryEventsCapability,
          RoutedTerminalContract.inputRefusalsCapability,
        ])
  }

  /// The cell's announcement lands on the session it names. A holder whose
  /// client this client's grant named is MINE, through any of its views;
  /// another client's is ANOTHER, with its face and the size it sized the PTY
  /// to; when that other lets go, the empty seat remembers who, at the size
  /// left; when this client lets go, nobody did.
  @Test func anAnnouncementIsMineAnothersOrLetGo() async throws {
    let transport = ScriptedTransport()
    let client = makeClient(transport)
    defer { client.close() }
    client.open(try TicketFactory.make(sessionId: session))
    let live = try await attached(client, transport)
    #expect(client.negotiatedCapabilities.contains("geometry-events"))
    #expect(client.sessions[session]?.seat == nil, "nothing is known before the cell says")

    try await live.control.deliver(.geometryState, try announced(phone, revision: 1))
    try await settle("this phone's") { client.sessions[session]?.seat?.driver == .mine(phone) }
    try await live.control.deliver(.geometryState, try announced(nil, revision: 2))
    try await settle("let go by this phone") {
      client.sessions[session]?.seat?.driver == .nobody(letGo: nil)
    }

    try await live.control.deliver(
      .geometryState, try announced(studio, revision: 3, cols: 100, rows: 28))
    try await settle("another's") { client.sessions[session]?.seat?.driver == .another(studio) }
    #expect(client.sessions[session]?.seat?.cols == 100)
    #expect(client.sessions[session]?.seat?.rows == 28)
    try await live.control.deliver(
      .geometryState, try announced(nil, revision: 4, cols: 100, rows: 28))
    try await settle("let go by another") {
      client.sessions[session]?.seat
        == RoutedSessionSeat(driver: .nobody(letGo: studio), revision: 4, cols: 100, rows: 28)
    }

    // Any view of this client is this client's: a lane's view id is new each
    // time the lane opens, and the cell may hold the seat for the one before.
    let earlierLane = seatHolder(
      ownClient, view: "phone-an-earlier-lane", generation: 5, face: phone.face)
    try await live.control.deliver(.geometryState, try announced(earlierLane, revision: 5))
    try await settle("this phone's, through another view") {
      client.sessions[session]?.seat?.driver == .mine(earlierLane)
    }
  }

  /// A stale announcement changes nothing. One this build cannot read is
  /// dropped and SAID — by its field, never a value — and the leg stays. One
  /// for a session this client does not carry is nobody's here.
  @Test func aStaleUnreadableOrStrayAnnouncementChangesNothing() async throws {
    let transport = ScriptedTransport()
    let lines = Lines()
    let client = makeClient(transport, log: lines.log)
    defer { client.close() }
    client.open(try TicketFactory.make(sessionId: session))
    let live = try await attached(client, transport)
    try await live.control.deliver(
      .geometryState, try announced(studio, revision: 5, cols: 100, rows: 28))
    try await settle("another's") { client.sessions[session]?.seat?.revision == 5 }
    let held = client.sessions[session]?.seat

    try await live.control.deliver(.geometryState, try announced(nil, revision: 4))
    var unread = try announced(phone, revision: 6)
    unread["holder"] = nil
    try await live.control.deliver(.geometryState, unread)
    var stray = try announced(phone, revision: 7)
    stray["sessionId"] = .string("sess-on-no-lane-of-this-phone")
    try await live.control.deliver(.geometryState, stray)
    try await drained(client, live.control, activation: live.activation, mark: 1)

    #expect(client.sessions[session]?.seat == held)
    #expect(client.sessions["sess-on-no-lane-of-this-phone"] == nil)
    #expect(client.state == .attached, "an unreadable state never closes the leg")
    let dropped = lines.errors.filter { $0.contains("GeometryState") }
    #expect(dropped.count == 1)
    #expect(dropped.first?.contains("holder") == true)
    // A face's name is a person's device: no line carries one.
    #expect(
      !lines.all.contains(where: { $0.contains("iPhone 16 Pro") || $0.contains("Mac Studio") }))
  }

  /// The seat goes WITH its session: a lane that lets the session go forgets
  /// it, and attaching the session again starts with no seat until the cell
  /// says one.
  @Test func aForgottenSessionTakesItsSeatWithIt() async throws {
    let transport = ScriptedTransport()
    let held = try await heldElsewhere(transport)
    defer { held.client.close() }
    held.client.forget(sessionId: session)
    #expect(held.client.sessions[session] == nil)

    held.client.open(try TicketFactory.make(sessionId: session))
    try await settle("a second attach") {
      await held.control.allSent("AttachControlLeg").count == 2
    }
    #expect(held.client.sessions[session] != nil)
    #expect(held.client.sessions[session]?.seat == nil)
  }

  /// …and a session the cell REMOVED keeps its state, ended, for the card to
  /// say so, and loses its seat: nothing drives a session that is gone.
  @Test func aRemovedSessionDropsItsSeat() async throws {
    let transport = ScriptedTransport()
    let held = try await heldElsewhere(transport)
    defer { held.client.close() }
    try await held.control.deliver(
      .sessionEvent,
      ["event": .object(["kind": .string("removed"), "sessionId": .string(session)])])
    try await settle("removed") {
      held.client.sessions[session]?.control == .ended(reason: "removed")
    }
    #expect(held.client.sessions[session]?.seat == nil)
  }

  /// …and a ticket for another cell boot replaces the set and every session
  /// on it: a new cell is a new key, never a reconnect, and its seats are its
  /// own to announce.
  @Test func aNewCellBootDropsEverySeat() async throws {
    let transport = ScriptedTransport()
    let held = try await heldElsewhere(transport)
    defer { held.client.close() }
    _ = transport.rotate("/control")
    _ = transport.rotate("/frames")
    held.client.open(try TicketFactory.make(cellBootId: "cb-a-different-boot", sessionId: session))
    #expect(held.client.sessions[session]?.seat == nil)
  }

  /// The seat is the SESSION's: a re-attach carries it until that attach's
  /// announcement replaces it. And every client a grant of the session named
  /// counts as this client's — a fieldd restart mints this phone a new client
  /// (TP-R21) while the cell may still hold the seat for the old one, within
  /// its grace.
  @Test func aReattachCarriesTheSeatAndEveryClientAGrantNamedIsMine() async throws {
    let transport = ScriptedTransport()
    let client = makeClient(transport)
    defer { client.close() }
    client.open(try TicketFactory.make(sessionId: session))
    let first = try await attached(client, transport)
    try await first.control.deliver(.geometryState, try announced(phone, revision: 5))
    try await settle("this phone's") { client.sessions[session]?.seat?.driver == .mine(phone) }

    // The legs go, and the next ticket names a NEW client, on fresh sockets.
    await first.control.hangUp(code: nil)
    try await settle("reconnecting") { client.state == .reconnecting }
    _ = transport.rotate("/control")
    _ = transport.rotate("/frames")
    let restarted = "win-3c4d-incarnation-3"
    client.open(try TicketFactory.make(sessionId: session, clientId: restarted))
    let second = try await attached(client, transport, legGeneration: 2)
    #expect(second.activation != first.activation)
    #expect(client.sessions[session]?.seat?.driver == .mine(phone), "carried across the attach")

    // The attach's announcement: the cell still holds the seat for the OLD
    // client, which is still this phone.
    try await second.control.deliver(.geometryState, try announced(phone, revision: 5))
    try await drained(client, second.control, activation: second.activation, mark: 1)
    #expect(client.sessions[session]?.seat?.driver == .mine(phone))
    // The new client takes it: this phone's too…
    let retaken = seatHolder(restarted, view: "view-1", generation: 6, face: phone.face)
    try await second.control.deliver(.geometryState, try announced(retaken, revision: 6))
    try await settle("this phone's, under the new client") {
      client.sessions[session]?.seat?.driver == .mine(retaken)
    }
    // …and a client no grant of the session named is another's.
    try await second.control.deliver(.geometryState, try announced(studio, revision: 7))
    try await settle("another's") { client.sessions[session]?.seat?.driver == .another(studio) }
  }
}
