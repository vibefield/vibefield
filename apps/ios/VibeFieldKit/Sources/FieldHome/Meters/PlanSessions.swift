import FieldProduct
import Foundation

// UM-5b (UM-D14; DESIGN.md §8 "The phone's corner") — WHICH PLAN A SESSION SPENDS, the desktop's join on the phone
// (`packages/field-app/src/usage/plan-sessions.ts`, held to it by `BandsParityTests`): a run's Agent Profile set and
// agent name the persona (a set holds one account per agent), the sign-in it runs on decides its plan, and a key beside
// a held plan spends none. A plan two profiles share is one filter (`family`).

enum PlanSessions {
  private static func planKeyOf(_ setId: String, _ planId: String) -> String { "\(setId)/plan:\(planId)" }
  private static func agentKeyOf(_ setId: String, _ profileId: String) -> String { "\(setId)/agent:\(profileId)" }
  private static func runId(_ setId: String, _ provider: String) -> String { "\(setId)\u{0}\(provider)" }

  /// The plan a run spends, as the union keys it (`‹set›/plan:‹id›`, `‹set›/agent:‹profileId›`), or nil: no set, no
  /// agent (a terminal), or pay per use.
  static func planKey(_ sets: [AgentProfileSet], profileSet: String?, provider: String?) -> String? {
    guard let profileSet, let provider, let set = sets.first(where: { $0.id == profileSet }),
      let persona = set.personas.first(where: { $0.provider == provider })
    else { return nil }
    let holding = persona.holds?.first { $0.runsOn }
    if let planId = holding?.planId { return planKeyOf(set.id, planId) }
    let held = set.plans?.first { $0.holders.contains(persona.profileId) }
    if holding != nil { return held == nil ? agentKeyOf(set.id, persona.profileId) : nil }
    return held.map { planKeyOf(set.id, $0.id) } ?? agentKeyOf(set.id, persona.profileId)
  }

  /// The plan and its twins in other profiles, sorted (`everyPlan`'s rule); an agent's row, a plan with nothing to
  /// share, and a key the sets do not hold are their own family.
  static func family(_ sets: [AgentProfileSet], key: String) -> [String] {
    struct Member {
      let set: AgentProfileSet
      let plan: AgentPlan
    }
    let start = sets.flatMap { set in
      (set.plans ?? []).filter { planKeyOf(set.id, $0.id) == key }.map { Member(set: set, plan: $0) }
    }.first
    guard let start, let shared = MeterModel.sharedKey(start.plan) else { return [key] }
    var members = [start]
    var index = 0
    while index < members.count {
      let member = members[index]
      index += 1
      for set in sets where member.plan.alsoIn.contains(set.id) {
        for plan in set.plans ?? [] where MeterModel.sharedKey(plan) == shared {
          if !members.contains(where: { $0.set.id == set.id && $0.plan.id == plan.id }) {
            members.append(Member(set: set, plan: plan))
          }
        }
      }
    }
    return members.map { planKeyOf($0.set.id, $0.plan.id) }.sorted()
  }

  /// Every run on the family, as a value-stable string (sorted, joined), like the desktop's.
  static func runs(_ sets: [AgentProfileSet], key: String) -> String {
    let keys = Set(family(sets, key: key))
    var pairs: [String] = []
    for set in sets {
      for persona in set.personas {
        guard let found = planKey(sets, profileSet: set.id, provider: persona.provider), keys.contains(found) else {
          continue
        }
        pairs.append(runId(set.id, persona.provider))
      }
    }
    return pairs.sorted().joined(separator: "\n")
  }

  /// A key the sets still hold: a plan's id, or an agent on no plan (`meters.ts`'s own rows).
  static func stands(_ sets: [AgentProfileSet], key: String) -> Bool {
    sets.contains { set in
      guard key.hasPrefix("\(set.id)/") else { return false }
      if (set.plans ?? []).contains(where: { planKeyOf(set.id, $0.id) == key }) { return true }
      return set.personas.contains { persona in
        agentKeyOf(set.id, persona.profileId) == key
          && !(set.plans ?? []).contains { $0.holders.contains(persona.profileId) }
      }
    }
  }

  /// A plan chosen, as the token, the page and search say it.
  struct Choice: Equatable {
    let key: String
    /// as the meters title it
    let label: String
    let provider: String
    let family: [String]
    let runs: String
  }

  /// The choice a key stands for, or nil for one the sets no longer hold.
  static func choice(_ sets: [AgentProfileSet], key: String, options: MetersOptions) -> Choice? {
    for set in sets where key.hasPrefix("\(set.id)/") {
      let bare = String(key.dropFirst(set.id.count + 1))
      let meters = MeterModel.planMeters(set, rows: [], now: Date(timeIntervalSince1970: 0), options: options)
      guard let entry = meters.entries.first(where: { $0.key == bare }) else { continue }
      let family = family(sets, key: key)
      return Choice(key: key, label: entry.title, provider: entry.provider, family: family, runs: runs(sets, key: key))
    }
    return nil
  }

  /// Whether a plan or its twin is in a profile: what a lens keeps, and what choosing a plan under a lens keeps.
  static func isIn(_ sets: [AgentProfileSet], key: String, setId: String) -> Bool {
    family(sets, key: key).contains { $0.hasPrefix("\(setId)/") }
  }

  /// What is chosen on the field, as what recedes reads it: the profile and the plan's runs. A bare string is a lens on
  /// that profile, and `nil` nothing chosen, so the views' tests read as before.
  struct Lens: Equatable, Sendable, ExpressibleByStringLiteral, ExpressibleByNilLiteral {
    var profile: String?
    /// `runs`'s pairs; nil, no plan chosen
    var planRuns: Set<String>?

    init(profile: String? = nil, planRuns: Set<String>? = nil) {
      self.profile = profile
      self.planRuns = planRuns
    }

    init(stringLiteral value: String) { self.init(profile: value) }
    init(nilLiteral: ()) { self.init() }

    static let none = Lens()
  }

  /// The one predicate a live row and a swarm body both call: a chosen profile keeps the home's rows under it, a chosen
  /// plan the runs on it, so under a plan a peer's run and a terminal recede (they spend no plan of this home's).
  static func recedes(_ lens: Lens, isSelf: Bool, profileSet: String?, provider: String?) -> Bool {
    if let profile = lens.profile, !(isSelf && profileSet == profile) { return true }
    guard let planRuns = lens.planRuns else { return false }
    guard isSelf, let profileSet, let provider else { return true }
    return !planRuns.contains(runId(profileSet, provider))
  }
}
