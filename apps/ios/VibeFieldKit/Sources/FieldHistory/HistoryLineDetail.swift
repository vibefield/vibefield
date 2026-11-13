import FieldProduct

// Item 362f (James, 2026-11-12 18:40:35Z, of the phone's History session view against the desktop's: "i think all
// message type and views are different from desktop, needs thorough audit") — WHAT AN ENTRY SAYS BEYOND ITS ROW.
//
// The document is read two ways. Through the home desktop a row is what fieldd projects (`IndexTimelineRow`): its
// words cut at 2,000 units, its tool a line. Read straight from the desktop's index the phone holds rosetta's whole
// entry and projects the same row from it (`HistoryProjection`), so the two ways read alike. A detail is what that
// projection left behind, kept BESIDE the row and never in it: the row stays the row the door would have sent
// (`HistoryProjectionTests` holds that against fieldd's own pairs), and the merges of a road change go on comparing
// like with like (item 366).
//
// Three things are kept: the body's whole words where the row's were cut (`whole`), what the row's tool line opens
// to (`tool`, `HistoryToolDetail`), and the recorded pictures its attachments name (`pictures`, `HistoryPicture`;
// item 362g). The first is laid over the rows a fold reads (`applied`). The other two never enter the fold or the
// document: they are found beside it, a tool's by its line's id (`opened`), a picture by its attachment's
// (`pictured`).
//
// A detail speaks only for the row it was made beside (`row`). The moment the document holds another row under
// that id (the door sent one that differs), the detail is silent, and it is dropped at the next fold. So no path
// that lands rows has to keep a detail in step with its row.
// DESIGN.md §8 "The phone's session document" → read straight from the desktop, a message is whole.

/// What an entry carries beyond its row.
struct HistoryLineDetail: Equatable, Sendable {
  /// The row this was made beside: the entry's projection, as the door would send it.
  let row: IndexTimelineRow
  /// That row with the body's whole words: `text` whole and `textClipped` off. Nil when the row's words were not
  /// cut, or the whole is not in the entry (a text that is a file on the desktop).
  let whole: IndexTimelineRow?
  /// What the row's tool line opens to; nil for a row that is no tool line, or one with nothing to open.
  let tool: HistoryToolDetail?
  /// Item 362g — the recorded pictures the entry's attachments name, by attachment id; empty when it names none.
  let pictures: [String: HistoryPicture]

  init(
    row: IndexTimelineRow, whole: IndexTimelineRow?, tool: HistoryToolDetail? = nil,
    pictures: [String: HistoryPicture] = [:]
  ) {
    self.row = row
    self.whole = whole
    self.tool = tool
    self.pictures = pictures
  }

  /// What the tool lines open to, by the line's id (a tool line's id is its row's).
  static func opened(_ details: [String: HistoryLineDetail]) -> [String: HistoryToolDetail] {
    details.compactMapValues(\.tool)
  }

  /// Item 362g — the pictures by the id the document has for each attachment: its row's id, a slash, its own
  /// (`HistoryFold` makes a reply's `.attachment` segment's id the same way). The one place the two ids are joined
  /// outside the fold.
  static func pictured(_ details: [String: HistoryLineDetail]) -> [String: HistoryPicture] {
    var found: [String: HistoryPicture] = [:]
    for detail in details.values {
      for (attachmentId, picture) in detail.pictures {
        found["\(detail.row.timelineId)/\(attachmentId)"] = picture
      }
    }
    return found
  }

  /// The rows a fold reads: each row as it is, or as its whole where a detail was made beside that very row.
  static func applied(_ rows: [IndexTimelineRow], _ details: [String: HistoryLineDetail]) -> [IndexTimelineRow] {
    guard !details.isEmpty else { return rows }
    return rows.map { row in
      guard let detail = details[row.timelineId], detail.row == row, let whole = detail.whole else { return row }
      return whole
    }
  }

  /// The details that still speak: those whose row is the row held.
  static func live(
    _ details: [String: HistoryLineDetail], over rows: [String: IndexTimelineRow]
  ) -> [String: HistoryLineDetail] {
    details.filter { rows[$0.key] == $0.value.row }
  }
}

/// An entry, projected: its row, and what it carries beyond it.
struct HistoryProjected: Equatable, Sendable {
  let row: IndexTimelineRow
  let detail: HistoryLineDetail?
}
