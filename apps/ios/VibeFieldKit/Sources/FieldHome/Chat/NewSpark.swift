import FieldDesign
import FieldProduct
import FieldWorkspace
import Foundation

// IOS-12f (PC-D8 A, PC-L1, one Chat; NS-D1 A, NS-D2 B, NS-D5; DESIGN.md §8 "The phone's Chat", New spark) — THE NEW
// SPARK SHEET'S MODEL, the Mac's (`field-app/src/chat/new-spark.ts`) ported: what the sheet suggests, which agents
// can be a spark, the agent menu and its Effort, the pill's words, the profiles' chips and reach, and where a refusal
// is said. It is held to the goldens the Mac's own model writes (`Tests/FieldHomeTests/Fixtures/new-spark/`). Its
// controller's choices (the first agent that takes, the default profile, the set it sees) are the Mac's
// `NewSparkSheet.tsx`, held to DESIGN.md §8 by rows of their own. Every agent id is the catalog's and opaque (AR-L1).
// The phone calls a native set Default (PJ-7, `LaunchModel.nativeLabel`) above the model, never inside it.

/// One agent as the sheet's menu offers it: one a spark can think with, or one disabled with why.
struct SparkAgent: Equatable, Sendable {
  let id: String
  let label: String
  let takes: Bool
  /// why it cannot be a spark yet, when it cannot
  let why: String?
}

/// Where the sheet says a refusal (DESIGN.md §8): under what it asked.
enum RefusalPlace: String, Equatable, Sendable {
  case name, agent, profiles, foot
}

struct SheetRefusal: Equatable, Sendable {
  let at: RefusalPlace
  let words: String
}

/// What a hatch's refusal asked about, in the sheet's words: the name, the agent's label, the profile's label.
struct RefusalAsk: Equatable, Sendable {
  let name: String
  var agent: String?
  var profile: String?
}

/// An agent's own picker as the menu holds it: being read, read (`agent.models`' answer), or why the read failed.
enum ModelsReading: Equatable, Sendable {
  case reading
  case read(AgentModelsResult)
  case failed(String)
}

/// One row of the agent menu: an agent's head, a model of its picker, or a word in place of the picker.
enum AgentMenuRow: Equatable, Sendable {
  /// `under`: the profile whose sign-in it thinks under, on the chosen agent's head
  case agent(SparkAgent, under: String?)
  /// `id` nil: **Its own model**
  case model(id: String?, label: String, on: Bool)
  case note(String)
}

/// The chosen model's Effort, as the menu's palette row.
struct EffortChoice: Equatable, Sendable {
  struct Value: Equatable, Sendable {
    let id: String
    let label: String
    let on: Bool
  }
  let label: String
  let values: [Value]
}

/// One chip of the profiles row (NS-D5).
struct ProfileChip: Equatable, Sendable {
  let id: String
  let label: String
  let checked: Bool
  /// the one it thinks under: always checked, never unchecked
  let home: Bool
}

/// What the sheet holds once its two reads return (`NewSparkSheet.tsx`'s first effect): the agent it thinks with, the
/// profile it thinks under, the profiles it starts with, and the read that failed, said at the foot.
struct NewSparkOpening: Equatable, Sendable {
  let agent: String?
  let thinksUnder: String?
  let profiles: [String]
  let refusal: SheetRefusal?
}

/// The sheet's words (§8, §9 "Chat on the phone"), pure.
enum NewSparkWords {
  /// An agent that cannot take the briefing yet (the Mac's `CANNOT_TAKE_TOOLS`).
  static let cannotTakeTools = "can't take VibeField's tools yet"
  /// The agents could not be read: said at the foot (the Mac's `CANNOT_LIST_AGENTS`).
  static let cannotListAgents = "VibeField can't list its agents right now"
  /// The Agent Profiles could not be read: said at the foot, since Create waits on the profile it thinks under and
  /// never waits in silence (item 149; the Mac's `CANNOT_LIST_PROFILES`).
  static let cannotListProfiles = "VibeField can't list your Agent Profiles right now"
  /// The door and the sheet's name (the Mac's create, `sparkle`); the name field, ↻ and Cancel, as the Mac's sheet
  /// labels them.
  static let title = "New spark"
  static let nameLabel = "Name"
  static let anotherFace = "Another face"
  static let cancel = "Cancel"

