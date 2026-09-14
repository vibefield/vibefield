import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

@Suite struct TaggedMessageTests {
  /// Every JSON text message is `{ type, ...body }`, and the tag is STRIPPED
  /// before the body is read — so a tolerant body can never smuggle a second
  /// one past the leg check.
  @Test func theTagIsStrippedFromTheBody() throws {
    let text = try RoutedWire.encode(
      .sceneApplied, ["sessionId": .string("s-1"), "type": .string("SendInput")])
    let decoded = try RoutedWire.decode(text, allowed: [.sceneApplied])
    #expect(decoded.type == .sceneApplied)
    #expect(decoded.body["type"] == nil)
    #expect(decoded.body["sessionId"]?.stringValue == "s-1")
  }

  /// The leg sets ARE the contract. A tag outside the set this leg reads is a
  /// protocol error, not a shrug — which is precisely why the cell must not
  /// speak `SessionEvent` until the capability is negotiated.
  @Test func aTagOutsideTheLegsSetIsRefused() throws {
    let text = try RoutedWire.encode(.sessionEvent, ["event": .object(["kind": .string("resync")])])
    #expect(throws: RoutedWire.DecodeFailure.notAllowedHere(.sessionEvent)) {
      try RoutedWire.decode(text, allowed: RoutedLegVocabulary.inbound(.frames))
    }
    // …and IS read on the control leg, which is where the cell sends it.
    let onControl = try RoutedWire.decode(text, allowed: RoutedLegVocabulary.inbound(.control))
    #expect(onControl.type == .sessionEvent)
  }

  @Test func anUnknownTagIsNamedRatherThanGuessedAt() throws {
    #expect(throws: RoutedWire.DecodeFailure.unknownType("SomeFutureVerb")) {
      try RoutedWire.decode(
        "{\"type\":\"SomeFutureVerb\"}", allowed: RoutedLegVocabulary.inbound(.control))
    }
    #expect(throws: RoutedWire.DecodeFailure.missingType) {
      try RoutedWire.decode("{\"body\":1}", allowed: RoutedLegVocabulary.inbound(.control))
    }
    #expect(throws: RoutedWire.DecodeFailure.notAnObject) {
      try RoutedWire.decode("[1,2]", allowed: RoutedLegVocabulary.inbound(.control))
    }
  }

  /// The four directions, as the contracts spell them. Written out rather than
  /// derived, because a set that derived itself from the code it guards would
  /// agree with any mistake the code made.
  @Test func theLegSetsMatchTheContract() {
    #expect(
      RoutedLegVocabulary.outbound(.control) == [
        .connectionHello, .legHeartbeat, .attachControlLeg, .declareDemand, .claimGeometry,
        .releaseGeometry, .transferGeometry, .sendInput,
      ])
    #expect(
      RoutedLegVocabulary.outbound(.frames) == [
        .connectionHello, .legHeartbeat, .attachFramesLeg, .transportCredit, .sceneApplied,
        .calibrationPing,
      ])
    #expect(
      RoutedLegVocabulary.inbound(.control) == [
        .connectionAccepted, .connectionRefused, .legHeartbeatAck, .controlLegAttached,
        .attachRefused, .demandAccepted, .cellActivationStatus, .geometryCommitted,
        .geometryRefused, .sessionEvent,
      ])
    #expect(
      RoutedLegVocabulary.inbound(.frames) == [
        .connectionAccepted, .connectionRefused, .legHeartbeatAck, .framesLegAttached,
        .attachRefused,
      ])
    // No tag is both sent and read on one leg — the two sets are disjoint per
    // leg, which is what makes "a tag outside the set" a decidable question.
    for channel in RoutedChannel.allCases {
      let both = RoutedLegVocabulary.inbound(channel).intersection(
        RoutedLegVocabulary.outbound(channel))
      #expect(both.isEmpty, "\(channel.rawValue)")
    }
  }
}

