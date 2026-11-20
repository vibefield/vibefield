import FieldProduct
import Foundation
import Observation

/// A sheet's choices and reads; only the daemon's fold adds a new field row.
///
/// Item 586 (2026-11-19) — what a launch carries: WHERE, a place by its ref (a pill: a project's place, or the newest
/// on the sheet's desktop) or a folder by its path (Browse's, until PJ-8); WHO, an agent of the desktop's catalog that
/// the sheet's profile can run; and the Agent Profile, the bloom's (else the recipe's, else one that runs the agent),
/// which the sheet says and never offers. No model selection is sent: each agent runs its own (PJ-7's Model and Effort
/// rows left with the redesign). Every ask goes to the chosen desktop's own door. Item 587 (2026-11-19) — Terminal asks
/// that same door for a shell in the chosen folder under the profile, never another desktop's.
@MainActor
@Observable
public final class WorkspaceLaunch {
  public typealias Request = @MainActor (String, String, JSONValue?) async throws -> JSONValue
  public private(set) var desktops: [WorkspaceDesktop]
  public private(set) var selected: String?
  public private(set) var reader: WorkspaceReads?
  public private(set) var agents: [AgentCatalogRow] = []
  /// fix7 — the chosen desktop's agents were asked and answered (or refused):
  /// until then WHO says it is reading, never "No agent available"
  public private(set) var agentsRead = false
  /// fix7 — the agents could not be read (the sheet says fieldd's words)
  public private(set) var agentsFailed = false
  /// the chosen agent's catalog id ("" for none)
  public private(set) var provider: String = ""
  /// FS-2 — a folder chosen in Browse (its absolute path; sent as `cwd`), while it is the chosen one
  public private(set) var folder: WorkspaceChoice?
  /// Item 586 — the folder Browse chose, which leads WHERE while the sheet stays on its desktop
  public private(set) var picked: WorkspaceChoice?
  /// PJ-7 — a place chosen or filled in (sent by its ref, P1)
  public private(set) var place: LaunchPlace?
  public private(set) var context = LaunchContext()
  public private(set) var profileSets: [AgentProfileSet] = []
  public private(set) var profilesRead = false
  public private(set) var profileSet: String?
  public private(set) var spawning = false
  /// Item 587 — Terminal's ask, while it is out
  public private(set) var opening = false
  public private(set) var message: String?
  /// Item 586 — the agent this phone last started, which a sheet comes chosen with next (kept while the app runs)
  public private(set) var lastProvider: String?
  @ObservationIgnored private let request: Request
  @ObservationIgnored private let home: String?
  @ObservationIgnored private var readers: [String: WorkspaceReads] = [:]
  @ObservationIgnored private var epoch = 0

  public init(desktops: [WorkspaceDesktop], home: String?, request: @escaping Request) {
    self.desktops = desktops; self.home = home; self.selected = home ?? desktops.first?.id; self.request = request
  }
  public var desktop: WorkspaceDesktop? { desktops.first { $0.id == selected } }
  /// the profile the sheet runs under, as the desktop named it
  public var profile: AgentProfileSet? { profileSets.first { $0.id == profileSet } }
  /// the chosen agent's row
  public var agent: AgentCatalogRow? { agents.first { $0.id == provider } }
  /// Item 586 — whether the sheet's profile can run an agent: a bud it holds no sign-in for is never chosen
  public func runs(_ agent: AgentCatalogRow) -> Bool { LaunchModel.signedIn(agent.id, under: profile) }
  /// Item 587 — one ask at a time: while Start or Terminal asks, the other is off and the sheet's choices hold.
  public var busy: Bool { spawning || opening }
  public var canSpawn: Bool {
    !busy && desktop?.online == true && (place?.desktop == selected || folder?.device == selected)
      && agent.map { $0.canSpawn && runs($0) } == true
  }
  /// Item 587 (2026-11-19) — Terminal can ask: the chosen folder on the sheet's desktop, which answers (a place on the
  /// desktop its ref names), under a profile already read. A shell never goes without its profile.
  public var canOpenShell: Bool {
    !busy && desktop?.online == true && profilesRead && profileSet != nil
      && (place.map { $0.ref.device == selected } ?? (folder?.device == selected))
  }
  /// Nowhere to start yet: Browse opens by itself (PJ-D12 (a)).
  public var needsFolder: Bool { place == nil && folder == nil }

  // MARK: What the sheet says (DESIGN.md §8: a part says what it waits on)

