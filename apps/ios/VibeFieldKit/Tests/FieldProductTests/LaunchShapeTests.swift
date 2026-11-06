import Foundation
import Testing

@testable import FieldProduct

// PJ-7 — EL9 on the third side for the launch sheet's reads (PJ-6's shapes):
// `agent.models`' picker and its failure, the Agent Profiles, and the spawn a
// sheet sends. Every id the agent owns — a model's, a control's, a value's —
// is carried OPAQUE (AR-L1): read as a string, sent back as it came, never
// compared to a literal outside these goldens.

@Suite struct LaunchShapeTests {
  @Test func theModelsAnswerIsTheAgentsOwnPickerWithEachModelsControls() throws {
    let answer = try AgentModelsResult(json: try Fixture.json("agent-models.valid"))
    #expect(answer.provider == "claude")
    #expect(answer.profileSet == "work-7f3a")
    #expect(!answer.refreshing)
    #expect(answer.failure == nil)
    let catalog = try #require(answer.catalog)
    #expect(catalog.observedAt == "2026-10-12T18:07:17.797Z")
    #expect(catalog.freshness == "unknown")
    #expect(catalog.completeness == "complete")
    #expect(catalog.customModels)
    #expect(catalog.models.map(\.id) == ["default", "opus", "sonnet", "haiku"])
    #expect(catalog.models.map(\.label) == ["Default (recommended)", "Opus", "Sonnet", "Haiku"])
    let opus = try #require(catalog.models.first { $0.id == "opus" })
    #expect(opus.description == "Best for everyday, complex tasks")
    #expect(opus.controls.map(\.role) == ["effort"])
    #expect(opus.controls.first?.values.map(\.id) == ["low", "medium", "high", "xhigh", "max"])
    #expect(catalog.models.last?.controls.isEmpty == true)
    #expect(answer.unknownFields.isEmpty)
  }

  @Test func aStaleCatalogStandsBesideTheFailureAndAnUnknownRoleIsKept() throws {
    let answer = try AgentModelsResult(json: try Fixture.json("agent-models.stale"))
    #expect(answer.refreshing)
    #expect(answer.catalog?.freshness == "cached")
    #expect(answer.failure?.status == "unavailable")
    #expect(answer.failure?.code == "timeout")
    #expect(answer.failure?.message == "Model discovery timed out.")
    let opus = try #require(answer.catalog?.models.first { $0.id == "opus" })
    #expect(opus.controls.map(\.role) == ["effort", "some-future-role"])
    #expect(answer.unknownFields == ["later"])
  }

  @Test func aSignedOutAgentAnswersAFailureNeverAnEmptyList() throws {
    let answer = try AgentModelsResult(json: try Fixture.json("agent-models.auth-required"))
    #expect(answer.provider == "codex")
    #expect(answer.catalog == nil)
    #expect(answer.failure?.status == "auth-required")
    #expect(answer.failure?.message == "Sign in to discover models.")
  }

  @Test func thePhoneAsksForModelsWithNoPath() throws {
    let golden = try #require(try Fixture.json("agent-models-params.valid").objectValue)
    let ask = AgentModelsParams(provider: "claude", profileSet: "work-7f3a", refresh: true).json
    // the golden is a desktop window's ask; the phone's is the same less the
    // folder (P1: a phone never names a folder by its path)
    var expected = golden
    expected["cwd"] = nil
    #expect(ask == .object(expected))
    #expect(AgentModelsParams(provider: "claude").json == .object(["provider": .string("claude")]))
  }

  @Test func theProfileSetsNameTheirAgentsAndTheDefault() throws {
    let answer = try AgentProfileSetsResult(json: try Fixture.json("agents-profile-sets.valid"))
    #expect(answer.sets.map(\.id) == ["native", "work"])
    #expect(answer.sets.map(\.kind) == ["native", "managed"])
    #expect(answer.sets.map(\.label) == ["This Mac", "Work"])
    #expect(answer.sets.map(\.isDefault) == [false, true])
    #expect(answer.sets[1].glyph == "briefcase")
    #expect(answer.sets[0].providers == ["claude"])
    #expect(answer.sets[1].providers == ["codex", "hermes"])
    #expect(!answer.reading)
    #expect(answer.droppedRows.isEmpty)
  }

