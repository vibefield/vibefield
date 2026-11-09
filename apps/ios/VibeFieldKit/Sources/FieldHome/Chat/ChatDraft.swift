import FieldProduct
import Foundation

// IOS-12f's M-f2 (PC-L1; plan-12f's Q8 A; VF-PM 2026-11-09 02:24:16Z, Q1 (a); DESIGN.md §8 "The phone's Chat", the
// composer) — THE DRAFT, the Mac's (`field-app/src/chat/composer-draft.ts`) ported for what the phone sets in it: runs of
// text and the chips set into them. A card chip is the Mac's alone (the hand). The field draws these parts; these parts
// are the truth. Held to the goldens the Mac's own model writes (`Tests/FieldHomeTests/Fixtures/at-rows/`). SKELETON at
// f7c: every answer is empty, and the tests are red by value.

/// A model and effort chosen in an agent's menu, in words; `selection` is the picker's, never drawn and never sent.
struct ChatChipModel: Equatable, Sendable {
  let words: [String]
  var selection: AgentModelSelection? = nil
}

/// An agent taken from @: the spark starts it.
struct ChatAgentChip: Equatable, Sendable {
  let id: String
  let agent: String
  let label: String
  let profile: ChatAtProfile
  /// the spark has more than one profile, so the chip and the message say which
  let named: Bool
  var model: ChatChipModel? = nil
}

/// A session taken from @: one the spark's `agent_send` takes.
struct ChatSessionChip: Equatable, Sendable {
  let id: String
  let session: String
  let agent: String
  let label: String
  let handle: String
  let project: String?
}

enum ChatDraftChip: Equatable, Sendable {
  case agent(ChatAgentChip)
  case session(ChatSessionChip)
}

enum ChatDraftPart: Equatable, Sendable {
  case text(String)
  case chip(ChatDraftChip)
}

/// The @ being typed before the caret: where it stands, in UTF-16 units, and what follows it.
struct ChatAtQuery: Equatable, Sendable {
  let at: Int
  let query: String
}

/// A message as a send queues it: its words, and its chips as spans of them.
struct ChatDraftMessage: Equatable, Sendable {
  let text: String
  let chips: [SparkTranscriptChip]
}

enum ChatDraft {
  /// The @ typed at the start of a word, ending at the caret.
  static func queryBefore(_ before: String) -> ChatAtQuery? { nil }

  /// What a chip reads in the sentence.
  static func label(_ chip: ChatDraftChip) -> String { "" }

  /// The message a send queues.
  static func message(_ parts: [ChatDraftPart]) -> ChatDraftMessage { ChatDraftMessage(text: "", chips: []) }

  /// There is something to send: a chip, or a word beyond the @ still being typed.
  static func sendable(_ parts: [ChatDraftPart], pending: String?) -> Bool { false }
}