  /// Item 586 — the header's mono line: the profile the sheet runs under (`AS WORK`), or that it is being read.
  public var profileWords: String? {
    guard desktop?.online == true, !agentsFailed else { return nil }
    guard profilesRead else { return "READING PROFILES…" }
    return profile.map { "AS \(LaunchModel.profileLabel($0).uppercased())" } ?? "AS THE DESKTOP'S DEFAULT"
  }
  /// fix7, item 586 — WHO's words in the buds' place (nil: the buds)
  public var whoWords: String? {
    LaunchModel.whoRow(
      agents, read: agentsRead, failed: agentsFailed, online: desktop?.online == true,
      desktop: desktop?.name ?? "This desktop")
  }
  /// Item 586 — WHERE's pills: the folder Browse chose first, then the recent places, the chosen place among them
  /// even when it is older than the newest four.
  public var whereChoices: [LaunchWhere] {
    guard let selected else { return [] }
    var places = LaunchModel.recentPlaces(
      context.usual, desktop: selected, online: online, everyDesktop: !context.places.isEmpty)
    if let place, !places.contains(place) { places.insert(place, at: 0) }
    let browsed = picked.flatMap { $0.device == selected ? LaunchWhere.folder($0) : nil }
    return (browsed.map { [$0] } ?? []) + places.map { LaunchWhere.place($0) }
  }
  /// the chosen pill
  public var chosen: LaunchWhere? { place.map { LaunchWhere.place($0) } ?? folder.map { LaunchWhere.folder($0) } }
  /// the home's path on the sheet's desktop, which the sheet draws as `~`
  public var homePath: String? { reader?.roots.first { $0.browse == "home" }?.path }
  /// the chosen folder's absolute path, where it is known
  public var chosenPath: String? { place?.path ?? folder?.path }
  /// Item 586 — the line under the pills: where the chosen folder lives, its branch, its last use
  public var whereLine: String? {
    if let place {
      return LaunchModel.whereLine(path: place.path, branch: place.branch, last: place.last, home: homePath)
    }
    return folder.flatMap { LaunchModel.whereLine(path: $0.path, branch: nil, last: nil, home: homePath) }
  }
  /// Item 586 — the places known on the sheet's desktop, whose ages Browse's rows wear
  public var placesHere: [LaunchPlace] { context.usual.filter { $0.desktop == selected } }
  /// Item 586 — where Browse opens: beside the chosen folder, else at the home's top
  public var browseStart: LaunchModel.BrowseAt? {
    LaunchModel.browseStart(folder: folder, placePath: place?.path, roots: reader?.roots ?? [])
  }
  /// Item 586 — Start's small line: the agent, why it cannot run, or that it is starting
  public var startLine: String {
    LaunchModel.startLine(
      agent: agent?.label, runs: agent.map { runs($0) } ?? true,
      profile: profile.map { LaunchModel.profileLabel($0) } ?? LaunchModel.nativeLabel, starting: spawning)
  }
  /// Item 586 — Start as a screen reader says it
  public var startSentence: String {
    LaunchModel.startSentence(agent: agent?.label, folder: chosen?.name, starting: spawning)
  }
  /// Item 587 — Terminal as a screen reader says it
  public var shellSentence: String { LaunchModel.shellSentence(folder: chosen?.name, opening: opening) }

  private var online: Set<String> { Set(desktops.filter(\.online).map(\.id)) }

  public func update(_ desktops: [WorkspaceDesktop]) {
    self.desktops = desktops
    for (id, reader) in readers { reader.setOnline(desktops.first { $0.id == id }?.online == true) }
  }

  // MARK: Beginning a launch

  /// A new launch: where it begins, and the place WHERE comes filled with
  /// (synchronously, so the sheet knows at once whether Browse opens by
  /// itself). `select` reads the rest.
  public func prepare(_ context: LaunchContext) {
    guard !busy else { return }
    self.context = context
    folder = nil; picked = nil; message = nil; provider = ""
    let desk = context.desktop ?? home ?? selected ?? ""
    place = LaunchModel.usualPlace(recipe: context.recipe, places: context.usual, desktop: desk, online: online)
    selected = place?.desktop ?? (desktops.contains { $0.id == desk } ? desk : selected)
  }

  public func begin(_ context: LaunchContext) async {
    prepare(context)
    if let selected { await select(selected) }
  }

