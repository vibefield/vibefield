import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

/// THE WITNESS: the real `URLSessionRoutedTransport` carrying real bytes over a
/// real loopback socket to a door that answers the way `field-native/src/tp/door.rs`
/// answers.
///
/// It is a claim about this CLIENT — that it speaks the protocol over a socket
/// and not only over a seam — and never a claim about that cell. The real door
/// is Phase 0's: James's hardware run at TM-5.
@MainActor
@Suite(.serialized) struct FakeCellDoorTests {
  private let session = "sess-01J8Z3K9"
  private let cellBootId = "cb-7f3a9c1e-2026"

  private func endpoints(port: UInt16) -> (control: String, frames: String) {
    // The REAL topology: one port, two paths, the shape TM-2 mints for a tailnet
    // principal (with a loopback authority, since this door is on this machine).
    (
      "ws://127.0.0.1:\(port)/cell/\(cellBootId)/control",
      "ws://127.0.0.1:\(port)/cell/\(cellBootId)/frames"
    )
  }

  private func ticket(port: UInt16, rights: [String] = ["input", "read"]) throws
    -> RoutedTerminalTicket
  {
    let urls = endpoints(port: port)
    return try TicketFactory.make(
      controlUrl: urls.control, framesUrl: urls.frames, cellBootId: cellBootId,
      sessionId: session, rights: rights)
  }

  /// The whole path, over a socket: two hellos, two accepts, one activation on
  /// both legs, heartbeats, a SEED carrying a real TRF1 frame in chunks, a real
  /// delta, credit returned in bytes, and a `SceneApplied` that says what landed.
  @Test func aRealSocketCarriesTheHandshakeASeedADeltaAndItsCredit() async throws {
    let door = FakeCellDoor()
    let port = try await door.start()
    let sink = RoutedFrameRecorder()
    let client = RoutedTerminalClient(
      transport: URLSessionRoutedTransport(timeout: 10), sink: sink,
      options: .init(viewId: "view-1"))
    client.open(try ticket(port: port))

    try await settle("both legs accepted") { await door.helloCount.count == 2 }

    // The capacities on the wire are the phone's, advertised on the frames leg
    // alone — receive capacity belongs to the receiver.
    let capacities = await door.advertisedCapacities
    #expect(capacities?["connectionCreditBytes"]?.intValue == 2_097_152)
    #expect(capacities?["perActivationCreditBytes"]?.intValue == 524_288)
    #expect(await door.advertisedCapabilities == ["resume", "session-events"])

    try await settle("control attach") { await door.controlAttach != nil }
    let activation = try #require(await door.controlAttach?.activationId)
    // Separate real sockets cannot establish an ordering without this ack.
    try await Task.sleep(for: .milliseconds(100))
    #expect(await door.framesAttach == nil)

    await door.send(
      .controlLegAttached,
      Script.controlAttached(session: session, activation: activation, rights: ["input", "read"]),
      on: .control)
    try await settle("frames attach") { await door.framesAttach != nil }
    #expect(await door.framesAttach?.activationId == activation)
    // A first attach carries no resume — there is nothing to resume from.
    #expect(await door.framesResume == nil)
    await door.send(
      .framesLegAttached, Script.framesAttached(session: session, activation: activation),
      on: .frames)
    try await settle("attached") { client.state == .attached }
    // A timeout on a socket test says only "it did not happen". This says WHAT
    // did — and it earned its place: the first version of this test timed out
    // here, and these four values were what showed that the two acknowledgements
    // had raced and the client's readiness condition was asking the wrong
    // question.
    if client.state != .attached {
      let control = String(describing: client.sessions[session]?.control)
      let frames = String(describing: client.sessions[session]?.frames)
      let refusal = String(describing: client.lastRefusal)
      let keys = client.sessions.keys.sorted().joined(separator: ",")
      Issue.record(
        "state=\(client.state) control=\(control) frames=\(frames) refusal=\(refusal) keys=\(keys)")
    }

    // A SEED: a real TRF1 frame, chunked the way the cell's pump chunks one.
    let sample = try Trf1Sample.load()
    let seedUnits = try Script.transferUnits(
      session: session, activation: activation, creditEpoch: 1, firstSequence: 1, kind: "seed",
      base: nil, result: Script.stamp(4417), payload: sample.seed, chunkBytes: 256)
    #expect(seedUnits.count == 6)  // begin + 4 chunks + end, for 956 bytes at 256
    var seedBytes = 0
    for unit in seedUnits {
      await door.sendUnit(unit)
      seedBytes += unit.count
    }
    try await settle("the seed applies") { await sink.fullFrames == 1 }
    // Verbatim: the bytes the renderer gets are the bytes the corpus recorded.
    #expect(await sink.lastFrame == sample.seed)

    try await settle("the ack") { await door.lastAppliedRevision() == 4417 }

    // A DELTA: one real frame, one unit, 16 KiB.
    let deltaUnit = try Script.frame(
      session: session, activation: activation, sequence: 100, creditEpoch: 1,
      base: Script.stamp(4417), result: Script.stamp(4418), payload: sample.delta)
    await door.sendUnit(deltaUnit)
    try await settle("the delta applies") { await sink.deltaFrames == 1 }
    #expect(await sink.lastFrame == sample.delta)
    try await settle("the second ack") { await door.lastAppliedRevision() == 4418 }

    // CREDIT: the charge is the whole received message length, every unit
    // exactly once, cumulative within the epoch.
    let expected = Int64(seedBytes + deltaUnit.count)
    try await settle("every byte returned") { await door.totalCreditReturned() == expected }
    #expect(await door.lastCreditEpoch() == 1)

    // HEARTBEATS: both legs, unconditionally, at the cell's TTL over three.
    try await settle("heartbeats on both legs") {
      let control = await door.heartbeats[.control] ?? 0
      let frames = await door.heartbeats[.frames] ?? 0
      return control >= 1 && frames >= 1
    }

    // And input reaches the door once the lease allows it.
    await door.send(
      .cellActivationStatus,
      Script.status(session: session, activation: activation, sequence: 1), on: .control)
    try await settle("input allowed") { client.sessions[session]?.inputAllowed == true }
    client.send(text: "echo hi\n", to: session)
    try await settle("the keystroke") { await door.inputs.count == 1 }
    let input = await door.inputs[0]
    #expect(input["op"]?["text"]?.stringValue == "echo hi\n")
    #expect(input["inputSequence"]?.intValue == 1)

    client.close()
    await door.stop()
  }

