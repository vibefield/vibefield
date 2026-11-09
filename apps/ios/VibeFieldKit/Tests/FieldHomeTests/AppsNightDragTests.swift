import CoreGraphics
import Testing

@testable import FieldHome

/// MA-6e — an empty Chat has no list to overscroll: ES-5c's night stands in its place, so the night feeds the pull from
/// a drag of its own (VF-PM, 2026-11-09 15:07Z). This row holds the seam, the value the drag feeds. No unit row can
/// drive a SwiftUI gesture; the finger itself is James's, on a device (P6).
///
/// No key path, no `try` and no `mutating` call inside an #expect/#require argument: hoisted into a `let` first.
@MainActor
@Suite("MA-6e — the empty Chat's night reads the pull, at the seam")
struct AppsNightDragTests {
  @Test("the night's seam: the value a drag feeds reads 132 and answers opens; the finger is James's P6")
  func nightSeam() {
    var drag = AppsNightDrag()
    let depth = drag.changed(CGSize(width: 0, height: 132))
    #expect(depth == 132)
    let model = AppsDoorModel(store: nil)
    model.moved(to: depth ?? 0)
    let ended = drag.ended()
    #expect(ended)
    let opens = model.released()
    #expect(opens)

    var sideways = AppsNightDrag()
    let first = sideways.changed(CGSize(width: 40, height: 5))
    #expect(first == nil)
    let after = sideways.changed(CGSize(width: 40, height: 140))
    #expect(after == nil)
    let endedSideways = sideways.ended()
    #expect(endedSideways == false)
  }
}
