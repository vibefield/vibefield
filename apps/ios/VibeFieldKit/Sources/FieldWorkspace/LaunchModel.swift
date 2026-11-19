import FieldProduct
import Foundation

// PJ-7 (2026-10-14; Q5, Q6, Q7, PJ-D12 (a)) — the launch sheet's DECISIONS as pure functions (DESIGN.md §8, "The
// phone's launch sheet asks two things"). Item 586 (2026-11-19) — the sheet asks where and who: the desktop and the
// Agent Profile are the bloom's, said once in its header; WHERE is the recent places as pills, and Browse; WHO is the
// desktop's agents as buds, one the profile holds no sign-in for dashed and never chosen; no Model and no Effort, so a
// spawn sends no model selection. Every id the agent owns stays opaque (AR-L1): compared to what the wire said, never
// to a literal.

/// A place a launch can name by ref (P1): its folder's name and a branch that
/// says more, its desktop, and why a launch cannot land there when it cannot.
public struct LaunchPlace: Equatable, Sendable, Identifiable {
  public let ref: PlaceRef
  public let name: String
  public let branch: String?
  /// the desktop's device id (the ref's)
  public let desktop: String
  /// `folder gone` · `not connected`, or nil
  public let reason: String?
  public let lastAt: Int64?
  /// its last use in the record's word (`2h`, `yesterday`)
  public let last: String
  /// Item 586 — the folder's absolute path on its desktop, when the answer carried one (P1 (a): an answer to the
  /// person's own devices may). The sheet draws it under the pills and Browse opens beside it; a launch never sends
  /// it, it names the place by its ref.
  public let path: String?

  public var id: String { "\(ref.device)/\(ref.placeId)" }
  public var label: String { branch.map { "\(name) · \($0)" } ?? name }

  public init(
    ref: PlaceRef, name: String, branch: String?, desktop: String, reason: String?, lastAt: Int64?, last: String = "",
    path: String? = nil
  ) {
    self.ref = ref
    self.name = name
    self.branch = branch
    self.desktop = desktop
    self.reason = reason
    self.lastAt = lastAt
    self.last = last
    self.path = path
  }
}

/// Where a launch begins: from a project (its places, its recipe) or from the
/// field's hold and bloom (a desktop, maybe a profile, and every place known).
public struct LaunchContext: Sendable {
  public var projectName: String?
  /// the project's places, which WHERE offers on every desktop (Q7); empty from the field
  public var places: [LaunchPlace]
  /// the places WHERE and the usual place come from (a project's own, or every place known)
  public var usual: [LaunchPlace]
  public var recipe: ProjectRecipe?
  /// the desktop the bloom let go on (nil: the home)
  public var desktop: String?
  /// the profile the bloom let go on
  public var profileSet: String?

  public init(
    projectName: String? = nil, places: [LaunchPlace] = [], usual: [LaunchPlace]? = nil, recipe: ProjectRecipe? = nil,
    desktop: String? = nil, profileSet: String? = nil
  ) {
    self.projectName = projectName
    self.places = places
    self.usual = usual ?? places
    self.recipe = recipe
    self.desktop = desktop
    self.profileSet = profileSet
  }
}

/// Item 586 — one WHERE pill: a place, launched by its ref, or the folder Browse chose, launched by its path (until
/// PJ-8).
public enum LaunchWhere: Equatable, Sendable, Identifiable {
  case place(LaunchPlace)
  case folder(WorkspaceChoice)

  public var id: String {
    switch self {
    case .place(let place): "place:\(place.id)"
    case .folder(let folder): "folder:\(folder.device):\(folder.path)"
    }
  }

  /// the folder's own name: a place's, or the last step of the chosen folder's path
  public var name: String {
    switch self {
    case .place(let place): place.name
    case .folder(let folder): LaunchModel.lastStep(of: folder.path)
    }
  }

