import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

/// One leg's lifecycle: the handshake, the heartbeat, and the four ways a leg
/// can end. Everything here is ORDER, which is why it is driven frame by frame
/// rather than against a socket.
@MainActor
@Suite(.serialized) struct LegTests {
  private func makeLeg(
    channel: RoutedChannel = .control, transport: ScriptedTransport,
    onAccepted: @escaping @MainActor (RoutedConnectionAccepted) -> Void = { _ in },
    onRefused: @escaping @MainActor (RoutedConnectionRefused) -> Void = { _ in },
    onFailed: @escaping @MainActor (RoutedLegFailure) -> Void = { _ in },
    onText: @escaping @MainActor (RoutedMessageType, JSONValue) -> Void = { _, _ in },
    onBinary: @escaping @MainActor (Data) -> Void = { _ in }
  ) -> RoutedLeg {
    var callbacks = RoutedLeg.Callbacks()
    callbacks.onAccepted = onAccepted
    callbacks.onRefused = onRefused
    callbacks.onFailed = onFailed
    callbacks.onText = onText
    callbacks.onBinary = onBinary
    return RoutedLeg(
      channel: channel, url: URL(string: "ws://127.0.0.1:9/\(channel.rawValue)")!,
      transport: transport, callbacks: callbacks)
  }

  private func hello(_ channel: RoutedChannel) -> JSONValue {
    .object([
      "protocolMajor": .int(1), "protocolMinor": .int(0), "channel": .string(channel.rawValue),
      "transportGrant": .object(["mac": .string("m")]),
      "capabilities": .array([.string("resume")]),
    ])
  }

  /// The door's own rule: the FIRST frame is the hello, and nothing else may be
  /// sent until an accept has been read. A client that queued an attach beside
  /// the hello would be refused before it was authenticated, and the refusal
  /// carries no reason.
  @Test func theHelloIsTheFirstFrameAndNothingPrecedesIt() async throws {
    let transport = ScriptedTransport()
    let connection = transport.connection(for: "/control")
    let leg = makeLeg(transport: transport)
    leg.open(hello: hello(.control))

    try await settle("the hello") { await connection.sentTags() == ["ConnectionHello"] }
    // A send before the accept is DROPPED by the leg, not queued and not sent.
    leg.send(.attachControlLeg, ["activationId": .string("a-1")])
    try await Task.sleep(for: .milliseconds(30))
    #expect(await connection.sentTags() == ["ConnectionHello"])
    leg.close()
  }

  /// After the accept, the leg heartbeats UNCONDITIONALLY at the cell's TTL over
  /// three — not only while idle.
  ///
  /// This is the cell's own rule and it is not obvious from the prose: the door
  /// re-arms its receipt deadline on a `LegHeartbeat` (or a `CalibrationPing`)
  /// and on NOTHING else — not credit, not `SceneApplied`, not input. A client
  /// that heartbeat only when idle would be closed `4004` in the middle of a
  /// busy session.
  @Test func theLegHeartbeatsUnconditionallyAtOneThirdOfTheTtl() async throws {
    let transport = ScriptedTransport()
    let connection = transport.connection(for: "/control")
    var accepted: RoutedConnectionAccepted?
    let leg = makeLeg(transport: transport, onAccepted: { accepted = $0 })
    leg.open(hello: hello(.control))
    try await settle("the hello") { await connection.sentTags().first == "ConnectionHello" }
    try await connection.deliver(
      .connectionAccepted, Script.accepted(channel: .control, heartbeatTtlMs: 150))
    try await settle("the accept") { accepted != nil }

    // Keep the leg BUSY: heartbeats must still flow.
    for _ in 0..<5 {
      leg.send(.sendInput, ["sessionId": .string("s-1")])
      try await Task.sleep(for: .milliseconds(20))
    }
    try await settle("two heartbeats") { await connection.allSent("LegHeartbeat").count >= 2 }

    let beats = await connection.allSent("LegHeartbeat")
    // The identity must match EXACTLY or the cell closes 4003: it compares the
    // set id, the channel and the leg generation against the leg it accepted.
    #expect(beats[0]["connectionSetId"]?.stringValue == "cs-test")
    #expect(beats[0]["channel"]?.stringValue == "control")
    #expect(beats[0]["legGeneration"]?.intValue == 1)
    #expect(beats[0]["sequence"]?.intValue == 1)
    #expect(beats[1]["sequence"]?.intValue == 2)
    leg.close()
  }

