import CoreGraphics
import Testing

@testable import FieldHistory

/// Item 416 (asked for 2026-11-14, of a project's page on a phone: the project's title and its count bubble on
/// the back button's row, in line with History's Projects line, and a title too long for it cut off
/// properly) — a project's head stands in
/// the bar over its page, and a name too long for that row is cut at its end.
///
/// These rows hold the RULE the page draws from: which line the head stands on, and how its name gives way. What
/// the head says (its name, its bubble, its spoken line) is items 390 and 392's, held by HistoryHeadTests. How the
/// row looks beside the back button is to be seen on a device.
@Suite("item 416 — a project's head stands on the back button's row, and a long name is cut at its end")
struct HistoryProjectHeadTests {
  @Test("the head stands on the back button's row, and not on the page under the bar")
  func theLine() {
    #expect(HistoryProjectHead.line == .bar)
    #expect(HistoryProjectHead.line != .page)
  }

  @Test("a name too long for the row is cut at its end, and is not drawn smaller first")
  func theCut() {
    #expect(HistoryProjectHead.giving == .cut)
  }

  @Test("so the name is drawn at its own size, whatever its length")
  func itsOwnSize() {
    #expect(HistoryProjectHead.scale == 1)
  }
}