  /// the desktop it is on
  public var desktop: String {
    switch self {
    case .place(let place): place.desktop
    case .folder(let folder): folder.device
    }
  }
}

public enum LaunchModel {
  /// Q5 — the agents' own folders, on the phone: every desktop is elsewhere,
  /// and "This Mac" is a desktop's word for itself (SB-D10, 2026-10-14).
  public static let nativeLabel = "Default"
  /// Item 586 — how many recent places WHERE offers, two rows of pills; Browse reaches the rest.
  public static let recentLimit = 4

  /// PJ-D12 (a), PJ-D6 on the phone: the place the project's last launch
  /// entered (the recipe's), if its desktop answers and it can take a launch;
  /// else the newest launchable place on the sheet's desktop; else none, and
  /// Browse opens by itself.
  public static func usualPlace(
    recipe: ProjectRecipe?, places: [LaunchPlace], desktop: String, online: Set<String>
  ) -> LaunchPlace? {
    let launchable = places.filter { $0.reason == nil && online.contains($0.desktop) }
    if let ref = recipe?.place, let last = launchable.first(where: { $0.ref == ref }) { return last }
    return launchable.filter { $0.desktop == desktop }.max { ($0.lastAt ?? 0) < ($1.lastAt ?? 0) }
  }

  /// Item 586 — the places WHERE offers as pills: those that can take a launch, on desktops that answer, newest
  /// first, at most `limit`. From the field, the sheet's desktop's alone (another desktop is another bloom); from a
  /// project, its places on every desktop, the sheet's desktop's first (Q7).
  public static func recentPlaces(
    _ places: [LaunchPlace], desktop: String, online: Set<String>, everyDesktop: Bool,
    limit: Int = LaunchModel.recentLimit
  ) -> [LaunchPlace] {
    let newest = places
      .filter { $0.reason == nil && online.contains($0.desktop) && (everyDesktop || $0.desktop == desktop) }
      .sorted { a, b in
        let (x, y) = (a.lastAt ?? 0, b.lastAt ?? 0)
        return x != y ? x > y : a.id < b.id
      }
    let here = newest.filter { $0.desktop == desktop }
    return Array((here + newest.filter { $0.desktop != desktop }).prefix(limit))
  }

  // MARK: The profile and the agents

  /// The name a profile goes by on the phone: the agents' own folders read Default (Q5).
  public static func profileLabel(_ set: AgentProfileSet) -> String {
    set.kind == "native" ? nativeLabel : set.label
  }

  /// Item 586 — whether a profile can run an agent: the agents' own folders run every agent (Q5); an Agent Profile
  /// runs the agents it holds a sign-in for; with no profile read, the desktop's default decides, so none is refused.
  public static func signedIn(_ agent: String, under profile: AgentProfileSet?) -> Bool {
    guard let profile, profile.kind != "native" else { return true }
    return profile.providers.contains(agent)
  }

  /// Item 586 — the profile a sheet runs under: the first one wanted that the desktop has (a kept one, the bloom's,
  /// the recipe's); else, of the profiles that can run the agent the sheet will want, the desktop's default, else the
  /// agents' own folders, else the first; else the same over every profile. Nil when the desktop named none: the
  /// spawn then names no profile, and the desktop's default runs it.
  public static func sheetProfile(
    _ sets: [AgentProfileSet], wanted: [String?], for agent: String?
  ) -> AgentProfileSet? {
    for id in wanted.compactMap({ $0 }) {
      if let set = sets.first(where: { $0.id == id }) { return set }
    }
    let able = agent.map { agent in sets.filter { signedIn(agent, under: $0) } } ?? []
    for pool in [able, sets] where !pool.isEmpty {
      return pool.first(where: \.isDefault) ?? pool.first { $0.kind == "native" } ?? pool.first
    }
    return nil
  }

