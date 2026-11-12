import CoreGraphics
import FieldMarkdown
import FieldProduct
import Foundation

// Item 362d (red) — the names `HistoryWordsTests` calls, answering nothing yet: every message's words stand as typed
// (what the document draws today), and both measures are the stub's. The reading and the figures are the next
// commit's.

enum HistoryWords {
  enum Reading: Equatable {
    case blank
    case blocks([ChatMarkdownBlock])
    case typed(String)
  }

  static func reading(_ text: String) -> Reading { .typed(text) }

  static let reply = ChatMarkdownMeasure.chat
  static let prompt = ChatMarkdownMeasure.chat
}
