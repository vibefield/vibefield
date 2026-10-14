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

  @Test func aNativeResumeSendsTheIdAndNoPath() {
    let params = AgentResumeNativeParams(provider: "claude", nativeSessionId: "665e3e71")
    #expect(params.json == .object(["provider": .string("claude"), "nativeSessionId": .string("665e3e71")]))
  }
}