  /// A PRE-authentication close is `1008` with no body and no code, silent by
  /// policy — the reason is in the cell's audit line and nowhere the phone can
  /// reach. The leg reports the class, not a guess.
  @Test func aSilent1008BeforeTheAcceptIsThePreAuthClass() async throws {
    let transport = ScriptedTransport()
    let connection = transport.connection(for: "/control")
    var failure: RoutedLegFailure?
    let leg = makeLeg(transport: transport, onFailed: { failure = $0 })
    leg.open(hello: hello(.control))
    try await settle("the hello") { await connection.sentTags().first == "ConnectionHello" }
    await connection.hangUp(code: 1008)
    try await settle("the refusal") { failure != nil }
    #expect(failure == .preAuthenticationRefused)
  }

  /// The SAME code AFTER an accept is not the pre-auth class: by then the socket
  /// is authenticated, and a policy close means something else. Reporting the
  /// two as one would send the caller re-minting a grant that was fine.
  @Test func a1008AfterTheAcceptIsNotThePreAuthClass() async throws {
    let transport = ScriptedTransport()
    let connection = transport.connection(for: "/control")
    var failure: RoutedLegFailure?
    var accepted = false
    let leg = makeLeg(transport: transport, onAccepted: { _ in accepted = true }, onFailed: { failure = $0 })
    leg.open(hello: hello(.control))
    try await settle("the hello") { await connection.sentTags().first == "ConnectionHello" }
    try await connection.deliver(.connectionAccepted, Script.accepted(channel: .control))
    try await settle("the accept") { accepted }
    await connection.hangUp(code: 1008)
    try await settle("the close") { failure != nil }
    #expect(failure == .closed(code: 1008, reason: "POLICY"))
  }

  /// A socket that dies with NO close frame is a different fact from a policy
  /// close — a radio that wandered off the tailnet, not a decision — and the two
  /// are never reported as each other.
  @Test func aDropWithNoCodeIsNotAClose() async throws {
    let transport = ScriptedTransport()
    let connection = transport.connection(for: "/frames")
    var failure: RoutedLegFailure?
    let leg = makeLeg(channel: .frames, transport: transport, onFailed: { failure = $0 })
    leg.open(hello: hello(.frames))
    try await settle("the hello") { await connection.sentTags().first == "ConnectionHello" }
    await connection.hangUp(code: nil)
    try await settle("the drop") { failure != nil }
    if case .dropped = failure {} else { Issue.record("expected a drop, got \(String(describing: failure))") }
    #expect(failure?.isStaleRoute == false)
  }

  /// `4000 STALE_ROUTE` is the one close that tells the caller exactly what to
  /// do, so it is the one the leg names on its own.
  @Test func aStaleRouteCloseIsNamed() async throws {
    let transport = ScriptedTransport()
    let connection = transport.connection(for: "/control")
    var failure: RoutedLegFailure?
    let leg = makeLeg(transport: transport, onFailed: { failure = $0 })
    leg.open(hello: hello(.control))
    try await settle("the hello") { await connection.sentTags().first == "ConnectionHello" }
    await connection.hangUp(code: 4000)
    try await settle("the close") { failure != nil }
    #expect(failure == .closed(code: 4000, reason: "STALE_ROUTE"))
    #expect(failure?.isStaleRoute == true)
  }

  /// A structured refusal is POST-verification and carries the cell's own words.
  @Test func aStructuredRefusalCarriesTheCellsCode() async throws {
    let transport = ScriptedTransport()
    let connection = transport.connection(for: "/control")
    var refusal: RoutedConnectionRefused?
    let leg = makeLeg(transport: transport, onRefused: { refusal = $0 })
    leg.open(hello: hello(.control))
    try await settle("the hello") { await connection.sentTags().first == "ConnectionHello" }
    try await connection.deliver(
      .connectionRefused,
      ["code": .string("GRANT_NONCE_REPLAYED"), "retryable": .bool(false)])
    try await settle("the refusal") { refusal != nil }
    #expect(refusal?.code == "GRANT_NONCE_REPLAYED")
    #expect(refusal?.retryable == false)
  }

  /// A tag outside the leg's inbound set is a protocol error the CLIENT names —
  /// which is exactly the rule that makes the `session-events` capability
  /// load-bearing rather than advisory.
  @Test func aTagThatDoesNotBelongOnThisLegEndsIt() async throws {
    let transport = ScriptedTransport()
    let connection = transport.connection(for: "/frames")
    var failure: RoutedLegFailure?
    var accepted = false
    let leg = makeLeg(
      channel: .frames, transport: transport, onAccepted: { _ in accepted = true },
      onFailed: { failure = $0 })
    leg.open(hello: hello(.frames))
    try await settle("the hello") { await connection.sentTags().first == "ConnectionHello" }
    try await connection.deliver(.connectionAccepted, Script.accepted(channel: .frames))
    try await settle("the accept") { accepted }
    // `SessionEvent` is a CONTROL-leg verb. On the frames leg it is a violation.
    try await connection.deliver(.sessionEvent, ["event": .object(["kind": .string("resync")])])
    try await settle("the violation") { failure != nil }
    if case .protocolViolation = failure {} else {
      Issue.record("expected a protocol violation, got \(String(describing: failure))")
    }
  }