  /// "Runs on studio, your home" (§9, PC-D8 A).
  static func runsOn(_ desktop: String) -> String { "Runs on \(desktop), your home" }

  /// The home away (PC-L4), in the line where the agent stands, with Create disabled (§9, Q5).
  static func away(_ desktop: String, _ standing: ChatAway.Standing, device: DeviceWord) -> String {
    switch standing {
    case .asleep: "\(desktop) is asleep · New spark waits for it"
    case .silent: "\(desktop) isn't answering · New spark waits for it"
    case .incompatible: "\(desktop) runs a build \(device.this) can't read · New spark waits for it"
    }
  }

  /// Create's words: "Create Polaris", or "Create" while the name is empty (the Mac's `NewSparkSheetView`).
  static func create(_ name: String) -> String {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "Create" : "Create \(trimmed)"
  }
}

enum NewSpark {
  /// The names the sheet suggests, each a star (the Mac's `STAR_NAMES`).
  static let starNames = [
    "Polaris", "Capella", "Altair", "Deneb", "Io", "Castor", "Maia", "Spica", "Mira", "Kai", "Elara", "Ariel",
  ]

  /// The first star name no spark holds, compared without case; then a numbered spark.
  static func suggestName(_ taken: [String]) -> String {
    let held = Set(taken.map { $0.lowercased() })
    return starNames.first { !held.contains($0.lowercased()) } ?? "Spark \(taken.count + 1)"
  }

  /// A face, dealt from one draw in [0, 1): a seed in the engine's 32-bit range. ↻ deals another (NS-D2 B).
  static func dealSeed(_ random: Double) -> UInt32 {
    UInt32(clamping: Int64((random * 4_294_967_296).rounded(.down)))
  }

  /// IOS-12f's f6b — the draw that deals `seed`, `dealSeed`'s inverse. The red's skeleton: it draws 0.
  static func draw(dealing seed: UInt32) -> Double { 0 }

  /// The agents the sheet lists: the ones the catalog lets be a spark first, then the installed ones it does not let
  /// yet, disabled with why; one not installed is not listed. Each keeps `agent.providers`' order inside its kind.
  static func sparkAgents(_ providers: [AgentProviderSummary]) -> [SparkAgent] {
    let installed = providers.filter { $0.available }
    let sparks = installed.filter(canBeSpark).map { SparkAgent(id: $0.id, label: $0.label, takes: true, why: nil) }
    let notYet = installed.filter { !canBeSpark($0) }.map {
      SparkAgent(id: $0.id, label: $0.label, takes: false, why: NewSparkWords.cannotTakeTools)
    }
    return sparks + notYet
  }

  /// Whether the catalog lets the agent be a spark here: fieldd's word (`offers.spark`, CP-5a); from a daemon older
  /// than the claim, the facts its own hatch reads (all three briefing fields, and a process the door can name).
  private static func canBeSpark(_ provider: AgentProviderSummary) -> Bool {
    if let claim = provider.spark { return claim }
    guard let briefing = provider.briefing else { return false }
    return briefing.mcpServers == true && briefing.allowTools == true && briefing.instructions == true
      && briefing.mcpServerProcess == "terminal"
  }

  /// The default Agent Profile: the one marked default, else the first.
  static func defaultProfile(_ sets: [AgentProfileSet]) -> AgentProfileSet? {
    sets.first { $0.isDefault } ?? sets.first
  }

