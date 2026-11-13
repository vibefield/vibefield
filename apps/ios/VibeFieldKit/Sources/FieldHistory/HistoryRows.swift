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
  /// What was attached to the prompt, as one strip (item 362g): each its tile where a direct read holds its
  /// picture, and otherwise its placeholder's line.
  case promptStrip(turn: String, [HistoryAttached])
  /// The reply's head: the agent, the model, the facts.
  case head(HistoryTurn)
  /// One part of the reply: a reply's words, a group, a cut's note, a request. It keeps its turn, which the view
  /// reads when a reply's whole message is asked for. An attachment is no row of its own: it stands in a strip.
  case segment(HistorySegment, turn: HistoryTurn)
  /// A run of the reply's attachments, as one strip (item 362g): a reply's under the reply, a group's under the
  /// group. The pictures of one message are one row, as tall as their tiles.
  case strip(turn: String, [HistoryAttached])

  /// The room above a turn that opens no sitting.
  static let turnGap: CGFloat = 30

  /// Its own among the document's rows: the part's kind, its turn, and the part's own id where it has one.
  var id: String {
    switch self {
    case .gap(let turn): "gap/\(turn)"
    case .sitting(let turn, _): "sitting/\(turn)"
    case .prompt(let turn): "prompt/\(turn.id)"
    case .promptClipped(let turn, _): "prompt-clipped/\(turn)"
    case .promptStrip(let turn, _): "prompt-strip/\(turn)"
    case .head(let turn): "head/\(turn.id)"
    case .segment(let segment, let turn): "segment/\(turn.id)/\(segment.id)"
    case .strip(let turn, let attached): "strip/\(turn)/\(attached.first?.id ?? "")"
    }
  }

  /// The document's rows: each turn's parts in the order the turn is drawn. The room above, or the sitting's pill
  /// in its place; the prompt, where it has words or a search landed on it; the cut's note and the strip of what
  /// was attached under it; the reply's head, unless the turn is a later part of a reply that time cut; each part
  /// of the reply, a run of its attachments gathered into one strip (item 362g, `HistoryPictureLayout.pieces`).
  /// `desktop` is the name an attachment with no words of its own is said by (`attachment on studio`).
  static func of(_ turns: [HistoryTurn], desktop: String) -> [HistoryRow] {
    var rows: [HistoryRow] = []
    for turn in turns {
      if let pill = turn.dayPill {
        rows.append(.sitting(turn: turn.id, pill: pill))
      } else {
        rows.append(.gap(turn: turn.id))
      }
      if !turn.prompt.isEmpty || turn.promptAnchor != nil { rows.append(.prompt(turn)) }
      if let words = turn.promptClipped { rows.append(.promptClipped(turn: turn.id, words: words)) }
      if !turn.promptAttachments.isEmpty {
        rows.append(.promptStrip(turn: turn.id, HistoryPictureLayout.attached(to: turn)))
      }
      if !turn.segments.isEmpty, !turn.continues { rows.append(.head(turn)) }
      for piece in HistoryPictureLayout.pieces(turn.segments, desktop: desktop) {
        switch piece {
        case .segment(let segment): rows.append(.segment(segment, turn: turn))
        case .strip(let attached): rows.append(.strip(turn: turn.id, attached))
        }
      }
    }
    return rows
  }
}
