import FieldAgents
import FieldMesh
import FieldProduct
import Foundation

// PG-7 — WHAT THE SPEND VIEW SAYS IN WORDS, transcribed from puppeteer-views 0.3.3 at the pin `52d09c8e` (the spend
// module `5abe8f75`): `src/views/spend/spend-words.ts` (dist `spend-words.js` :8-166). Money as the swarm prints it
// (`~$1.84`, `+` when partial, `—` unpriced), the burn by the hour, each row's name and the line under it, and its
// state at a moment. Held to `phone-spend.golden.json` (SpendParityTests P3, P4, P5's labels, V1, V5, V6, V7).
// RED SKELETON (pair 3): placeholder returns, so the rows fail by assertion.

enum SpendWords {
  /// Below this a working agent's burn is said as how long it has worked (`BURN_FLOOR_PER_MIN`).
  static let burnFloorPerMinute = 0.0005

  enum Tone: String, Sendable { case muted, attention, info, live }

  /// A state's words and their tone (§2.5).
  struct Said: Equatable, Sendable {
    let text: String
    let tone: Tone
  }

  enum Glyph: String, Sendable { case question, failure, permission, reply }

  /// What a row was doing at a moment (`SpendRowState`).
  struct State: Equatable, Sendable {
    enum Key: String, Sendable { case before, unknown, blocked, unseen, idle, working }
    let key: Key
    let sinceMs: Double
    var glyph: Glyph?
    var words: String?
  }

  /// The names a row goes by (`SpendName`).
  struct Name: Equatable, Sendable {
    let name: String
    let one: String
    let task: String
    let model: String
  }

  /// `NOT_RECORDED`.
  static let notRecorded = Said(text: "", tone: .muted)

  static func money(_ value: Double?) -> String { "" }

  static func est(_ value: Double?, partial: Bool) -> String { "" }

  static func perHour(_ perMinute: Double?) -> String { "" }

  static func axisMoney(_ value: Double, step: Double) -> String { "" }

  static func taskOf(_ agent: SpendAgent) -> String { "" }

  static func modelOf(_ agent: SpendAgent) -> String { "" }

  static func spendNames(_ agents: [SpendAgent]) -> [String: Name] { [:] }

  static func fitWords(_ text: String, max: Double, measure: (String) -> Double) -> String { "" }

  static func spendStateAt(bornMs: Double, agent: SpendAgent, t: Double, nowMs: Double) -> State {
    State(key: .idle, sinceMs: 0)
  }

  static func printedBurn(_ state: State, perMinute: Double?) -> Double? { nil }

  static func stateWords(_ state: State, t: Double, perMinute: Double?, timeZone: TimeZone) -> Said {
    Said(text: "", tone: .muted)
  }

  static func waits(_ state: State) -> Bool { false }
}
