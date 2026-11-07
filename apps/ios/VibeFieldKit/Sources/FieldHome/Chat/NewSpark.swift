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
// SKELETON (f2): the types are the model's; every answer is f4's, and the rows in NewSparkTests are red until then.

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
  static let cannotTakeTools = ""
  static let cannotListAgents = ""
  static let cannotListProfiles = ""

  /// "Runs on studio, your home" (§9, PC-D8 A).
  static func runsOn(_ desktop: String) -> String { "" }

  /// The home away (PC-L4), in the line where the agent stands, with Create disabled (§9, Q5).
  static func away(_ desktop: String, _ standing: ChatAway.Standing, device: DeviceWord) -> String { "" }

  /// Create's words: "Create Polaris", or "Create" while the name is empty.
  static func create(_ name: String) -> String { "" }
}

enum NewSpark {
  /// The names the sheet suggests, each a star.
  static let starNames: [String] = []

  /// The first star name no spark holds, compared without case; then a numbered spark.
  static func suggestName(_ taken: [String]) -> String { "" }

  /// A face, dealt from one draw in [0, 1): a seed in the engine's 32-bit range. ↻ deals another (NS-D2 B).
  static func dealSeed(_ random: Double) -> UInt32 { 0 }

  /// The agents the sheet lists: the ones the catalog lets be a spark first, then the installed ones it does not let
  /// yet, disabled with why; one not installed is not listed. Each keeps `agent.providers`' order inside its kind.
  static func sparkAgents(_ providers: [AgentProviderSummary]) -> [SparkAgent] { [] }

  /// The default Agent Profile: the one marked default, else the first.
  static func defaultProfile(_ sets: [AgentProfileSet]) -> AgentProfileSet? { nil }

  /// A chosen model in words: its label, and its effort once one is chosen; none while untouched.
  static func modelWords(_ model: AgentModelChoice?, _ selection: AgentModelSelection?) -> [String] { [] }

  /// What the agent pill says: the agent, and the model and effort once one is chosen.
  static func agentLine(_ agent: SparkAgent?, _ model: AgentModelChoice?, _ selection: AgentModelSelection?)
    -> String
  { "" }

  /// A hatch's refusal, placed by fieldd's reason and said in the sheet's words; anything else under the foot.
  static func refusal(reason: String?, message: String, ask: RefusalAsk) -> SheetRefusal {
    SheetRefusal(at: .foot, words: "")
  }

  /// The agent menu: every agent's head; under the chosen one, its own model, then its picker's models or a word.
  static func menu(
    _ agents: [SparkAgent], chosen: String?, picker: ModelsReading?, selection: AgentModelSelection?,
    under: String?
  ) -> [AgentMenuRow] { [] }

  /// The Effort a chosen model offers; none until a model is chosen.
  static func effort(_ model: AgentModelChoice?, _ selection: AgentModelSelection?) -> EffortChoice? { nil }

  /// The profiles row: every profile, the chosen ones checked, the one it thinks under checked and locked.
  static func profileChips(_ sets: [AgentProfileSet], chosen: [String], thinksUnder: String?) -> [ProfileChip] { [] }

  /// The agents a spark of these profiles can start: each one signed in under one of them, by its label.
  static func starts(_ sets: [AgentProfileSet], chosen: [String], thinksUnder: String?, agents: [SparkAgent])
    -> [String]
  { [] }

  /// How many of the person's live sessions these profiles let a spark see; nil until the board is read.
  static func sessionsSeen(_ sessions: [RunProfileFacts]?, sets: [AgentProfileSet], chosen: [String]) -> Int? {
    nil
  }

  /// The line under the chips: how many sessions it sees, then what it can start.
  static func reach(_ sessions: Int?, starts: [String]) -> String { "" }

  /// "Claude Code", "Claude Code and Codex", "Claude Code, Codex and Grok".
  static func listWords(_ words: [String]) -> String { "" }

  // MARK: - The controller's choices (NewSparkSheet.tsx), held to DESIGN.md §8

  /// What the sheet holds once its reads return; nil for a read that failed.
  static func opening(agents: [SparkAgent]?, sets: [AgentProfileSet]?) -> NewSparkOpening {
    NewSparkOpening(agent: nil, thinksUnder: nil, profiles: [], refusal: nil)
  }

  /// The profiles a spark sees: the chosen ones, and the one it thinks under.
  static func seen(_ profiles: [String], thinksUnder: String?) -> [String] { [] }

  /// A profile as the phone names it: a native set is Default (PJ-7).
  static func label(_ set: AgentProfileSet) -> String { "" }

  /// The profile said on the pill and the chosen agent's head: once the home has more than one.
  static func under(_ sets: [AgentProfileSet], thinksUnder: String?) -> String? { nil }
}
