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
        .geometryRefused, .sessionEvent, .geometryState,
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

// MARK: - The readers, against the contracts' own bytes

/// EL9's third side, applied to the READERS (TM-r3, 2026-09-14).
///
/// Until this suite every row below decoded a literal typed into this file. A
/// hand-typed body tests the reader against the test author's memory of the
/// contract, while the contracts' goldens — the same files the TypeScript suite
/// and the Rust cell's fixture tests parse — sat beside it unread. The
/// difference is not theoretical: a literal cannot notice a field the schema
/// added, and it cannot notice one the schema RENAMED, because it was written
/// from the same memory that would have missed the rename.
///
/// So every row here decodes the FILE. A literal survives in exactly one place
/// — a VARIANT no golden carries — and each of those says which variant and
/// why, built by MUTATING the golden rather than typed from scratch, so even
/// the refusals start from the contract's own bytes. `check:ios-fixtures` then
/// gates every copy by basename, so a golden that moves upstream reds here.
@Suite struct AcceptedReaderTests {
  /// `tp-connection-accepted.frames.json`, read by the shipping reader. The
  /// numbers are the CELL's and travel on the wire; nothing in this client
  /// hardcodes them.
  @Test func theAcceptCarriesTheCellsLimitsAndWindows() throws {
    let accepted = try RoutedConnectionAccepted(
      json: try Vector.json("tp-connection-accepted.frames"))
    #expect(accepted.protocolMajor == 1)
    #expect(accepted.protocolMinor == 0)
    #expect(accepted.connectionSetId == "cs-win-3c4d-2-cb-7f3a9c1e")
    #expect(accepted.channel == .frames)
    #expect(accepted.legGeneration == 1)
    #expect(accepted.heartbeatTtlMs == 6000)
    #expect(accepted.creditEpoch == 1)
    #expect(accepted.initialWindows?.connectionCreditBytes == 4_194_304)
    #expect(accepted.initialWindows?.perActivationCreditBytes == 1_048_576)
    #expect(accepted.initialWindows?.stagingBytesPerSession == 16_777_216)
    #expect(accepted.initialWindows?.stagingBytesTotal == 33_554_432)
    #expect(accepted.initialWindows?.maxConcurrentActivations == 64)
    #expect(accepted.initialWindows?.maxConcurrentSeeds == 2)
    // Every limit the golden carries that this client reads. The other seven it
    // spells describe the CELL's own admission and this client consumes none of
    // them — a fact about the reader rather than a gap in the fixture, and the
    // reason `unknownFields` below is empty rather than seven long.
    #expect(accepted.limits.maxControlMessageBytes == 65_536)
    #expect(accepted.limits.maxPresentationChunkBytes == 262_144)
    #expect(accepted.limits.maxCreditReturnDelayMs == 16)
    #expect(accepted.limits.sceneAppliedRefreshMs == 1000)
    #expect(accepted.limits.activationAttachDeadlineMs == 5000)
    #expect(accepted.limits.maxCatchupBytes == 16_777_216)
    #expect(accepted.limits.creditAccountDrainTtlMs == 10_000)
    #expect(accepted.negotiated("resume"))
    #expect(!accepted.negotiated("session-events"))
    #expect(accepted.unknownFields.isEmpty)
  }

  /// The tolerant reader's two halves, on the golden's own bytes: a limit the
  /// cell OMITS keeps this client's conservative floor (a zero cap would refuse
  /// every frame), and a field this build does not know is named rather than
  /// fatal. Mutations, because a contracts fixture is what a CONFORMING cell
  /// sends and neither variant is that.
  @Test func anOmittedLimitKeepsTheFloorAndAnUnknownFieldIsNamed() throws {
    var body = try #require(try Vector.json("tp-connection-accepted.frames").objectValue)
    var limits = try #require(body["protocolLimits"]?.objectValue)
    limits["maxCatchupBytes"] = nil
    body["protocolLimits"] = .object(limits)
    body["aFieldThisBuildDoesNotRead"] = .bool(true)
    let accepted = try RoutedConnectionAccepted(json: .object(body))
    #expect(accepted.limits.maxCatchupBytes == RoutedProtocolLimits.floor.maxCatchupBytes)
    #expect(accepted.unknownFields == ["aFieldThisBuildDoesNotRead"])
  }

