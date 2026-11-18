import CoreGraphics
import Testing

@testable import FieldHome

/// Item 348 — an empty Chat has no list: ES-5c's night stands in its place. The night takes the one pull every tab
/// takes (DESIGN.md §8 "The phone's Apps": "One pull on every tab"), from anywhere on it, because a page with no list
/// stands at its top. This row holds the seam, the values the drag feeds. No unit row can drive a SwiftUI gesture; the
/// finger itself is to be tried on a device.
/// *(Corrected 2026-11-12, item 348: this suite held `AppsNightDrag`, the drag of its own the night had while History's
/// and Chat's pulls were their lists' overscroll, MA-6e, decided 2026-11-09.)*
///
/// No key path, no `try` and no `mutating` call inside an #expect/#require argument: hoisted into a `let` first.
@MainActor
@Suite("item 348 — the empty Chat's night takes the one pull, at the seam")
struct AppsNightDragTests {
  @Test("the night's seam: a drag down on it is the door's, reads 132 and answers opens; the finger needs a device")
  func nightSeam() {
    let model = AppsDoorModel(store: nil)
    let atTop = model.chatAtTop
    #expect(atTop, "no list has said otherwise")

    let down = CGSize(width: 0, height: 132)
    let decided = AppsPull.decides(down)
    #expect(decided)
    let begins = AppsPull.begins(
      start: CGPoint(x: 200, y: 400), translation: down, safeTop: 59, ground: .list(atTop: atTop))
    #expect(begins)
    model.moved(to: down.height)
    let opens = model.released()
    #expect(opens)

    let across = CGSize(width: 40, height: 5)
    let decidedAcross = AppsPull.decides(across)
    #expect(decidedAcross)
    let sideways = AppsPull.begins(
      start: CGPoint(x: 200, y: 400), translation: across, safeTop: 59, ground: .list(atTop: atTop))
    #expect(sideways == false, "a drag across is the night's own")
  }
}
