import Foundation
import Testing

@testable import FieldProduct

// EL9 on the third side. `hello-ack.*`, `device-*` and `agent-list.valid.json`
// under `Fixtures/` are COPIES of `packages/contracts/fixtures/`, byte for
// byte — the same goldens the TypeScript tests parse, so a wire change upstream
// is a red here rather than a runtime surprise on a phone.
//
// The field trio — `agent-field-snapshot.valid.json`,
// `agent-field-delta.valid.json`, `agent-field-slice.valid.json` — and the two
// door answers beside them are likewise copies, taken from `mf/fd1` at MF-1a
// (`2f331dbb`, `packages/contracts/fixtures/`). They were hand-authored from
// §10.1 for one commit while the contracts lane was still landing; these are
// the real goldens and the hand-authored ones are gone.
//
// A note for whoever refreshes them next: the SHA relayed to this lane was
// `8d23d257`, which is an ORPHAN — same subject, same fixture bytes, but not an
// ancestor of `mf/fd1` and on no branch, so it was rewritten before it landed.
// `2f331dbb` is the one that is actually reachable. Verified by diffing the
// three files between the two commits: identical.

@Suite struct HelloAckTests {
  @Test func theGoldenAckReadsAsItself() throws {
    let ack = try HelloAck(json: try Fixture.json("hello-ack.valid"))
    #expect(ack.contractsVersion == "0.1.0")
    #expect(ack.serverKind == "fieldd")
    #expect(
      ack.grantedScopes == ["canvas.read", "canvas.write", "terminal.attach", "agent.spawn"])
    #expect(ack.nativeBuild == nil)
    #expect(ack.unknownFields.isEmpty)
  }

  /// The mgmt-surface ack carries `terminal` endpoints this target never reads.
  /// The tolerant reader's whole job: it parses, and the unread key is NAMED.
  @Test func anAckWithFieldsWeDoNotReadStillParsesAndSaysWhich() throws {
    let ack = try HelloAck(json: try Fixture.json("hello-ack.terminal"))
    #expect(ack.serverKind == "field-native")
    #expect(ack.grantedScopes.isEmpty)
    #expect(ack.nativeBuild == "field-native/0.1.0+dev-4f3a91c07b2e5d68a1c40b93")
    #expect(ack.unknownFields == ["terminal"])
  }

  @Test func anAckMissingItsRequiredFieldsIsUnreadableRatherThanEmpty() {
    #expect(throws: WireDecodeError.self) {
      try HelloAck(json: .object(["serverKind": .string("fieldd")]))
    }
  }
}

@Suite struct DeviceShapeTests {
  @Test func theGoldenRosterRowReads() throws {
    let device = try DeviceInfo(json: try Fixture.json("device-info.valid"))
    #expect(device.deviceId == "nodeid-8f2a1c9b7e")
    #expect(device.name == "James MacBook Pro")
    #expect(device.platform == "darwin")
    #expect(device.online == true)
    #expect(device.isSelf == true)
    #expect(device.lastSeenAt == 1_753_142_400_000)
    // This golden is not serving, so there is no door — and no door is a fact,
    // not a missing field to paper over.
    #expect(device.productEndpoint == nil)
    #expect(device.productURL == nil)
    #expect(device.unknownFields == ["capabilities", "fielddVersion", "bootId", "headless",
      "contractsVersion", "publishedAt"].sorted())
  }

  /// The slice is where the phone actually learns a door: `productEndpoint.url`
  /// is the C3 capability URL, and it is the whole reason IOS-4a exists.
  @Test func aServingSliceCarriesTheDialTarget() throws {
    let device = try DeviceInfo(json: try Fixture.json("device-slice.valid"))
    #expect(device.productEndpoint?.serve == "product")
    #expect(device.productURL?.host == "mac.tail1234.ts.net")
    #expect(device.productURL?.path.hasPrefix("/t/") == true)
    // A slice is published BY a device about itself, so it carries no liveness:
    // nil here is "the slice did not say", never "offline".
    #expect(device.online == nil)
    #expect(device.isSelf == nil)
  }

  @Test func oneUnreadableRowCostsItsOwnRowAndNotTheRoster() throws {
    let good = try Fixture.json("device-info.valid")
    let result = try DeviceListResult(
      json: .object(["devices": .array([good, .object(["name": .string("nameless")])])]))
    #expect(result.devices.count == 1)
    #expect(result.droppedRows.count == 1)
    #expect(result.droppedRows[0].contains("deviceId"))
  }
}