  /// `tp-connection-refused.valid.json` — the POST-verification refusal. Every
  /// PRE-authentication failure is a silent `1008` instead, which is why this
  /// type can never explain one.
  @Test func aRefusalCarriesItsCodeAndWhetherAFreshMintCouldHelp() throws {
    let refused = try RoutedConnectionRefused(json: try Vector.json("tp-connection-refused.valid"))
    #expect(refused.code == "SET_CHANNEL_BUSY")
    #expect(refused.retryable)
  }
}

@Suite struct AttachReaderTests {
  /// `tp-control-leg-attached.valid.json`. The rights are the CELL's answer —
  /// a downgrade applies the moment it lands — so they are read as values, and
  /// `geometryAdmin` (never minted in v1) is absent rather than defaulted.
  @Test func theControlAttachCarriesTheRightsTheCellAccepted() throws {
    let attached = try RoutedControlLegAttached(
      json: try Vector.json("tp-control-leg-attached.valid"))
    #expect(attached.sessionId == "sess-01J8Z3K9")
    #expect(attached.activationId == "act-01")
    #expect(attached.grantGenerationAccepted == 1)
    #expect(attached.rights == [.geometry, .input, .read])
  }

  /// `tp-attach-refused.grant-invalid.json`. A grant code is TERMINAL for that
  /// grant — `retryable: false` is the cell saying so — and the client answers
  /// it with a fresh mint rather than a retry.
  @Test func anAttachRefusalNamesItsActivationAndItsCode() throws {
    let refused = try RoutedAttachRefused(json: try Vector.json("tp-attach-refused.grant-invalid"))
    #expect(refused.activationId == "act-01J8Z3K9-1")
    #expect(refused.code == "GRANT_INVALID")
    #expect(!refused.retryable)
  }

  /// `tp-frames-leg-attached.seed.json` — the seed arm, and the u64 TRF1
  /// handles the contract carries as DECIMAL STRINGS. The golden's
  /// `18446744073709551615` is `u64::MAX`, which is the whole reason the wire
  /// spells them as strings and this reader keeps them as strings.
  @Test func theFramesAttachSeedArmKeepsTheHandlesAsTheWireSpellsThem() throws {
    let attached = try RoutedFramesLegAttached(json: try Vector.json("tp-frames-leg-attached.seed"))
    #expect(attached.sessionId == "sess-01J8Z3K9")
    #expect(attached.activationId == "act-01")
    #expect(attached.resumeToken == "rt-9f1c")
    #expect(attached.trfIdentity.sessionHandle == "18446744073709551615")
    #expect(attached.trfIdentity.viewHandle == "7")
    #expect(attached.outcome == .seedRequired(reason: "no-cursor"))
  }

  /// `tp-frames-leg-attached.resume.json` — the other arm, with both stamps.
  /// `newestAvailable` ahead of `from` is the cell saying there is catch-up to
  /// come, and the two are only comparable because their lineage is equal.
  @Test func theFramesAttachResumeArmCarriesBothStamps() throws {
    let attached = try RoutedFramesLegAttached(
      json: try Vector.json("tp-frames-leg-attached.resume"))
    #expect(attached.activationId == "act-02")
    guard case .resumeAccepted(let from, let newest) = attached.outcome else {
      Issue.record("the golden's outcome is resume-accepted")
      return
    }
    #expect(from.cellBootId == "cb-7f3a9c1e-2026")
    #expect(from.modelGeneration == 0)
    #expect(from.sceneRevision == 4410)
    #expect(newest.sceneRevision == 4417)
    #expect(RoutedSceneStamp.compare(from, newest) == -1)
  }

  /// A `resume-accepted` outcome without its stamps is not a resume — the
  /// contract's own refinement, enforced at the reader so nothing downstream
  /// has to wonder. A MUTATION of the golden: no fixture carries a malformed
  /// outcome, because the fixtures are what a conforming cell sends.
  @Test func aResumeOutcomeWithoutItsStampsIsRefused() throws {
    var body = try #require(try Vector.json("tp-frames-leg-attached.resume").objectValue)
    body["outcome"] = .object(["kind": .string("resume-accepted")])
    #expect(throws: (any Error).self) {
      try RoutedFramesLegAttached(json: .object(body))
    }
  }
}