  public func select(_ device: String, keeping kept: String? = nil) async {
    guard !busy, let desktop = desktops.first(where: { $0.id == device }) else { return }
    epoch += 1; let ticket = epoch
    let previous = provider
    if selected != device { folder = nil; picked = nil }
    if place?.desktop != device { place = nil }
    selected = device; agents = []; agentsRead = false; agentsFailed = false; provider = ""; message = nil
    profileSets = []; profilesRead = false; profileSet = nil
    let reader = readers[device] ?? WorkspaceReads(device: device, name: desktop.name) { [request] method, params in
      try await request(device, method, params)
    }
    readers[device] = reader; self.reader = reader
    reader.setOnline(desktop.online)
    // fix7 — the folder roots are the FILES worker's to answer, and a busy one
    // (a drive something writes a lot to) held every row behind them for the
    // call's whole 20 s: they are read beside the agents, never before them
    let roots = Task { await reader.refreshRoots() }
    guard desktop.online, !Task.isCancelled else { return }
    // the agent the sheet had (a desktop changed under it), the recipe's, the last one started
    let wanted = [previous.isEmpty ? nil : previous, context.recipe?.provider, lastProvider]
    do {
      let catalog = try AgentCatalogResult(json: await request(device, "agent.catalog", AgentCatalogParams.phone.json))
      guard ticket == epoch, !Task.isCancelled else { return }
      agentsRead = true
      agents = catalog.catalog.filter { $0.canSpawn && $0.phone != false }
      // a bud comes chosen at once; the profile, read next, may move it to one the profile runs
      provider = LaunchModel.firstAgent(agents, profile: nil, wanted: wanted) ?? ""
    } catch {
      if ticket == epoch {
        agentsRead = true; agentsFailed = true
        message = (error as? FieldProductError)?.message ?? String(describing: error)
      }
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
    profileSet = LaunchModel.sheetProfile(
      profileSets, wanted: [kept, context.profileSet, context.recipe?.profileSet],
      for: LaunchModel.wantedAgent(agents, wanted: wanted))?.id
    provider = LaunchModel.firstAgent(agents, profile: profile, wanted: wanted) ?? ""
    // the sheet's reads end with its roots (Browse's first page)
    await roots.value
  }

  // MARK: Where and who

  /// Q7 — a place chosen in WHERE; one on another desktop brings its desktop, and the profile and the agent stay
  /// when that desktop has them.
  public func choose(_ place: LaunchPlace) async {
    guard !busy, place.reason == nil, online.contains(place.desktop) else { return }
    if place.desktop != selected {
      let kept = profileSet
      self.place = place
      await select(place.desktop, keeping: kept)
    }
    self.place = place
    folder = nil; message = nil
  }

  /// Item 586 — a WHERE pill chosen: a place, or the folder Browse chose.
  public func choose(_ choice: LaunchWhere) async {
    switch choice {
    case .place(let place): await choose(place)
    case .folder(let folder):
      guard !busy, folder.device == selected, folder == picked else { return }
      self.folder = folder; place = nil; message = nil
    }
  }

  /// Browse's Use: the folder Browse is in becomes the chosen one, and leads WHERE.
  public func chooseCurrentFolder() -> Bool {
    guard !busy, let choice = reader?.choice, choice.device == selected else { return false }
    folder = choice; picked = choice; place = nil; message = nil
    return true
  }

  /// Item 586 — a bud chosen: an agent the desktop offers and the sheet's profile can run.
  public func chooseAgent(_ id: String) {
    guard !busy, let row = agents.first(where: { $0.id == id }), runs(row) else { return }
    provider = id; message = nil
  }

  // MARK: The launch

  /// Non-idempotent: one tap, one ask. A lost reply is never retried here.
  public func spawn() async -> Bool {
    guard canSpawn, let device = selected else { return false }
    let params =
      if let place {
        AgentSpawnParams(provider: provider, place: place.ref, profileSet: profileSet)
      } else {
        AgentSpawnParams(provider: provider, cwd: folder?.path, profileSet: profileSet)
      }
    spawning = true; message = nil
    defer { spawning = false }
    do {
      let result = try await request(device, "agent.spawn", params.json)
      guard result["session"]?["runtimeRunId"]?.stringValue != nil else {
        throw WireDecodeError(shape: "agent.spawn", reason: "missing run receipt")
      }
      lastProvider = provider
      return true
    } catch {
      if let refusal = error as? FieldProductError, ["UNAVAILABLE", "TIMEOUT"].contains(refusal.kind) {
        message = LaunchModel.unconfirmed
      } else { message = (error as? FieldProductError)?.message ?? String(describing: error) }
      return false
    }
  }

  /// Item 587 (2026-11-19) — Terminal: a shell in the chosen folder under the sheet's profile, asked of the desktop the
  /// place's ref names (`terminal.create` is local to its device, D36). Non-idempotent, as Start: one tap, one ask, a
  /// lost reply never retried here. A refusal is said in the sheet's words (`LaunchModel.shellRefusal`).
  public func openTerminal() async -> Bool {
    guard canOpenShell, let device = place?.ref.device ?? selected, let profileSet else { return false }
    let at: TerminalCreateParams.Folder
    if let place {
      at = .place(place.ref)
    } else if let path = folder?.path {
      at = .cwd(path)
    } else {
      return false
    }
    opening = true; message = nil
    defer { opening = false }
    do {
      let result = try await request(device, "terminal.create", TerminalCreateParams(at, profileSet: profileSet).json)
      guard result["sessionId"]?.stringValue != nil else {
        throw WireDecodeError(shape: "terminal.create", reason: "missing session id")
      }
      return true
    } catch {
      message =
        (error as? FieldProductError).map { LaunchModel.shellRefusal($0, desktop: desktop?.name) }
        ?? String(describing: error)
      return false
    }
  }
}

/// fix7 — the sheet is presented BY its model (`.sheet(item:)`): a sheet asked
/// to open with no model drew an empty container on the first launch.
extension WorkspaceLaunch: Identifiable {}