  /// Binary is the frames leg's alone, and only after the accept. Before it, the
  /// first frame must be a hello; on the control leg there is no such thing as a
  /// presentation unit.
  @Test func binaryIsRefusedBeforeTheAcceptAndOnTheControlLeg() async throws {
    let transport = ScriptedTransport()
    let early = transport.connection(for: "/frames")
    var earlyFailure: RoutedLegFailure?
    let framesLeg = makeLeg(channel: .frames, transport: transport, onFailed: { earlyFailure = $0 })
    framesLeg.open(hello: hello(.frames))
    try await settle("the hello") { await early.sentTags().first == "ConnectionHello" }
    await early.deliver(.binary(Data([0x54, 0x50, 1, 0, 0, 0, 0, 0])))
    try await settle("the early binary") { earlyFailure != nil }
    if case .protocolViolation = earlyFailure {} else {
      Issue.record("expected a protocol violation, got \(String(describing: earlyFailure))")
    }

    let control = transport.connection(for: "/control")
    var controlFailure: RoutedLegFailure?
    var accepted = false
    let controlLeg = makeLeg(
      transport: transport, onAccepted: { _ in accepted = true }, onFailed: { controlFailure = $0 })
    controlLeg.open(hello: hello(.control))
    try await settle("the hello") { await control.sentTags().first == "ConnectionHello" }
    try await control.deliver(.connectionAccepted, Script.accepted(channel: .control))
    try await settle("the accept") { accepted }
    await control.deliver(.binary(Data([0x54, 0x50, 1, 0, 0, 0, 0, 0])))
    try await settle("the control binary") { controlFailure != nil }
    if case .protocolViolation = controlFailure {} else {
      Issue.record("expected a protocol violation, got \(String(describing: controlFailure))")
    }
  }

  /// An accept for the OTHER channel, or for a protocol major this client did
  /// not offer, is the cell contradicting its own rule — it selects within the
  /// client's major or refuses `VERSION_UNSUPPORTED`.
  @Test func anAcceptThatContradictsTheHelloIsRefused() async throws {
    let transport = ScriptedTransport()
    let connection = transport.connection(for: "/control")
    var failure: RoutedLegFailure?
    let leg = makeLeg(transport: transport, onFailed: { failure = $0 })
    leg.open(hello: hello(.control))
    try await settle("the hello") { await connection.sentTags().first == "ConnectionHello" }
    try await connection.deliver(.connectionAccepted, Script.accepted(channel: .frames))
    try await settle("the contradiction") { failure != nil }
    if case .protocolViolation = failure {} else {
      Issue.record("expected a protocol violation, got \(String(describing: failure))")
    }

    let second = transport.rotate("/control")
    var majorFailure: RoutedLegFailure?
    let secondLeg = makeLeg(transport: transport, onFailed: { majorFailure = $0 })
    secondLeg.open(hello: hello(.control))
    try await settle("the hello") { await second.sentTags().first == "ConnectionHello" }
    var body = Script.accepted(channel: .control)
    body["selectedProtocolVersion"] = .object(["major": .int(2), "minor": .int(0)])
    try await second.deliver(.connectionAccepted, body)
    try await settle("the version") { majorFailure != nil }
    if case .protocolViolation = majorFailure {} else {
      Issue.record("expected a protocol violation, got \(String(describing: majorFailure))")
    }
  }

  /// The leg never sends a tag the contract does not put on its leg — checked in
  /// the leg rather than trusted of every caller, because the cost of being
  /// wrong is a `4003` that takes the whole connection set with it.
  @Test func theLegRefusesToSendATagThatIsNotItsOwn() async throws {
    let transport = ScriptedTransport()
    let connection = transport.connection(for: "/control")
    var failure: RoutedLegFailure?
    var accepted = false
    let leg = makeLeg(
      transport: transport, onAccepted: { _ in accepted = true }, onFailed: { failure = $0 })
    leg.open(hello: hello(.control))
    try await settle("the hello") { await connection.sentTags().first == "ConnectionHello" }
    try await connection.deliver(.connectionAccepted, Script.accepted(channel: .control))
    try await settle("the accept") { accepted }
    // `TransportCredit` rides the FRAMES leg.
    leg.send(.transportCredit, ["creditEpoch": .int(1)])
    try await settle("the refusal") { failure != nil }
    #expect(await connection.allSent("TransportCredit").isEmpty)
  }
}