@Suite struct ActivationStatusReaderTests {
  /// `tp-cell-activation-status.presenting-allowed.json` — the healthy pair,
  /// and the `acceptedContent` stamp `PresentationReady` compares against.
  @Test func thePresentingAllowedStatusReadsBothDimensions() throws {
    let status = try RoutedActivationStatus(
      json: try Vector.json("tp-cell-activation-status.presenting-allowed"))
    #expect(status.sessionId == "sess-01J8Z3K9")
    #expect(status.activationId == "act-01")
    #expect(status.cellStatusSequence == 7)
    #expect(status.leaseTtlMs == 3000)
    #expect(status.acceptedContent?.sceneRevision == 4417)
    #expect(status.acceptedContent?.cellBootId == "cb-7f3a9c1e-2026")
    #expect(status.presentation == .presenting)
    #expect(status.input == .allowed)
  }

  /// `tp-cell-activation-status.lagging.json` — the two dimensions DISAGREEING,
  /// which is the reason this is not a boolean: presentation continues while
  /// input is suspended, and the lag decision is the cell's alone.
  @Test func laggingSuspendsInputWhilePresentationContinues() throws {
    let status = try RoutedActivationStatus(
      json: try Vector.json("tp-cell-activation-status.lagging"))
    #expect(status.cellStatusSequence == 8)
    #expect(status.presentation == .presenting)
    #expect(status.input == .suspended(reason: "lagging"))
  }

  /// `tp-cell-activation-status.revoked.json` — both dimensions gone, with the
  /// cell's own reason, and NO `acceptedContent`: there is no accepted scene on
  /// a revoked activation, and a reader that invented one would report progress
  /// against a lease that no longer exists.
  @Test func revokedCarriesTheCellsReasonAndNoAcceptedContent() throws {
    let status = try RoutedActivationStatus(
      json: try Vector.json("tp-cell-activation-status.revoked"))
    #expect(status.cellStatusSequence == 9)
    #expect(status.presentation == .revoked(reason: "stale-route"))
    #expect(status.input == .revoked(reason: "stale-route"))
    #expect(status.acceptedContent == nil)
  }

  /// A reason word this build has not learned is KEPT, not replaced by a state
  /// this client invented. A mutation of the golden, because a fixture carries
  /// the vocabulary of the day it was written and this rule is about the next
  /// word the cell learns.
  @Test func anUnknownReasonIsKeptRatherThanReplaced() throws {
    var body = try #require(try Vector.json("tp-cell-activation-status.revoked").objectValue)
    body["presentation"] = .object([
      "state": .string("revoked"), "reason": .string("some-future-reason"),
    ])
    let status = try RoutedActivationStatus(json: .object(body))
    #expect(status.presentation == .revoked(reason: "some-future-reason"))
  }

  /// A STATE word this build has not learned is the opposite case and refused:
  /// a lease dimension is a closed set the cell and the client must agree on,
  /// and a reader that shrugged at an unknown one would be guessing at whether
  /// a person may type.
  @Test func anUnknownStateIsRefusedRatherThanGuessedAt() throws {
    var body = try #require(
      try Vector.json("tp-cell-activation-status.presenting-allowed").objectValue)
    body["input"] = .object(["state": .string("perhaps")])
    #expect(throws: (any Error).self) { try RoutedActivationStatus(json: .object(body)) }
  }
}

@Suite struct SessionEventReaderTests {
  /// `tp-session-event.exited.json` — a signalled exit the user asked for. Its
  /// `exitCode` is null and its `exitSignal` is not, which is the pair a reader
  /// that treated them as one field would flatten.
  @Test func aSignalledExitKeepsItsSignalAndItsOutcome() throws {
    let event = try RoutedSessionEvent(json: try Vector.json("tp-session-event.exited"))
    #expect(
      event
        == .exited(
          sessionId: "sess-tp-fixture-1", exitCode: nil, exitSignal: "SIGHUP",
          requestedTermination: "user", exitOutcome: "user-terminated"))
  }

  /// `tp-session-event.completed.json` — the other half of the same shape: an
  /// exit CODE of 0 and no signal. Zero is a value, and a reader that read a
  /// falsy code as absent would call every clean exit unknown.
  @Test func aCleanExitKeepsAZeroCodeRatherThanLosingIt() throws {
    let event = try RoutedSessionEvent(json: try Vector.json("tp-session-event.completed"))
    #expect(
      event
        == .exited(
          sessionId: "sess-tp-fixture-2", exitCode: 0, exitSignal: nil, requestedTermination: nil,
          exitOutcome: "completed"))
  }

  /// `tp-session-event.removed.json` and `tp-session-event.resync.json` — the
  /// two events that carry no exit at all. `resync` is the cell's honest "my
  /// deltas dropped", and it names no session because it is about all of them.
  @Test func removedAndResyncCarryWhatTheyCarryAndNothingElse() throws {
    #expect(
      try RoutedSessionEvent(json: try Vector.json("tp-session-event.removed"))
        == .removed(sessionId: "sess-tp-fixture-1"))
    #expect(try RoutedSessionEvent(json: try Vector.json("tp-session-event.resync")) == .resync)
  }

  /// An unknown kind is drop-and-log at the receiver — a tolerant reader, never
  /// a leg close, because future variants are additive behind one capability.
  /// A mutation of the golden for the usual reason: the fixture is today's
  /// vocabulary and this rule is about tomorrow's.
  @Test func anUnknownKindIsNamedRatherThanFatal() throws {
    var body = try #require(try Vector.json("tp-session-event.resync").objectValue)
    body["event"] = .object(["kind": .string("someFutureKind")])
    #expect(try RoutedSessionEvent(json: .object(body)) == .unknown(kind: "someFutureKind"))
  }
}