  /// A leg loss, then its replacement — the shape a phone's radio produces
  /// several times an hour.
  ///
  /// The replacement is a FRESH TICKET, never a re-dial: the cell consumes a
  /// transport grant's `(nonce, channel)` at first use, so the ticket in hand is
  /// spent. The new frames leg brings a new generation and therefore a NEW
  /// CREDIT EPOCH, and every total resets with it.
  @Test func aLostLegIsReplacedByAFreshTicketWithANewCreditEpoch() async throws {
    let door = FakeCellDoor()
    let port = try await door.start()
    let sink = RoutedFrameRecorder()
    let client = RoutedTerminalClient(
      transport: URLSessionRoutedTransport(timeout: 10), sink: sink, options: .init())
    client.open(try ticket(port: port))
    try await settle("control attach") { await door.controlAttach != nil }
    let first = try #require(await door.controlAttach?.activationId)
    await door.send(
      .controlLegAttached,
      Script.controlAttached(session: session, activation: first, rights: ["read"]), on: .control)
    try await settle("frames attach") { await door.framesAttach != nil }
    await door.send(
      .framesLegAttached, Script.framesAttached(session: session, activation: first), on: .frames)
    try await settle("attached") { client.state == .attached }

    // Spend credit on the first epoch.
    let sample = try Trf1Sample.load()
    let unit = try Script.frame(
      session: session, activation: first, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(10), payload: sample.seed)
    await door.sendUnit(unit)
    try await settle("credit on epoch 1") { await door.totalCreditReturned() == Int64(unit.count) }

    // The frames leg goes. Every activation on the SET ends — an activation is
    // two legs, so either one going ends it.
    await door.hangUp(.frames)
    try await settle("reconnecting") { client.state == .reconnecting }
    #expect(client.needsTicket)
    #expect(client.sessions[session]?.control == .ended(reason: "leg-dead"))
    try await settle("the sink is told") { await sink.endings.contains("\(first):leg-dead") }

    // A fresh ticket, and the cell answers with a higher leg generation.
    await door.rotate()
    await door.set(legGeneration: 2)
    client.open(try ticket(port: port))
    try await settle("second control attach") { await door.controlAttach != nil }
    let second = try #require(await door.controlAttach?.activationId)
    #expect(second != first)
    await door.send(
      .controlLegAttached,
      Script.controlAttached(session: session, activation: second, rights: ["read"]), on: .control)
    try await settle("second frames attach") { await door.framesAttach != nil }
    // The resume capability was negotiated and there is a token plus an applied
    // stamp, so the frames attach asks to resume rather than to reseed.
    #expect(await door.framesResume?["resumeToken"]?.stringValue == "rt-1")
    await door.send(
      .framesLegAttached,
      Script.framesAttached(
        session: session, activation: second, resumeFrom: Script.stamp(10),
        newest: Script.stamp(12)), on: .frames)
    try await settle("attached again") { client.state == .attached }

    let next = try Script.frame(
      session: session, activation: second, sequence: 1, creditEpoch: 2,
      base: Script.stamp(10), result: Script.stamp(11), payload: sample.delta)
    await door.sendUnit(next)
    try await settle("credit on epoch 2") { await door.lastCreditEpoch() == 2 }
    // Reset whole: the new epoch's total counts only the new leg's bytes.
    #expect(await door.totalCreditReturned() == Int64(next.count))

    client.close()
    await door.stop()
  }

