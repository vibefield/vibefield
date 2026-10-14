import FieldProduct
import Foundation

// PJ-7 (2026-10-14; Q5, Q6, Q7, PJ-D12 (a)) — the launch sheet's DECISIONS as
// pure functions (DESIGN.md §8's FS-2 entry, its PJ-7 paragraph): which place
// the folder row comes filled with, which Agent Profiles can run the agent and
// what the native one is called on the phone, what the Model and Effort rows
// say when there is no real choice, and how old the models' read is. Every id
// the agent owns stays opaque (AR-L1): compared to what the wire said, never
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

  public var id: String { "\(ref.device)/\(ref.placeId)" }
  public var label: String { branch.map { "\(name) · \($0)" } ?? name }

  public init(
    ref: PlaceRef, name: String, branch: String?, desktop: String, reason: String?, lastAt: Int64?, last: String = ""
  ) {
    self.ref = ref
    self.name = name
    self.branch = branch
    self.desktop = desktop
    self.reason = reason
    self.lastAt = lastAt
    self.last = last
  }
}

/// Where a launch begins: from a project (its places, its recipe) or from the
/// field's hold and bloom (a desktop, maybe a profile, and every place known).
public struct LaunchContext: Sendable {
  public var projectName: String?
  /// the project's places, which the folder sheet lists first (Q7); empty from the field
  public var places: [LaunchPlace]
  /// the places the folder row may come filled with (a project's own, or every place known)
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

/// One Agent Profile as the Profile row offers it.
public struct ProfileChoice: Equatable, Sendable, Identifiable {
  public let id: String
  public let label: String
  public let isDefault: Bool
  public let isNative: Bool
}

public enum LaunchModel {
  /// Q5 — the agents' own folders, on the phone: every desktop is elsewhere,
  /// and "This Mac" is a desktop's word for itself (SB-D10, James's word).
  public static let nativeLabel = "Default"

  /// PJ-D12 (a), PJ-D6 on the phone: the place the project's last launch
  /// entered (the recipe's), if its desktop answers and it can take a launch;
  /// else the newest launchable place on the sheet's desktop; else none, and
  /// the folder sheet opens by itself.
  public static func usualPlace(
    recipe: ProjectRecipe?, places: [LaunchPlace], desktop: String, online: Set<String>
  ) -> LaunchPlace? {
    let launchable = places.filter { $0.reason == nil && online.contains($0.desktop) }
    if let ref = recipe?.place, let last = launchable.first(where: { $0.ref == ref }) { return last }
    return launchable.filter { $0.desktop == desktop }.max { ($0.lastAt ?? 0) < ($1.lastAt ?? 0) }
  }

  /// The profiles that can run `provider`: the agents' own folders (named
  /// Default) and every Agent Profile holding a sign-in for it, in the
  /// desktop's order.
  public static func profileChoices(_ sets: [AgentProfileSet], provider: String) -> [ProfileChoice] {
    sets.filter { $0.kind == "native" || $0.providers.contains(provider) }.map { set in
      ProfileChoice(
        id: set.id, label: set.kind == "native" ? nativeLabel : set.label, isDefault: set.isDefault,
        isNative: set.kind == "native")
    }
  }

  /// The profile a sheet starts on: the first one wanted that can run the
  /// agent (a kept choice, the recipe's, the bloom's), else the desktop's
  /// default profile, else the agents' own folders.
  public static func firstProfile(_ choices: [ProfileChoice], wanted: [String?]) -> String? {
    for id in wanted.compactMap({ $0 }) where choices.contains(where: { $0.id == id }) { return id }
    return (choices.first(where: \.isDefault) ?? choices.first(where: \.isNative) ?? choices.first)?.id
  }

  /// The Profile row's quiet fact when there is no real choice; nil: a menu.
  public static func profileRow(_ choices: [ProfileChoice], desktop: String) -> String? {
    switch choices.count {
    case 0: "The desktop's default profile"
    case 1: "\(choices[0].label) — the only profile on \(desktop)"
    default: nil
    }
  }

  /// fix7 — the Agent row's quiet fact (nil: several agents, a menu): what
  /// is being read is said, a refusal is said, and "No agent available" only
  /// when the desktop answered with none.
  public static func agentRow(_ agents: [AgentCatalogRow], read: Bool, failed: Bool, online: Bool) -> String? {
    if !online { return "Its desktop is not connected" }
    if failed { return "Agents could not be read" }
    if !read { return "Reading agents…" }
    if agents.count > 1 { return nil }
    return agents.first?.label ?? "No agent available"
  }

  /// A failed models read, in words: a signed-out agent says how to fix it.
  public static func modelsNote(_ answer: AgentModelsResult?) -> String? {
    guard let failure = answer?.failure else { return nil }
    if failure.status == "auth-required" { return "Sign in to see models" }
    return failure.message.isEmpty ? "Models could not be read" : failure.message
  }

  /// The Model row's quiet fact when there is no real choice; nil: a menu
  /// ("Each agent's own" first, then the picker).
  public static func modelRow(_ answer: AgentModelsResult?, loading: Bool, error: String? = nil) -> String? {
    if let models = answer?.catalog?.models, !models.isEmpty { return nil }
    if let note = modelsNote(answer) ?? error { return "Each agent's own · \(note)" }
    if loading || answer == nil { return "Each agent's own · reading models…" }
    return "Each agent's own — the only choice"
  }

  /// An ISO stamp as a date.
  public static func date(_ iso: String?) -> Date? {
    guard let iso else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: iso) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: iso)
  }

  /// `models read 2h ago` — the catalog's age, for the footer.
  public static func modelsAge(_ answer: AgentModelsResult?, now: Date) -> String? {
    guard let observed = date(answer?.catalog?.observedAt) else { return nil }
    let minutes = max(0, Int(now.timeIntervalSince(observed) / 60))
    let ago =
      if minutes < 1 { "just now" }
      else if minutes < 60 { "\(minutes)m ago" }
      else if minutes < 60 * 24 { "\(minutes / 60)h ago" }
      else { "\(minutes / (60 * 24))d ago" }
    return "models read \(ago)"
  }

  /// The Effort row's quiet fact; nil: a menu ("Its own" first, then the
  /// model's own values).
  public static func effortRow(model: AgentModelChoice?) -> String? {
    guard let model else { return "Its own effort" }
    if model.effort?.values.isEmpty ?? true { return "\(model.label) has no effort setting" }
    return nil
  }

  /// Q3 of 10-12 — the effort the project last ran this model at (the
  /// recipe's `controlsByModel`), when the model still offers it.
  public static func effort(for model: AgentModelChoice, recipe: ProjectRecipe?) -> String? {
    guard let control = model.effort, let value = recipe?.controlsByModel[model.id]?[control.id],
      control.values.contains(where: { $0.id == value })
    else { return nil }
    return value
  }
}