  /// Item 586 — the first agent wanted that the desktop offers, whoever runs it: the agent the profile is chosen for.
  public static func wantedAgent(_ agents: [AgentCatalogRow], wanted: [String?]) -> String? {
    wanted.compactMap { $0 }.first { id in agents.contains { $0.id == id } }
  }

  /// Item 586 — the agent a sheet comes chosen with: the first one wanted (the one the sheet had, the recipe's, the
  /// last one this phone started) that the desktop offers and the profile can run; else the first the profile can
  /// run; else the first offered, whose Start is off and says why; nil when the desktop offers none.
  public static func firstAgent(
    _ agents: [AgentCatalogRow], profile: AgentProfileSet?, wanted: [String?]
  ) -> String? {
    let runnable = agents.filter { signedIn($0.id, under: profile) }
    for id in wanted.compactMap({ $0 }) where runnable.contains(where: { $0.id == id }) { return id }
    return (runnable.first ?? agents.first)?.id
  }

  /// fix7, item 586 — what WHO says in the buds' place (nil: the buds): the desktop asleep, the catalog refused or
  /// still being read, or the desktop offering none; never "No agent available" while it has not answered.
  public static func whoRow(
    _ agents: [AgentCatalogRow], read: Bool, failed: Bool, online: Bool, desktop: String
  ) -> String? {
    if !online { return "\(desktop) is asleep" }
    if failed { return "Agents could not be read" }
    if !read { return "Reading agents…" }
    if agents.isEmpty { return "\(desktop) offers no agents to launch" }
    return nil
  }

  /// Item 586 — Start's small line, in the buds' mono: the agent, `STARTING …` while it starts, and why it cannot
  /// run when the sheet's profile holds no sign-in for it.
  public static func startLine(agent: String?, runs: Bool, profile: String, starting: Bool) -> String {
    guard let agent else { return "NO AGENT" }
    if starting { return "STARTING \(agent.uppercased())…" }
    return runs ? agent.uppercased() : "NO SIGN-IN AS \(profile.uppercased())"
  }

  /// Item 586 — Start as a screen reader says it: the whole sentence the pill draws in parts.
  public static func startSentence(agent: String?, folder: String?, starting: Bool) -> String {
    guard let folder else { return "Choose a folder first" }
    guard let agent else { return "No agent to start" }
    return "\(starting ? "Starting" : "Start") \(agent) in \(folder)"
  }

  // MARK: Paths, as the sheet draws them

  /// Item 586 — a desktop's absolute path as the sheet draws it: under the desktop's home, `~` and the rest.
  public static func shown(_ path: String, home: String?) -> String {
    guard let home, !home.isEmpty, path.hasPrefix(home) else { return path }
    let rest = path.dropFirst(home.count)
    guard let first = rest.first else { return "~" }
    return first == "/" || first == "\\" ? "~" + rest : path
  }

