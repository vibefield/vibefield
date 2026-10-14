import FieldProduct
import Foundation
import Observation

/// A sheet's choices and reads; only the daemon's fold adds a new field row.
///
/// PJ-7 — how it starts: the Agent Profile (`agents.profileSets.list`), the
/// model and its effort (`agent.models {provider, profileSet}`, never a path),
/// and WHERE — a place by its ref (a project's, or the usual one the sheet
/// comes filled with) or, from Browse, a folder by its path (until PJ-8).
/// Every ask goes to the chosen desktop's own door.
@MainActor
@Observable
public final class WorkspaceLaunch {
  public typealias Request = @MainActor (String, String, JSONValue?) async throws -> JSONValue
  public private(set) var desktops: [WorkspaceDesktop]
  public private(set) var selected: String?
  public private(set) var reader: WorkspaceReads?
  public private(set) var agents: [AgentCatalogRow] = []
  public var provider: String = ""
  /// FS-2 — a folder chosen in Browse (its absolute path; sent as `cwd`)
  public private(set) var folder: WorkspaceChoice?
  /// PJ-7 — a place chosen or filled in (sent by its ref, P1)
  public private(set) var place: LaunchPlace?
  public private(set) var context = LaunchContext()
  public private(set) var profileSets: [AgentProfileSet] = []
  public private(set) var profilesRead = false
  public private(set) var profileSet: String?
  public private(set) var models: AgentModelsResult?
  public private(set) var modelsLoading = false
  public private(set) var modelsError: String?
  /// nil: "Each agent's own" — no selection is sent
  public private(set) var modelId: String?
  /// nil: "Its own" — no control is sent
  public private(set) var effort: String?
  public private(set) var spawning = false
  public private(set) var message: String?
  @ObservationIgnored private let request: Request
  @ObservationIgnored private let home: String?
  @ObservationIgnored private var readers: [String: WorkspaceReads] = [:]
  @ObservationIgnored private var epoch = 0
  @ObservationIgnored private var modelsEpoch = 0

  public init(desktops: [WorkspaceDesktop], home: String?, request: @escaping Request) {
    self.desktops = desktops; self.home = home; self.selected = home ?? desktops.first?.id; self.request = request
  }
  public var desktop: WorkspaceDesktop? { desktops.first { $0.id == selected } }
  public var canSpawn: Bool {
    !spawning && desktop?.online == true && (place?.desktop == selected || folder?.device == selected)
      && agents.contains { $0.id == provider && $0.canSpawn }
  }
  /// Nowhere to start yet: the folder sheet opens by itself (PJ-D12 (a)).
  public var needsFolder: Bool { place == nil && folder == nil }

  // MARK: The rows' words (DESIGN.md §8: one answer, or none, said in the row)

  public var profileChoices: [ProfileChoice] { LaunchModel.profileChoices(profileSets, provider: provider) }
  public var profileRowWords: String? {
    profilesRead ? LaunchModel.profileRow(profileChoices, desktop: desktop?.name ?? "this desktop") : "Reading profiles…"
  }
  public var modelChoices: [AgentModelChoice] { models?.catalog?.models ?? [] }
  public var model: AgentModelChoice? { modelChoices.first { $0.id == modelId } }
  public var modelRowWords: String? { LaunchModel.modelRow(models, loading: modelsLoading, error: modelsError) }
  public var effortRowWords: String? { LaunchModel.effortRow(model: model) }
  /// The footer: a refusal first, else how old the models' read is.
  public var footer: String {
    message ?? LaunchModel.modelsAge(models, now: Date()) ?? "The agent opens in the folder you choose."
  }

  /// Q7 — a project's places by desktop for the folder sheet: the chosen
  /// desktop's first, then the home's, then the rest as the project lists them.
  public var placesByDesktop: [(desktop: String, places: [LaunchPlace])] {
    var order: [String] = []
    for id in [selected, home].compactMap({ $0 }) where !order.contains(id) { order.append(id) }
    for place in context.places where !order.contains(place.desktop) { order.append(place.desktop) }
    return order.compactMap { id in
      let places = context.places.filter { $0.desktop == id }
      return places.isEmpty ? nil : (id, places)
    }
  }

  private var online: Set<String> { Set(desktops.filter(\.online).map(\.id)) }
  /// The recipe, when it is this agent's (its profile and models are its own).
  private var recipe: ProjectRecipe? { context.recipe?.provider == provider ? context.recipe : nil }

  public func update(_ desktops: [WorkspaceDesktop]) {
    self.desktops = desktops
    for (id, reader) in readers { reader.setOnline(desktops.first { $0.id == id }?.online == true) }
  }

  // MARK: Beginning a launch

  /// A new launch: where it begins, and the place the folder row comes filled
  /// with (synchronously, so the sheet knows at once whether to open the
  /// folder sheet by itself). `select` reads the rest.
  public func prepare(_ context: LaunchContext) {
    guard !spawning else { return }
    self.context = context
    folder = nil; message = nil; provider = ""
    let desk = context.desktop ?? home ?? selected ?? ""
    place = LaunchModel.usualPlace(recipe: context.recipe, places: context.usual, desktop: desk, online: online)
    selected = place?.desktop ?? (desktops.contains { $0.id == desk } ? desk : selected)
  }

  public func begin(_ context: LaunchContext) async {
    prepare(context)
    if let selected { await select(selected) }
  }

