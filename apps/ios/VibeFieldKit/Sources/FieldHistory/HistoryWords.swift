import CoreGraphics
import FieldMarkdown
import FieldProduct
import Foundation

// Item 362d (James, 2026-11-12 18:40:35Z, of the phone's History session view against the desktop's: "i think all
// message type and views are different from desktop") — A RECORDED MESSAGE'S WORDS, READ: a prompt's and a reply's
// words go through the phone's one reader (`ChatMarkdown.blocks`, field-app's `markdownBlocksOf` ported and held to
// its golden) and are drawn by the view Chat draws a spark's words with (`ChatMarkdownView`), as the desktop's
// transcript reads both through one renderer (rosetta's room, `components/transcript/Prose.tsx`). A recorded text is
// the adversary's (EL7): it is read into plain data, a link is its words, and no run can carry a destination.
// DESIGN.md §8 "The phone's session document" → its words.
//
// Pure: the view draws what this answers.

enum HistoryWords {
  /// What a message's words are drawn as.
  enum Reading: Equatable {
    /// Nothing but space: the view says so in its own faint words (`(no words)`, `(an empty prompt)`).
    case blank
    /// Blocks, for `ChatMarkdownView`.
    case blocks([ChatMarkdownBlock])
    /// Words that read into no block (a rule and nothing else): they stand as typed, never as a blank.
    case typed(String)
  }