@Suite struct AcceptedReaderTests {
  /// `tp-connection-accepted.frames.json`'s own shape, read by the shipping
  /// reader. The numbers here are the CELL's and travel on the wire; nothing in
  /// this client hardcodes them.
  @Test func theAcceptCarriesTheCellsLimitsAndWindows() throws {
    let accepted = try RoutedConnectionAccepted(
      json: .object([
        "selectedProtocolVersion": .object(["major": .int(1), "minor": .int(0)]),
        "connectionSetId": .string("cs-1"),
        "channel": .string("frames"),
        "legGeneration": .int(3),
        "heartbeatTtlMs": .int(6000),
        "creditEpoch": .int(3),
        "initialWindows": .object([
          "connectionCreditBytes": .int(4_194_304),
          "perActivationCreditBytes": .int(1_048_576),
          "stagingBytesPerSession": .int(16_777_216),
          "stagingBytesTotal": .int(33_554_432),
          "maxConcurrentActivations": .int(64),
          "maxConcurrentSeeds": .int(2),
        ]),
        "protocolLimits": .object([
          "maxPresentationChunkBytes": .int(262_144),
          "maxCreditReturnDelayMs": .int(16),
          "sceneAppliedRefreshMs": .int(1000),
        ]),
        "capabilities": .array([.string("resume")]),
        "aFieldThisBuildDoesNotRead": .bool(true),
      ]))
    #expect(accepted.channel == .frames)
    #expect(accepted.legGeneration == 3)
    #expect(accepted.creditEpoch == 3)
    #expect(accepted.initialWindows?.connectionCreditBytes == 4_194_304)
    #expect(accepted.limits.maxPresentationChunkBytes == 262_144)
    // A limit the cell omitted keeps this client's conservative floor rather
    // than becoming zero — a zero cap would refuse every frame.
    #expect(accepted.limits.maxCatchupBytes == RoutedProtocolLimits.floor.maxCatchupBytes)
    #expect(accepted.negotiated("resume"))
    #expect(!accepted.negotiated("session-events"))
    // The tolerant reader's other half: unknown, named, and not fatal.
    #expect(accepted.unknownFields == ["aFieldThisBuildDoesNotRead"])
  }

  /// The two-dimensional lease, read as VALUES. `stopped` and `suspended` carry
  /// the cell's own reason, and an unknown reason is a string this client keeps
  /// rather than a state it invents.
  @Test func theActivationStatusKeepsBothDimensionsAndTheirReasons() throws {
    let status = try RoutedActivationStatus(
      json: .object([
        "sessionId": .string("s-1"),
        "activationId": .string("a-1"),
        "cellStatusSequence": .int(7),
        "leaseTtlMs": .int(6000),
        "presentation": .object(["state": .string("presenting")]),
        "input": .object(["state": .string("suspended"), "reason": .string("lagging")]),
      ]))
    #expect(status.presentation == .presenting)
    #expect(status.input == .suspended(reason: "lagging"))

    let revoked = try RoutedActivationStatus(
      json: .object([
        "sessionId": .string("s-1"),
        "activationId": .string("a-1"),
        "cellStatusSequence": .int(8),
        "leaseTtlMs": .int(6000),
        "presentation": .object([
          "state": .string("revoked"), "reason": .string("some-future-reason"),
        ]),
        "input": .object(["state": .string("revoked"), "reason": .string("leg-dead")]),
      ]))
    #expect(revoked.presentation == .revoked(reason: "some-future-reason"))
  }

  /// A `resume-accepted` outcome without its stamps is not a resume — the
  /// contract's own refinement, enforced at the reader so nothing downstream
  /// has to wonder.
  @Test func aResumeOutcomeWithoutItsStampsIsRefused() throws {
    #expect(throws: (any Error).self) {
      try RoutedFramesLegAttached(
        json: .object([
          "sessionId": .string("s-1"),
          "activationId": .string("a-1"),
          "resumeToken": .string("rt-1"),
          "trfIdentity": .object([
            "sessionHandle": .string("77"), "viewHandle": .string("9"),
          ]),
          "outcome": .object(["kind": .string("resume-accepted")]),
        ]))
    }
  }
}

@Suite struct StampOrderingTests {
  /// Two stamps are comparable iff their lineage is equal; across lineages there
  /// is NO order, and a client that invented one would apply a delta from one
  /// cell boot onto a scene from another.
  @Test func stampsCompareOnlyWithinOneLineage() {
    let a = RoutedSceneStamp(cellBootId: "cb-1", modelGeneration: 0, sceneRevision: 10)
    let b = RoutedSceneStamp(cellBootId: "cb-1", modelGeneration: 0, sceneRevision: 11)
    let newerModel = RoutedSceneStamp(cellBootId: "cb-1", modelGeneration: 1, sceneRevision: 1)
    let otherCell = RoutedSceneStamp(cellBootId: "cb-2", modelGeneration: 0, sceneRevision: 10)
    #expect(RoutedSceneStamp.compare(a, b) == -1)
    #expect(RoutedSceneStamp.compare(b, a) == 1)
    #expect(RoutedSceneStamp.compare(a, a) == 0)
    #expect(RoutedSceneStamp.compare(a, newerModel) == nil)
    #expect(RoutedSceneStamp.compare(a, otherCell) == nil)
  }
}