  public func select(_ device: String, keeping kept: String? = nil) async {
    guard !spawning, let desktop = desktops.first(where: { $0.id == device }) else { return }
    epoch += 1; let ticket = epoch
    let previous = provider
    if selected != device { folder = nil }
    if place?.desktop != device { place = nil }
    selected = device; agents = []; provider = ""; message = nil
    profileSets = []; profilesRead = false; profileSet = nil
    models = nil; modelsError = nil; modelId = nil; effort = nil
    let reader = readers[device] ?? WorkspaceReads(device: device, name: desktop.name) { [request] method, params in
      try await request(device, method, params)
    }
    readers[device] = reader; self.reader = reader
    reader.setOnline(desktop.online)
    await reader.refreshRoots()
    guard ticket == epoch, desktop.online, !Task.isCancelled else { return }
    do {
      let catalog = try AgentCatalogResult(json: await request(device, "agent.catalog", AgentCatalogParams.phone.json))
      guard ticket == epoch, !Task.isCancelled else { return }
      agents = catalog.catalog.filter { $0.canSpawn && $0.phone != false }
      // the agent already chosen stays when this desktop offers it, else the recipe's
      provider = (agents.first { $0.id == previous } ?? agents.first { $0.id == context.recipe?.provider })?.id
        ?? agents.first?.id ?? ""
      if agents.isEmpty { message = "This desktop offers no agents to launch" }
    } catch {
      if ticket == epoch { message = (error as? FieldProductError)?.message ?? String(describing: error) }
      return
    }
    do {
      let sets = try AgentProfileSetsResult(json: await request(device, "agents.profileSets.list", nil))
      guard ticket == epoch, !Task.isCancelled else { return }
      profileSets = sets.sets
    } catch {
      // unreadable profiles: the spawn names none, and the desktop's default runs it
      guard ticket == epoch else { return }
    }
    profilesRead = true
    profileSet = LaunchModel.firstProfile(profileChoices, wanted: [kept, recipe?.profileSet, context.profileSet])
    await readModels()
  }

  /// Q7 — a place chosen in the folder sheet; one on another desktop brings
  /// its desktop, and the profile stays when that desktop has it.
  public func choose(_ place: LaunchPlace) async {
    guard !spawning, place.reason == nil, online.contains(place.desktop) else { return }
    if place.desktop != selected {
      let kept = profileSet
      self.place = place
      await select(place.desktop, keeping: kept)
    }
    self.place = place
    folder = nil; message = nil
  }

  public func chooseCurrentFolder() -> Bool {
    guard let choice = reader?.choice, choice.device == selected else { return false }
    folder = choice; place = nil; message = nil; return true
  }

  // MARK: How it starts

  /// The agent changed: its profiles and its models are its own.
  public func providerChanged() async {
    modelId = nil; effort = nil
    profileSet = LaunchModel.firstProfile(profileChoices, wanted: [recipe?.profileSet, context.profileSet])
    await readModels()
  }

  public func chooseProfile(_ id: String) async {
    guard profileChoices.contains(where: { $0.id == id }), id != profileSet else { return }
    profileSet = id
    modelId = nil; effort = nil
    await readModels()
  }

  /// A model (nil: "Each agent's own"): its effort comes back as the project
  /// last ran it, else its own.
  public func chooseModel(_ id: String?) {
    modelId = id.flatMap { id in modelChoices.contains { $0.id == id } ? id : nil }
    effort = model.flatMap { LaunchModel.effort(for: $0, recipe: recipe) }
  }

  public func chooseEffort(_ value: String?) {
    effort = value.flatMap { value in model?.effort?.values.contains { $0.id == value } == true ? value : nil }
  }

  private func readModels() async {
    guard let device = selected, !provider.isEmpty, online.contains(device) else { return }
    modelsEpoch += 1; let ticket = modelsEpoch
    modelsLoading = true; models = nil; modelsError = nil
    defer { if ticket == modelsEpoch { modelsLoading = false } }
    do {
      let answer = try AgentModelsResult(
        json: await request(device, "agent.models", AgentModelsParams(provider: provider, profileSet: profileSet).json))
      guard ticket == modelsEpoch, !Task.isCancelled else { return }
      models = answer
      if modelId == nil, let wanted = recipe?.selection?.modelId { chooseModel(wanted) }
    } catch {
      guard ticket == modelsEpoch else { return }
      modelsError = (error as? FieldProductError)?.message ?? "Models could not be read"
    }
  }

  // MARK: The launch

  /// The selection a spawn carries: none for "Each agent's own"; the model
  /// and, when chosen, its effort control — every id the agent's own.
  public var selection: AgentModelSelection? {
    guard let modelId else { return nil }
    var controls: [String: String] = [:]
    if let effort, let control = model?.effort { controls[control.id] = effort }
    return AgentModelSelection(modelId: modelId, controls: controls)
  }

  /// Non-idempotent: one tap, one ask. A lost reply is never retried here.
  public func spawn() async -> Bool {
    guard canSpawn, let device = selected else { return false }
    let params =
      if let place {
        AgentSpawnParams(provider: provider, place: place.ref, profileSet: profileSet, modelSelection: selection)
      } else {
        AgentSpawnParams(provider: provider, cwd: folder?.path, profileSet: profileSet, modelSelection: selection)
      }
    spawning = true; message = nil
    defer { spawning = false }
    do {
      let result = try await request(device, "agent.spawn", params.json)
      guard result["session"]?["runtimeRunId"]?.stringValue != nil else {
        throw WireDecodeError(shape: "agent.spawn", reason: "missing run receipt")
      }
      return true
    } catch {
      if let refusal = error as? FieldProductError, ["UNAVAILABLE", "TIMEOUT"].contains(refusal.kind) {
        message = "The desktop did not confirm the launch. Check the field before trying again."
      } else { message = (error as? FieldProductError)?.message ?? String(describing: error) }
      return false
    }
  }
}
