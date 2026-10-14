import FieldProduct
import Foundation
import Testing

@testable import FieldWorkspace

// PJ-7 — the launch sheet (Q5, Q6, Q7, PJ-D12 (a); DESIGN.md §8's FS-2 entry):
// Profile · Model · Effort rows that never come or go, the native profile
// named "Default", "Each agent's own" first with a failed read said in words,
// the effort brought back per model from the recipe, the folder row filled
// from the recipe's place (else the newest launchable place on the sheet's
// desktop, else the folder sheet opens by itself), a project's places first,
// and a spawn that names a place by ref — a path only from Browse. Over the
// contracts' goldens.

private let studio = "01J9ZK3M5Q8XR2V7N4B6C1D0EF"
private let laptop = "01J9ZM0PQ7W3E6R8T2Y4U1I5O9"

private func place(
  _ id: String, on device: String, name: String, lastAt: Int64, reason: String? = nil
) -> LaunchPlace {
  LaunchPlace(
    ref: PlaceRef(device: device, placeId: id), name: name, branch: nil, desktop: device, reason: reason,
    lastAt: lastAt)
}

private let vibeField = place("pl_4c1e9a0b7d2f6e8a1b3c5d7e", on: studio, name: "vibe-field", lastAt: 300)
private let docs = place("pl_77d3f2a1c9e0b4d6f8a2c4e6", on: laptop, name: "vf-docs", lastAt: 200)
private let older = place("pl_old", on: studio, name: "old-spike", lastAt: 100)
private let gone = place("pl_gone", on: studio, name: "gone", lastAt: 900, reason: "folder gone")

@MainActor
private final class Desk {
  var asked: [(device: String, method: String, params: JSONValue?)] = []
  var models: [String: String] = ["claude": "agent-models.valid", "codex": "agent-models.auth-required"]
  var spawnReply: JSONValue = .object(["session": .object(["runtimeRunId": .string("run-1")])])

  func answer(_ device: String, _ method: String, _ params: JSONValue?) async throws -> JSONValue {
    asked.append((device, method, params))
    switch method {
    case "workspace.roots":
      // the golden's roots, on the desktop asked
      var answer = try #require(try workspaceFixture("workspace-roots.valid").objectValue)
      answer["roots"] = .array((answer["roots"]?.arrayValue ?? []).map { root in
        var fields = root.objectValue ?? [:]
        fields["device"] = .string(device)
        return .object(fields)
      })
      return .object(answer)
    case "workspace.list": return try workspaceFixture("workspace-list.valid")
    case "agent.catalog": return try workspaceFixture("agent-catalog.valid")
    case "agents.profileSets.list": return try workspaceFixture("agents-profile-sets.valid")
    case "agent.models":
      let provider = params?["provider"]?.stringValue ?? ""
      var answer = try #require(try workspaceFixture(models[provider] ?? "agent-models.auth-required").objectValue)
      answer["provider"] = .string(provider)
      if let set = params?["profileSet"] { answer["profileSet"] = set }
      return .object(answer)
    case "agent.spawn": return spawnReply
    default: throw FieldProductError(kind: "NOT_FOUND", message: method)
    }
  }

  func launch() -> WorkspaceLaunch {
    WorkspaceLaunch(desktops: [
      .init(id: studio, name: "studio", platform: "darwin", online: true),
      .init(id: laptop, name: "laptop", platform: "win32", online: true),
    ], home: studio) { [unowned self] device, method, params in
      try await self.answer(device, method, params)
    }
  }

  func last(_ method: String) -> (device: String, method: String, params: JSONValue?)? {
    asked.last { $0.method == method }
  }
}

private func recipe() throws -> ProjectRecipe {
  try #require(try ProjectSummary(json: try workspaceFixture("project-summary.recipe-place")).recipe)
}

