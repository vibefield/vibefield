import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

/// The connection SET: two legs, one activation per session, credits, frames,
/// and the states a caller reads. Driven frame by frame through the scripted
/// door, because every rule here is about ORDER and about what is DECIDED, not
/// about bytes on a wire — that is `FakeCellDoorTests`' job.
@MainActor
@Suite(.serialized) struct RoutedClientTests {
  private let session = "sess-01J8Z3K9"

  private func client(_ transport: ScriptedTransport, sink: RoutedFrameRecorder)
    -> RoutedTerminalClient
  {
    RoutedTerminalClient(
      transport: transport, sink: sink, options: .init(viewId: "view-1"))
  }

  private func ticket(cellBootId: String = "cb-7f3a9c1e-2026") throws -> RoutedTerminalTicket {
    try TicketFactory.make(cellBootId: cellBootId, sessionId: session)
  }

  /// Bring a client all the way to `attached` and hand back everything the test
  /// needs to keep driving it.
  private func attached(
    transport: ScriptedTransport, sink: any RoutedFrameSink, client: RoutedTerminalClient,
    legGeneration: Int64 = 1
  ) async throws -> (control: ScriptedConnection, frames: ScriptedConnection, activation: String) {
    let control = transport.connection(for: "/control")
    let frames = transport.connection(for: "/frames")
    try await settle("two hellos") {
      let onControl = await control.sentTags().contains("ConnectionHello")
      let onFrames = await frames.sentTags().contains("ConnectionHello")
      return onControl && onFrames
    }
    try await control.deliver(
      .connectionAccepted, try Script.accepted(channel: .control, legGeneration: legGeneration))
    try await frames.deliver(
      .connectionAccepted, try Script.accepted(channel: .frames, legGeneration: legGeneration))
    try await settle("control attach") {
      await control.lastSent("AttachControlLeg") != nil
    }
    let attach = await control.lastSent("AttachControlLeg")
    let activation = attach?["activationId"]?.stringValue ?? ""
    try await control.deliver(
      .controlLegAttached,
      Script.controlAttached(session: session, activation: activation, rights: ["input", "read"]))
    try await settle("frames attach after control acknowledgement") {
      await frames.lastSent("AttachFramesLeg") != nil
    }
    try await frames.deliver(
      .framesLegAttached, Script.framesAttached(session: session, activation: activation))
    try await settle("attached") { client.state == .attached }
    return (control, frames, activation)
  }

  // MARK: The handshake