  static func reading(_ text: String) -> Reading {
    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .blank }
    let blocks = ChatMarkdown.blocks(text)
    return blocks.isEmpty ? .typed(text) : .blocks(blocks)
  }

  /// A reply's measure: the document's own 15 with 4 of leading, as its plain words stood; `code` and fenced code at
  /// 13, a fenced line gaining 3.4 (13 at 1.45: SF Mono's own line at 13 is about 15.5); blocks 10 apart.
  static let reply = ChatMarkdownMeasure(
    size: 15, lineSpacing: 4, codeSize: 13, codeLineSpacing: 3.4, blockGap: 10, top: 0, onPanel: false)

  /// A prompt's: the same figures on its filled panel, where a fence takes solid chrome ringed by the strong hairline
  /// and `code` takes no ground (the room's rule: a fill on a fill is no boundary).
  static let prompt = ChatMarkdownMeasure(
    size: 15, lineSpacing: 4, codeSize: 13, codeLineSpacing: 3.4, blockGap: 10, top: 0, onPanel: true)

  /// Item 362e — a group's member, opened (a thought, a notice, a summary, a team message): the group's pitch, 13
  /// with 3 of leading, `code` and fenced code at 12, blocks 8 apart.
  static let member = ChatMarkdownMeasure(
    size: 13, lineSpacing: 3, codeSize: 12, codeLineSpacing: 3, blockGap: 8, top: 0, onPanel: false)

  // MARK: - The excerpt (item 362f)

  /// The room's `MESSAGE_PREVIEW_CHARACTERS` and `MESSAGE_PREVIEW_LINES` (rosetta at the pin, clients/room/src/
  /// components/transcript/message-preview.ts): the bound of a message's words in the document.
  static let excerptCharacters = 2_400
  static let excerptLines = 32

  /// A message's words as the document draws them: all of them, or their opening with the rest left out.
  struct Excerpt: Equatable {
    let text: String
    let omitted: Bool
  }

  /// The room's `messageExcerpt`, ported as it is written, over UTF-16 units as JavaScript counts them.
  ///
  /// The allowance is `budget` (never more than `excerptCharacters`) or the first `excerptLines` lines, whichever
  /// ends first. A text within it is whole. Otherwise the cut moves back to a paragraph break, else a line break,
  /// else a space or a tab: the first of those, in that order, that falls in the allowance's last quarter. It
  /// never splits a surrogate pair; the trailing space goes; and the excerpt does not finish on a heading or an
  /// opening fence whose content was left out (a heading that is all there is stays).
  static func excerpt(_ text: String, budget: Int = excerptCharacters) -> Excerpt {
    let units = Array(text.utf16)
    var end = min(units.count, max(0, budget), excerptCharacters)
    var lines = 1
    for at in 0..<end where units[at] == 0x0A {
      lines += 1
      if lines > excerptLines {
        end = at
        break
      }
    }
    if end == units.count { return Excerpt(text: text, omitted: false) }

    let prefix = units[0..<end]
    var paragraph = -1
    var at = end - 2
    while at >= 0 {
      if prefix[at] == 0x0A, prefix[at + 1] == 0x0A {
        paragraph = at
        break
      }
      at -= 1
    }
    let line = prefix.lastIndex(of: 0x0A) ?? -1
    let word = max(prefix.lastIndex(of: 0x20) ?? -1, prefix.lastIndex(of: 0x09) ?? -1)
    if let boundary = [paragraph, line, word].first(where: { Double($0) >= Double(end) * 0.75 }) { end = boundary }
    if end > 0, UTF16.isLeadSurrogate(units[end - 1]) { end -= 1 }

    var kept = trimmedEnd(units[0..<end])
    // the room's loop: while its pattern matches past the text's first unit
    while let match = dangling(kept), match > 0 {
      let before = trimmedEnd(kept[0..<match])
      if before.isEmpty { break }
      kept = before
    }
    return Excerpt(text: String(decoding: kept, as: UTF16.self), omitted: true)
  }

  /// JavaScript's white space and line terminators: what `trimEnd` drops and `\s` matches.
  private static func isSpace(_ unit: UInt16) -> Bool {
    switch unit {
    case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
    case 0x2000...0x200A: true
    default: false
    }
  }

  private static func trimmedEnd(_ units: ArraySlice<UInt16>) -> [UInt16] {
    var end = units.endIndex
    while end > units.startIndex, isSpace(units[end - 1]) { end -= 1 }
    return Array(units[units.startIndex..<end])
  }

  /// Where the room's `dangling` pattern first matches, as `RegExp.exec` answers its index; nil when it does not.
  /// The pattern is anchored to the text's end and starts at the text's start or at a newline, so it is tried at
  /// each line's start in turn; the index is that newline's (0 for the first line).
  private static func dangling(_ units: [UInt16]) -> Int? {
    var start = 0
    while true {
      if dangles(units, from: start) { return max(0, start - 1) }
      guard let newline = units[start...].firstIndex(of: 0x0A) else { return nil }
      start = newline + 1
    }
  }

  /// The pattern from one line's start: up to three spaces, then a heading (`#` to `######`, white space, and no
  /// newline after that white space) or a fence (three or more backticks or tildes, and no newline after). The
  /// heading's white space is the pattern's `\s+`, which takes newlines: a bare `#` line, blank lines and one
  /// last line match together, as they do in the room.
  private static func dangles(_ units: [UInt16], from start: Int) -> Bool {
    var at = start
    while at < units.count, at - start < 3, units[at] == 0x20 { at += 1 }
    let rest = units[at...]
    let hashes = rest.prefix { $0 == 0x23 }.count
    if (1...6).contains(hashes) {
      let after = rest.dropFirst(hashes)
      let space = after.prefix(while: isSpace).count
      if space > 0, !after.dropFirst(space).contains(0x0A) { return true }
    }
    let fence = max(rest.prefix { $0 == 0x60 }.count, rest.prefix { $0 == 0x7E }.count)
    return fence >= 3 && !rest.contains(0x0A)
  }

  // MARK: - The window (item 380)

  /// The room's window over a message's words (rosetta at the pin, clients/room/src/styles/message-preview.css,
  /// `.tr-message__viewport`): at most 21.7 em tall; at least 5 em where words are left out; its words clear from
  /// 32 above its foot, where `View full message` stands in a band of 44.
  static let windowEms: CGFloat = 21.7
  static let windowFloorEms: CGFloat = 5
  static let fadeClearance: CGFloat = 32
  static let openBand: CGFloat = 44

  /// A message's window.
  struct Window: Equatable {
    /// How tall it stands.
    let height: CGFloat
    /// More is left to read than it shows: its words fade, and `View full message` stands over its foot.
    let more: Bool
  }

  /// One stop of the window's fade: how much of the words shows (1 whole, 0 none) at a point down the window (0 its
  /// top, 1 its foot).
  struct FadeStop: Equatable {
    let shows: Double
    let at: Double
  }

  // STUB (item 380, red): the document as it stood. No window: the words stand as tall as they are, and more is
  // left to read only where the excerpt left words out.
  static func window(natural: CGFloat, omitted: Bool, size: CGFloat) -> Window {
    Window(height: natural, more: omitted)
  }

  // STUB (item 380, red): no ramp.
  static func fade(height: CGFloat) -> [FadeStop] {
    [FadeStop(shows: 1, at: 0)]
  }
}