@Suite struct GeometryReaderTests {
  /// `tp-geometry-committed.valid.json`. The cell mints the holder GENERATION —
  /// a claimant can only name itself — and the revision is what the next claim
  /// must expect, which is the CAS the contract asks for.
  @Test func theCommitCarriesTheHolderTheCellMinted() throws {
    let committed = try RoutedGeometryCommitted(
      json: try Vector.json("tp-geometry-committed.valid"))
    #expect(committed.clientId == "win-3c4d-incarnation-2")
    #expect(committed.viewId == "view-b2")
    #expect(committed.holderGeneration == 6)
    #expect(committed.geometryRevision == 6)
    #expect(committed.cols == 160)
    #expect(committed.rows == 48)
  }

  /// `tp-tagged-message.geometry-refused.json` — the ONLY golden this shape
  /// has, and it is a TAGGED one, so this row runs the whole inbound path: the
  /// control leg's vocabulary admits the tag, `decode` strips it, and the
  /// reader takes what is left. FOCUS NEVER IMPLIES A CLAIM, so `SEAT_HELD` is
  /// an ordinary answer rather than an error.
  @Test func theRefusalArrivesTaggedAndNamesTheRevisionToRetryAt() throws {
    let bytes = try Vector.json("tp-tagged-message.geometry-refused").encoded()
    let text = try #require(String(data: bytes, encoding: .utf8))
    let tagged = try RoutedWire.decode(text, allowed: RoutedLegVocabulary.inbound(.control))
    #expect(tagged.type == .geometryRefused)
    let refused = try RoutedGeometryRefused(json: tagged.body)
    #expect(refused.code == "SEAT_HELD")
    #expect(refused.geometryRevision == 5)
  }
}