@MainActor
private func settle(_ what: String, _ condition: @MainActor () -> Bool) async {
  let deadline = ContinuousClock.now.advanced(by: .seconds(5))
  while ContinuousClock.now < deadline {
    if condition() { return }
    try? await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("timed out waiting for \(what)")
}

@Suite("PJ-7 — the launch sheet's decisions")
struct LaunchDecisionTests {
  @Test("the usual place: the recipe's, else the newest launchable on the sheet's desktop, else none")
  func usualPlace() throws {
    let places = [gone, docs, vibeField, older]
    let recipe = try recipe()
    #expect(LaunchModel.usualPlace(recipe: recipe, places: places, desktop: laptop, online: [studio, laptop]) == vibeField)
    // the recipe's place on a desktop that does not answer: the newest on the sheet's desktop
    #expect(LaunchModel.usualPlace(recipe: recipe, places: places, desktop: laptop, online: [laptop]) == docs)
    // never a place that cannot take a launch, however new
    #expect(LaunchModel.usualPlace(recipe: nil, places: places, desktop: studio, online: [studio]) == vibeField)
    #expect(LaunchModel.usualPlace(recipe: nil, places: [gone], desktop: studio, online: [studio]) == nil)
    #expect(LaunchModel.usualPlace(recipe: nil, places: places, desktop: studio, online: []) == nil)
  }

  @Test("the profiles that can run the agent: its own folders named Default, the default set chosen first")
  func profiles() throws {
    let sets = try AgentProfileSetsResult(json: try workspaceFixture("agents-profile-sets.valid")).sets
    let claude = LaunchModel.profileChoices(sets, provider: "claude")
    #expect(claude.map(\.id) == ["native"])
    #expect(claude.map(\.label) == ["Default"], "Q5: the wire's This Mac reads Default on the phone")
    #expect(LaunchModel.profileRow(claude, desktop: "studio") == "Default — the only profile on studio")
    let codex = LaunchModel.profileChoices(sets, provider: "codex")
    #expect(codex.map(\.label) == ["Default", "Work"])
    #expect(LaunchModel.profileRow(codex, desktop: "studio") == nil, "a real choice is a menu")
    #expect(LaunchModel.firstProfile(codex, wanted: [nil]) == "work", "the desktop's default profile")
    #expect(LaunchModel.firstProfile(codex, wanted: ["work-7f3a", "native"]) == "native")
    #expect(LaunchModel.profileRow([], desktop: "studio") == "The desktop's default profile")
  }

  @Test("the model row: Each agent's own first; a failed read in words; the read's age")
  func modelWords() throws {
    let signedOut = try AgentModelsResult(json: try workspaceFixture("agent-models.auth-required"))
    #expect(LaunchModel.modelsNote(signedOut) == "Sign in to see models")
    #expect(LaunchModel.modelRow(signedOut, loading: false) == "Each agent's own · Sign in to see models")
    let valid = try AgentModelsResult(json: try workspaceFixture("agent-models.valid"))
    #expect(LaunchModel.modelRow(valid, loading: false) == nil)
    #expect(LaunchModel.modelRow(nil, loading: true) == "Each agent's own · reading models…")
    let observed = try #require(LaunchModel.date(valid.catalog?.observedAt))
    #expect(LaunchModel.modelsAge(valid, now: observed.addingTimeInterval(7_200)) == "models read 2h ago")
    let stale = try AgentModelsResult(json: try workspaceFixture("agent-models.stale"))
    #expect(LaunchModel.modelsNote(stale) == "Model discovery timed out.")
    #expect(LaunchModel.modelRow(stale, loading: false) == nil, "a kept catalog is still offered")
  }

  @Test("the effort row: Its own first; a model with no effort says so")
  func effortWords() throws {
    let catalog = try #require(try AgentModelsResult(json: try workspaceFixture("agent-models.valid")).catalog)
    let opus = try #require(catalog.models.first { $0.id == "opus" })
    let haiku = try #require(catalog.models.first { $0.id == "haiku" })
    #expect(LaunchModel.effortRow(model: nil) == "Its own effort")
    #expect(LaunchModel.effortRow(model: haiku) == "Haiku has no effort setting")
    #expect(LaunchModel.effortRow(model: opus) == nil)
  }
}

@MainActor
@Suite("PJ-7 — the launch sheet asks and launches")
struct LaunchSheetTests {
  @Test("from a project: the recipe's place, profile and model fill the sheet; the spawn names the place by ref")
  func fromAProject() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(projectName: "vibe-field", places: [vibeField, docs, older], recipe: try recipe()))
    #expect(model.place == vibeField)
    #expect(model.selected == studio)
    #expect(!model.needsFolder)
    #expect(model.provider == "claude")
    #expect(model.profileSet == "native", "the recipe's profile is not on this desktop: claude's only one")
    await settle("the models") { model.models != nil }
    #expect(model.modelId == "opus", "the recipe's model")
    #expect(model.effort == "high", "the recipe's effort for opus")
    // switching model brings back that model's own effort
    model.chooseModel("sonnet")
    #expect(model.effort == "low")
    model.chooseModel("haiku")
    #expect(model.effort == nil)
    model.chooseModel("opus")
    #expect(model.effort == "high")
    // agent.models was asked with the agent and the profile, never a folder
    let ask = try #require(desk.last("agent.models")?.params)
    #expect(ask == .object(["provider": .string("claude"), "profileSet": .string("native")]))
    #expect(model.canSpawn)
    #expect(await model.spawn())
    let spawn = try #require(desk.last("agent.spawn"))
    #expect(spawn.device == studio)
    #expect(spawn.params?["place"] == vibeField.ref.json)
    #expect(spawn.params?["cwd"] == nil)
    #expect(spawn.params?["profileSet"] == .string("native"))
    #expect(spawn.params?["modelSelection"] == AgentModelSelection(modelId: "opus", controls: ["effort": "high"]).json)
  }

  @Test("Each agent's own sends no selection; a signed-out agent's models are said, never an empty list")
  func eachAgentsOwn() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(places: [vibeField]))
    await settle("the models") { model.models != nil }
    model.chooseModel(nil)
    #expect(model.effort == nil)
    #expect(await model.spawn())
    #expect(desk.last("agent.spawn")?.params?["modelSelection"] == nil)
    model.provider = "codex"
    await model.providerChanged()
    #expect(model.profileSet == "work", "codex runs under the desktop's default profile")
    await settle("codex's models") { model.models?.provider == "codex" }
    #expect(model.modelRowWords == "Each agent's own · Sign in to see models")
    #expect(model.modelId == nil)
  }

  @Test("no usual place: the folder sheet opens by itself; Browse sends a path and no place")
  func browse() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init())
    #expect(model.place == nil && model.needsFolder)
    #expect(!model.canSpawn)
    let reader = try #require(model.reader)
    let home = try #require(reader.roots.first { $0.browse == "home" })
    await reader.open(home, path: "Projects/project100")
    #expect(model.chooseCurrentFolder())
    #expect(model.place == nil)
    #expect(await model.spawn())
    let spawn = try #require(desk.last("agent.spawn")?.params)
    #expect(spawn["cwd"] == (try workspaceFixture("workspace-list.valid"))["path"])
    #expect(spawn["place"] == nil)
  }

  @Test("a project's place on another desktop brings its desktop; the profile stays when that desktop has it")
  func anotherDesktop() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(places: [vibeField, docs]))
    model.provider = "codex"
    await model.providerChanged()
    #expect(model.profileSet == "work")
    await model.choose(docs)
    #expect(model.selected == laptop)
    #expect(model.place == docs)
    #expect(model.profileSet == "work")
    #expect(model.placesByDesktop.map(\.desktop) == [laptop, studio], "the chosen place's desktop first")
    #expect(await model.spawn())
    #expect(desk.last("agent.spawn")?.device == laptop)
    // a place that cannot take a launch is never chosen
    await model.choose(gone)
    #expect(model.place == docs)
  }

  @Test("the bloom: the desktop and the profile let go on come chosen")
  func fromTheBloom() async throws {
    let desk = Desk()
    let model = desk.launch()
    await model.begin(.init(places: [vibeField, docs], desktop: laptop, profileSet: "work"))
    #expect(model.selected == laptop)
    #expect(model.place == docs, "the newest place on the bloom's desktop")
    model.provider = "codex"
    await model.providerChanged()
    #expect(model.profileSet == "work")
  }
}
