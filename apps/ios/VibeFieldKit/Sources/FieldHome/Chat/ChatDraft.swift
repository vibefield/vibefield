import FieldProduct
import Foundation

// IOS-12f's M-f2 (PC-L1; plan-12f's Q8 A; VF-PM 2026-11-09 02:24:16Z, Q1 (a); DESIGN.md §8 "The phone's Chat", the
// composer) — THE DRAFT, the Mac's (`field-app/src/chat/composer-draft.ts`) ported for what the phone sets in it: runs of
// text and the chips set into them. A card chip is the Mac's alone (the hand). The field draws these parts; these parts
// are the truth. Held to the goldens the Mac's own model writes (`Tests/FieldHomeTests/Fixtures/at-rows/`).

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
  /// JavaScript's `\s` and `String.trim`'s set: the two the Mac's draft reads.
  static func isSpace(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
    default: false
    }
  }

  /// `String.trim`, by the Mac's set rather than Foundation's.
  static func trim(_ text: String) -> String {
    let scalars = Array(text.unicodeScalars)
    var start = 0
    var end = scalars.count
    while start < end, isSpace(scalars[start]) { start += 1 }
    while end > start, isSpace(scalars[end - 1]) { end -= 1 }
    var view = String.UnicodeScalarView()
    view.append(contentsOf: scalars[start..<end])
    return String(view)
  }

  /// Everything before the trim's cut at the start, in UTF-16 units.
  private static func leadLength(_ text: String) -> Int {
    var units = 0
    for scalar in text.unicodeScalars {
      guard isSpace(scalar) else { break }
      units += String(scalar).utf16.count
    }
    return units
  }

  /// The @ typed at the start of a word, ending at the caret: `/(^|\s)@([^\s@]*)$/u` read from the end.
  static func queryBefore(_ before: String) -> ChatAtQuery? {
    let scalars = Array(before.unicodeScalars)
    var at = scalars.count - 1
    while at >= 0, scalars[at] != "@" {
      if isSpace(scalars[at]) { return nil }
      at -= 1
    }
    guard at >= 0, at == 0 || isSpace(scalars[at - 1]) else { return nil }
    var head = String.UnicodeScalarView()
    head.append(contentsOf: scalars[..<at])
    var tail = String.UnicodeScalarView()
    tail.append(contentsOf: scalars[(at + 1)...])
    return ChatAtQuery(at: String(head).utf16.count, query: String(tail))
  }

  /// What a chip reads in the sentence: an agent, its label, its model and effort once chosen, and its profile when the
  /// spark has more than one; a session, its handle.
  static func label(_ chip: ChatDraftChip) -> String {
    switch chip {
    case .agent(let agent):
      let line = ([agent.label] + (agent.model?.words ?? [])).joined(separator: " · ")
      return agent.named ? "\(line) · \(agent.profile.name)" : line
    case .session(let session):
      return session.handle
    }
  }

  private static func kind(_ chip: ChatDraftChip) -> String {
    switch chip {
    case .agent: "agent"
    case .session: "session"
    }
  }

  /// What a chip carries into the message.
  private static func words(_ chip: ChatDraftChip) -> String {
    switch chip {
    case .agent(let agent):
      let words = agent.model?.words ?? []
      let at = words.isEmpty ? agent.label : "\(agent.label) at \(words.joined(separator: " · "))"
      return agent.named ? "\(at) under \(agent.profile.name)" : at
    case .session(let session):
      guard let project = session.project else { return "\(session.label) (session \(session.session))" }
      return "\(session.label) in \(project) (session \(session.session))"
    }
  }

  /// The message a send queues, in the draft's order, trimmed at both ends, with each chip as the span of the words it
  /// carries (in UTF-16 units, as the door counts them). Past the door's bound the rest are words alone.
  static func message(_ parts: [ChatDraftPart]) -> ChatDraftMessage {
    var out = ""
    var spans: [(start: Int, length: Int, kind: String)] = []
    for part in parts {
      switch part {
      case .text(let text):
        out += text
      case .chip(let chip):
        let carried = words(chip)
        spans.append((start: out.utf16.count, length: carried.utf16.count, kind: kind(chip)))
        out += carried
      }
    }
    let text = trim(out)
    let lead = leadLength(out)
    let total = text.utf16.count
    // the trim moves every span by what it took from the start, and clips a chip's own space at either end
    let chips = spans.compactMap { span -> SparkTranscriptChip? in
      let start = max(0, span.start - lead)
      let end = min(total, span.start - lead + span.length)
      return end > start ? SparkTranscriptChip(start: start, length: end - start, kind: span.kind) : nil
    }
    return ChatDraftMessage(text: text, chips: Array(chips.prefix(SparkSay.chipsMax)))
  }

  /// Adjacent runs of text joined and empty runs dropped, so two drafts that read the same are the same parts.
  static func normalized(_ parts: [ChatDraftPart]) -> [ChatDraftPart] {
    var out: [ChatDraftPart] = []
    for part in parts {
      if case .text(let text) = part {
        if text.isEmpty { continue }
        if case .text(let last)? = out.last {
          out[out.count - 1] = .text(last + text)
          continue
        }
      }
      out.append(part)
    }
    return out
  }

  /// There is something to send: a chip, or a word beyond the @ still being typed, since a mention in progress is not a
  /// message.
  static func sendable(_ parts: [ChatDraftPart], pending: String?) -> Bool {
    var typed = ""
    for part in parts {
      switch part {
      case .chip: return true
      case .text(let text): typed += text
      }
    }
    let words = trim(typed)
    guard let pending else { return !words.isEmpty }
    let units = Array(words.utf16)
    let tail = Array(pending.utf16)
    guard units.count >= tail.count, Array(units.suffix(tail.count)) == tail else { return !words.isEmpty }
    return !trim(String(decoding: units.dropLast(tail.count), as: UTF16.self)).isEmpty
  }
}