  // UM-4 (UM-D8 A) — the meters read each profile's sign-ins and the plans they run on: whose reading a plan's is
  // (`namedBy`), the sign-ins on it, the other profiles with the same account, and a draft no agent signed in to.
  @Test func theProfileSetsCarryTheirSignInsAndPlansForTheMeters() throws {
    let answer = try AgentProfileSetsResult(json: try Fixture.json("agents-profile-sets.meters"))
    let ids = answer.sets.map(\.id)
    #expect(ids == ["native", "work", "side", "new-profile"])
    let drafts = answer.sets.map(\.draft)
    #expect(drafts == [false, false, false, true])
    let native = try #require(answer.sets.first)
    let nativeKinds = native.personas.map(\.kind)
    #expect(nativeKinds == ["native-default", "native-default", "native-default"])
    let nativeIds = native.personas.map(\.profileId)
    #expect(nativeIds == ["claude:native-default", "codex:native-default", "grok:native-default"])
    let first = try #require(native.personas.first)
    #expect(first.provider == "claude")
    #expect(first.identity?.loggedIn == true)
    #expect(first.identity?.email == "kim@example.com")
    let plans = try #require(native.plans)
    let planIds = plans.map(\.id)
    #expect(planIds == ["anthropic", "openai", "xai"])
    let anthropic = try #require(plans.first)
    #expect(anthropic.service == AgentSignInService(id: "anthropic", label: "Anthropic"))
    #expect(anthropic.account?.email == "kim@example.com")
    #expect(anthropic.account?.plan == "max")
    #expect(anthropic.namedBy == "claude:native-default")
    #expect(anthropic.holders == ["claude:native-default"])
    #expect(anthropic.alsoIn == ["work"])
    let kimi = try #require(answer.sets.dropFirst().first?.personas.last)
    #expect(kimi.kind == "managed")
    #expect(kimi.identity?.loggedIn == false)
    let side = answer.sets[2]
    let signingIn = side.personas.map(\.signingIn)
    #expect(signingIn == [false, true])
    #expect(side.personas.last?.identity == nil)
    #expect(answer.droppedRows.isEmpty)
  }

  @Test func aProfileFromAnOlderFielddNamesNoPlansAndItsSignInsStillRead() throws {
    let older = JSONValue.object([
      "id": .string("work"), "kind": .string("managed"), "label": .string("Work"), "default": .bool(true),
      "createdAt": .string("2026-09-01T00:00:00.000Z"),
      "personas": .array([
        .object([
          "profileId": .string("0b7e2c4d-9a1f-4e58-8c1d-3f2a6b9e7d10"), "provider": .string("codex"),
          "label": .string("Work"), "kind": .string("managed"), "createdAt": .string("2026-09-01T00:00:00.000Z"),
        ])
      ]),
    ])
    let set = try AgentProfileSet(json: older)
    #expect(set.plans == nil)
    #expect(!set.draft)
    let ids = set.personas.map(\.profileId)
    #expect(ids == ["0b7e2c4d-9a1f-4e58-8c1d-3f2a6b9e7d10"])
    #expect(set.personas.first?.identity == nil)
    #expect(set.personas.first?.signingIn == false)
  }