  @Test func framesWaitsForMatchingControlAcknowledgementAndAttachesOnlyOnce() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    defer { client.close() }
    client.open(try ticket())
    let control = transport.connection(for: "/control")
    let frames = transport.connection(for: "/frames")
    try await settle("two hellos") {
      let onControl = await control.lastSent("ConnectionHello") != nil
      let onFrames = await frames.lastSent("ConnectionHello") != nil
      return onControl && onFrames
    }
    try await control.deliver(.connectionAccepted, try Script.accepted(channel: .control))
    try await frames.deliver(.connectionAccepted, try Script.accepted(channel: .frames))
    let attach = try await settled("control attach") {
      await control.lastSent("AttachControlLeg")
    }
    let activation = try #require(attach["activationId"]?.stringValue)
    // A stale ack cannot authorize frames, even while the current ack is delayed.
    try await control.deliver(
      .controlLegAttached,
      Script.controlAttached(session: session, activation: "stale", rights: ["read"]))
    try await Task.sleep(for: .milliseconds(100))
    #expect(await frames.allSent("AttachFramesLeg").isEmpty)
    try await control.deliver(
      .controlLegAttached,
      Script.controlAttached(session: session, activation: activation, rights: ["input", "read"]))
    let framesAttach = try await settled("frames attach") {
      await frames.lastSent("AttachFramesLeg")
    }
    #expect(framesAttach["activationId"]?.stringValue == activation)
    // Duplicate and higher-generation renewal acknowledgements share this path.
    try await control.deliver(
      .controlLegAttached,
      Script.controlAttached(session: session, activation: activation, rights: ["input", "read"]))
    var renewal = Script.controlAttached(session: session, activation: activation, rights: ["read"])
    renewal["grantGenerationAccepted"] = .int(2)
    try await control.deliver(.controlLegAttached, renewal)
    try await Task.sleep(for: .milliseconds(100))
    #expect(await frames.allSent("AttachFramesLeg").count == 1)
    #expect(client.sessions[session]?.rights == [.read])
  }

  /// One ticket opens BOTH legs: the hello carries the grant VERBATIM, names its
  /// own channel, and advertises receive capacity on the frames leg only —
  /// receive capacity belongs to the receiver, and the control leg receives no
  /// presentation units.
  @Test func oneTicketOpensBothLegsWithTheGrantCarriedVerbatim() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    let ticket = try ticket()
    client.open(ticket)
    #expect(client.state == .connecting)

    let control = transport.connection(for: "/control")
    let frames = transport.connection(for: "/frames")
    try await settle("two hellos") {
      let onControl = await control.lastSent("ConnectionHello") != nil
      let onFrames = await frames.lastSent("ConnectionHello") != nil
      return onControl && onFrames
    }
    let controlHello = await control.lastSent("ConnectionHello")
    let framesHello = await frames.lastSent("ConnectionHello")

    #expect(controlHello?["channel"]?.stringValue == "control")
    #expect(framesHello?["channel"]?.stringValue == "frames")
    #expect(controlHello?["protocolMajor"]?.intValue == 1)
    // The grant on the wire is the grant that arrived — byte for byte the same
    // JSON value, because the MAC covers what the CELL receives.
    #expect(controlHello?["transportGrant"] == ticket.transportGrant.raw)
    #expect(framesHello?["transportGrant"] == ticket.transportGrant.raw)
    // Capacity is the FRAMES leg's alone.
    #expect(controlHello?["receiverCapacities"] == nil)
    #expect(framesHello?["receiverCapacities"]?["connectionCreditBytes"]?.intValue == 2_097_152)
    #expect(framesHello?["receiverCapacities"]?["perActivationCreditBytes"]?.intValue == 524_288)
    // Only capabilities this client can actually honour.
    let advertised = controlHello?["capabilities"]?.arrayValue?.compactMap(\.stringValue)
    #expect(advertised == ["resume", "session-events", "geometry-events"])
    client.close()
  }

  /// A grant outside its validity window is refused HERE, before a socket: at
  /// the door it would earn a silent `1008` that carries no reason at all, and
  /// guessing at one afterwards is worse than naming it now.
  @Test func aDeadGrantIsRefusedBeforeItCostsASocket() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    let stale = try TicketFactory.make(
      sessionId: session, issuedAt: 1_000, expiresAt: 61_000)
    client.open(stale)
    #expect(client.state == .reconnecting)
    #expect(client.needsTicket)
    #expect(transport.dials.isEmpty)
    client.close()
  }

  /// …and a ticket refused that way does not STOP the re-minting (TM-r3, K-M2).
  ///
  /// The retry loop called `open` and returned whatever it did. `open` refusing
  /// locally — a grant outside its window, which a clock that is still wrong
  /// will produce again — left nobody minting: the task was gone, `needsTicket`
  /// was set with nothing reading it, and the card sat on `.reconnecting`
  /// forever. A refused ticket is a reason to ask again on the backoff.
  @Test func aTicketTheClientRefusesLocallyDoesNotStopTheReMinting() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let mints = TicketMints()
    let session = session
    let client = RoutedTerminalClient(
      transport: transport, sink: sink,
      options: .init(
        ticketProvider: { _ in
          mints.calls += 1
          guard mints.handOutLive else {
            // Outside its window: `open` names it and spends no socket.
            return try TicketFactory.make(
              sessionId: session, issuedAt: 1_000, expiresAt: 61_000)
          }
          // A replacement set needs fresh sockets; the old ones have hung up.
          _ = transport.rotate("/control")
          _ = transport.rotate("/frames")
          return try TicketFactory.make(sessionId: session)
        },
        maxBackoff: .milliseconds(200), viewId: "view-1"))
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    #expect(transport.dials.count == 2)
    _ = live.activation

    await live.frames.hangUp(code: nil)

    // TWO mints asked for while every answer is refused — which is the whole
    // assertion: after the first refusal there was nothing left to ask.
    try await settle("a second mint after the first was refused") { mints.calls >= 2 }
    // …and the precondition that makes it mean something: a refused ticket
    // costs no socket, so nothing was dialed by either of them.
    #expect(transport.dials.count == 2)
    #expect(client.needsTicket)
    #expect(client.state == .reconnecting)

    mints.handOutLive = true
    try await settle("the set to come back") { transport.dials.count == 4 }
    #expect(!client.needsTicket)
    client.close()
  }

  /// The door's two answers for a session it lost: its cell gone (retryable, the
  /// beat before its inventory catches up), then no such terminal (final).
  private nonisolated static let cellGone = FieldProductError(
    kind: "UNAVAILABLE", message: "the terminal cell holding this session is gone", retryable: true,
    details: .object([
      "service": .string("terminal"), "state": .string("cell_gone"),
      "cellBootId": .string("cb-7f3a9c1e-2026"),
    ]))
  private nonisolated static func noSuchTerminal(_ sessionId: String) -> FieldProductError {
    FieldProductError(kind: "NOT_FOUND", message: "no such terminal: \(sessionId)", retryable: false)
  }

  /// A client whose re-mints are answered `refusals` in turn (the last one
  /// again after that), attached and then cut off at the frames leg so that it
  /// starts asking.
  private func cutOff(refusingWith refusals: [FieldProductError], mints: TicketMints)
    async throws -> (client: RoutedTerminalClient, transport: ScriptedTransport)
  {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = RoutedTerminalClient(
      transport: transport, sink: sink,
      options: .init(
        ticketProvider: { _ in
          mints.calls += 1
          throw refusals[min(mints.calls, refusals.count) - 1]
        },
        maxBackoff: .milliseconds(50), viewId: "view-1"))
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    await live.frames.hangUp(code: nil)
    return (client, transport)
  }

  /// …but a refusal the DOOR marks final is not asked again (fix8: never waits
  /// forever). On 2026-10-19 James's floor was respawned under a live card, and
  /// the phone asked for the lost session's ticket 254 times over three hours.
  /// The door had answered that it no longer had the session, and that asking
  /// again would not change it.
  @Test func aSessionTheDoorNoLongerHasEndsAndIsNotAskedForAgain() async throws {
    let session = session
    let mints = TicketMints()
    let (client, transport) = try await cutOff(
      refusingWith: [Self.noSuchTerminal(session)], mints: mints)
    try await settle("the session to end") {
      client.sessions[session]?.control == .ended(reason: RoutedTerminalClient.notFoundReason)
    }
    #expect(!client.needsTicket)
    // Well past several backoffs, the one ask stands, and nothing was dialed.
    try await Task.sleep(for: .milliseconds(400))
    #expect(mints.calls == 1)
    #expect(transport.dials.count == 2)
    client.close()
  }

  /// `cell_gone` is retryable, as fieldd marks it: it is the beat before the
  /// door's final answer. It is asked through, and the end that follows carries
  /// why.
  @Test func aGoneCellIsAskedThroughItsBeatAndTheEndSaysWhy() async throws {
    let session = session
    let mints = TicketMints()
    let (client, _) = try await cutOff(
      refusingWith: [Self.cellGone, Self.noSuchTerminal(session)], mints: mints)
    try await settle("the session to end") {
      client.sessions[session]?.control == .ended(reason: RoutedTerminalClient.cellGoneReason)
    }
    try await Task.sleep(for: .milliseconds(400))
    #expect(mints.calls == 2)
    client.close()
  }

  /// A session the door no longer has ends ALONE: the set is re-minted through
  /// the next session it carries, at once, and that one is answered on its own.
  @Test func aGoneSessionEndsAloneAndTheSetIsReMintedThroughTheNext() async throws {
    let session = session
    let second = "sess-second"
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let mints = TicketMints()
    let client = RoutedTerminalClient(
      transport: transport, sink: sink,
      options: .init(
        ticketProvider: { asked in
          mints.calls += 1
          guard asked == session else { throw Self.noSuchTerminal(asked) }
          // A replacement set needs fresh sockets; the old ones have hung up.
          _ = transport.rotate("/control")
          _ = transport.rotate("/frames")
          return try TicketFactory.make(sessionId: session)
        },
        maxBackoff: .milliseconds(50), viewId: "view-1"))
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    // A second session on the same set. The last ticket names it, so the set is
    // re-minted through it first.
    client.open(try TicketFactory.make(sessionId: second))
    try await settle("a second attach") {
      await live.control.allSent("AttachControlLeg").count == 2
    }

    await live.frames.hangUp(code: nil)

    try await settle("the gone session ends") {
      client.sessions[second]?.control == .ended(reason: RoutedTerminalClient.notFoundReason)
    }
    try await settle("the set re-minted through the other") { transport.dials.count == 4 }
    if case .ended = client.sessions[session]?.control {
      Issue.record("a session the door still has must not end")
    }
    #expect(mints.calls == 2)
    client.close()
  }

  /// The refusals the product client never retries stop the asking too, and
  /// are said: with the legs gone, the set's own state is the news.
  @Test func aRefusalTheProductClientNeverRetriesStopsTheAsking() async throws {
    let mints = TicketMints()
    let (client, transport) = try await cutOff(
      refusingWith: [FieldProductError(kind: "UNAUTHORIZED", message: "the token is not valid")],
      mints: mints)
    try await settle("the refusal to be said") { client.state == .refused(code: "UNAUTHORIZED") }
    try await Task.sleep(for: .milliseconds(400))
    #expect(mints.calls == 1)
    #expect(transport.dials.count == 2)
    client.close()
  }

  /// Any other refusal the door marks final is said in its code, and asking
  /// again is the person's act.
  @Test func aRefusalTheDoorMarksFinalIsSaidAndNotAskedAgain() async throws {
    let mints = TicketMints()
    let (client, _) = try await cutOff(
      refusingWith: [FieldProductError(kind: "FORBIDDEN_SCOPE", message: "not yours", retryable: false)],
      mints: mints)
    try await settle("the refusal to be said") { client.state == .refused(code: "FORBIDDEN_SCOPE") }
    try await Task.sleep(for: .milliseconds(400))
    #expect(mints.calls == 1)
    client.close()
  }

  /// Every refusal the door marks retryable is still asked again on the backoff
  /// (TM-r3): a floor that is still starting answers `UNAVAILABLE`, then a
  /// ticket.
  @Test func aRetryableRefusalIsAskedAgain() async throws {
    let session = session
    let mints = TicketMints()
    let (client, _) = try await cutOff(
      refusingWith: [
        FieldProductError(
          kind: "UNAVAILABLE", message: "the terminal floor is not available", retryable: true,
          details: .object(["service": .string("terminal"), "state": .string("absent")]))
      ],
      mints: mints)
    try await settle("asked again after a passing refusal") { mints.calls >= 3 }
    #expect(client.state == .reconnecting)
    if case .ended = client.sessions[session]?.control {
      Issue.record("a retryable refusal must not end the session")
    }
    client.close()
  }

  // MARK: Activation

  /// The CLIENT is the activation authority: it mints ONE id and both legs
  /// attach under it. The cell holds the table and answers it; it never invents
  /// an activation id, which is what makes a reconnect race impossible to
  /// disagree about.
  @Test func oneActivationIdCarriesBothLegs() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    let controlAttach = await live.control.lastSent("AttachControlLeg")
    let framesAttach = await live.frames.lastSent("AttachFramesLeg")
    #expect(controlAttach?["activationId"]?.stringValue == live.activation)
    #expect(framesAttach?["activationId"]?.stringValue == live.activation)
    #expect(!live.activation.isEmpty)
    // A FIRST attach replaces nothing, and carries no resume: there is no token
    // and no applied stamp to resume from.
    #expect(controlAttach?["replacesActivationId"] == nil)
    #expect(framesAttach?["resume"] == nil)
    // The demand rides the control attach.
    #expect(controlAttach?["initialDemand"]?["mode"]?.stringValue == "live")

    // The rights the CELL accepted are the rights, not the ones the grant asked
    // for — a downgrade applies the moment the cell accepts it.
    #expect(client.sessions[session]?.rights == [.input, .read])
    // The declared TRF1 identity is bound and handed to the sink, which owns the
    // only decoder that can check the handles inside a frame.
    #expect(client.sessions[session]?.identity?.sessionHandle == "77")
    try await settle("the sink is bound") { await sink.identities[live.activation] != nil }
    client.close()
  }

  /// `PresentationReady` ≠ `InputAllowed`. A read-only or lagging viewer still
  /// presents; input is a SECOND dimension with its own answer, and the client
  /// refuses a keystroke rather than sending one the cell will drop in silence.
  @Test func presentationAndInputAreSeparateDimensions() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    // Attached, but no status yet: neither predicate holds — an activation with
    // no lease is not ready, and saying otherwise would be a false ready.
    #expect(client.sessions[session]?.presentationReady == false)
    #expect(client.sessions[session]?.presentationHeldBecause == "the cell has said nothing yet")

    // A frame makes the frames leg active, then the lease arrives.
    let frame = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(10), payload: Data("TRF1-seed".utf8))
    await live.frames.deliver(.binary(frame))
    try await settle("the frame applies") { await sink.deltaFrames == 1 }
    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(session: session, activation: live.activation, sequence: 1))
    try await settle("presenting") { client.sessions[session]?.presentationReady == true }
    #expect(client.sessions[session]?.inputAllowed == true)
    #expect(client.sessions[session]?.inputHeldBecause == nil)

    // The cell suspends input for lag. Presentation continues; typing does not.
    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(
        session: session, activation: live.activation, sequence: 2, input: "suspended",
        reason: "lagging"))
    try await settle("input suspended") { client.sessions[session]?.inputAllowed == false }
    #expect(client.sessions[session]?.presentationReady == true)
    #expect(client.sessions[session]?.status?.input == .suspended(reason: "lagging"))
    // …and the drop says which term held it.
    #expect(
      client.sessions[session]?.inputHeldBecause
        == "the cell holds input: suspended(reason: \"lagging\")")

    let before = await live.control.allSent("SendInput").count
    client.send(text: "ls\n", to: session)
    try await Task.sleep(for: .milliseconds(30))
    #expect(await live.control.allSent("SendInput").count == before)
    client.close()
  }

  /// A `leaseTtlMs` at the top of the range is a lease that lasts, not a crash
  /// (TM-r3, K-M3).
  ///
  /// `leaseDeadlineMs = nowMs + status.leaseTtlMs` was a bare `+` over a number
  /// the CELL supplies, so a defective one took the app down. The deadline
  /// saturates now: every reader of it is a comparison, and the honest reading
  /// of "further away than a clock can say" is the furthest one it can say.
  @Test func aLeaseTtlAtTheTopOfTheRangeSaturatesRatherThanTrapping() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(
        session: session, activation: live.activation, sequence: 1, leaseTtlMs: .max))
    try await settle("the status") { client.sessions[session]?.status != nil }
    #expect(client.sessions[session]?.leaseLive == true)

    // …and a NEGATIVE one is a lease that is already over, which is the same
    // arithmetic saturating the other way rather than wrapping into the future.
    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(
        session: session, activation: live.activation, sequence: 2, leaseTtlMs: .min))
    try await settle("the expired lease") { client.sessions[session]?.leaseLive == false }
    #expect(client.sessions[session]?.presentationReady == false)
    client.close()
  }

  /// The same discipline on the ATTACH grant's expiry, which `open` never
  /// validates — it checks the TRANSPORT grant — so an extreme stamp reaches
  /// `attach()`'s `expiresAt - attachRenewalMarginMs` unchecked. The client
  /// attaches and simply holds no live input right, rather than trapping.
  @Test func anAttachGrantExpiryAtTheBottomOfTheRangeDoesNotTrap() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    // A transport grant inside its window and an attach grant whose expiry is
    // at the floor of the range. `TicketFactory` stamps both, so the attach
    // grant's own validity is not what is under test here — the subtraction is.
    client.open(
      try TicketFactory.make(
        sessionId: session, issuedAt: Int64.min, expiresAt: Int64.min + 1_000))
    // The ticket is refused before a socket (its transport grant is not live),
    // which is itself the arithmetic not trapping.
    #expect(client.needsTicket)
    #expect(transport.dials.isEmpty)

    // Now the case that reaches `attach()`: a live transport grant, and an
    // attach grant expiring at the floor.
    let mixed = try TicketFactory.makeMixed(
      sessionId: session, attachIssuedAt: Int64.min, attachExpiresAt: Int64.min + 1_000)
    client.open(mixed)
    let live = try await attached(transport: transport, sink: sink, client: client)
    _ = live.activation
    #expect(client.sessions[session]?.inputRightLive == false)
    #expect(client.sessions[session]?.inputAllowed == false)
    client.close()
  }

  /// A status with an OLDER sequence is a reorder, not a revocation. Applying it
  /// backwards would revoke a live lease from a message that was already stale
  /// when it arrived.
  @Test func anOlderStatusSequenceIsDropped() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(session: session, activation: live.activation, sequence: 5))
    try await settle("the status") { client.sessions[session]?.status != nil }
    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(
        session: session, activation: live.activation, sequence: 2, presentation: "revoked",
        reason: "leg-dead"))
    try await Task.sleep(for: .milliseconds(30))
    #expect(client.sessions[session]?.status?.cellStatusSequence == 5)
    #expect(client.sessions[session]?.status?.presentation == .presenting)
    client.close()
  }

  /// The input sequence is per-ACTIVATION and monotonic, minted here. It is not
  /// the DOM's counter: several views share one cell view, and copying their
  /// individual counters would collide at the cell's `authorize_input`.
  @Test func theInputSequenceIsMonotonicPerActivation() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    let frame = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(10), payload: Data("TRF1".utf8))
    await live.frames.deliver(.binary(frame))
    try await settle("the frame applies") { await sink.deltaFrames == 1 }
    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(session: session, activation: live.activation, sequence: 1))
    try await settle("input allowed") { client.sessions[session]?.inputAllowed == true }

    client.send(text: "a", to: session)
    client.send(key: RoutedKeyInput(key: "Enter", code: "Enter"), to: session)
    client.paste("hello", to: session)
    client.interrupt(session)
    try await settle("four inputs") { await live.control.allSent("SendInput").count == 4 }

    let inputs = await live.control.allSent("SendInput")
    #expect(inputs.map { $0["inputSequence"]?.intValue } == [1, 2, 3, 4])
    #expect(inputs.allSatisfy { $0["activationId"]?.stringValue == live.activation })
    #expect(inputs.allSatisfy { $0["leaseEpoch"]?.intValue == 4 })
    #expect(inputs[0]["op"]?["kind"]?.stringValue == "text")
    // The key body is the ENGINE's serde shape, `repeat` and all — the cell
    // deserializes the wire `op` straight into ghosttea's own type.
    #expect(inputs[1]["op"]?["key"]?["code"]?.stringValue == "Enter")
    #expect(inputs[1]["op"]?["key"]?["repeat"]?.boolValue == false)
    #expect(inputs[1]["op"]?["key"]?["unshiftedCodepoint"]?.intValue == 0)
    #expect(inputs[2]["op"]?["kind"]?.stringValue == "paste")
    #expect(inputs[3]["op"]?["kind"]?.stringValue == "interrupt")
    client.close()
  }

  /// A non-finite pointer coordinate never leaves this device (TM-r3, K-L2).
  ///
  /// `RoutedMouseInput`'s doc has always said so; until now only
  /// `TerminalAttachment.handleMouse` enforced it, so the claim was true of one
  /// caller and false of this surface. The cell's reader refuses an infinity
  /// before it reaches the engine and the refusal is an audit line with no
  /// reply, so a message spent on one tells this device nothing.
  @Test func aNonFinitePointerCoordinateNeverLeavesThisDevice() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    let frame = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(10), payload: Data("TRF1".utf8))
    await live.frames.deliver(.binary(frame))
    try await settle("the frame applies") { await sink.deltaFrames == 1 }
    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(session: session, activation: live.activation, sequence: 1))
    try await settle("input allowed") { client.sessions[session]?.inputAllowed == true }

    func mouse(x: Float, y: Float) -> RoutedMouseInput {
      RoutedMouseInput(
        action: .motion, button: 0, x: x, y: y, screenWidth: 800, screenHeight: 600,
        cellWidth: 8, cellHeight: 16, paddingLeft: 0, paddingTop: 0)
    }
    // The precondition, pinned: a FINITE event does go, so the silence below is
    // the guard and not an input path that was never open.
    client.send(mouse: mouse(x: 10, y: 20), to: session)
    try await settle("the finite event") { await live.control.allSent("SendInput").count == 1 }

    for bad in [mouse(x: .infinity, y: 20), mouse(x: 10, y: -.infinity), mouse(x: .nan, y: .nan)] {
      client.send(mouse: bad, to: session)
    }
    try await Task.sleep(for: .milliseconds(30))
    #expect(await live.control.allSent("SendInput").count == 1)
    // …and the input SEQUENCE did not move either: a dropped event must not
    // leave a gap the cell would read as a lost message.
    #expect(client.sessions[session]?.inputSequence == 1)
    client.close()
  }

  /// FOCUS NEVER IMPLIES A CLAIM. The seat is explicit, the claim names its
  /// claimant and the revision it expects, and the cell mints the holder
  /// generation — a caller can only name itself.
  @Test func theGeometrySeatIsClaimedExplicitly() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    // This ticket carries `geometry`; the default one in `attached` does not.
    client.open(try TicketFactory.make(sessionId: session, rights: ["geometry", "input", "read"]))
    let live = try await attached(transport: transport, sink: sink, client: client)
    // The cell's accepted rights are what count, so it must grant geometry too.
    try await live.control.deliver(
      .controlLegAttached,
      Script.controlAttached(
        session: session, activation: live.activation, rights: ["geometry", "input", "read"]))
    try await settle("geometry granted") {
      client.sessions[session]?.rights.contains(.geometry) == true
    }

    client.claimGeometry(cols: 100, rows: 30, for: session)
    try await settle("the claim") { await live.control.lastSent("ClaimGeometry") != nil }
    let claim = await live.control.lastSent("ClaimGeometry")
    #expect(claim?["cols"]?.intValue == 100)
    #expect(claim?["rows"]?.intValue == 30)
    #expect(claim?["expectRevision"]?.intValue == 0)
    #expect(claim?["claimant"]?["viewId"]?.stringValue == "view-1")
    #expect(claim?["claimant"]?["clientId"]?.stringValue == "win-3c4d-incarnation-2")

    try await live.control.deliver(
      .geometryCommitted,
      [
        "holder": .object([
          "clientId": .string("win-3c4d-incarnation-2"), "viewId": .string("view-1"),
          "holderGeneration": .int(1),
        ]),
        "geometryRevision": .int(7), "cols": .int(100), "rows": .int(30),
      ])
    try await settle("the commit") { client.sessions[session]?.geometryRevision == 7 }
    // The next claim expects the revision the cell committed — the CAS the
    // contract asks for, rather than a hopeful zero.
    client.claimGeometry(cols: 101, rows: 30, for: session)
    try await settle("a second claim") {
      await live.control.allSent("ClaimGeometry").count == 2
    }
    let second = await live.control.allSent("ClaimGeometry")[1]
    #expect(second["expectRevision"]?.intValue == 7)
    client.close()
  }

  /// A session with no `geometry` right never claims the seat — the cell would
  /// refuse `RIGHT_MISSING`, and asking anyway is a message that can only fail.
  @Test func aViewerWithoutTheGeometryRightDoesNotClaim() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    client.claimGeometry(cols: 80, rows: 24, for: session)
    try await Task.sleep(for: .milliseconds(30))
    #expect(await live.control.lastSent("ClaimGeometry") == nil)
    client.close()
  }

  /// Demand is per-activation, sequenced, and idempotent to re-send. `none`
  /// detaches the cell's view; `live` attaches it.
  @Test func demandIsSequencedPerActivation() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    client.declare(demand: .none, for: session)
    client.declare(demand: .live, for: session)
    try await settle("two demands") { await live.control.allSent("DeclareDemand").count == 2 }
    let demands = await live.control.allSent("DeclareDemand")
    #expect(demands.map { $0["demandSequence"]?.intValue } == [1, 2])
    #expect(demands[0]["demand"]?["mode"]?.stringValue == "none")
    #expect(demands[1]["demand"]?["mode"]?.stringValue == "live")
    #expect(demands[0]["activationId"]?.stringValue == live.activation)
    client.close()
  }

  // MARK: Frames and credits

  /// A seed arrives as a TRANSFER — begin, chunks, end — is reassembled,
  /// checksum-verified, applied whole, and acknowledged with a stamp.
  @Test func aSeedTransferReassemblesAndIsAcknowledged() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    #expect(client.sessions[session]?.lastSeedReason == "no-cursor")

    let seed = Data((0..<300).map { UInt8($0 % 251) })
    let units = try Script.transferUnits(
      session: session, activation: live.activation, creditEpoch: 1, firstSequence: 1,
      kind: "seed", base: nil, result: Script.stamp(4417), payload: seed)
    for unit in units { await live.frames.deliver(.binary(unit)) }
    try await settle("the seed applies") { await sink.fullFrames == 1 }
    #expect(await sink.lastFrame == seed)
    #expect(await sink.content?.sceneRevision == 4417)

    try await settle("the ack") { await live.frames.lastSent("SceneApplied") != nil }
    let applied = await live.frames.lastSent("SceneApplied")
    #expect(applied?["appliedContent"]?["sceneRevision"]?.intValue == 4417)
    #expect(applied?["activationId"]?.stringValue == live.activation)
    client.close()
  }

  /// A delta applies against the base the SINK holds — the only place that can
  /// answer it. When the sink has moved on, the honest repair is a reseed, not a
  /// delta onto the wrong scene.
  @Test func aDeltaWhoseBaseTheSinkDoesNotHoldBreaksTheLineage() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    let seed = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(100), payload: Data("TRF1-full".utf8))
    await live.frames.deliver(.binary(seed))
    try await settle("the full frame") { await sink.deltaFrames == 1 }

    let good = try Script.frame(
      session: session, activation: live.activation, sequence: 2, creditEpoch: 1,
      base: Script.stamp(100), result: Script.stamp(101), payload: Data("TRF1-delta".utf8))
    await live.frames.deliver(.binary(good))
    try await settle("the delta") { await sink.deltaFrames == 2 }
    #expect(await sink.content?.sceneRevision == 101)

    let stale = try Script.frame(
      session: session, activation: live.activation, sequence: 3, creditEpoch: 1,
      base: Script.stamp(55), result: Script.stamp(56), payload: Data("TRF1-wrong".utf8))
    await live.frames.deliver(.binary(stale))
    try await settle("the lineage break") { client.sessions[session]?.frames == .seeding }
    #expect(client.sessions[session]?.appliedContent == nil)
    #expect(await sink.deltaFrames == 2)
    client.close()
  }

  /// D1 (the second audit, 2026-10-16) — frames reach the sink in the order they
  /// arrived, ONE AT A TIME per session. Each used to start its own task, and
  /// nothing ordered two tasks: a delta could reach the sink while the frame it
  /// builds on was still applying. A sink that holds the first apply open must
  /// not see the second until it returns, and nothing is acknowledged early.
  @Test func framesReachTheSinkInArrivalOrderEvenWhenAnApplyIsSlow() async throws {
    let transport = ScriptedTransport()
    let sink = HeldApplySink()
    let client = RoutedTerminalClient(
      transport: transport, sink: sink, options: .init(viewId: "view-1"))
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    let seed = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(100), payload: Data("TRF1-full".utf8))
    let delta = try Script.frame(
      session: session, activation: live.activation, sequence: 2, creditEpoch: 1,
      base: Script.stamp(100), result: Script.stamp(101), payload: Data("TRF1-delta".utf8))
    await live.frames.deliver(.binary(seed))
    await live.frames.deliver(.binary(delta))

    try await settle("the first apply to start") { await sink.started == 1 }
    // Both units are in; the second's apply must still be waiting.
    try await Task.sleep(for: .milliseconds(150))
    #expect(await sink.started == 1)
    #expect(await live.frames.lastSent("SceneApplied") == nil)

    await sink.release()
    try await settle("both frames applied, in order") { await sink.applied == [100, 101] }
    try await settle("the newest acknowledgement") {
      await live.frames.lastSent("SceneApplied")?["appliedContent"]?["sceneRevision"]?.intValue
        == 101
    }
    client.close()
  }

  /// §5.4 — a frame IN FLIGHT over an applied scene is still the worker's
  /// `active` state, not a seed. Reading `.applying` as not ready closed input
  /// for the length of every frame's render: while a TUI streamed, keystrokes
  /// were declined ("waiting for the terminal to catch up") and the card's
  /// phase fell to `connecting` on every frame (James's phone, 2026-10-17).
  @Test func aFrameInFlightOverAnAppliedSceneKeepsPresentationAndInput() async throws {
    let transport = ScriptedTransport()
    let sink = HeldApplySink(holding: 2)
    let client = RoutedTerminalClient(
      transport: transport, sink: sink, options: .init(viewId: "view-1"))
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    let seed = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(100), payload: Data("TRF1-full".utf8))
    await live.frames.deliver(.binary(seed))
    try await settle("the seed applies") { await sink.applied == [100] }
    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(session: session, activation: live.activation, sequence: 1))
    try await settle("input allowed") { client.sessions[session]?.inputAllowed == true }

    let delta = try Script.frame(
      session: session, activation: live.activation, sequence: 2, creditEpoch: 1,
      base: Script.stamp(100), result: Script.stamp(101), payload: Data("TRF1-delta".utf8))
    await live.frames.deliver(.binary(delta))
    try await settle("the delta's apply is held open") { await sink.started == 2 }
    #expect(client.sessions[session]?.frames == .applying)
    #expect(client.sessions[session]?.presentationReady == true)
    #expect(client.sessions[session]?.inputAllowed == true)
    let before = await live.control.allSent("SendInput").count
    client.send(text: "l", to: session)
    try await settle("the keystroke goes out mid-frame") {
      await live.control.allSent("SendInput").count == before + 1
    }

    await sink.release()
    try await settle("the delta applies") { await sink.applied == [100, 101] }
    client.close()
  }

  /// The keyboard's bottom (James, 2026-10-17): the contract's largest
  /// `scroll-to` row, which the engine pins to the active area whatever has
  /// scrolled in since the last frame — never a total read off that frame.
  @Test func scrollToBottomAsksForTheContractsLargestRow() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    let frame = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(10), payload: Data("TRF1-seed".utf8))
    await live.frames.deliver(.binary(frame))
    try await settle("the frame applies") { await sink.deltaFrames == 1 }
    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(session: session, activation: live.activation, sequence: 1))
    try await settle("input allowed") { client.sessions[session]?.inputAllowed == true }

    client.scrollToBottom(for: session)
    let sent = try await settled("the scroll") { await live.control.lastSent("SendInput") }
    #expect(sent["op"]?["kind"]?.stringValue == "scroll-to")
    #expect(sent["op"]?["row"]?.intValue == 9_007_199_254_740_991)
    client.close()
  }

  /// A SEED the sink refuses is not an applied scene (TM-r3, K-H1).
  ///
  /// `applyFullFrame` returned `Void`, so a refusal was indistinguishable from
  /// an apply: the client stamped the scene, told the cell `SceneApplied`, and
  /// the cell — whose only trigger for another seed is an acknowledgement that
  /// does NOT advance — had every reason to stop seeding. The phone sat at
  /// phase `live` behind a blank pane with no banner and nothing arriving.
  ///
  /// The whole of the fix is asserted here in the negative first, which is the
  /// only way this bug is visible: NOTHING was acknowledged.
  @Test func aSeedTheSinkRefusesIsNeverAcknowledgedAsApplied() async throws {
    let transport = ScriptedTransport()
    let sink = RefusingSink()
    let client = RoutedTerminalClient(
      transport: transport, sink: sink, options: .init(viewId: "view-1"))
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    let seed = Data((0..<300).map { UInt8($0 % 251) })
    let units = try Script.transferUnits(
      session: session, activation: live.activation, creditEpoch: 1, firstSequence: 1,
      kind: "seed", base: nil, result: Script.stamp(4417), payload: seed)
    for unit in units { await live.frames.deliver(.binary(unit)) }

    try await settle("the sink to refuse the seed") { await sink.refusedFull == 1 }
    try await settle("the client to ask again") {
      client.sessions[session]?.frames == .seeding
    }
    // The three things that were wrong, each named: no acknowledgement went to
    // the cell, no scene is claimed, and the frames state says a seed is owed
    // rather than that one landed.
    #expect(await live.frames.lastSent("SceneApplied") == nil)
    #expect(client.sessions[session]?.appliedContent == nil)
    #expect(client.sessions[session]?.frames == .seeding)
    client.close()
  }

  /// …and the asking is BOUNDED. A build whose TRF1 reader cannot parse what
  /// this cell renders would otherwise ask for a scene it can never show, from
  /// a cell that keeps sending one, behind a pane that stays blank — a silent
  /// loop where the old bug was a silent blank.
  ///
  /// Three refused authoritative scenes in a row and the client says so, in a
  /// sentence, in a state the card can render with a retry beside it.
  @Test func aRepairRefusedThreeTimesStopsAskingAndSaysWhy() async throws {
    let transport = ScriptedTransport()
    let sink = RefusingSink()
    let client = RoutedTerminalClient(
      transport: transport, sink: sink, options: .init(viewId: "view-1"))
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    // Self-contained frames — no base — which is what a seed is however it is
    // framed. Both roads into the sink are exercised: a transfer and a bare
    // `trf1-frame`, because both replace the scene and both are the repair.
    let units = try Script.transferUnits(
      session: session, activation: live.activation, creditEpoch: 1, firstSequence: 1,
      kind: "seed", base: nil, result: Script.stamp(1), payload: Data(count: 64))
    for unit in units { await live.frames.deliver(.binary(unit)) }
    try await settle("the first refusal") { client.sessions[session]?.frames == .seeding }

    for (index, revision) in [Int64(2), Int64(3)].enumerated() {
      let frame = try Script.frame(
        session: session, activation: live.activation, sequence: Int64(10 + index), creditEpoch: 1,
        base: nil, result: Script.stamp(revision), payload: Data("TRF1".utf8))
      await live.frames.deliver(.binary(frame))
    }

    try await settle("the bound") {
      if case .failed = client.state { return true } else { return false }
    }
    guard case .failed(let reason) = client.state else {
      Issue.record("the client is failed at the bound")
      return
    }
    // The sentence names what is actually wrong — this build cannot show these
    // frames — rather than blaming a connection that is perfectly healthy.
    #expect(reason.contains("cannot be shown on this build"))
    #expect(reason.contains("3"))
    #expect(client.lastRefusal == reason)
    // Still nothing was ever acknowledged, and nothing is claimed.
    #expect(await live.frames.lastSent("SceneApplied") == nil)
    #expect(client.sessions[session]?.appliedContent == nil)
    client.close()
  }

  /// The bound counts CONSECUTIVE refusals. A sink that takes a scene is not a
  /// build that cannot show any, so an applied frame clears the count — without
  /// which a long session would eventually fail on three unrelated races.
  @Test func anAppliedSceneClearsTheRefusalCount() async throws {
    let transport = ScriptedTransport()
    let sink = RefusingSink()
    let client = RoutedTerminalClient(
      transport: transport, sink: sink, options: .init(viewId: "view-1"))
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    func deliverSelfContained(_ sequence: Int64, _ revision: Int64) async throws {
      let frame = try Script.frame(
        session: session, activation: live.activation, sequence: sequence, creditEpoch: 1,
        base: nil, result: Script.stamp(revision), payload: Data("TRF1".utf8))
      await live.frames.deliver(.binary(frame))
    }

    try await deliverSelfContained(1, 1)
    try await deliverSelfContained(2, 2)
    try await settle("two refusals") { await sink.refusedDelta == 2 }

    // The sink starts taking frames again — a race that resolved, not a broken
    // build — and the next scene applies and resets the count.
    await sink.accept()
    try await deliverSelfContained(3, 3)
    try await settle("the applied scene") { await sink.appliedDelta == 1 }
    #expect(client.sessions[session]?.appliedContent?.sceneRevision == 3)

    // Two more refusals would have tripped a count that had not been cleared.
    await sink.refuse()
    try await deliverSelfContained(4, 4)
    try await deliverSelfContained(5, 5)
    try await settle("two more refusals") { await sink.refusedDelta == 4 }
    #expect(client.state == .attached)
    if case .failed = client.state { Issue.record("the count did not reset") }
    client.close()
  }

  /// Credit is returned for EVERY received unit, exactly once, cumulatively —
  /// including one for an activation this client no longer holds, whose content
  /// it discards. A receiver that returned credit only for units it liked would
  /// starve the connection one mistake at a time.
  @Test func everyUnitReturnsItsChargeIncludingAStaleOne() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    let first = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(1), payload: Data(count: 1000))
    let orphan = try Script.frame(
      session: session, activation: "an-activation-nobody-holds", sequence: 1, creditEpoch: 1,
      base: nil, result: Script.stamp(1), payload: Data(count: 500))
    await live.frames.deliver(.binary(first))
    await live.frames.deliver(.binary(orphan))

    // Settle on the credit that accounts for BOTH units, not on "a credit": the
    // client's coalescing window may close between the two deliveries, and the
    // first return (the 1000-byte frame alone, one account) already satisfies
    // "any credit was sent". Totals are cumulative within the connection, so
    // the return that covers the orphan carries the sum (TM-4a, 2026-09-14 —
    // the row went red once under load with exactly that first return).
    //
    // …and the return that MATCHED is what is read below, rather than whatever
    // `lastSent` answers a moment later (TM-r3, T-L(b)): re-reading a
    // cumulative surface after settling on it is two reads, and an account
    // pruned between them would change the answer under the assertions.
    let expected = Int64(first.count + orphan.count)
    let credit = try await settled("a credit return covering both units") {
      let sent = await live.frames.lastSent("TransportCredit")
      return sent?["connectionBytesReturned"]?.intValue == expected ? sent : nil
    }
    #expect(credit["creditEpoch"]?.intValue == 1)
    #expect(credit["connectionBytesReturned"]?.intValue == expected)
    let accounts = credit["accounts"]?.arrayValue ?? []
    #expect(accounts.count == 2)
    let orphanAccount = accounts.first { $0["activationId"]?.stringValue == "an-activation-nobody-holds" }
    #expect(orphanAccount?["bytesReturned"]?.intValue == Int64(orphan.count))
    // The orphan's CONTENT went nowhere.
    #expect(await sink.deltaFrames == 1)
    client.close()
  }

  /// A unit stamped with another credit epoch cannot be accounted for on this
  /// leg. It is a protocol error rather than a discard, because a ledger that
  /// silently absorbed it would be a ledger the cell and the client disagree
  /// about.
  @Test func aUnitFromAnotherCreditEpochEndsTheConnection() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    let wrong = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 99, base: nil,
      result: Script.stamp(1), payload: Data(count: 10))
    await live.frames.deliver(.binary(wrong))
    try await settle("the failure") {
      if case .failed = client.state { return true } else { return false }
    }
    client.close()
  }

  /// Two live activations of one set may not declare the same TRF1 session
  /// handle: the sink indexes its replica by that handle, so two identities
  /// routing to two replicas is the exact corruption the rule exists to prevent.
  @Test func twoActivationsMayNotClaimOneTrfHandle() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    // A second session on the same set, attaching with the SAME handle.
    let second = "sess-second"
    client.open(try TicketFactory.make(sessionId: second))
    try await settle("a second attach") {
      await live.control.allSent("AttachControlLeg").count == 2
    }
    let secondAttach = await live.control.allSent("AttachControlLeg")[1]
    let secondActivation = secondAttach["activationId"]?.stringValue ?? ""
    try await live.frames.deliver(
      .framesLegAttached,
      Script.framesAttached(session: second, activation: secondActivation, sessionHandle: "77"))
    try await settle("the collision") {
      if case .failed = client.state { return true } else { return false }
    }
    #expect(client.lastRefusal?.contains("77") == true)
    _ = live.activation
    client.close()
  }

  /// P5 (2026-10-17) — an attach refusal is ONE session's answer: it stays on
  /// that session, the set stays attached for every other session on its legs,
  /// and a fresh ticket for the refused one attaches over the same legs. It used
  /// to set the SET's state, which painted the refusal on every card of the lane
  /// and left `open` no branch that attaches — RETRY minted, and used nothing.
  @Test func anAttachRefusalStaysOnItsSession() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    let second = "sess-second"
    client.open(try TicketFactory.make(sessionId: second))
    try await settle("a second attach") {
      await live.control.allSent("AttachControlLeg").count == 2
    }
    let refused = await live.control.allSent("AttachControlLeg")[1]["activationId"]?.stringValue
    try await live.control.deliver(
      .attachRefused,
      [
        "activationId": .string(refused ?? ""), "code": .string("SESSION_NOT_FOUND"),
        "retryable": .bool(false),
      ])
    try await settle("the refusal lands on its session") {
      client.sessions[second]?.control == .refused(code: "SESSION_NOT_FOUND", retryable: false)
    }
    #expect(client.state == .attached)
    #expect(client.sessions[session]?.control == .attached)
    #expect(client.hasLiveActivation(session))
    #expect(!client.hasLiveActivation(second))

    // The card's RETRY is a fresh ticket, and it attaches over the legs that are up.
    client.open(try TicketFactory.make(sessionId: second))
    try await settle("the retry attaches") {
      await live.control.allSent("AttachControlLeg").count == 3
    }
    #expect(transport.dials.count == 2)
    client.close()
  }

  /// P5 — a failure tears the legs down, and every activation on them ends with
  /// them: no session reads attached over closed sockets, so the card's RETRY (a
  /// fresh ticket) dials, rather than taking a dead lane for a live one ("back
  /// on its lane — no mint, no dial", over nothing).
  @Test func aFailureEndsEveryActivationOnItsLegsSoATicketDials() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    let wrong = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 99, base: nil,
      result: Script.stamp(1), payload: Data(count: 10))
    await live.frames.deliver(.binary(wrong))
    try await settle("the failure") {
      if case .failed = client.state { return true } else { return false }
    }
    #expect(client.sessions[session]?.control == .attaching)
    #expect(!client.hasLiveActivation(session))
    try await settle("the sink is told") {
      await sink.endings.contains("\(live.activation):legs-closed")
    }

    client.open(try ticket())
    try await settle("a fresh dial") { transport.dials.count == 4 }
    #expect(client.state == .connecting)
    client.close()
  }

  /// P6 (2026-10-17) — the set's step is read off the sessions it still
  /// CARRIES, and every session's first frame is recorded. Both were the last
  /// ticket's session alone: a session presenting while the ticket named
  /// another was never "presented", and a `forget` of the ticket's session left
  /// the set waiting on an attach nobody would make — 20 s later the whole lane
  /// stalled, and every card on it said "couldn't reach".
  @Test func theStepIsTheCarriedSessionsAndAForgetStallsNothing() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = RoutedTerminalClient(
      transport: transport, sink: sink,
      options: .init(viewId: "view-1", stepDeadline: .seconds(1)))
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    // The last ticket names a second session, whose attach the cell has not
    // answered — and the FIRST one presents meanwhile.
    let second = "sess-second"
    client.open(try TicketFactory.make(sessionId: second))
    try await settle("a second attach") {
      await live.control.allSent("AttachControlLeg").count == 2
    }
    let seed = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(100), payload: Data("TRF1-full".utf8))
    await live.frames.deliver(.binary(seed))
    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(session: session, activation: live.activation, sequence: 1))
    try await settle("the first session presents") { client.hasPresented(session) }
    #expect(client.step == .control)

    client.forget(sessionId: second)
    #expect(client.step == nil)
    // Past the deadline the forgotten attach would have stalled the set at.
    try await Task.sleep(for: .milliseconds(1_300))
    #expect(client.state == .attached)
    #expect(client.hasLiveActivation(session))
    client.close()
  }

  /// The History lead's D6 (2026-10-17) — a paste larger than the cell's
  /// control-message cap closed the WHOLE control leg: the cell's reader drops
  /// a connection on an oversize message. Past the announced cap it is refused
  /// here, with the text's own size and how much of IT one message carries, and
  /// nothing is sent; the leg stays, and the next paste goes.
  @Test func aPasteTooLargeForOneControlMessageIsRefusedWithItsNumbers() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    let seed = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(100), payload: Data("TRF1-full".utf8))
    await live.frames.deliver(.binary(seed))
    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(session: session, activation: live.activation, sequence: 1))
    try await settle("typing is allowed") { client.sessions[session]?.inputAllowed == true }

    // The vector's cell announces 65,536 bytes a control message.
    let large = String(repeating: "a", count: 100_000)
    let refused = try #require(client.paste(large, to: session))
    #expect(refused.kind == .pasted)
    #expect(refused.bytes == 100_000)
    #expect(refused.fits < 65_536 && refused.fits > 65_000)
    // Quotes cost two bytes each on the wire, so "of it" is THIS text's figure.
    let quoted = String(repeating: "\"", count: 40_000)
    let escaped = try #require(client.send(text: quoted, to: session))
    #expect(escaped.kind == .typed)
    #expect(escaped.bytes == 40_000)
    #expect(escaped.fits < 32_768 && escaped.fits > 32_000)
    #expect(await live.control.allSent("SendInput").isEmpty)
    #expect(await live.control.isClosed == false)

    #expect(client.paste("echo fits", to: session) == nil)
    try await settle("the next paste goes") {
      await live.control.allSent("SendInput").count == 1
    }
    client.close()
  }

  // MARK: Loss and replacement

  /// Losing ONE leg invalidates every activation on the SET — the other leg's
  /// activations are no longer two-legged, so they are not activations — and the
  /// client asks for a fresh ticket rather than re-dialing. The SESSIONS are not
  /// ended by it: a lost leg is the connection's lifetime, and each session waits
  /// for the next legs' activation (the audit's B3, 2026-10-17: a blip read "this
  /// session ended — leg-dead" with no retry).
  ///
  /// There is no socket-level retry BY DESIGN: a transport grant's
  /// `(nonce, channel)` is consumed at first use and held until the grant
  /// expires (`tp/ledger.rs` `check_transport`), so a re-dial with the ticket in
  /// hand earns `GRANT_NONCE_REPLAYED`, which is terminal for that grant. A
  /// client that retried the socket would spin against a refusal that can never
  /// become an acceptance.
  @Test func aLostLegEndsEveryActivationAndAsksForAFreshTicket() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    await live.frames.hangUp(code: nil)
    try await settle("reconnecting") { client.state == .reconnecting }
    #expect(client.needsTicket)
    #expect(client.sessions[session]?.control == .attaching)
    #expect(client.sessions[session]?.lastRefusal != nil)
    try await settle("the sink is told") { await sink.endings.contains("\(live.activation):leg-dead") }
    // Exactly ONE dial per leg: nothing retried the socket.
    #expect(transport.dials.count == 2)
    client.close()
  }

  /// B3 — the cell's own `revoked{leg-dead}` is the same loss seen from its side
  /// (`leg_closed`): the activation is over, the session is not, and the legs are
  /// the set's to replace when this side sees the close. Re-attaching on the
  /// revoke alone would race that replacement on legs that are going.
  @Test func theCellsLegDeadRevokeEndsTheActivationNotTheSession() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(
        session: session, activation: live.activation, sequence: 1, presentation: "revoked",
        input: "revoked", reason: "leg-dead"))
    try await settle("the activation ends") {
      await sink.endings.contains("\(live.activation):leg-dead")
    }
    #expect(client.sessions[session]?.control == .attaching)
    #expect(client.sessions[session]?.lastRefusal == "leg-dead")
    #expect(transport.dials.count == 2)

    await live.frames.hangUp(code: nil)
    try await settle("reconnecting") { client.state == .reconnecting }
    #expect(client.sessions[session]?.control == .attaching)
    client.close()
  }

  /// The replacement is a FRESH TICKET, and it brings a new leg generation: the
  /// cell's rule is that the credit epoch IS the frames leg generation, so every
  /// total resets and the new activation names the one it replaces.
  @Test func aFreshTicketReplacesTheSetWithANewCreditEpoch() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    // Spend some credit, then lose the leg.
    let frame = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(10), payload: Data(count: 2000))
    await live.frames.deliver(.binary(frame))
    try await settle("a credit return") { await live.frames.lastSent("TransportCredit") != nil }
    await live.control.hangUp(code: nil)
    try await settle("reconnecting") { client.state == .reconnecting }

    // A fresh ticket on fresh sockets.
    let control = transport.rotate("/control")
    let frames = transport.rotate("/frames")
    client.open(try ticket())
    let replaced = try await attached(
      transport: transport, sink: sink, client: client, legGeneration: 2)
    #expect(replaced.activation != live.activation)

    let attach = await control.lastSent("AttachControlLeg")
    #expect(attach?["replacesActivationId"]?.stringValue == live.activation)
    // The resume capability was negotiated and there is a token plus an applied
    // stamp, so the frames attach asks to resume rather than to reseed.
    let framesAttach = await frames.lastSent("AttachFramesLeg")
    #expect(framesAttach?["resume"]?["resumeToken"]?.stringValue == "rt-1")
    #expect(framesAttach?["resume"]?["from"]?["sceneRevision"]?.intValue == 10)

    // A new epoch: the first return on the replacement counts from zero.
    let next = try Script.frame(
      session: session, activation: replaced.activation, sequence: 1, creditEpoch: 2, base: nil,
      result: Script.stamp(11), payload: Data(count: 100))
    await frames.deliver(.binary(next))
    try await settle("a return on the new leg") { await frames.lastSent("TransportCredit") != nil }
    let credit = await frames.lastSent("TransportCredit")
    #expect(credit?["creditEpoch"]?.intValue == 2)
    #expect(credit?["creditSequence"]?.intValue == 1)
    #expect(credit?["connectionBytesReturned"]?.intValue == Int64(next.count))
    client.close()
  }

  /// `STALE_ROUTE` is its own state: the session moved, and the caller must
  /// re-resolve the route before minting. The client cannot do either and does
  /// not pretend to.
  @Test func aStaleRouteCloseIsItsOwnState() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    await live.control.hangUp(code: 4000)
    try await settle("stale route") { client.state == .staleRoute }
    #expect(client.needsTicket)
    client.close()
  }

  /// An `AttachRefused` naming `STALE_ROUTE` says the same thing as the close
  /// code and gets the same answer.
  @Test func anAttachRefusedForAStaleRouteAsksForAFreshTicket() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let control = transport.connection(for: "/control")
    let frames = transport.connection(for: "/frames")
    try await settle("two hellos") {
      let onControl = await control.sentTags().contains("ConnectionHello")
      let onFrames = await frames.sentTags().contains("ConnectionHello")
      return onControl && onFrames
    }
    try await control.deliver(.connectionAccepted, try Script.accepted(channel: .control))
    try await frames.deliver(.connectionAccepted, try Script.accepted(channel: .frames))
    try await settle("the attach") { await control.lastSent("AttachControlLeg") != nil }
    let activation = await control.lastSent("AttachControlLeg")?["activationId"]?.stringValue ?? ""
    try await control.deliver(
      .attachRefused,
      [
        "activationId": .string(activation), "code": .string("STALE_ROUTE"),
        "retryable": .bool(true),
      ])
    try await settle("stale route") { client.state == .staleRoute }
    #expect(client.sessions[session]?.lastRefusal == "STALE_ROUTE")
    client.close()
  }

  /// "Re-mint once, then UNAVAILABLE" — the pre-authentication rule, counted
  /// here because nothing else can count it: the close carried no code and no
  /// body BY POLICY, so a second identical silence is the only evidence that
  /// re-minting does not help.
  @Test func aSecondSilentRefusalIsUnavailableRatherThanAThirdTry() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let control = transport.connection(for: "/control")
    try await settle("the hello") { await control.sentTags().contains("ConnectionHello") }
    await control.hangUp(code: 1008)
    try await settle("reconnecting") { client.state == .reconnecting }
    #expect(client.needsTicket)

    let second = transport.rotate("/control")
    _ = transport.rotate("/frames")
    client.open(try ticket())
    try await settle("a second hello") { await second.sentTags().contains("ConnectionHello") }
    await second.hangUp(code: 1008)
    try await settle("unavailable") {
      if case .failed(let reason) = client.state { return reason.contains("UNAVAILABLE") }
      return false
    }
    #expect(!client.needsTicket)
    client.close()
  }

  /// A ticket naming a DIFFERENT cell boot replaces the set outright. A replaced
  /// cell is a new key, never a reconnect: carrying an activation across one
  /// would be carrying it across a lineage.
  @Test func aTicketForAnotherCellBootReplacesTheSet() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    #expect(client.sessions[session]?.activationId == live.activation)

    _ = transport.rotate("/control")
    _ = transport.rotate("/frames")
    client.open(try ticket(cellBootId: "cb-a-different-boot"))
    try await settle("a new set") { client.state == .connecting }
    // The old session's state went with the old cell rather than being carried.
    #expect(client.sessions[session]?.activationId != live.activation)
    client.close()
  }

  // MARK: Lifecycle events

  /// `SessionEvent` rides the control leg behind the negotiated capability, and
  /// each event lands on the session it names, as the cell's own fact. They
  /// once went to a queue for "the caller", and no caller drained it: a run
  /// that had exited read live and took keys into nothing (the audit's P8,
  /// 2026-10-17). `exited` holds input with its facts and leaves the
  /// activation up, so the run's last frames still land; `removed` ends it;
  /// `resync` and an unknown kind are said, and never close a leg.
  @Test func lifecycleEventsLandOnTheirSessionAndAreNeverInvented() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    #expect(client.negotiatedCapabilities.contains("session-events"))
    let seed = try Script.frame(
      session: session, activation: live.activation, sequence: 1, creditEpoch: 1, base: nil,
      result: Script.stamp(100), payload: Data("TRF1-full".utf8))
    await live.frames.deliver(.binary(seed))
    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(session: session, activation: live.activation, sequence: 1))
    try await settle("typing is allowed") { client.sessions[session]?.inputAllowed == true }

    try await live.control.deliver(
      .sessionEvent,
      [
        "event": .object([
          "kind": .string("exited"), "sessionId": .string(session), "exitCode": .int(0),
          "exitSignal": .null, "requestedTermination": .null, "exitOutcome": .string("completed"),
        ])
      ])
    try await settle("the exit lands") { client.sessions[session]?.exit != nil }
    #expect(
      client.sessions[session]?.exit
        == RoutedSessionExit(code: 0, signal: nil, requestedTermination: nil, outcome: "completed"))
    #expect(client.sessions[session]?.inputHeldBecause == "the run exited — completed")
    // The exit is not the activation's end: the legs stay, and a frame the run
    // wrote before it died still lands.
    #expect(client.sessions[session]?.control == .attached)
    let last = try Script.frame(
      session: session, activation: live.activation, sequence: 2, creditEpoch: 1,
      base: Script.stamp(100), result: Script.stamp(101), payload: Data("TRF1-delta".utf8))
    await live.frames.deliver(.binary(last))
    try await settle("the run's last frame") { await sink.deltaFrames == 2 }

    try await live.control.deliver(
      .sessionEvent, ["event": .object(["kind": .string("resync")])])
    // An unknown kind is drop-and-LOG at the receiver — a tolerant reader, never
    // a leg close, because future variants are additive behind this capability.
    try await live.control.deliver(
      .sessionEvent, ["event": .object(["kind": .string("someFutureKind")])])
    try await live.control.deliver(
      .sessionEvent,
      ["event": .object(["kind": .string("removed"), "sessionId": .string(session)])])
    try await settle("the removal ends it") {
      client.sessions[session]?.control == .ended(reason: "removed")
    }
    #expect(client.sessions[session]?.exit?.outcome == "completed")
    #expect(await live.control.isClosed == false)
    #expect(await live.frames.isClosed == false)
    client.close()
  }

  // MARK: Renewal and the lapsed attach (P0-C)
  //
  // The 2026-09-24 terminal audit: `renew(_:)` had no caller, so every phone
  // attach lost input at 540 s and, at 600 s, the cell revoked the activation
  // with `right-revoked` — which this client mapped to `.ended`, and the card
  // to "this session ended" over a PTY that was still running.

  /// A ticket whose attach grant falls due for renewal `dueInMs` from now: its
  /// expiry sits exactly the cell's margin plus this client's headroom beyond.
  private func renewableTicket(dueInMs: Int64) throws -> RoutedTerminalTicket {
    let now = RoutedTerminalClient.nowMs()
    let expiresAt =
      now + Int64(RoutedTerminalContract.attachRenewalMarginMs)
      + RoutedTerminalClient.renewalHeadroomMs + dueInMs
    return try TicketFactory.makeMixed(
      sessionId: session, attachIssuedAt: now - 1_000, attachExpiresAt: expiresAt)
  }

  /// What `terminal.renewAttach` answers: the held grant at the NEXT generation,
  /// good for another ten minutes.
  private func renewed(from grant: RoutedGrant) throws -> RoutedGrant {
    var envelope = grant.raw.objectValue ?? [:]
    var claims = envelope["claims"]?.objectValue ?? [:]
    claims["grantGeneration"] = .int((grant.grantGeneration ?? 0) + 1)
    claims["expiresAt"] = .int(RoutedTerminalClient.nowMs() + 600_000)
    envelope["claims"] = .object(claims)
    return try RoutedGrant(json: .object(envelope))
  }

  private func attachControlLegs(_ control: ScriptedConnection) async -> Int {
    await control.sentTags().filter { $0 == "AttachControlLeg" }.count
  }

  /// The renewal is asked for BEFORE the cell closes input, and rides the SAME
  /// activation: a renewal is not a re-attach.
  @Test func theGrantIsRenewedBeforeTheInputMarginOnTheSameActivation() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let asks = RenewalAsks()
    let ticket = try renewableTicket(dueInMs: 300)
    let answer = try renewed(from: ticket.attachGrant)
    let client = RoutedTerminalClient(
      transport: transport, sink: sink,
      options: .init(
        renewalProvider: { request in
          asks.requests.append(request)
          return answer
        },
        viewId: "view-1"))
    client.open(ticket)
    let live = try await attached(transport: transport, sink: sink, client: client)

    try await settle("the renewal carried to the cell") {
      await attachControlLegs(live.control) == 2
    }
    #expect(asks.requests.count == 1)
    #expect(asks.requests.first?.sessionId == session)
    #expect(asks.requests.first?.expectGeneration == ticket.attachGrant.grantGeneration)
    #expect(asks.requests.first?.requestId.isEmpty == false)
    let carried = await live.control.lastSent("AttachControlLeg")
    #expect(carried?["activationId"]?.stringValue == live.activation)
    #expect(carried?["attachGrant"] == answer.raw)
    // the local deadline moved with the new expiry: input stays open
    #expect(client.sessions[session]?.inputRightLive == true)
    client.close()
  }

  /// A renewal that fails is asked again under the SAME request id: the door is
  /// idempotent by it, so a reply lost on the way back cannot cost a generation.
  @Test func aFailedRenewalIsRetriedUnderTheSameRequestId() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let asks = RenewalAsks()
    let ticket = try renewableTicket(dueInMs: 200)
    let answer = try renewed(from: ticket.attachGrant)
    let client = RoutedTerminalClient(
      transport: transport, sink: sink,
      options: .init(
        renewalProvider: { request in
          asks.requests.append(request)
          if asks.requests.count == 1 {
            throw FieldProductError(kind: "UNAVAILABLE", message: "busy", retryable: true)
          }
          return answer
        },
        viewId: "view-1"))
    client.open(ticket)
    let live = try await attached(transport: transport, sink: sink, client: client)

    try await settle("the retried renewal carried to the cell", timeout: .seconds(8)) {
      await attachControlLegs(live.control) == 2
    }
    #expect(asks.requests.count == 2)
    #expect(asks.requests[0].requestId == asks.requests[1].requestId)
    #expect(asks.requests[0].expectGeneration == asks.requests[1].expectGeneration)
    client.close()
  }

  /// The cell's tick at the grant's expiry revokes the WHOLE activation with
  /// `right-revoked`. The session is alive, so the client re-attaches — a fresh
  /// ticket's grant, on the SAME legs — and never reads `.ended`.
  @Test func aLapsedGrantReattachesOnTheSameLegsInsteadOfEndingTheSession() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let mints = TicketMints()
    let session = session
    let client = RoutedTerminalClient(
      transport: transport, sink: sink,
      options: .init(
        ticketProvider: { _ in
          mints.calls += 1
          return try TicketFactory.make(sessionId: session)
        },
        maxBackoff: .milliseconds(200), viewId: "view-1"))
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)
    let dialsBefore = transport.dials.count

    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(
        session: session, activation: live.activation, sequence: 1, presentation: "revoked",
        input: "revoked", reason: "right-revoked"))

    try await settle("a fresh attach") { await attachControlLegs(live.control) == 2 }
    if case .ended = client.sessions[session]?.control {
      Issue.record("a lapsed grant read as an ended session")
    }
    #expect(mints.calls == 1)
    // the same legs: a lapsed attach is not a lost connection
    #expect(transport.dials.count == dialsBefore)
    let reattach = await live.control.lastSent("AttachControlLeg")
    let activation = reattach?["activationId"]?.stringValue
    #expect(activation != nil)
    #expect(activation != live.activation)
    #expect(reattach?["replacesActivationId"]?.stringValue == live.activation)
    #expect(client.state != .reconnecting)
    client.close()
  }

  /// …and only a lapse re-attaches. A lost leg waits for the set's next legs
  /// (`theCellsLegDeadRevokeEndsTheActivationNotTheSession`); a revoke for any
  /// other reason — the cell's `replaced`, or one this client does not know —
  /// still ends the session here, in the cell's own words.
  @Test func aRevokeForAnyOtherReasonStillEndsTheSession() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let client = client(transport, sink: sink)
    client.open(try ticket())
    let live = try await attached(transport: transport, sink: sink, client: client)

    try await live.control.deliver(
      .cellActivationStatus,
      Script.status(
        session: session, activation: live.activation, sequence: 1, presentation: "revoked",
        reason: "session-gone"))
    try await settle("the session ended") {
      if case .ended(let reason) = client.sessions[session]?.control {
        return reason == "session-gone"
      }
      return false
    }
    #expect(await attachControlLegs(live.control) == 1)
    client.close()
  }

  /// An attach refused for its GRANT is one message on a LIVE leg: the fresh
  /// grant re-attaches over the same legs. It used to set the set to
  /// `.reconnecting`, where `open` has no branch that attaches over live legs —
  /// the fresh grant was stored, never used, and the card said "connecting…"
  /// for good.
  @Test func anAttachRefusedForItsGrantReattachesOnTheLiveLegs() async throws {
    let transport = ScriptedTransport()
    let sink = RoutedFrameRecorder()
    let mints = TicketMints()
    let session = session
    let client = RoutedTerminalClient(
      transport: transport, sink: sink,
      options: .init(
        ticketProvider: { _ in
          mints.calls += 1
          return try TicketFactory.make(sessionId: session)
        },
        maxBackoff: .milliseconds(200), viewId: "view-1"))
    client.open(try ticket())
    let control = transport.connection(for: "/control")
    let frames = transport.connection(for: "/frames")
    try await settle("two hellos") {
      let onControl = await control.sentTags().contains("ConnectionHello")
      let onFrames = await frames.sentTags().contains("ConnectionHello")
      return onControl && onFrames
    }
    try await control.deliver(.connectionAccepted, try Script.accepted(channel: .control))
    try await frames.deliver(.connectionAccepted, try Script.accepted(channel: .frames))
    try await settle("the first attach") { await attachControlLegs(control) == 1 }
    let first = await control.lastSent("AttachControlLeg")?["activationId"]?.stringValue ?? ""

    try await control.deliver(
      .attachRefused,
      [
        "activationId": .string(first), "code": .string("GRANT_INVALID"),
        "retryable": .bool(false),
      ])

    try await settle("a second attach on the same legs") { await attachControlLegs(control) == 2 }
    #expect(mints.calls == 1)
    #expect(transport.dials.count == 2)
    #expect(client.state != .reconnecting)
    client.close()
  }
}

/// What the renewal provider was asked, in order (the `TicketMints` rule: a
/// class, because the provider is `@Sendable` and main-actor isolated).
@MainActor
final class RenewalAsks {
  var requests: [RoutedRenewal] = []
}

/// What the ticket provider has been asked for, and what it hands back.
///
/// A class rather than a captured `var` because the provider closure is
/// `@Sendable` and Swift 6 is right to refuse a mutable capture across that
/// line; `@MainActor` because the client — and therefore every call of the
/// provider — is main-actor isolated.
@MainActor
final class TicketMints {
  var calls = 0
  /// While false, every ticket handed out is one the client will refuse before
  /// it spends a socket.
  var handOutLive = false
}
