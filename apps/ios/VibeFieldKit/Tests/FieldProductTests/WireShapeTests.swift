import Foundation
import Testing

@testable import FieldProduct

// EL9 on the third side. `hello-ack.*`, `device-*` and `agent-list.valid.json`
// under `Fixtures/` are COPIES of `packages/contracts/fixtures/`, byte for
// byte — the same goldens the TypeScript tests parse, so a wire change upstream
// is a red here rather than a runtime surprise on a phone.
//
// "Byte for byte" is now GATED rather than asserted in a comment:
// `scripts/check-ios-fixtures.mjs`, which `pnpm verify` runs, compares every
// copy under `apps/ios/VibeFieldKit/**` to the contracts' file of the same
// name. It was written because this sentence was already false —
// `agent-list.valid.json` had drifted by a line of formatting and nothing
// noticed, which is exactly how a copy stops being evidence.
//
// The field trio — `agent-field-snapshot.valid.json`,
// `agent-field-delta.valid.json`, `agent-field-slice.valid.json` — and the two
// door answers beside them are likewise copies from `mf/fd1`'s
// `packages/contracts/fixtures/`, at MF-1e (`256f559b`) for the snapshot and
// the slice and MF-1a (`3ce315bc`) for the delta.
//
// A note for whoever refreshes them next, because this lane has now been
// burned twice by a SHA: the commit relayed here was `8d23d257`, an orphan;
// its reachable twin was `2f331dbb`; and that one was itself rewritten to
// `3ce315bc` when the lane rebased. Cite the commit that last TOUCHED the
// file (`git log -1 -- <path>`) rather than the one a message names, and
// re-diff the bytes rather than trusting that a subject line means the same
// content. The bytes are what these tests are about.

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
    // MF-1i/EL7-B1: the FOLDER, never the path. The absolute path no longer
    // rides the slice — it reached every VibeField node on the tailnet and the
    // card only ever drew the basename.
    #expect(blocked.projectName == "vibe-field")
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
    #expect(working.projectName == "ice")
    #expect(working.branch == nil)
  }

  /// AR-4's pending row, and the ruling it forced (MF-1e).
  ///
  /// The first cut of this golden shipped `alive: false` beside
  /// `pending: "resume-when-idle"`, which contradicted §10.3's "live,
  /// unobserved"; this lane reported the disagreement and the contracts lane
  /// settled it the other way — `alive` answers "is this agent still there",
  /// `pending` answers "is anyone at the wheel", and a run whose PTY the floor
  /// still hosts is ALIVE. Pinned here because the two fields now mean
  /// different things and a reader that collapsed them would be wrong again.
  @Test func thePendingRowIsAliveAndUnobserved() throws {
    let snapshot = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.valid"))
    let pending = try #require(snapshot.rows.first { $0.pending != nil })
    #expect(pending.runtimeRunId == "run-pending")
    #expect(pending.pending == "resume-when-idle")
    #expect(pending.alive)
    #expect(pending.statusValue == .unknown)
    #expect(pending.terminal?.runtimeSessionId == "pty-0b5e")
  }

  /// The exited row is the one that is really gone: not alive, nothing
  /// pending, and no terminal left.
  @Test func theExitedRowIsTheOnlyDeadOne() throws {
    let snapshot = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.valid"))
    #expect(snapshot.rows.filter { !$0.alive }.map(\.runtimeRunId) == ["run-exited"])

    let exited = try #require(snapshot.rows.first { $0.runtimeRunId == "run-exited" })
    #expect(exited.pending == nil)
    #expect(exited.terminal?.hostedValue == AgentTerminalJoin.Hosted.none)
    #expect(exited.terminal?.runtimeSessionId == nil)
    #expect(exited.cumulativeTokens == 33_110)
    #expect(exited.burnRatePerMin == nil)
  }

  /// §10.1's own list of what a field row must NOT carry — checked against a
  /// PAYLOAD that carries all of it.
  ///
  /// The first version of this reflected over the Swift type, which the
  /// compiler already guarantees: a property that is not declared cannot be
  /// read, and the mirror was only asking the compiler to confirm its own
  /// work. The question worth asking is what happens when the CONTENT ARRIVES
  /// ANYWAY — a future fieldd, a hostile peer's slice — and the answer must be
  /// that it lands in `unknownFields` and reaches nothing else.
  @Test func contentThatArrivesAnywayIsCarriedAsUnknownAndReadByNobody() throws {
    var row = try #require(
      try Fixture.json("agent-field-snapshot.valid")["rows"]?.arrayValue?.first?.objectValue)
    row["lastAssistantMessage"] = .object([
      .init("text"): .string("the secret plan"), .init("at"): .string("2026-09-13T18:00:00Z"),
    ])
    row["title"] = .string("a title nobody asked for")
    row["monitor"] = .object([.init("status"): .string("working")])
    var blocker = try #require(row["blockers"]?.arrayValue?.first?.objectValue)
    blocker["input"] = .string("rm -rf /")
    blocker["questions"] = .array([.object([.init("prompt"): .string("are you sure?")])])
    blocker["detail"] = .string("a detail")
    row["blockers"] = .array([.object(blocker)])

    let decoded = try AgentFieldRow(json: .object(row))
    // Carried, named, and nowhere near a screen.
    #expect(decoded.unknownFields == ["lastAssistantMessage", "monitor", "title"])
    #expect(decoded.blockers.first?.unknownFields == ["detail", "input", "questions"])

    // And the whole decoded row, rendered, contains none of the content. This
    // is the assertion the reflection could not make: a field that leaked into
    // some other property would show up here.
    let rendered = String(describing: decoded)
    for secret in ["the secret plan", "a title nobody asked for", "rm -rf /", "are you sure?"] {
      #expect(!rendered.contains(secret), "`\(secret)` reached the decoded row")
    }
    // The row still reads as itself.
    #expect(decoded.runtimeRunId == "run-blocked")
    #expect(decoded.blockers.first?.tool == "Bash")
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

  /// The 64 KiB cap can leave rows out, and a board that silently claims to be
  /// whole is the blank the corpus forbids. Decoded now, drawn by nobody:
  /// "+N more" is a later slice's, and absence is every producer today.
  @Test func theSliceCarriesHowManyRowsTheCapLeftOut() throws {
    let whole = try AgentFieldSlice(json: try Fixture.json("agent-field-slice.valid"))
    #expect(whole.omitted == nil)

    var fields = try #require(try Fixture.json("agent-field-slice.valid").objectValue)
    fields["omitted"] = .int(7)
    let capped = try AgentFieldSlice(json: .object(fields))
    #expect(capped.omitted == 7)
    // And it is a field this build now READS, so it is not an unknown.
    #expect(!capped.unknownFields.contains("omitted"))
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

  /// The OTHER door, and the one that was open. `dump()`,
  /// `String(reflecting:)` and `po` do not use `description` — they fall back
  /// to the Mirror, which walks the stored properties and prints the
  /// capability in full. A redaction that only covers `print` covers the way
  /// nobody debugs.
  @Test func theGrantIsRedactedInTheDebuggerToo() throws {
    let grant = try TerminalMirrorWriteGrant(
      json: try Fixture.json("terminal-mirror-write-grant.valid"))
    #expect(!String(reflecting: grant).contains("mw_EXAMPLE"))
    #expect(String(reflecting: grant).contains("<redacted>"))

    var dumped = ""
    dump(grant, to: &dumped)
    #expect(!dumped.contains("mw_EXAMPLE"))
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