  /// A chosen model in words: its label, and its effort once one is chosen; none while untouched. The one spelling of
  /// a model and its effort (the Mac's `modelWords`).
  static func modelWords(_ model: AgentModelChoice?, _ selection: AgentModelSelection?) -> [String] {
    guard let model, let selection else { return [] }
    let value = model.effort.flatMap { effort in
      effort.values.first { $0.id == selection.controls[effort.id] }
    }
    guard let value else { return [model.label] }
    return [model.label, value.label]
  }

  /// What the agent pill says: the agent, and the model and effort once one is chosen.
  static func agentLine(_ agent: SparkAgent?, _ model: AgentModelChoice?, _ selection: AgentModelSelection?)
    -> String
  {
    guard let agent else { return "No agent can be a spark yet" }
    return ([agent.label] + modelWords(model, selection)).joined(separator: " · ")
  }

  /// A hatch's refusal, placed by fieldd's reason and said in the sheet's words; anything else under the foot.
  static func refusal(reason: String?, message: String, ask: RefusalAsk) -> SheetRefusal {
    switch reason {
    case "name-taken":
      return SheetRefusal(at: .name, words: "\(ask.name) is taken")
    case "no-sign-in":
      guard let profile = ask.profile, let agent = ask.agent else { return SheetRefusal(at: .agent, words: message) }
      return SheetRefusal(at: .agent, words: "\(profile) has no \(agent) sign-in")
    case "unknown-profile":
      return SheetRefusal(at: .profiles, words: "That profile is gone")
    default:
      return SheetRefusal(at: .foot, words: message)
    }
  }

  /// The agent menu: every agent's head; under the chosen one, its own model, then its picker's models or a word.
  static func menu(
    _ agents: [SparkAgent], chosen: String?, picker: ModelsReading?, selection: AgentModelSelection?,
    under: String?
  ) -> [AgentMenuRow] {
    agents.flatMap { agent -> [AgentMenuRow] in
      let mine = agent.takes && agent.id == chosen
      guard mine else { return [.agent(agent, under: nil)] }
      var rows: [AgentMenuRow] = [
        .agent(agent, under: under), .model(id: nil, label: "Its own model", on: selection == nil),
      ]
      switch picker {
      case nil, .reading:
        rows.append(.note("Reading \(agent.label)'s models…"))
      case .failed(let words):
        rows.append(.note(words))
      case .read(let answer):
        guard let catalog = answer.catalog else {
          rows.append(.note(answer.failure?.message ?? "\(agent.label) lists no models"))
          break
        }
        rows += catalog.models.map { AgentMenuRow.model(id: $0.id, label: $0.label, on: selection?.modelId == $0.id) }
      }
      return rows
    }
  }

  /// The Effort a chosen model offers; none until a model is chosen.
  static func effort(_ model: AgentModelChoice?, _ selection: AgentModelSelection?) -> EffortChoice? {
    guard let control = model?.effort, let selection else { return nil }
    let value = selection.controls[control.id] ?? control.defaultValue
    return EffortChoice(
      label: control.label,
      values: control.values.map { EffortChoice.Value(id: $0.id, label: $0.label, on: $0.id == value) })
  }

  /// The profiles row: every profile, the chosen ones checked, the one it thinks under checked and locked.
  static func profileChips(_ sets: [AgentProfileSet], chosen: [String], thinksUnder: String?) -> [ProfileChip] {
    sets.map { set in
      ProfileChip(
        id: set.id, label: set.label, checked: chosen.contains(set.id) || set.id == thinksUnder,
        home: set.id == thinksUnder)
    }
  }

  /// The agents a spark of these profiles can start: each one signed in under one of them, by its label.
  static func starts(_ sets: [AgentProfileSet], chosen: [String], thinksUnder: String?, agents: [SparkAgent])
    -> [String]
  {
    let providers =
      sets
      .filter { chosen.contains($0.id) || $0.id == thinksUnder }
      .flatMap { $0.personas.filter { $0.identity?.loggedIn == true } }
      .map { $0.provider }
    return ordered(providers).map { provider in agents.first { $0.id == provider }?.label ?? provider }
  }

