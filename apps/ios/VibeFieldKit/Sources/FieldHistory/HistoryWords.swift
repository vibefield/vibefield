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
}