/// item 42 — the cell's announcement of a session's seat, read from the
/// contracts' own three goldens (`tp-geometry-state.held`, `.empty` and the
/// tagged one): the bytes the TypeScript suite parses and the cell's fixture
/// parity re-serializes are the bytes this reader is held to.
@Suite struct GeometryStateReaderTests {
  /// `tp-geometry-state.held.json` — the phone holding: the holder the cell
  /// minted, the face fieldd minted into its grant, the revision and the PTY's
  /// committed size.
  @Test func aHeldSeatCarriesItsHolderItsFaceAndTheCommittedSize() throws {
    let state = try RoutedGeometryState(json: try Vector.json("tp-geometry-state.held"))
    #expect(state.sessionId == "sess-01J8Z3K9")
    let holder = try #require(state.holder)
    #expect(holder.clientId == "tailnet:owner@github#node-phone~e1")
    #expect(holder.viewId == "view-p1")
    #expect(holder.holderGeneration == 7)
    #expect(
      holder.face == RoutedGeometryHolderFace(kind: "phone", name: "iPhone 16 Pro", os: "ios"))
    #expect(state.geometryRevision == 9)
    #expect(state.cols == 46)
    #expect(state.rows == 30)
  }

  /// `tp-geometry-state.empty.json` — `holder: null` is an EMPTY seat, and the
  /// size is still the one the phone left the PTY at: a release resizes nothing.
  @Test func anEmptySeatIsANullHolderAtTheSizeLeft() throws {
    let state = try RoutedGeometryState(json: try Vector.json("tp-geometry-state.empty"))
    #expect(state.sessionId == "sess-01J8Z3K9")
    #expect(state.holder == nil)
    #expect(state.geometryRevision == 10)
    #expect(state.cols == 46)
    #expect(state.rows == 30)
  }

  /// `tp-tagged-message.geometry-state.json` — the whole inbound path: the
  /// control leg's vocabulary admits the tag, `decode` strips it, and the reader
  /// takes the rest. Its face names no OS (the key omitted), and is a face all
  /// the same. The frames leg does not read the tag.
  @Test func theStateArrivesTaggedOnTheControlLegOnly() throws {
    let bytes = try Vector.json("tp-tagged-message.geometry-state").encoded()
    let text = try #require(String(data: bytes, encoding: .utf8))
    let tagged = try RoutedWire.decode(text, allowed: RoutedLegVocabulary.inbound(.control))
    #expect(tagged.type == .geometryState)
    let state = try RoutedGeometryState(json: tagged.body)
    #expect(state.sessionId == "s1")
    #expect(state.holder?.clientId == "client-02")
    #expect(state.holder?.viewId == "view-02")
    #expect(state.holder?.holderGeneration == 3)
    #expect(state.holder?.face == RoutedGeometryHolderFace(kind: "peer-window", name: "Studio"))
    #expect(state.geometryRevision == 6)
    #expect(state.cols == 100)
    #expect(state.rows == 28)
    #expect(throws: RoutedWire.DecodeFailure.notAllowedHere(.geometryState)) {
      try RoutedWire.decode(text, allowed: RoutedLegVocabulary.inbound(.frames))
    }
  }

  /// `holder` is nullable, never optional: a state that does not name its
  /// holder says nothing about the seat, and is refused rather than read as an
  /// empty one — while an explicit null IS the empty seat. Mutations of the
  /// golden, because a fixture is what a conforming cell sends.
  @Test func aStateWithoutItsHolderKeyIsRefusedNotReadAsEmpty() throws {
    var body = try #require(try Vector.json("tp-geometry-state.held").objectValue)
    body["holder"] = nil
    #expect(throws: WireDecodeError.self) { try RoutedGeometryState(json: .object(body)) }
    body["holder"] = .null
    let state = try RoutedGeometryState(json: .object(body))
    #expect(state.holder == nil)
    #expect(state.geometryRevision == 9)
  }

  /// The face's words are OPEN: a kind and an OS this build has not learned
  /// reach a face as the text the cell sent, and a field nobody reads is no
  /// error. A mutation, because the golden carries today's vocabulary and this
  /// rule is about the next word fieldd learns.
  @Test func anUnknownKindAndOsArriveAsText() throws {
    var body = try #require(try Vector.json("tp-geometry-state.held").objectValue)
    var holder = try #require(body["holder"]?.objectValue)
    holder["face"] = .object([
      "kind": .string("tablet"), "name": .string("James's iPad"), "os": .string("ipados"),
      "aFieldThisBuildDoesNotRead": .bool(true),
    ])
    body["holder"] = .object(holder)
    body["aFieldThisBuildDoesNotRead"] = .bool(true)
    let state = try RoutedGeometryState(json: .object(body))
    #expect(
      state.holder?.face
        == RoutedGeometryHolderFace(kind: "tablet", name: "James's iPad", os: "ipados"))
  }

  /// A face this build cannot read is no face, and NEVER the seat's loss: a
  /// nameless one (the contract refuses it) leaves the holder, the revision and
  /// the size standing, as a grant minted without a face does. A holder that
  /// will not read is another matter — it is the state's one load-bearing fact,
  /// and the whole state is refused.
  @Test func aFaceThatWillNotReadCostsTheFaceAndNotTheSeat() throws {
    var body = try #require(try Vector.json("tp-geometry-state.held").objectValue)
    var holder = try #require(body["holder"]?.objectValue)
    holder["face"] = .object(["kind": .string("phone"), "name": .string("")])
    body["holder"] = .object(holder)
    let state = try RoutedGeometryState(json: .object(body))
    #expect(state.holder?.clientId == "tailnet:owner@github#node-phone~e1")
    #expect(state.holder?.holderGeneration == 7)
    #expect(state.holder?.face == nil)
    #expect(state.geometryRevision == 9)
    #expect(state.cols == 46)

    holder["viewId"] = nil
    body["holder"] = .object(holder)
    #expect(throws: WireDecodeError.self) { try RoutedGeometryState(json: .object(body)) }
  }
}