@Suite struct TicketReaderTests {
  /// The tailnet shape TM-2 mints. The reader takes a tailnet authority AND
  /// loopback — a simulator dialing a door on this machine is the same client —
  /// and refuses the one thing that is not topology.
  @Test func bothAuthoritiesAreAcceptedAndSecretsInUrlsAreNot() throws {
    let tailnet = try RoutedCellEndpoints(
      json: .object([
        "controlUrl": .string("wss://desk.tail1234.ts.net:8443/cell/cb-7/control"),
        "framesUrl": .string("wss://desk.tail1234.ts.net:8443/cell/cb-7/frames"),
      ]))
    #expect(tailnet.url(for: .control).path == "/cell/cb-7/control")
    #expect(tailnet.url(for: .frames).path == "/cell/cb-7/frames")

    _ = try RoutedCellEndpoints(
      json: .object([
        "controlUrl": .string("ws://127.0.0.1:51234/control"),
        "framesUrl": .string("ws://127.0.0.1:51234/frames"),
      ]))

    // Tokens NEVER ride URLs: authority is the grant in the first frame, and a
    // URL carrying a query is refused here rather than dialed and logged.
    #expect(throws: (any Error).self) {
      try RoutedCellEndpoints(
        json: .object([
          "controlUrl": .string("wss://desk.ts.net/cell/cb-7/control?token=hunter2"),
          "framesUrl": .string("wss://desk.ts.net/cell/cb-7/frames"),
        ]))
    }
    #expect(throws: (any Error).self) {
      try RoutedCellEndpoints(
        json: .object([
          "controlUrl": .string("https://desk.ts.net/cell/cb-7/control"),
          "framesUrl": .string("wss://desk.ts.net/cell/cb-7/frames"),
        ]))
    }
  }

  /// A ticket whose halves disagree is a fieldd bug, and dialing it would spend
  /// a socket to be told so by a silence that carries no reason.
  @Test func aTicketWhoseGrantsNameAnotherCellIsRefused() throws {
    let vector = try Vector.json("tp-grant-mac.vector")
    func grant(_ which: String, cellBootId: String? = nil) throws -> JSONValue {
      var claims = vector[which]?["claims"]?.objectValue ?? [:]
      if let cellBootId { claims["audienceCellBootId"] = .string(cellBootId) }
      return .object([
        "protected": vector[which]?["protected"] ?? .null,
        "claims": .object(claims),
        "mac": vector[which]?["mac"] ?? .null,
      ])
    }
    let endpoints = JSONValue.object([
      "controlUrl": .string("wss://desk.ts.net:8443/cell/cb-7f3a9c1e-2026/control"),
      "framesUrl": .string("wss://desk.ts.net:8443/cell/cb-7f3a9c1e-2026/frames"),
    ])
    let route = JSONValue.object([
      "cellBootId": .string("cb-7f3a9c1e-2026"), "routeRevision": .int(12), "leaseEpoch": .int(4),
    ])

    let ticket = try RoutedTerminalTicket(
      json: .object([
        "route": route, "endpoints": endpoints,
        "transportGrant": try grant("transport"), "attachGrant": try grant("attach"),
      ]))
    #expect(ticket.sessionId == "sess-01J8Z3K9")
    #expect(ticket.leaseEpoch == 4)
    #expect(ticket.rights.contains(.input))

    #expect(throws: (any Error).self) {
      try RoutedTerminalTicket(
        json: .object([
          "route": route, "endpoints": endpoints,
          "transportGrant": try grant("transport", cellBootId: "cb-somewhere-else"),
          "attachGrant": try grant("attach"),
        ]))
    }
    // The two grants are not interchangeable: `protected.typ` is domain
    // separation, and a transport grant presented as an attach grant is refused
    // before anything else happens.
    #expect(throws: (any Error).self) {
      try RoutedTerminalTicket(
        json: .object([
          "route": route, "endpoints": endpoints,
          "transportGrant": try grant("attach"), "attachGrant": try grant("attach"),
        ]))
    }
  }
}
