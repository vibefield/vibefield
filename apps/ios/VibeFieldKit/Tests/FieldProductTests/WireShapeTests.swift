import Foundation
import Testing

@testable import FieldProduct

// EL9 on the third side. `hello-ack.*`, `device-*` and `agent-list.valid.json`
// under `Fixtures/` are COPIES of `packages/contracts/fixtures/`, byte for
// byte — the same goldens the TypeScript tests parse, so a wire change upstream
// is a red here rather than a runtime surprise on a phone.
//
// PROVENANCE of the other three: `agent-field-snapshot.valid.json`,
// `agent-field-delta.valid.json` and `agent-field-slice.valid.json` are
// HAND-AUTHORED from `thinking-godview-mobile-first.md` §10.1, because
// `packages/contracts/src/agent-field.ts` was still being landed when this
// target was built. They carry the five rows §10.1 asks for (one blocked with
// `tool: "Bash"`, one pending, one exited) and the same field names. When the
// contracts' goldens land under those exact names, REPLACE these three files
// with the real ones — the names match so that is a copy, not an edit.

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
    #expect(snapshot.revision == 41)
    #expect(snapshot.rows.count == 5)
    #expect(snapshot.droppedRows.isEmpty)

    let blocked = try #require(snapshot.rows.first { $0.statusValue == .blocked })
    #expect(blocked.runtimeRunId == "run-1")
    #expect(blocked.revision == 9)
    #expect(blocked.blockers.first?.tool == "Bash")
    #expect(blocked.effort == "high")
    #expect(blocked.effortIntent == "observed")
    #expect(blocked.contextUsedPercent == 20)
    #expect(blocked.cwd == "/repo")
    #expect(blocked.branch == "main")
    #expect(blocked.terminal?.runtimeSessionId == "sess-01J8Z3K9")
    #expect(blocked.profileId == "claude:native-default")

    let pending = try #require(snapshot.rows.first { $0.pending != nil })
    #expect(pending.runtimeRunId == "run-4")
    #expect(pending.pending == "resume-when-idle")
    #expect(pending.alive)

    let exited = try #require(snapshot.rows.first { !$0.alive })
    #expect(exited.runtimeRunId == "run-5")
    #expect(exited.terminal?.hostedValue == AgentTerminalJoin.Hosted.none)
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
  }

  @Test func aDeltaNamesWhatItReplacesAndWhatLeft() throws {
    let delta = try AgentFieldDelta(json: try Fixture.json("agent-field-delta.valid"))
    #expect(delta.since == 41)
    #expect(delta.revision == 42)
    #expect(delta.upserts.count == 2)
    #expect(delta.removed == ["run-5"])
    #expect(delta.upserts.first { $0.runtimeRunId == "run-1" }?.blockers.isEmpty == true)
    #expect(delta.upserts.first { $0.runtimeRunId == "run-2" }?.revision == 119)
  }

  @Test func theStoreSliceCarriesItsOwnExpiry() throws {
    let slice = try AgentFieldSlice(json: try Fixture.json("agent-field-slice.valid"))
    #expect(slice.version == 1)
    #expect(slice.deviceId == "dev-3c4d")
    #expect(slice.revision == 41)
    #expect(slice.rows.count == 5)
    #expect(slice.expiresAt - slice.publishedAt == 30_000)

    let justBefore = Date(timeIntervalSince1970: Double(slice.expiresAt - 1) / 1000)
    let justAfter = Date(timeIntervalSince1970: Double(slice.expiresAt + 1) / 1000)
    #expect(!slice.isExpired(at: justBefore))
    #expect(slice.isExpired(at: justAfter))
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
    #expect(decoded.runtimeRunId == "run-1")
  }

  @Test func theSubscribeParamsLeaveTheDesktopUnchangedByOmission() {
    #expect(AgentSubscribeParams().json == .object([:]))
    #expect(
      AgentSubscribeParams.phoneField.json
        == .object(["projection": .string("field"), "minIntervalMs": .int(250)]))
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