@Suite struct AgentListShapeTests {
  @Test func theGoldenFullRowReadsDownToTheReplyAndTheJoin() throws {
    let result = try AgentListResult(json: try Fixture.json("agent-list.valid"))
    #expect(result.droppedRows.isEmpty)
    let row = try #require(result.sessions.first)
    #expect(row.runtimeRunId == "run-1")
    #expect(row.kind == "claude")
    #expect(row.label == "Claude")
    #expect(row.device == "dev-3c4d")
    #expect(row.tier == "managed")
    #expect(row.statusValue == .blocked)
    #expect(row.statusSince == "2026-08-16T12:00:00.000Z")
    #expect(row.alive == true)
    #expect(row.terminal?.hostedValue == .local)
    #expect(row.terminal?.runtimeSessionId == "sess-01J8Z3K9")
    #expect(row.cumulativeTokens == 12345)
    #expect(row.burnRatePerMin == 321)
    #expect(row.contextUsedPercent == 20)
    #expect(row.modelId == "model-card-v2")
    #expect(row.modelDisplayName == "Model Card V2")
    #expect(row.cwd == "/repo")
  }

  /// `environment.git` is `null` in the golden, and null reads as absent —
  /// one rule, decided in `WireObject` and not eleven times over.
  @Test func aNullSubObjectReadsAsAbsent() throws {
    let result = try AgentListResult(json: try Fixture.json("agent-list.valid"))
    #expect(try #require(result.sessions.first).branch == nil)
  }

  /// The golden's blocker is a QUESTION, which carries no tool — and its
  /// `questions` array, the prompt and the options, is exactly what this client
  /// does not read.
  @Test func aQuestionBlockerCarriesNoToolAndNoPrompt() throws {
    let result = try AgentListResult(json: try Fixture.json("agent-list.valid"))
    let blocker = try #require(result.sessions.first?.blockers.first)
    #expect(blocker.id == "question-1")
    #expect(blocker.kind == "question")
    #expect(blocker.tool == nil)
    #expect(blocker.unknownFields == ["questions"])
  }

  @Test func aPermissionBlockerIsReadDownToItsTool() throws {
    let blocker = try AgentBlockerRow(
      json: .object([
        "id": .string("permission-1"), "kind": .string("permission"),
        "since": .string("2026-09-13T12:00:00.000Z"),
        "permission": .object([
          "requestId": .string("req-1"), "tool": .string("Bash"),
        ]),
      ]))
    #expect(blocker.tool == "Bash")
  }

  @Test func aRowWithNoMonitorMirrorIsStillARow() throws {
    let result = try AgentListResult(
      json: .object([
        "sessions": .array([
          .object([
            "runtimeRunId": .string("run-9"), "kind": .string("claude"),
            "label": .string("Claude"), "device": .string("dev-1"),
            "tier": .string("managed"), "status": .string("idle"),
            "createdAt": .string("2026-09-13T00:00:00.000Z"),
            "stateChangedAt": .string("2026-09-13T00:00:00.000Z"),
          ])
        ])
      ]))
    let row = try #require(result.sessions.first)
    #expect(row.statusValue == .idle)
    #expect(row.blockers.isEmpty)
    #expect(row.alive == nil)
    #expect(row.lastAssistantMessage == nil)
  }

  @Test func anUnheardOfStatusFoldsToUnknownRatherThanFailing() {
    #expect(AgentRowStatus(wire: "compacting") == .unknown)
    #expect(AgentRowStatus(wire: "working") == .working)
  }
}

