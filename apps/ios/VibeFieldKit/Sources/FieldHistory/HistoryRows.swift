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

// Item 396 (James, 2026-11-13 23:38:00Z, session qa-01: "a good addition design should be added to both desktop and
// mobile is that we should have a floating button on the side for user to quick jump to previous user message so user
// can quick navigate, help me design and implement nicely") — THE MESSAGE BEFORE. A round button at the document's
// side goes to the nearest message of the person's own that begins above the top of the view. DESIGN.md §8 "The
// phone's session document", "A button at the side goes to the message before".
//
// Pure: each row that is laid out says where it begins against the top of the view (`HistorySight`), and the rules
// below say where a press goes, how it goes there, and whether the button is there at all.

/// Item 396 — where a press on the button at the document's side goes.
enum HistoryBefore: Equatable, Sendable {
  /// No message of the person's own begins above the top of the view, and no row above waits to be read: the
  /// button is gone.
  case nothing
  /// The nearest message of the person's own that begins above the top of the view, by the id its row is found by
  /// (`HistoryRow.promptMark`). It is `near` when it begins a screen above at most: the page eases to it.
  case message(String, near: Bool)
  /// No such message among the rows read, and rows above are not yet read: the document's top, where they are
  /// read in.
  case top

  /// The button is a 40 pt circle with a 44 pt hit area, its glyph at 15 pt, 16 pt in from the screen's edge.
  static let size: CGFloat = 40
  static let reach: CGFloat = 44
  static let glyph: CGFloat = 15
  static let side: CGFloat = 16
  /// The pill it stands level with is 36 pt tall.
  static let pill: CGFloat = 36
  /// How far under the head the message's top is stood.
  static let air: CGFloat = 12
  /// A row begins above the top of the view when its top is more than this far above it. A message a press has
  /// just stood under the head is never counted as above, whatever the rounding, so the next press goes on.
  static let slack: CGFloat = 1
  /// The ease to a message a screen away at most, and the button's own fade, in seconds.
  static let ease: Double = 0.3
  static let fade: Double = 0.2

  /// The button is there while a press has somewhere to go.
  var shows: Bool { self != .nothing }

  /// Where the button's foot stands above the safe area's line: its centre on the pill's centre line, so it
  /// clears whatever stands over the page's foot as the pill does (`HistoryFollow.pillFoot`). Over the bar alone
  /// it is 90 pt.
  static func foot(bar: CGFloat) -> CGFloat { HistoryFollow.pillFoot(bar: bar) + (pill - size) / 2 }

  /// The share of the view's height at which the message's row and the view are lined up, so the message's top
  /// stands 12 pt under the head: the point that share of the way down the row meets the point that share of the
  /// way down the view. The row's own share is taken off the 12, so a short message stands a point nearer the
  /// head and one that fills half the view stands at 6. With the view's height not known it is 0, the top itself.
  static func anchor(screen: CGFloat) -> CGFloat { screen > air ? air / screen : 0 }

  /// The page eases to a place a screen away at most, and never under Reduce Motion.
  static func eases(near: Bool, reduceMotion: Bool) -> Bool { near && !reduceMotion }
}

extension HistoryRow {
  /// Item 396 — where a row that is laid out begins, against the top of the view (the foot of the head).
  enum Standing: Equatable, Sendable {
    /// At the top of the view or below it: on screen, or under the screen's foot.
    case below
    /// Above the top of the view, by a screen at most.
    case above
    /// More than a screen above the top of the view.
    case away
  }

  /// Item 396 — what a laid-out row says of itself: where it begins, and the view's height as it measured it (0
  /// where it could not).
  struct Seen: Equatable, Sendable {
    var standing: Standing
    var screen: CGFloat
  }

  /// Item 396 — where a row begins. `top` is how far its top is below the top of the view, negative above it;
  /// `screen` is the view's height. A row begins above the top once it is more than `HistoryBefore.slack` above
  /// it, and is away once it is more than a screen above it. With the view's height not known every row above is
  /// away, so it is gone to at once.
  static func standing(top: CGFloat, screen: CGFloat) -> Standing {
    if top >= -HistoryBefore.slack { return .below }
    return -top <= screen ? .above : .away
  }

  /// The id a prompt's row is found by in the document: the hit's where a search landed on it, else its turn's.
  /// The view sets it on the row (`HistorySessionView.prompt`), and a landed search and the button at the side
  /// both ask for the row by it.
  static func promptMark(_ turn: HistoryTurn) -> String { turn.promptAnchor ?? "prompt-\(turn.id)" }

  /// Item 396 — the id the document's stack gives the prompt's row that `mark` names (`HistoryRow.id`), or nil
  /// when no prompt among `rows` wears that mark. A press asks for the row by this id as well as by its mark: a
  /// lazy stack knows a row it has not laid out by the id its own ForEach gave it, and knows the id a row's view
  /// carries only once that row is laid out.
  static func promptRow(marked mark: String, in rows: [HistoryRow]) -> String? {
    // STUB (red): no row is found
    nil
  }

  /// Item 396 — where a press on the button at the side goes: to the nearest message of the person's own that
  /// begins above the top of the view. `standing` is where each row that is laid out begins, by the row's id; a
  /// row that is not laid out says nothing. The last row, in the document's order, that begins above the top is
  /// found, and the prompt at that row or nearest before it is the message: one the top of the view cuts is
  /// gone to, and one that begins in the view is not, so a second press goes to the one before. It is near when
  /// its own row is laid out a screen above at most. With no such message the answer is the document's top
  /// while rows above are not yet read (`unread`), and nothing once they all are.
  static func before(_ rows: [HistoryRow], standing: [String: Standing], unread: Bool) -> HistoryBefore {
    let otherwise: HistoryBefore = unread ? .top : .nothing
    let above = standing.filter { $0.value != .below }
    guard !above.isEmpty, let last = rows.lastIndex(where: { above[$0.id] != nil }) else { return otherwise }
    for row in rows[...last].reversed() {
      if case .prompt(let turn) = row { return .message(promptMark(turn), near: standing[row.id] == .above) }
    }
    return otherwise
  }
}
