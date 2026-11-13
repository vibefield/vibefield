import CoreGraphics

// Item 381 (James, 2026-11-13 05:29:39Z, of the first build that reads a desktop directly: "some long session shows
// up blank and only shows when i try to scroll") — THE DOCUMENT'S ROWS. The session's document is laid out lazily,
// and what it lays out lazily is a row: a row that was a whole turn stood thousands of points tall once a message
// came whole, and the page's first offset, reckoned on an estimate of rows not yet laid out, overshot its end (a
// reading of the code, not yet shown on a device). A row is ONE PART of a turn, in the order the turn is drawn.
// DESIGN.md §8 "The phone's session document" → "It never rests past its end".
//
// Pure: the view draws one view for each row.

/// One lazy row of a session's document: one part of a turn.
enum HistoryRow: Identifiable, Equatable, Sendable {
  /// The room above a turn that opens no sitting.
  case gap(turn: String)
  /// The pill of the sitting the turn opens (item 362c), in place of the room above.
  case sitting(turn: String, pill: HistoryDayPill)
  /// The turn's prompt, on its panel.
  case prompt(HistoryTurn)
  /// The words under a prompt the desktop cut (`clipped · 14 KB on studio`).
  case promptClipped(turn: String, words: String)
  /// One thing attached to the prompt, as its placeholder's words; `index` is its place among them.
  case promptAttachment(turn: String, index: Int, words: String)
  /// The reply's head: the agent, the model, the facts.
  case head(HistoryTurn)
  /// One part of the reply: a reply's words, a group, an attachment, a cut's note, a request. It keeps its turn,
  /// which the view reads when a reply's whole message is asked for.
  case segment(HistorySegment, turn: HistoryTurn)

  /// The room above a turn that opens no sitting.
  static let turnGap: CGFloat = 30

  /// Its own among the document's rows: the part's kind, its turn, and the part's own id where it has one.
  var id: String {
    switch self {
    case .gap(let turn): "gap/\(turn)"
    case .sitting(let turn, _): "sitting/\(turn)"
    case .prompt(let turn): "prompt/\(turn.id)"
    case .promptClipped(let turn, _): "prompt-clipped/\(turn)"
    case .promptAttachment(let turn, let index, _): "prompt-attachment/\(turn)/\(index)"
    case .head(let turn): "head/\(turn.id)"
    case .segment(let segment, let turn): "segment/\(turn.id)/\(segment.id)"
    }
  }

  // STUB (item 381, red): no rows. The view still draws a turn whole.
  static func of(_ turns: [HistoryTurn]) -> [HistoryRow] {
    []
  }
}