@Suite struct EnvelopeHeaderReaderTests {
  /// `tp-envelope-header.trf1.json` — a delta's header, base and result both
  /// present. The pair is the whole of the lineage rule: a delta applies iff
  /// its base is the scene the sink holds.
  @Test func aDeltaHeaderCarriesItsBaseAndItsResult() throws {
    let header = try RoutedEnvelopeHeader(json: try Vector.json("tp-envelope-header.trf1"))
    #expect(header.creditEpoch == 1)
    #expect(header.activationSequence == 88)
    #expect(header.sessionId == "sess-01J8Z3K9")
    #expect(header.activationId == "act-01")
    #expect(header.leaseEpoch == 4)
    #expect(header.kind == .trf1Frame)
    #expect(header.baseContent?.sceneRevision == 4416)
    #expect(header.resultContent?.sceneRevision == 4417)
    #expect(header.transfer == nil)
  }

  /// `tp-envelope-header.seed-begin.json` — a seed's `baseContent` is EXPLICIT
  /// null, which reads as "no base" exactly like an absent field: the receiver
  /// may hold no compatible base, which is what makes it a seed.
  @Test func aSeedBeginDeclaresItsLayoutAndANullBase() throws {
    let header = try RoutedEnvelopeHeader(json: try Vector.json("tp-envelope-header.seed-begin"))
    #expect(header.kind == .transferBegin)
    #expect(header.baseContent == nil)
    #expect(header.resultContent?.sceneRevision == 4400)
    let transfer = try #require(header.transfer)
    #expect(transfer.transferId == "xfer-01")
    #expect(transfer.kind == .seed)
    #expect(transfer.totalBytes == 524_288)
    #expect(transfer.chunkCount == 2)
    #expect(transfer.checksum == 3_947_196_713)
    #expect(transfer.cols == 120)
    #expect(transfer.rows == 40)
    #expect(transfer.scrollbackRows == 10_000)
  }

  /// `tp-envelope-header.chunk.json` — a chunk names only its transfer, its
  /// index and where its bytes go. It carries NO stamps: the transfer's result
  /// was declared once at begin, and repeating it per chunk is the desync the
  /// contract removed a field to prevent.
  @Test func aChunkHeaderNamesOnlyItsPlaceInTheTransfer() throws {
    let header = try RoutedEnvelopeHeader(json: try Vector.json("tp-envelope-header.chunk"))
    #expect(header.kind == .transferChunk)
    #expect(header.resultContent == nil)
    #expect(header.baseContent == nil)
    let transfer = try #require(header.transfer)
    #expect(transfer.transferId == "xfer-01")
    #expect(transfer.chunkIndex == 0)
    #expect(transfer.byteOffset == 0)
    #expect(transfer.totalBytes == nil)
  }
}

/// The two shapes this client WRITES that a golden pins.
///
/// Neither has a reader in `RoutedWire.swift` — they travel client → cell — so
/// the evidence a golden can give runs the other way: the key set this client
/// puts on the wire is the key set the contract spells. That is a real gate (a
/// renamed field on the SEND path is invisible to every reader row above) and
/// it is the honest limit of what a fixture can prove about a writer — the
/// shape, never the cell's acceptance, which is Phase 0's hardware run.
///
/// The other outbound goldens (`tp-connection-hello.frames`, `tp-send-input.*`,
/// `tp-attach-control-leg.valid`, `tp-attach-frames-leg.resume`,
/// `tp-declare-demand.release`, `tp-claim-geometry.valid`,
/// `tp-transfer-geometry.valid`) are deliberately NOT copied: their bodies are
/// built inline in `RoutedTerminalClient` rather than by a nameable writer, so
/// pinning them means driving the client and reading the socket — which
/// `RoutedClientTests` already does, field by field. A copied file asserting
/// what that test already spells would be a second copy of one claim.
@Suite struct WriterShapeTests {
  /// `tp-transport-credit.valid.json` — the ledger's own return. Totals are
  /// CUMULATIVE within the epoch and the accounts are per activation, both of
  /// which the golden spells and this writer must keep.
  @Test func theCreditReturnIsTheShapeTheContractSpells() throws {
    let golden = try #require(try Vector.json("tp-transport-credit.valid").objectValue)
    var ledger = RoutedCreditLedger(creditEpoch: 1)
    ledger.charge(bytes: 917_504, activationId: "act-01", nowMs: 0)
    ledger.charge(bytes: 131_072, activationId: "act-00-draining", nowMs: 0)
    let written = try #require(ledger.makeReturn(nowMs: 0).objectValue)

    #expect(written.keys.sorted() == golden.keys.sorted())
    #expect(written["creditEpoch"] == golden["creditEpoch"])
    #expect(written["connectionBytesReturned"] == golden["connectionBytesReturned"])
    // The golden's own sequence is 41 — a connection that has returned credit
    // forty times already — and a fresh ledger's is 1. The FIELD is what a
    // fixture can pin; its value belongs to the run.
    #expect(written["creditSequence"]?.intValue == 1)
    let goldenAccounts = try #require(golden["accounts"]?.arrayValue)
    let writtenAccounts = try #require(written["accounts"]?.arrayValue)
    #expect(writtenAccounts.count == goldenAccounts.count)
    let goldenRowKeys = try #require(goldenAccounts.first?.objectValue?.keys.sorted())
    for row in writtenAccounts {
      #expect(row.objectValue?.keys.sorted() == goldenRowKeys)
    }
    let byId = Dictionary(
      uniqueKeysWithValues: writtenAccounts.compactMap { row -> (String, Int64)? in
        guard let id = row["activationId"]?.stringValue, let bytes = row["bytesReturned"]?.intValue
        else { return nil }
        return (id, bytes)
      })
    for row in goldenAccounts {
      let id = try #require(row["activationId"]?.stringValue)
      #expect(byId[id] == row["bytesReturned"]?.intValue, "\(id)")
    }
  }

