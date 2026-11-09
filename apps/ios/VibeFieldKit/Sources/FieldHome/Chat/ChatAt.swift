import FieldProduct
import Foundation

// IOS-12f's M-f2 (PC-L1, one Chat; plan-12f's Q8 A; DESIGN.md §8 "The phone's Chat", the composer) — @'S ROWS IN CHAT,
// the Mac's (`field-app/src/chat/at-rows.ts`) ported: the spark, its profiles and the board's facts in; the two groups
// out, read bottom-up, nearest first. Held to the goldens the Mac's own model writes
// (`Tests/FieldHomeTests/Fixtures/at-rows/`). SKELETON at f7c: the rows answer nothing, and the tests are red by value.

/// What a board row says, on either side's wire: the one rule reads these (at-rows-goldens.test.ts, `Facts`).
struct ChatAtRun: Equatable, Sendable {
  let run: String
  let agent: String
  let label: String
  let project: String?
  /// `working`, `idle`, `blocked`, or `unknown` for a run not heard yet.
  let status: String
  let blockers: Int
  let alive: Bool
  let spark: String?
  let originBy: String?
  let originSpark: String?
  let profile: RunProfileFacts
  /// Times in ms; a time that can't be read is 0, as the Mac's `timeOf` has it.
  let createdAt: Double
  let stateChangedAt: Double
  let lastActivityAt: Double?
}

extension ChatAtRun {
  /// The phone's cut of a row (Q3): the owner's monitor row says the resolved profile and no persona.
  init(remote row: AgentRemoteRow) {
    self.init(
      run: "", agent: "", label: "", project: nil, status: "", blockers: 0, alive: false, spark: nil, originBy: nil,
      originSpark: nil, profile: RunProfileFacts(), createdAt: 0, stateChangedAt: 0, lastActivityAt: nil)
  }
}

/// What @ reads of a spark.
struct ChatAtSpark: Equatable, Sendable {
  let id: String
  let name: String
  let profiles: [String]
  /// its own session's run
  let run: String?
}

/// Read, being read, or refused (the Mac's `null`, value, `"failed"`).
enum ChatAtReading<Value: Sendable>: Sendable {
  case reading
  case read(Value)
  case failed
}

struct ChatAtProfile: Equatable, Sendable {
  let id: String
  let name: String
}

/// An agent the spark can start, under one of its profiles.
struct ChatAtAgentRow: Equatable, Sendable, Identifiable {
  let id: String
  let agent: String
  let label: String
  let profile: ChatAtProfile
  /// the profile's name, as the row's pill, when the spark has more than one
  let pill: String?
}

/// A session's one word for what it is doing.
enum ChatAtSessionWord: String, Equatable, Sendable {
  case working = "Working"
  case idle = "Idle"
  case needsYou = "Needs you"
}

/// A session running in the spark's profiles that its `agent_send` takes.
struct ChatAtSessionRow: Equatable, Sendable, Identifiable {
  let id: String
  let session: String
  let agent: String
  let label: String
  let handle: String
  let project: String?
  let word: ChatAtSessionWord?
}

/// @'s list, as drawn top to bottom: the agents, then the sessions, the nearest last, against the composer.
struct ChatAtList: Equatable, Sendable {
  var agents: [ChatAtAgentRow] = []
  var sessions: [ChatAtSessionRow] = []
  var reading = false
  var sessionsFailed = false
  var quiet: String? = nil
}

/// @'s words (DESIGN.md §9 "Chat's words").
enum ChatAtWords {
  static let agents = ""
  static let sessions = ""
  static let reading = ""
  static let sessionsFailed = ""
  static func none(_ query: String) -> String { "" }
  static func empty(_ name: String) -> String { "" }
}

enum ChatAt {
  /// @'s handles, by run id: the one rule, for every reader that names a session as @ does.
  static func handles(
    spark: ChatAtSpark, board: ChatAtReading<[ChatAtRun]>, sets: ChatAtReading<[AgentProfileSet]>
  ) -> [String: String] {
    [:]
  }

  /// @'s list for the spark's thread. `labels`: each agent's label as the catalog says it, by its id.
  static func list(
    spark: ChatAtSpark, query: String, sets: ChatAtReading<[AgentProfileSet]>, board: ChatAtReading<[ChatAtRun]>,
    labels: [String: String]
  ) -> ChatAtList {
    ChatAtList()
  }
}
