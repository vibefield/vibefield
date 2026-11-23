import CoreGraphics
import SwiftUI
import Testing

@testable import FieldInput

/// PF-11 (2026-11-22; DESIGN.md §8 "The phone's input card is one row in each
/// of its two modes") — the row of chips, switch and fold key is a shelf while
/// the keyboard is up: it keeps one row's height, and the grid ends above it.
/// With the keyboard down it keeps none and floats.
@MainActor
@Suite("PF-11 — the switch's row is a shelf while the keyboard is up")
struct InputShelfTests {
  @Test("the row is a shelf whenever anything holds the keyboard, and never with it down")
  func whenTheRowIsAShelf() {
    #expect(!InputOverlay.shelved(.none))
    #expect(InputOverlay.shelved(.composer))
    #expect(InputOverlay.shelved(.terminal))
    #expect(InputOverlay.shelved(.keypad))
  }

  @Test("a shelf keeps one row's height; floating, the row keeps no room")
  func theRoomKept() {
    #expect(InputOverlay.reserved(shelved: true, rowHeight: 44) == 44)
    #expect(InputOverlay.reserved(shelved: true, rowHeight: 52) == 52)
    #expect(InputOverlay.reserved(shelved: false, rowHeight: 44) == 0)
    #expect(InputOverlay.shelfGap == 2)
  }

  /// PF-19 (2026-11-23): floating, the row keeps no room of its own, and the grid ends above the room it stands
  /// in: its 12pt lift and the doors, which stand 8pt over a row.
  @Test("the floating row stands in 64pt at the default size, and the held message clears 18 more")
  func theFloatingRowsRoom() {
    #expect(InputOverlay.floatingRoom(for: .large) == CGFloat(64))
    #expect(InputOverlay.footprint(for: .large) == CGFloat(82))
    for size in [DynamicTypeSize.xSmall, .large, .xxxLarge, .accessibility3] {
      #expect(InputOverlay.floatingRoom(for: size) == InputCardMetrics.rowHeight(for: size) + CGFloat(20))
      #expect(InputOverlay.footprint(for: size) == InputOverlay.floatingRoom(for: size) + CGFloat(18))
    }
  }

  @Test("the row follows the model: up in either mode it is a shelf, folded it floats")
  func theRowFollowsTheModel() {
    let model = InputCardModel()
    #expect(!InputOverlay.shelved(model.keyboardOwner))
    model.enter(.draft)
    #expect(InputOverlay.shelved(model.keyboardOwner))
    model.enter(.live)
    #expect(InputOverlay.shelved(model.keyboardOwner))
    model.dismissKeyboard()
    #expect(!InputOverlay.shelved(model.keyboardOwner))
  }
}