  /// How many of the person's live sessions these profiles let a spark see, each placed by the one rule
  /// (`ProfilePlacement`, as @ places it); nil until the board is read.
  static func sessionsSeen(_ sessions: [RunProfileFacts]?, sets: [AgentProfileSet], chosen: [String]) -> Int? {
    guard let sessions else { return nil }
    let personaSets = ProfilePlacement.personaSets(sets)
    return sessions.filter { session in
      ProfilePlacement.setOf(session, personaSets: personaSets).map { chosen.contains($0) } ?? false
    }.count
  }

  /// The person's live sessions on the home, as the phone's board holds them (VF-PM 2026-11-07 13:37:20Z, ruled (a)):
  /// the home's rows that live and are no spark's own session, each under the profile the board says. The Mac reads
  /// its own field board's `{profileSet, profileId}` (`personSessionsOf`); a remote row carries the monitor's resolved
  /// set and no persona, so a retired sign-in counts as Default here, where the rule places it nowhere
  /// (agent-index.ts's "the one place the two differ"). The caller says nil until the board is read.
  static func sessions(_ rows: [AgentRemoteRow], home: String?) -> [RunProfileFacts] {
    rows
      .filter { $0.device == home && $0.monitorRow.alive && $0.spark == nil }
      .map { RunProfileFacts(profileSet: $0.monitorRow.profileSet) }
  }

  /// The line under the chips: how many sessions it sees, then what it can start.
  static func reach(_ sessions: Int?, starts: [String]) -> String {
    let start =
      starts.isEmpty ? "starts no agent yet: none of these profiles holds a sign-in" : "starts \(listWords(starts))"
    guard let sessions else { return start.prefix(1).uppercased() + start.dropFirst() }
    return "Sees \(sessions) \(sessions == 1 ? "session" : "sessions") · \(start)"
  }

  /// "Claude Code", "Claude Code and Codex", "Claude Code, Codex and Grok".
  static func listWords(_ words: [String]) -> String {
    guard words.count > 1, let last = words.last else { return words.joined() }
    return "\(words.dropLast().joined(separator: ", ")) and \(last)"
  }

  // MARK: - The controller's choices (NewSparkSheet.tsx), held to DESIGN.md §8

  /// What the sheet holds once its reads return; nil for a read that failed. A failed read is said at the foot, the
  /// agents' first, so Create never waits in silence (item 149).
  static func opening(agents: [SparkAgent]?, sets: [AgentProfileSet]?) -> NewSparkOpening {
    let home = defaultProfile(sets ?? [])?.id
    let refusal: SheetRefusal? =
      if agents == nil {
        SheetRefusal(at: .foot, words: NewSparkWords.cannotListAgents)
      } else if home == nil {
        SheetRefusal(at: .foot, words: NewSparkWords.cannotListProfiles)
      } else {
        nil
      }
    return NewSparkOpening(
      agent: agents?.first(where: { $0.takes })?.id, thinksUnder: home, profiles: home.map { [$0] } ?? [],
      refusal: refusal)
  }

  /// The profiles a spark sees: the chosen ones, and the one it thinks under, the chosen first.
  static func seen(_ profiles: [String], thinksUnder: String?) -> [String] {
    ordered(profiles + (thinksUnder.map { [$0] } ?? []))
  }

  /// A profile as the phone names it: a native set is Default (PJ-7).
  static func label(_ set: AgentProfileSet) -> String {
    set.kind == "native" ? LaunchModel.nativeLabel : set.label
  }

  /// The profile said on the pill and the chosen agent's head: once the home has more than one.
  static func under(_ sets: [AgentProfileSet], thinksUnder: String?) -> String? {
    guard sets.count > 1 else { return nil }
    return sets.first { $0.id == thinksUnder }.map(label)
  }

  /// The words in their first order, each once (a JavaScript `Set`'s order).
  private static func ordered(_ words: [String]) -> [String] {
    var held = Set<String>()
    return words.filter { held.insert($0).inserted }
  }
}