  /// The PRE-authentication class over a real socket: `1008`, no body, no code
  /// the client can read. Its rule is the spec's — re-mint once, then
  /// UNAVAILABLE — and the second silence is what proves re-minting did not
  /// help, because nothing else can.
  @Test func aSilentPolicyCloseIsRemintedOnceAndThenUnavailable() async throws {
    let door = FakeCellDoor()
    let port = try await door.start()
    await door.set(policy: .silentPolicyClose)
    let sink = RoutedFrameRecorder()
    let client = RoutedTerminalClient(
      transport: URLSessionRoutedTransport(timeout: 10), sink: sink, options: .init())

    client.open(try ticket(port: port))
    try await settle("the first refusal") { client.state == .reconnecting }
    #expect(client.needsTicket)

    client.open(try ticket(port: port))
    try await settle("unavailable") {
      if case .failed(let reason) = client.state { return reason.contains("UNAVAILABLE") }
      return false
    }
    #expect(!client.needsTicket)
    client.close()
    await door.stop()
  }

  /// A structured refusal is POST-verification and names itself. Every grant
  /// code is terminal for that grant, so the client asks for a fresh mint rather
  /// than presenting the same one again.
  @Test func aStructuredRefusalIsSurfacedInTheCellsOwnWords() async throws {
    let door = FakeCellDoor()
    let port = try await door.start()
    await door.set(policy: .refuse(code: "GRANT_NONCE_REPLAYED", retryable: false))
    let sink = RoutedFrameRecorder()
    let client = RoutedTerminalClient(
      transport: URLSessionRoutedTransport(timeout: 10), sink: sink, options: .init())
    client.open(try ticket(port: port))
    try await settle("the refusal") {
      if case .refused(let code) = client.state { return code == "GRANT_NONCE_REPLAYED" }
      return false
    }
    #expect(client.lastRefusal == "GRANT_NONCE_REPLAYED")
    #expect(client.needsTicket)
    client.close()
    await door.stop()
  }

  /// `4000 STALE_ROUTE` over a real socket: the close code survives the
  /// transport, which is the whole reason the connection exposes one.
  @Test func aStaleRouteCloseSurvivesTheRealTransport() async throws {
    let door = FakeCellDoor()
    let port = try await door.start()
    let sink = RoutedFrameRecorder()
    let client = RoutedTerminalClient(
      transport: URLSessionRoutedTransport(timeout: 10), sink: sink, options: .init())
    client.open(try ticket(port: port))
    try await settle("both legs accepted") { await door.helloCount.count == 2 }
    await door.hangUp(.control, code: 4000)
    try await settle("stale route") { client.state == .staleRoute }
    #expect(client.needsTicket)
    client.close()
    await door.stop()
  }

  /// What the client's HTTP upgrade actually carries — the one thing no test
  /// inside the client can see, and two door rules ride on it.
  ///
  /// **No `Origin`.** The cell ADMITS a socket without one (a non-browser
  /// client, by design — fieldd's own door has the same rule) and refuses an
  /// Origin outside its list. `URLSessionWebSocketTask` sends none, so the phone
  /// takes the non-browser path and the allow-list never applies to it.
  ///
  /// **It DOES offer `permessage-deflate`.** Measured here, and worth recording
  /// because the spec only anticipated it of Chromium: `URLSessionWebSocketTask`
  /// offers the extension on every upgrade and there is no API to stop it. That
  /// is harmless, and harmless for a precise reason — the cell never selects it
  /// (tungstenite 0.29 carries no deflate at all, and the door's own probe
  /// asserts no `Sec-WebSocket-Extensions` on the RESPONSE), so messages arrive
  /// uncompressed and the credit charge is the same length at both ends.
  ///
  /// The DEPENDENCY is the finding: this client's byte ledger is correct only
  /// while the cell keeps refusing compression. If a future cell ever selected
  /// it, the charge the client computes from the reassembled message would still
  /// be right — but nothing here would notice the day that stopped being true,
  /// so it is named. The proof that it is off TODAY is not this header: it is the
  /// credit assertion in the first test, where the door's received total equals
  /// the exact byte lengths it sent.
  @Test func theUpgradeCarriesNoOriginAndOffersCompressionTheCellRefuses() async throws {
    let door = FakeCellDoor()
    let port = try await door.start()
    let sink = RoutedFrameRecorder()
    let client = RoutedTerminalClient(
      transport: URLSessionRoutedTransport(timeout: 10), sink: sink, options: .init())
    client.open(try ticket(port: port))
    try await settle("two upgrades") { await door.requestHeaders.count == 2 }

    for headers in await door.requestHeaders {
      let names = headers.map { $0.name.lowercased() }
      #expect(!names.contains("origin"), "the client sends no Origin: \(names)")
      let offered = headers.first { $0.name.lowercased() == "sec-websocket-extensions" }
      #expect(offered?.value == "permessage-deflate")
    }
    // The door answers `.accept` with no `Sec-WebSocket-Extensions` of its own,
    // which is how the real cell behaves and is what makes the offer moot.
    client.close()
    await door.stop()
  }
}