  /// Item 586 — the line under the pills: where the chosen folder lives, its branch, its last use.
  public static func whereLine(path: String?, branch: String?, last: String?, home: String?) -> String? {
    let parts = [path.map { shown($0, home: home) }, branch, last].compactMap { $0 }.filter { !$0.isEmpty }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  /// The last step of a path, whichever separator its desktop writes.
  public static func lastStep(of path: String) -> String {
    path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? path
  }

  /// The parent of a path relative to its root (`/`-separated, as the wire's are): "" at the root's top.
  public static func parent(_ relative: String) -> String {
    guard let cut = relative.lastIndex(of: "/") else { return "" }
    return String(relative[..<cut])
  }

  /// Item 586 — where a search hit lives: its parent folder, as the sheet draws paths.
  public static func parentShown(_ path: String, home: String?) -> String {
    guard let cut = path.lastIndex(where: { $0 == "/" || $0 == "\\" }) else { return path }
    let parent = String(path[..<cut])
    return shown(parent.isEmpty ? String(path[...cut]) : parent, home: home)
  }

  // MARK: Browse

  /// One step of Browse's way back: its words, the root it opens (nil: the desktop's places) and the path in it.
  public struct Crumb: Equatable, Sendable {
    public let label: String
    public let rootId: String?
    public let path: String
  }

  /// Where Browse stands: a root of the desktop's and a path in it.
  public struct BrowseAt: Equatable, Sendable {
    public let root: WorkspaceRoot
    public let path: String
  }

  /// Item 586 — Browse's way back: the desktop (its places), the root (`~` for the home), then each folder. Past four
  /// steps and 42 characters the middle folds to `…`, which opens the folder it stands for.
  public static func crumbs(desktop: String, root: WorkspaceRoot?, path: String) -> [Crumb] {
    var steps = [Crumb(label: desktop, rootId: nil, path: "")]
    guard let root else { return steps }
    steps.append(Crumb(label: root.browse == "home" ? "~" : root.name, rootId: root.id, path: ""))
    var walked: [Substring] = []
    for step in path.split(separator: "/") {
      walked.append(step)
      steps.append(Crumb(label: String(step), rootId: root.id, path: walked.joined(separator: "/")))
    }
    let characters = steps.reduce(0) { $0 + $1.label.count + 3 }
    guard steps.count > 4, characters > 42 else { return steps }
    let folded = steps[steps.count - 3]
    return [
      steps[0], Crumb(label: "…", rootId: folded.rootId, path: folded.path), steps[steps.count - 2],
      steps[steps.count - 1],
    ]
  }

  /// Item 586 — the folder Browse is in, as its title: the desktop at its places, a root's own name at its top (the
  /// home reads Home), else the folder's.
  public static func browseTitle(desktop: String, root: WorkspaceRoot?, path: String) -> String {
    guard let root else { return desktop }
    if let step = path.split(separator: "/").last { return String(step) }
    return root.browse == "home" ? "Home" : root.name
  }

  /// Item 586 — where Browse opens: beside the chosen folder, in its parent (a Browse folder under its own root, a
  /// place under the deepest root its path lies in); else at the home's top; nil before the roots are read.
  public static func browseStart(folder: WorkspaceChoice?, placePath: String?, roots: [WorkspaceRoot]) -> BrowseAt? {
    let open = roots.filter { $0.kind != "place" && !$0.missing }
    if let folder, let root = roots.first(where: { $0.id == folder.rootId && !$0.missing }) {
      return BrowseAt(root: root, path: parent(folder.relativePath))
    }
    if let placePath,
      let root = open.filter({ relative(placePath, in: $0.path) != nil }).max(by: { $0.path.count < $1.path.count }),
      let inside = relative(placePath, in: root.path)
    {
      return BrowseAt(root: root, path: parent(inside))
    }
    guard let home = open.first(where: { $0.browse == "home" }) else { return nil }
    return BrowseAt(root: home, path: "")
  }

  /// A path's steps under a root's path, `/`-separated as the wire's relative paths are; nil when it lies elsewhere.
  static func relative(_ path: String, in base: String) -> String? {
    let stem = base.hasSuffix("/") || base.hasSuffix("\\") ? String(base.dropLast()) : base
    if path == base || path == stem { return "" }
    guard path.hasPrefix(stem), let next = path.dropFirst(stem.count).first, next == "/" || next == "\\" else {
      return nil
    }
    return path.dropFirst(stem.count + 1).split(whereSeparator: { $0 == "/" || $0 == "\\" }).joined(separator: "/")
  }

  /// Item 586 — a Browse row's tag: `CHOSEN` for the chosen folder, else a recent place's age (`2H`), else none.
  public static func browseTag(_ path: String, chosen: String?, places: [LaunchPlace]) -> String? {
    if path == chosen { return "CHOSEN" }
    guard let place = places.first(where: { $0.path == path }), !place.last.isEmpty else { return nil }
    return place.last.uppercased()
  }
}