  /// `tp-scene-applied.valid.json` — progress, in stamps. The NESTING is the
  /// part worth pinning: the lineage lives under `sceneEpoch` and the revision
  /// beside it, so a flattened stamp would be a scene the cell cannot order.
  @Test func theAppliedStampIsTheShapeTheContractSpells() throws {
    let golden = try #require(try Vector.json("tp-scene-applied.valid").objectValue)
    let stamp = RoutedSceneStamp(
      cellBootId: "cb-7f3a9c1e-2026", modelGeneration: 0, sceneRevision: 4417)
    // The body `reportApplied` builds, with the values the golden carries.
    let written: [String: JSONValue] = [
      "sessionId": .string("sess-01J8Z3K9"),
      "activationId": .string("act-01"),
      "leaseEpoch": .int(4),
      "appliedContent": stamp.json,
    ]
    #expect(written.keys.sorted() == golden.keys.sorted())
    #expect(JSONValue.object(written) == JSONValue.object(golden))
    // …and the stamp READS back as itself, which is what makes the writer and
    // the reader one claim rather than two that happen to agree today.
    #expect(try RoutedSceneStamp(json: try #require(golden["appliedContent"])) == stamp)
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
  /// `tp-remote-open-ticket.valid.json` — the shape the PHONE is given, and the
  /// only reader of it. The endpoints carry a tailnet authority and the attach
  /// grant carries `[input, read]` and no `geometry`: a tailnet self peer is
  /// ADDITIVE to the desktop's viewer — it types, but never resizes.
  @Test func theTailnetTicketReadsAsTheContractMintsIt() throws {
    let ticket = try RoutedTerminalTicket(json: try Vector.json("tp-remote-open-ticket.valid"))
    #expect(ticket.route.cellBootId == "cb-7f3a9c1e-2026")
    #expect(ticket.route.routeRevision == 12)
    #expect(ticket.route.leaseEpoch == 4)
    #expect(ticket.endpoints.url(for: .control).host == "studio-mbp.tail9f2c.ts.net")
    #expect(ticket.endpoints.url(for: .control).path == "/cell/cb-7f3a9c1e-2026/control")
    #expect(ticket.endpoints.url(for: .frames).path == "/cell/cb-7f3a9c1e-2026/frames")
    #expect(ticket.sessionId == "sess-01J8Z3K9")
    #expect(ticket.clientId == "tailnet:james@example.com")
    #expect(ticket.connectionSetId == "tailnet:james@example.com@cb-7f3a9c1e-2026")
    #expect(ticket.leaseEpoch == 4)
    #expect(ticket.rights == [.input, .read])
    #expect(!ticket.rights.contains(.geometry))
  }

  /// `tp-open-ticket.valid.json` — the LOOPBACK ticket a window receives. This
  /// reader takes it too, deliberately: a simulator dialing a door on this
  /// machine is the same client, and the AUTHORITY is the one thing this reader
  /// is tolerant about. That the two goldens differ in `endpoints`, `clientId`
  /// and `rights` and in nothing else is the shape being one shape.
  @Test func theLoopbackTicketReadsWithTheSameReader() throws {
    let ticket = try RoutedTerminalTicket(json: try Vector.json("tp-open-ticket.valid"))
    #expect(ticket.endpoints.url(for: .control).host == "127.0.0.1")
    #expect(ticket.endpoints.url(for: .control).port == 53111)
    #expect(ticket.endpoints.url(for: .frames).port == 53112)
    #expect(ticket.clientId == "win-3c4d-incarnation-2")
    #expect(ticket.rights == [.geometry, .input, .read])
    #expect(ticket.sessionId == "sess-01J8Z3K9")
  }

  /// Tokens NEVER ride URLs — authority is the grant in the first frame — and a
  /// URL carrying a query or a fragment is refused HERE rather than dialed and
  /// logged, because the failure mode it guards against is a secret in a log.
  /// Mutations of the golden: no contracts fixture carries a malformed URL.
  @Test func aSecretInAUrlIsRefusedRatherThanDialed() throws {
    let golden = try #require(try Vector.json("tp-remote-open-ticket.valid").objectValue)
    func withEndpoints(control: String, frames: String) -> JSONValue {
      var ticket = golden
      ticket["endpoints"] = .object([
        "controlUrl": .string(control), "framesUrl": .string(frames),
      ])
      return .object(ticket)
    }
    let base = "ws://studio-mbp.tail9f2c.ts.net:9422/cell/cb-7f3a9c1e-2026"
    #expect(throws: (any Error).self) {
      try RoutedTerminalTicket(
        json: withEndpoints(control: "\(base)/control?token=hunter2", frames: "\(base)/frames"))
    }
    #expect(throws: (any Error).self) {
      try RoutedTerminalTicket(
        json: withEndpoints(control: "\(base)/control#token", frames: "\(base)/frames"))
    }
    // …and the scheme is not topology either: a cell door is a WebSocket.
    #expect(throws: (any Error).self) {
      try RoutedTerminalTicket(
        json: withEndpoints(
          control: "https://studio-mbp.tail9f2c.ts.net:9422/cell/cb-7f3a9c1e-2026/control",
          frames: "\(base)/frames"))
    }
  }

  /// A ticket whose halves disagree is a fieldd bug, and dialing it would spend
  /// a socket to be told so by a silence that carries no reason. Two local
  /// agreements, each checked by MUTATING the golden — which is what makes the
  /// refusal about the RULE rather than about a body typed to fail.
  @Test func aTicketWhoseGrantsNameAnotherCellIsRefused() throws {
    let golden = try #require(try Vector.json("tp-remote-open-ticket.valid").objectValue)
    func grant(_ which: String, cellBootId: String? = nil) throws -> JSONValue {
      var row = try #require(golden[which]?.objectValue)
      guard let cellBootId else { return .object(row) }
      var claims = try #require(row["claims"]?.objectValue)
      claims["audienceCellBootId"] = .string(cellBootId)
      row["claims"] = .object(claims)
      return .object(row)
    }
    func ticket(transport: JSONValue, attach: JSONValue) -> JSONValue {
      var body = golden
      body["transportGrant"] = transport
      body["attachGrant"] = attach
      return .object(body)
    }

    // A grant naming a cell the route does not — either grant.
    #expect(throws: (any Error).self) {
      try RoutedTerminalTicket(
        json: ticket(
          transport: try grant("transportGrant", cellBootId: "cb-somewhere-else"),
          attach: try grant("attachGrant")))
    }
    #expect(throws: (any Error).self) {
      try RoutedTerminalTicket(
        json: ticket(
          transport: try grant("transportGrant"),
          attach: try grant("attachGrant", cellBootId: "cb-somewhere-else")))
    }
    // The two grants are not interchangeable: `protected.typ` is domain
    // separation, and one presented in the other's place is refused before
    // anything else happens — in both directions.
    #expect(throws: (any Error).self) {
      try RoutedTerminalTicket(
        json: ticket(transport: try grant("attachGrant"), attach: try grant("attachGrant")))
    }
    #expect(throws: (any Error).self) {
      try RoutedTerminalTicket(
        json: ticket(transport: try grant("transportGrant"), attach: try grant("transportGrant")))
    }
  }
}