@Suite struct AgentFieldShapeTests {
  @Test func theSnapshotReadsEveryRowOfTheBoard() throws {
    let snapshot = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.valid"))
    #expect(snapshot.revision == 64)
    #expect(snapshot.rows.count == 5)
    #expect(snapshot.droppedRows.isEmpty)

    let blocked = try #require(snapshot.rows.first { $0.runtimeRunId == "run-blocked" })
    #expect(blocked.statusValue == .blocked)
    #expect(blocked.revision == 7)
    #expect(blocked.kind == "claude")
    #expect(blocked.label == "Claude Code")
    #expect(blocked.tier == "managed")
    #expect(blocked.device == "dev-01HQ8ZK4M7")
    #expect(blocked.blockers.count == 1)
    #expect(blocked.blockers.first?.kind == "permission")
    #expect(blocked.blockers.first?.tool == "Bash")
    #expect(blocked.effort == "high")
    #expect(blocked.effortIntent == "observed")
    #expect(blocked.contextUsedPercent == 38)
    #expect(blocked.cumulativeTokens == 184_320)
    #expect(blocked.burnRatePerMin == 1450)
    #expect(blocked.modelId == "claude-opus-5")
    #expect(blocked.modelDisplayName == "Opus 5")
    #expect(blocked.cwd == "/Users/j/Projects/vibe-field")
    #expect(blocked.branch == "mf/fd1")
    #expect(blocked.terminal?.hostedValue == .local)
    #expect(blocked.terminal?.runtimeSessionId == "pty-a41f")
    #expect(blocked.terminal?.workloadClass == "agent")
    // Optional where the golden leaves it out, and that is the point of optional.
    #expect(blocked.profileId == nil)
    #expect(blocked.pending == nil)
    #expect(blocked.unknownFields.isEmpty)
    #expect(blocked.droppedBlockers.isEmpty)

    let working = try #require(snapshot.rows.first { $0.runtimeRunId == "run-working" })
    #expect(working.profileId == "work")
    #expect(working.modelDisplayName == nil)
    #expect(working.effort == "medium")
    #expect(working.effortIntent == nil)
    #expect(working.terminal?.cellBootId == "cell-3")
  }

  /// The golden's `run-working` carries `"branch": null` — a detached head, or
  /// a worktree that is not a repo. It reads as absent, and the rule lives in
  /// `WireObject` rather than in each of eleven readers.
  @Test func aNullBranchInTheGoldenReadsAsAbsent() throws {
    let snapshot = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.valid"))
    let working = try #require(snapshot.rows.first { $0.runtimeRunId == "run-working" })
    #expect(working.cwd == "/Users/j/Projects/ice")
    #expect(working.branch == nil)
  }

  /// AR-4's pending row. Worth pinning precisely, because the GOLDEN and the
  /// prose disagree and the golden is the authority: §10.3 describes a pending
  /// row as "live, unobserved", but the fixture ships `alive: false` beside
  /// `pending: "resume-when-idle"`. This reader carries both fields verbatim
  /// and derives nothing from either, so the disagreement is fieldd's to settle
  /// and cannot become a wrong bubble here — but a feed that renders "alive"
  /// must read `pending` first (see the note in the slice's report).
  @Test func thePendingRowCarriesBothItsFactsVerbatim() throws {
    let snapshot = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.valid"))
    let pending = try #require(snapshot.rows.first { $0.pending != nil })
    #expect(pending.runtimeRunId == "run-pending")
    #expect(pending.pending == "resume-when-idle")
    #expect(pending.alive == false)
    #expect(pending.statusValue == .unknown)
    #expect(pending.terminal?.runtimeSessionId == "pty-0b5e")
  }

  /// Two rows in the golden are not alive — the pending one and the exited one
  /// — so "not alive" does not identify a row. The exited one is the one with
  /// no terminal left.
  @Test func theExitedRowHasNoTerminalAndIsNotTheOnlyDeadOne() throws {
    let snapshot = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.valid"))
    #expect(snapshot.rows.filter { !$0.alive }.count == 2)

    let exited = try #require(snapshot.rows.first { $0.runtimeRunId == "run-exited" })
    #expect(!exited.alive)
    #expect(exited.pending == nil)
    #expect(exited.terminal?.hostedValue == AgentTerminalJoin.Hosted.none)
    #expect(exited.terminal?.runtimeSessionId == nil)
    #expect(exited.cumulativeTokens == 33_110)
    #expect(exited.burnRatePerMin == nil)
  }

