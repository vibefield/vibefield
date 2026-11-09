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

/// Where the @ being typed stands in the draft.
struct ChatAtPlace: Equatable, Sendable {
  /// The run of text it stands in.
  let index: Int
  /// The @ in that run, in UTF-16 units.
  let at: Int
  let query: String
  /// The @ in the whole draft, counted as the caret moves.
  let offset: Int
}

extension ChatDraft {
  private static func dropUnits(_ text: String, _ count: Int) -> String {
    String(decoding: Array(text.utf16).dropFirst(count), as: UTF16.self)
  }

  /// The draft's words alone, its chips left out.
  static func typed(_ parts: [ChatDraftPart]) -> String {
    parts.reduce(into: "") { out, part in
      if case .text(let text) = part { out += text }
    }
  }

  /// `parts` with the units from `start` to `end` of the run at `index` taken out and, when `chip` is given, the chip
  /// set in their place with a space after it, since a chip never splits a word (`spliceDraft`).
  static func splice(
    _ parts: [ChatDraftPart], index: Int, start: Int, end: Int, chip: ChatDraftChip? = nil
  ) -> [ChatDraftPart] {
    guard parts.indices.contains(index), case .text(let text) = parts[index] else { return parts }
    let units = Array(text.utf16)
    let before = String(decoding: units[..<start], as: UTF16.self)
    let after = String(decoding: units[end...], as: UTF16.self)
    var middle: [ChatDraftPart] = []
    if let chip {
      middle = [.chip(chip), .text(after.utf16.first == 0x20 ? "" : " ")]
    }
    var out = Array(parts[..<index])
    out.append(.text(before))
    out.append(contentsOf: middle)
    out.append(.text(after))
    out.append(contentsOf: parts[(index + 1)...])
    return normalized(out)
  }

  /// How long the draft is, counted as the caret moves: one per UTF-16 unit, one per chip (`draftOffset`).
  static func length(_ parts: [ChatDraftPart]) -> Int {
    parts.reduce(0) { sum, part in
      if case .text(let text) = part { return sum + text.utf16.count }
      return sum + 1
    }
  }

  /// The chip at a place in the draft, counted as the caret moves.
  static func chip(_ parts: [ChatDraftPart], at offset: Int) -> (index: Int, chip: ChatDraftChip)? {
    var at = 0
    for (index, part) in parts.enumerated() {
      switch part {
      case .chip(let chip):
        if at == offset { return (index, chip) }
        at += 1
      case .text(let text):
        at += text.utf16.count
      }
    }
    return nil
  }

  /// The @ being typed before the caret, or nil: the caret stands in a run of text, and the run reads an @ up to it.
  static func place(_ parts: [ChatDraftPart], caret: Int?) -> ChatAtPlace? {
    guard let caret else { return nil }
    var start = 0
    for (index, part) in parts.enumerated() {
      guard case .text(let text) = part else {
        start += 1
        continue
      }
      let units = Array(text.utf16)
      if caret >= start, caret <= start + units.count {
        let before = String(decoding: units[..<(caret - start)], as: UTF16.self)
        guard let found = queryBefore(before) else { return nil }
        return ChatAtPlace(index: index, at: found.at, query: found.query, offset: start + found.at)
      }
      start += units.count
    }
    return nil
  }

  /// What a draft keeps once `sent` was queued from it (`draftAfterSend`): when it still begins with every part sent,
  /// what follows them stays, its leading space trimmed; a draft changed within what was sent stays whole, so no word
  /// is lost.
  static func after(sent: [ChatDraftPart], now: [ChatDraftPart]) -> [ChatDraftPart] {
    guard let end = sent.last else { return now }
    let last = sent.count - 1
    guard last < now.count, Array(sent[..<last]) == Array(now[..<last]) else { return now }
    var rest: [ChatDraftPart]
    if case .text(let ended) = end, case .text(let text) = now[last], text.utf16.starts(with: ended.utf16) {
      rest = [ChatDraftPart.text(dropUnits(text, ended.utf16.count))] + Array(now[(last + 1)...])
    } else if end == now[last] {
      rest = Array(now[(last + 1)...])
    } else {
      return now
    }
    if case .text(let first)? = rest.first { rest[0] = .text(dropUnits(first, leadLength(first))) }
    return normalized(rest)
  }
}