  @Test func aSpawnCarriesTheProfileAndTheSelectionOpaqueAndRoundTrips() throws {
    let golden = try Fixture.json("agent-spawn-params.model-selection")
    let selection = try AgentModelSelection(json: try #require(golden["modelSelection"]))
    #expect(selection.modelId == "model-card-v2")
    #expect(selection.controls == ["effort": "high"])
    let params = AgentSpawnParams(
      provider: "claude", cwd: "/Users/test/Projects/vibe-field", profileSet: "work-7f3a", modelSelection: selection)
    #expect(params.json == golden)
    // a selection's own key a newer fieldd adds reaches the spawn whole
    let future = try AgentModelSelection(
      json: .object(["modelId": .string("m"), "controls": .object([:]), "futureKey": .bool(true)]))
    #expect(future.json["futureKey"] == .bool(true))
    #expect(future.unknownFields == ["futureKey"])
  }

  @Test func aSpawnByPlaceSendsTheRefAndNoPath() throws {
    let place = PlaceRef(device: "dev-a", placeId: "pl_1")
    let params = AgentSpawnParams(provider: "claude", place: place, profileSet: "native")
    #expect(params.json["place"] == place.json)
    #expect(params.json["cwd"] == nil)
    #expect(params.json["profileSet"] == .string("native"))
    #expect(params.json["modelSelection"] == nil)
    #expect(AgentSpawnParams(provider: "codex", cwd: "/a").json == .object(["provider": .string("codex"), "cwd": .string("/a")]))
  }

  @Test func thePhonesWholeLaunchByPlaceMatchesItsGolden() throws {
    let golden = try Fixture.json("agent-spawn-params.place")
    let params = AgentSpawnParams(
      provider: "claude", place: try PlaceRef(json: try #require(golden["place"])), profileSet: "work-7f3a",
      modelSelection: AgentModelSelection(modelId: "model-card-v2", controls: ["effort": "high"]))
    var expected = try #require(golden.objectValue)
    expected["//"] = nil
    #expect(params.json == .object(expected))
    #expect(params.json["cwd"] == nil, "never beside a cwd")
  }

  @Test func theFieldRowCarriesItsConversationsIdOnlyWhenTheAgentSaidIt() throws {
    let board = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.native-session"))
    #expect(board.rows.map(\.nativeSessionId) == ["4f9c2d1e-7a3b-4c8d-9e0f-1a2b3c4d5e6f", nil])
    #expect(board.rows.allSatisfy { $0.unknownFields.isEmpty })
  }

  // ST-D5 — a person's durable Stop rides the field row while fieldd holds one,
  // on every audience's row: the phone's Stop reads the window's truth.
  @Test func theFieldRowCarriesAPersonsStopOnlyWhileFielddHoldsOne() throws {
    let board = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.stop"))
    #expect(board.droppedRows.isEmpty)
    let stops = board.rows.map(\.stop)
    #expect(stops.map { $0?.stage } == ["terminating", "resent", "heard"])
    #expect(stops.map { $0?.sentAt } == ["2026-10-31T06:00:03.000Z", "2026-10-31T06:01:02.000Z", "2026-10-31T06:02:04.000Z"])
    #expect(stops.map { $0?.unheardAt } == [nil, "2026-10-31T06:01:08.000Z", nil])
    #expect(stops.map { $0?.heardBy } == [nil, nil, "status"])
    #expect(board.rows.allSatisfy { $0.unknownFields.isEmpty && $0.stop?.unknownFields == [] })
    let none = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.native-session"))
    #expect(none.rows.allSatisfy { $0.stop == nil }, "a row holding no Stop carries none")
  }

  // TU-1 — the row says whether its run has worked and the Agent Profile it is
  // filed under. The phone reads both and leaves a spark's own keys unread
  // (`spark`, `origin`), named as unread, never refused.
  @Test func theFieldRowSaysWhetherItsRunHasWorkedAndTheProfileItIsFiledUnder() throws {
    let board = try AgentFieldSnapshot(json: try Fixture.json("agent-field-snapshot.turned"))
    #expect(board.droppedRows.isEmpty)
    #expect(board.rows.map(\.turnedAt) == ["2026-11-01T08:40:12.000Z", nil, nil])
    #expect(board.rows.map(\.profileSet) == ["native", "work-7f3a", nil])
    #expect(board.rows.map(\.unknownFields) == [["origin", "spark"], ["origin", "spark"], []])
    for name in ["agent-field-snapshot.native-session", "agent-field-snapshot.stop"] {
      let older = try AgentFieldSnapshot(json: try Fixture.json(name))
      #expect(older.rows.allSatisfy { $0.turnedAt == nil && $0.profileSet == nil }, "\(name)")
    }
  }

  @Test func aStopsStageIsAnOpenWordKeptAsItCame() throws {
    let stop = try AgentFieldStop(
      json: .object([
        "sentAt": .string("2026-10-31T06:03:00.000Z"), "stage": .string("withdrawn"), "by": .string("x"),
      ]))
    #expect(stop.stage == "withdrawn", "a reader takes it as still stopping")
    #expect(stop.unknownFields == ["by"])
    #expect(throws: WireDecodeError.self) { try AgentFieldStop(json: .object(["stage": .string("sent")])) }
  }

  @Test func theCatalogSaysWhichAgentsResume() throws {
    let catalog = try AgentCatalogResult(json: try Fixture.json("agent-catalog.valid"))
    #expect(catalog.catalog.first { $0.id == "claude" }?.canResume == true)
    let silent = try AgentCatalogRow(
      json: .object(["id": .string("x"), "label": .string("X"), "status": .string("preview"), "offers": .object(["spawn": .bool(true)])]))
    #expect(!silent.canResume, "absent unless the desktop offers it")
  }

  @Test func aNativeResumeSendsTheIdAndNoPath() {
    let params = AgentResumeNativeParams(provider: "claude", nativeSessionId: "665e3e71")
    #expect(params.json == .object(["provider": .string("claude"), "nativeSessionId": .string("665e3e71")]))
  }
}