  /// §10.1's own list of what a field row must NOT carry. This test is the
  /// wall: if a future shape starts shipping the reply text or a blocker's
  /// prompt, the phone still will not read it.
  @Test func theFieldRowCarriesNoConversationContent() throws {
    let snapshot = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.valid"))
    let names = Set(Mirror(reflecting: try #require(snapshot.rows.first)).children.map {
      $0.label ?? ""
    })
    for absent in ["lastAssistantMessage", "title", "input", "questions", "detail", "monitor"] {
      #expect(!names.contains(absent), "AgentFieldRow must not carry `\(absent)`")
    }
    // And the golden itself carries none of them, which is the fieldd half of
    // the same promise — a reader that ignored them would hide a leak.
    let raw = try #require(try Fixture.json("agent-field-snapshot.valid")["rows"]?
      .arrayValue?.first?.objectValue)
    for absent in ["lastAssistantMessage", "title", "monitor"] {
      #expect(raw[absent] == nil, "the golden row must not ship `\(absent)`")
    }
    var blocker = try #require(raw["blockers"]?.arrayValue?.first?.objectValue)
    for absent in ["input", "questions", "detail", "permission"] {
      #expect(blocker[absent] == nil, "the golden blocker must not ship `\(absent)`")
    }
    blocker.removeAll()
  }

  @Test func aDeltaNamesWhatItReplacesAndWhatLeft() throws {
    let delta = try AgentFieldDelta(json: try Fixture.json("agent-field-delta.valid"))
    #expect(delta.since == 64)
    #expect(delta.revision == 66)
    #expect(delta.upserts.count == 2)
    #expect(delta.removed == ["run-exited"])
    #expect(delta.droppedRows.isEmpty)

    // The blocked row was answered: it is working, and its blockers are gone.
    let unblocked = try #require(delta.upserts.first { $0.runtimeRunId == "run-blocked" })
    #expect(unblocked.statusValue == .working)
    #expect(unblocked.blockers.isEmpty)
    #expect(unblocked.revision == 65)

    // A delta's rows carry the row's own revision, not the board's.
    let woken = try #require(delta.upserts.first { $0.runtimeRunId == "run-idle" })
    #expect(woken.statusValue == .working)
    #expect(woken.revision == 66)
  }

  /// A delta applies ON TOP of `since`. The pairing is the whole repair rule:
  /// a client whose revision is not `since` re-subscribes for a snapshot.
  @Test func theDeltaFollowsTheSnapshotItWasCutAgainst() throws {
    let snapshot = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.valid"))
    let delta = try AgentFieldDelta(json: try Fixture.json("agent-field-delta.valid"))
    #expect(delta.since == snapshot.revision)
    #expect(delta.revision > delta.since)
  }

  @Test func theStoreSliceCarriesItsOwnExpiry() throws {
    let slice = try AgentFieldSlice(json: try Fixture.json("agent-field-slice.valid"))
    #expect(slice.version == 1)
    #expect(slice.deviceId == "dev-01HQ8ZK4M7")
    #expect(slice.revision == 64)
    #expect(slice.rows.count == 5)
    #expect(slice.droppedRows.isEmpty)
    #expect(slice.expiresAt - slice.publishedAt == 30_000)

    let justBefore = Date(timeIntervalSince1970: Double(slice.expiresAt - 1) / 1000)
    let justAfter = Date(timeIntervalSince1970: Double(slice.expiresAt + 1) / 1000)
    #expect(!slice.isExpired(at: justBefore))
    #expect(slice.isExpired(at: justAfter))
  }

  /// The slice is the snapshot's board with the store's envelope around it —
  /// same revision, same rows — which is what lets one feed read either.
  @Test func theSliceAndTheSnapshotAgreeOnTheBoard() throws {
    let slice = try AgentFieldSlice(json: try Fixture.json("agent-field-slice.valid"))
    let snapshot = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.valid"))
    #expect(slice.revision == snapshot.revision)
    #expect(slice.rows.map(\.runtimeRunId) == snapshot.rows.map(\.runtimeRunId))
  }

  @Test func aRowMissingARequiredFieldIsDroppedAndNamed() throws {
    let good = try Fixture.json("agent-field-snapshot.valid")["rows"]?.arrayValue?.first
    let snapshot = try AgentFieldSnapshot(
      json: .object([
        "revision": .int(1),
        "rows": .array([try #require(good), .object(["runtimeRunId": .string("run-x")])]),
      ]))
    #expect(snapshot.rows.count == 1)
    #expect(snapshot.droppedRows.count == 1)
    #expect(snapshot.droppedRows[0].contains("revision"))
  }

  @Test func unknownRowFieldsRideRatherThanFailing() throws {
    var row = try #require(
      try Fixture.json("agent-field-snapshot.valid")["rows"]?.arrayValue?.first?.objectValue)
    row["somethingTheDesktopAddedLater"] = .string("hello")
    let decoded = try AgentFieldRow(json: .object(row))
    #expect(decoded.unknownFields == ["somethingTheDesktopAddedLater"])
    #expect(decoded.runtimeRunId == "run-blocked")
  }

  @Test func theSubscribeParamsLeaveTheDesktopUnchangedByOmission() {
    #expect(AgentSubscribeParams().json == .object([:]))
    #expect(
      AgentSubscribeParams.phoneField.json
        == .object(["projection": .string("field"), "minIntervalMs": .int(250)]))
  }
}

