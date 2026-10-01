import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

// DS-4b — the phone's lease verbs (TPv3 §6 as amended 2026-09-30, DS-D5: the
// pane the person focused LAST holds the geometry, on any device, LWW). The
// host calls `takeGeometry` once per focus gain; the client owns the one
// retry. The cell's answers carry no session and no verb, so they are matched
// to what was asked in send order — and the cell never tells a displaced
// holder it lost the seat: the next refusal is the announcement.

private let session = "sess-01J8Z3K9"
private let me = RoutedGeometryHolder(
  clientId: "win-3c4d-incarnation-2", viewId: "view-1", holderGeneration: 1)
private let desk = RoutedGeometryHolder(
  clientId: "win-desk-incarnation-1", viewId: "view-desk", holderGeneration: 3)

@MainActor
private func attached(
  rights: [String] = ["geometry", "input", "read"], takeFirst: (cols: Int, rows: Int)? = nil
) async throws -> (RoutedTerminalClient, ScriptedConnection) {
  let transport = ScriptedTransport()
  let client = RoutedTerminalClient(
    transport: transport, sink: RoutedFrameRecorder(), options: .init(viewId: "view-1"))
  client.open(try TicketFactory.make(sessionId: session, rights: rights))
  if let takeFirst { client.takeGeometry(cols: takeFirst.cols, rows: takeFirst.rows, for: session) }
  let control = transport.connection(for: "/control")
  let frames = transport.connection(for: "/frames")
  try await settle("two hellos") {
    let onControl = await control.sentTags().contains("ConnectionHello")
    let onFrames = await frames.sentTags().contains("ConnectionHello")
    return onControl && onFrames
  }
  try await control.deliver(.connectionAccepted, try Script.accepted(channel: .control))
  try await frames.deliver(.connectionAccepted, try Script.accepted(channel: .frames))
  let attach = try await settled("the control attach") { await control.lastSent("AttachControlLeg") }
  let activation = attach["activationId"]?.stringValue ?? ""
  try await control.deliver(
    .controlLegAttached,
    Script.controlAttached(session: session, activation: activation, rights: rights))
  try await settle("the frames attach") { await frames.lastSent("AttachFramesLeg") != nil }
  try await frames.deliver(
    .framesLegAttached, Script.framesAttached(session: session, activation: activation))
  try await settle("attached") { client.state == .attached }
  return (client, control)
}

private func committed(_ holder: RoutedGeometryHolder, revision: Int64, cols: Int = 100, rows: Int = 30)
  -> [String: JSONValue]
{
  [
    "holder": holder.json, "geometryRevision": .int(revision),
    "cols": .int(Int64(cols)), "rows": .int(Int64(rows)),
  ]
}

private func refused(_ code: String, holder: RoutedGeometryHolder?, revision: Int64?)
  -> [String: JSONValue]
{
  var body: [String: JSONValue] = ["code": .string(code)]
  if let holder { body["currentHolder"] = holder.json }
  if let revision { body["geometryRevision"] = .int(revision) }
  return body
}

private func count(_ tag: String, on control: ScriptedConnection) async -> Int {
  await control.allSent(tag).count
}

/// Teach the client that the DESK holds the seat at `revision`, the way it
/// actually learns it: it held the seat, the desk took it (the phone is told
/// nothing), and the phone's next resize was refused with the announcement.
@MainActor
private func seatTakenByTheDesk(
  _ client: RoutedTerminalClient, _ control: ScriptedConnection, revision: Int64
) async throws {
  client.takeGeometry(cols: 100, rows: 30, for: session)
  try await settle("the first take") { await count("ClaimGeometry", on: control) == 1 }
  try await control.deliver(.geometryCommitted, committed(me, revision: 1))
  try await settle("this view holds the seat") { client.holdsGeometry(session) }
  client.resizeGeometry(cols: 90, rows: 30, for: session)
  try await settle("the holder's resize") { await count("ClaimGeometry", on: control) == 2 }
  try await control.deliver(.geometryRefused, refused("SEAT_HELD", holder: desk, revision: revision))
  try await settle("the announcement") { client.sessions[session]?.geometryHolder == desk }
}

