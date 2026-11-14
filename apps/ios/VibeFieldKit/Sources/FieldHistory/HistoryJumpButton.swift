import FieldDesign
import SwiftUI

// Item 396 (James, 2026-11-13 23:38:00Z, session qa-01: "a good addition design should be added to both desktop and
// mobile is that we should have a floating button on the side for user to quick jump to previous user message so user
// can quick navigate, help me design and implement nicely") — THE BUTTON AT THE DOCUMENT'S SIDE, and how a session's
// document knows which of its rows begin above the top of the view. The rules are pure and stand beside the rows
// (`HistoryBefore`, `HistoryRow.before`, HistoryRows.swift). DESIGN.md §8 "The phone's session document", "A button
// at the side goes to the message before".
//
// HOW THE DOCUMENT KNOWS. Each row says where it begins while it is laid out (`sighted`), measured in the document's
// own space (`HistorySight.space`, set on the scroll view, whose top is the top of the view under the head). It is
// the rows' own geometry and not the scroll view's visibility callbacks, for two reasons: the text asks which message
// BEGINS above the top of the view, which a row's top answers and "is on screen" does not; and nothing is added to
// the scroll view that could move it (no scroll target layout, no second position). The page's following, its
// return to its end and its reading of the rows above are left as they were.

/// Item 396 — the round button at the session document's trailing side that goes to the message before: a 40 pt
/// glass circle holding `chevron.up`, level with the pill at the foot, 16 pt in from the screen's edge. It is there
/// only while a press has somewhere to go (`HistoryBefore.shows`), fades in and out over 200 ms, and takes no press
/// while it is gone. It reads where the rows begin itself, so a row crossing the top of the view draws the button
/// again and not the document.
struct HistoryJumpButton: View {
  /// The document's rows in order, and whether rows above them are not yet read.
  let rows: [HistoryRow]
  let unread: Bool
  /// Where each laid-out row begins.
  let sight: HistorySight
  /// Where the button's foot stands above the safe area's line (`HistoryBefore.foot`).
  let foot: CGFloat
  /// A press, with where it goes as the rule said it when the press came.
  let go: (HistoryBefore) -> Void

  var body: some View {
    let before = HistoryRow.before(rows, standing: sight.standing, unread: unread)
    Button {
      go(before)
    } label: {
      Image(systemName: "chevron.up")
        .font(.system(size: HistoryBefore.glyph, weight: .semibold))
        .foregroundStyle(ChromePalette.ink)
        .frame(width: HistoryBefore.reach, height: HistoryBefore.reach)
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    // the press reaches 44 pt and the glass is 40: the button gives the 2 pt around it back before the glass is cut
    .padding(-(HistoryBefore.reach - HistoryBefore.size) / 2)
    .liquidGlassCircle()
    .opacity(before.shows ? 1 : 0)
    .allowsHitTesting(before.shows)
    .accessibilityHidden(!before.shows)
    .accessibilityLabel("Previous message")
    .animation(FieldMotion.plainEase(HistoryBefore.fade), value: before.shows)
    .padding(.trailing, HistoryBefore.side)
    .padding(.bottom, foot)
  }
}

/// Item 396 — where the rows of a session's document that are laid out begin, against the top of the view. A row
/// counts only while it is in the layout (`came`, `left`): what a row that has left last said is true of nothing,
/// and would name a message the page has since gone past. Only the button reads `standing`, so a row crossing the
/// top of the view never draws the document again.
@MainActor
@Observable
final class HistorySight {
  /// The document's own coordinate space, named on its scroll view: its top is the top of the view, under the head.
  static let space = "history-document"

  /// Where each row in the layout begins, by the row's id (`HistoryRow.id`).
  private(set) var standing: [String: HistoryRow.Standing] = [:]
  /// The view's height as a row last measured it: 0 until one has.
  @ObservationIgnored private(set) var screen: CGFloat = 0
  /// What each row last said, kept while it is out of the layout. A row says where it begins only when that
  /// changes, so one that comes back where it left says nothing new, and its last word is still true of it.
  @ObservationIgnored private var said: [String: HistoryRow.Standing] = [:]
  @ObservationIgnored private var laidOut: Set<String> = []

  /// A row said where it begins.
  func saw(_ id: String, _ seen: HistoryRow.Seen) {
    if seen.screen > 0 { screen = seen.screen }
    said[id] = seen.standing
    if laidOut.contains(id), standing[id] != seen.standing { standing[id] = seen.standing }
  }

  /// A row came into the layout: what it last said counts again.
  func came(_ id: String) {
    laidOut.insert(id)
    if let last = said[id], standing[id] != last { standing[id] = last }
  }

  /// A row left the layout: it counts for nothing until it comes back.
  func left(_ id: String) {
    laidOut.remove(id)
    if standing[id] != nil { standing[id] = nil }
  }
}

extension View {
  /// Item 396 — on a row of a session's document: it says where it begins against the top of the view, in the
  /// document's own space, when it is laid out and whenever that changes (`HistoryRow.standing`), and says when
  /// it comes into the layout and leaves it (`HistorySight`).
  @MainActor
  func sighted(_ id: String, by sight: HistorySight) -> some View {
    let space = HistorySight.space
    return onGeometryChange(for: HistoryRow.Seen.self) { geometry in
      // the view's height is the document's own space's, or failing that the scroll view's as the system names it
      let screen = geometry.bounds(of: .named(space))?.height ?? geometry.bounds(of: .scrollView)?.height ?? 0
      let top = geometry.frame(in: .named(space)).minY
      return HistoryRow.Seen(standing: HistoryRow.standing(top: top, screen: screen), screen: screen)
    } action: { seen in
      sight.saw(id, seen)
    }
    .onAppear { sight.came(id) }
    .onDisappear { sight.left(id) }
  }
}