@Suite struct AgentDoorShapeTests {
  /// G7's stop verb. An acceptance carries nothing else, and that is a shape,
  /// not a gap.
  @Test func anAcceptedInterruptSaysOnlyThat() throws {
    let result = try AgentInterruptResult(json: try Fixture.json("agent-interrupt.valid"))
    #expect(result.accepted)
    #expect(result.reason == nil)
    #expect(result.unknownFields.isEmpty)
  }

  /// A refusal is a normal outcome with a reason a card can show — never an
  /// error to catch.
  @Test func aRefusedInterruptCarriesItsReason() throws {
    let result = try AgentInterruptResult(json: try Fixture.json("agent-interrupt.refused"))
    #expect(!result.accepted)
    #expect(result.reason == "human-input-conflict")
  }

  @Test func theMirrorWriteGrantReadsItsThreeFacts() throws {
    let grant = try TerminalMirrorWriteGrant(
      json: try Fixture.json("terminal-mirror-write-grant.valid"))
    #expect(grant.deviceId == "dev-01HQ8ZK4M7")
    #expect(grant.issuedAt == 1_789_671_899_000)
    #expect(grant.capability == "mw_EXAMPLE_not_a_real_capability_0000")
  }

  /// IOS-3c's rule, enforced by the type rather than by everyone remembering
  /// it: the capability is never displayed, exported, or logged. A `print` of
  /// this value in a debug session must not put a live write capability in a
  /// console — so `description` redacts it, and a failing `#expect` on two of
  /// these prints the redacted form too.
  @Test func theGrantNeverRendersItsSecret() throws {
    let grant = try TerminalMirrorWriteGrant(
      json: try Fixture.json("terminal-mirror-write-grant.valid"))
    let rendered = "\(grant)"
    #expect(!rendered.contains("mw_EXAMPLE_not_a_real_capability_0000"))
    #expect(rendered.contains("<redacted>"))
    #expect(rendered.contains("dev-01HQ8ZK4M7"))
    #expect(String(describing: grant) == rendered)
  }
}

@Suite struct JSONValueTests {
  @Test func integersSurviveARoundTrip() throws {
    let value = JSONValue.object(["at": .int(1_757_808_000_000)])
    #expect(try JSONValue.parse(try value.encoded()) == value)
  }

  @Test func aWholeDoubleCountsAsAnIntegerAndAFractionalOneDoesNot() {
    #expect(JSONValue.double(5).intValue == 5)
    #expect(JSONValue.double(5.5).intValue == nil)
    #expect(JSONValue.int(5).doubleValue == 5)
  }

  @Test func nullAndAbsentAnswerAlike() throws {
    var object = try WireObject(shape: "T", value: .object(["a": .null]))
    #expect(object.string("a") == nil)
    #expect(object.string("b") == nil)
    // Both keys were ASKED for, so neither is an unknown field; only `a` was
    // ever on the wire, so only `a` could have been one.
    #expect(object.unknownFields.isEmpty)
  }
}