@MainActor
@Suite(.serialized) struct GeometryTakeTests {
  /// Focus on an EMPTY seat claims it: the claimant is this view, the CAS is
  /// the revision last announced (none yet: 0), and the cell mints the holder.
  @Test func focusOnAnEmptySeatClaimsIt() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    client.takeGeometry(cols: 100, rows: 30, for: session)
    let claim = try await settled("the claim") { await control.lastSent("ClaimGeometry") }
    #expect(claim["claimant"]?["clientId"]?.stringValue == me.clientId)
    #expect(claim["claimant"]?["viewId"]?.stringValue == "view-1")
    #expect(claim["cols"]?.intValue == 100)
    #expect(claim["rows"]?.intValue == 30)
    #expect(claim["expectRevision"]?.intValue == 0)
    #expect(await count("TransferGeometry", on: control) == 0)

    try await control.deliver(.geometryCommitted, committed(me, revision: 1))
    try await settle("the commit") { client.holdsGeometry(session) }
    #expect(client.sessions[session]?.geometryHolder == me)
    #expect(client.sessions[session]?.geometryRevision == 1)
  }

  /// Focus on a seat ANOTHER view holds sends exactly ONE TransferGeometry from
  /// the announced holder to this view, at the announced revision — and no
  /// claim. Its shape is the contract's golden, key for key.
  @Test func focusOnAHeldSeatSendsOneTransfer() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    try await seatTakenByTheDesk(client, control, revision: 7)
    #expect(!client.holdsGeometry(session))

    client.takeGeometry(cols: 90, rows: 30, for: session)
    let transfer = try await settled("the transfer") { await control.lastSent("TransferGeometry") }
    #expect(transfer["from"]?["clientId"]?.stringValue == desk.clientId)
    #expect(transfer["from"]?["viewId"]?.stringValue == desk.viewId)
    #expect(transfer["from"]?["holderGeneration"]?.intValue == desk.holderGeneration)
    #expect(transfer["to"]?["clientId"]?.stringValue == me.clientId)
    #expect(transfer["to"]?["viewId"]?.stringValue == "view-1")
    #expect(transfer["expectRevision"]?.intValue == 7)
    #expect(transfer["cols"]?.intValue == 90)
    try await Task.sleep(for: .milliseconds(30))
    #expect(await count("TransferGeometry", on: control) == 1)
    #expect(await count("ClaimGeometry", on: control) == 2, "the take sent no claim")

    // The wire shape is `tp-transfer-geometry.valid.json`'s, key for key.
    let golden = try Vector.json("tp-transfer-geometry.valid")
    var sent = transfer.objectValue ?? [:]
    sent["type"] = nil
    func keys(_ value: JSONValue?) -> Set<String> { Set(value?.objectValue?.keys ?? [:].keys) }
    #expect(Set(sent.keys) == keys(golden))
    #expect(keys(sent["from"]) == keys(golden["from"]))
    #expect(keys(sent["to"]) == keys(golden["to"]))

    try await control.deliver(
      .geometryCommitted,
      committed(RoutedGeometryHolder(clientId: me.clientId, viewId: "view-1", holderGeneration: 4), revision: 8, cols: 90))
    try await settle("the take committed") { client.holdsGeometry(session) }
  }

  /// THE REFUSAL IS THE ANNOUNCEMENT, and it earns EXACTLY ONE retry: a take
  /// built on a seat the phone believed empty is refused with the real holder,
  /// the one retry is a transfer from that holder, and a refusal of the retry
  /// is the end of it.
  @Test func aRefusalIsTheAnnouncementAndEarnsExactlyOneRetry() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    client.takeGeometry(cols: 100, rows: 30, for: session)
    try await settle("the claim") { await count("ClaimGeometry", on: control) == 1 }
    try await control.deliver(.geometryRefused, refused("STALE_REVISION", holder: desk, revision: 7))
    let retry = try await settled("the one retry") { await control.lastSent("TransferGeometry") }
    #expect(retry["from"]?["clientId"]?.stringValue == desk.clientId)
    #expect(retry["expectRevision"]?.intValue == 7)

    let other = RoutedGeometryHolder(clientId: "win-other", viewId: "view-o", holderGeneration: 5)
    try await control.deliver(.geometryRefused, refused("NOT_HOLDER", holder: other, revision: 9))
    try await settle("the second announcement") { client.sessions[session]?.geometryHolder == other }
    try await Task.sleep(for: .milliseconds(40))
    #expect(await count("TransferGeometry", on: control) == 1)
    #expect(await count("ClaimGeometry", on: control) == 1)
  }

  /// A refusal that repeats EXACTLY the seat the take was built on is not
  /// retried: a resend would be refused the same way (a cell that does not
  /// authorize the take answers precisely this).
  @Test func aRefusalRepeatingTheTakesOwnBasisIsNotRetried() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    try await seatTakenByTheDesk(client, control, revision: 7)
    client.takeGeometry(cols: 90, rows: 30, for: session)
    try await settle("the transfer") { await count("TransferGeometry", on: control) == 1 }
    try await control.deliver(.geometryRefused, refused("NOT_HOLDER", holder: desk, revision: 7))
    try await Task.sleep(for: .milliseconds(40))
    #expect(await count("TransferGeometry", on: control) == 1)
    #expect(await count("ClaimGeometry", on: control) == 2)
  }

  /// A refusal naming no seat at all — no holder, no revision — says nothing a
  /// retry could act on, and earns none.
  @Test func aRefusalNamingNoSeatIsNotRetried() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    client.takeGeometry(cols: 100, rows: 30, for: session)
    try await settle("the claim") { await count("ClaimGeometry", on: control) == 1 }
    try await control.deliver(.geometryRefused, refused("VIEW_NOT_PRESENTING", holder: nil, revision: nil))
    try await Task.sleep(for: .milliseconds(40))
    #expect(await count("ClaimGeometry", on: control) == 1)
    #expect(await count("TransferGeometry", on: control) == 0)
    #expect(client.sessions[session]?.geometryRevision == 0)
  }

  /// The seat EMPTIED before the take arrived (a revision, no holder): the one
  /// retry claims it at that revision — the last-focused pane takes the empty
  /// seat.
  @Test func anEmptiedSeatIsClaimedOnce() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    try await seatTakenByTheDesk(client, control, revision: 7)
    client.takeGeometry(cols: 90, rows: 30, for: session)
    try await settle("the transfer") { await count("TransferGeometry", on: control) == 1 }
    try await control.deliver(.geometryRefused, refused("NOT_HOLDER", holder: nil, revision: 8))
    try await settle("the claim of the empty seat") { await count("ClaimGeometry", on: control) == 3 }
    let claim = try #require(await control.lastSent("ClaimGeometry"))
    #expect(claim["expectRevision"]?.intValue == 8)
    #expect(await count("TransferGeometry", on: control) == 1)
    #expect(client.sessions[session]?.geometryHolder == nil)
  }

  /// A refusal naming THIS view as the holder retries as a claim of its own
  /// seat (a resize) — never a transfer to itself.
  @Test func aRefusalNamingThisViewRetriesAsItsOwnSeat() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    client.takeGeometry(cols: 100, rows: 30, for: session)
    try await settle("the claim") { await count("ClaimGeometry", on: control) == 1 }
    let mine = RoutedGeometryHolder(clientId: me.clientId, viewId: "view-1", holderGeneration: 4)
    try await control.deliver(.geometryRefused, refused("STALE_REVISION", holder: mine, revision: 5))
    try await settle("the own-seat retry") { await count("ClaimGeometry", on: control) == 2 }
    let claim = try #require(await control.lastSent("ClaimGeometry"))
    #expect(claim["expectRevision"]?.intValue == 5)
    #expect(await count("TransferGeometry", on: control) == 0)
  }

  /// A grant without `geometry` sends no lease verb, ever.
  @Test func noGeometryRightNoVerb() async throws {
    let (client, control) = try await attached(rights: ["input", "read"])
    defer { client.close() }
    client.takeGeometry(cols: 100, rows: 30, for: session)
    client.resizeGeometry(cols: 120, rows: 40, for: session)
    try await Task.sleep(for: .milliseconds(40))
    #expect(await count("ClaimGeometry", on: control) == 0)
    #expect(await count("TransferGeometry", on: control) == 0)
  }

  /// A pane that LOST the seat renders what the holder sized and never claims
  /// on a mere resize; a pane that HOLDS it resizes its own seat.
  @Test func aPaneThatLostTheSeatNeverClaimsOnAResize() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    client.takeGeometry(cols: 100, rows: 30, for: session)
    try await settle("the claim") { await count("ClaimGeometry", on: control) == 1 }
    try await control.deliver(.geometryCommitted, committed(me, revision: 1))
    try await settle("held") { client.holdsGeometry(session) }

    client.resizeGeometry(cols: 90, rows: 28, for: session)
    let resize = try await settled("the holder's resize") {
      await control.allSent("ClaimGeometry").count == 2 ? await control.lastSent("ClaimGeometry") : nil
    }
    #expect(resize["cols"]?.intValue == 90)
    #expect(resize["rows"]?.intValue == 28)
    #expect(resize["expectRevision"]?.intValue == 1)
    try await control.deliver(.geometryRefused, refused("SEAT_HELD", holder: desk, revision: 2))
    try await settle("the seat lost") { !client.holdsGeometry(session) }

    client.resizeGeometry(cols: 120, rows: 40, for: session)
    client.resizeGeometry(cols: 60, rows: 20, for: session)
    try await Task.sleep(for: .milliseconds(40))
    #expect(await count("ClaimGeometry", on: control) == 2)
    #expect(await count("TransferGeometry", on: control) == 0)
  }

  /// A take before the control leg attaches is HELD — the latest grid wins —
  /// and sent once the leg attaches with the right.
  @Test func aTakeBeforeTheLegAttachesIsSentWhenItDoes() async throws {
    let (client, control) = try await attached(takeFirst: (80, 24))
    defer { client.close() }
    let claim = try await settled("the held take") { await control.lastSent("ClaimGeometry") }
    #expect(claim["cols"]?.intValue == 80)
    #expect(await count("ClaimGeometry", on: control) == 1)
  }

  /// The grid moved while the take was in flight: once the take commits, ONE
  /// resize of the seat it now holds carries the newest grid.
  @Test func aResizeDuringTheTakeIsSentOnceTheTakeCommits() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    client.takeGeometry(cols: 80, rows: 24, for: session)
    try await settle("the take") { await count("ClaimGeometry", on: control) == 1 }
    client.resizeGeometry(cols: 100, rows: 30, for: session)
    try await Task.sleep(for: .milliseconds(30))
    #expect(await count("ClaimGeometry", on: control) == 1, "not before the take is answered")
    try await control.deliver(.geometryCommitted, committed(me, revision: 1, cols: 80, rows: 24))
    try await settle("the catch-up resize") { await count("ClaimGeometry", on: control) == 2 }
    let resize = try #require(await control.lastSent("ClaimGeometry"))
    #expect(resize["cols"]?.intValue == 100)
    #expect(resize["rows"]?.intValue == 30)
    #expect(resize["expectRevision"]?.intValue == 1)
  }
}
