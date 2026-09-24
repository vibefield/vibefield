import CoreGraphics
import Testing

@testable import FieldHome

/// IOS-9e — the bar's geometry, as decisions: James (2026-09-23) "why the
/// account circle is not in left corner, why their size not match". What is
/// pinned here is exactly that — the corner and the search circle are ONE
/// size, the corner stands in the LEFT corner as the search circle's mirror,
/// the capsule is centred between them with equal gaps — and that every
/// number is the system bar's own, measured on the iPhone 17 simulator.
@Suite("the bar is one row: the account left, the tabs centred, search right")
struct AppBarTests {
  /// The narrowest iOS 26 phone, this one, the widest — as `CGFloat`, the
  /// frames' own type: `#expect` compares a `Double` and a `CGFloat` of the
  /// same value as unequal, which is how this suite first failed.
  static let widths: [CGFloat] = [375, 402, 440]

  @Test("the account circle and the search circle are one size, and it is the bar's height")
  func oneSize() {
    #expect(AccountCornerView.circle == AppBar.height)
    let frames = AppBar.frames(width: 402)
    #expect(frames.account.size == frames.search.size)
    #expect(frames.account.size == CGSize(width: 62, height: 62))
    #expect(frames.capsule.height == frames.account.height)
  }

  @Test("the account stands in the left corner, the search circle's mirror")
  func leftCorner() {
    for width in Self.widths {
      let frames = AppBar.frames(width: width)
      #expect(frames.account.minX == AppBar.margin)
      #expect(width - frames.search.maxX == AppBar.margin)
      #expect(frames.account.minX == width - frames.search.maxX)
    }
  }

  @Test("the capsule is centred with equal gaps, and fits on the narrowest iOS 26 phone")
  func centredCapsule() {
    for width in Self.widths {
      let frames = AppBar.frames(width: width)
      let left = frames.capsule.minX - frames.account.maxX
      let right = frames.search.minX - frames.capsule.maxX
      #expect(abs(left - right) < 0.001)
      #expect(left >= 10, "the capsule would touch a circle at \(width) pt")
    }
    // On the iPhone 17 the gaps are 24 pt, over the glass's melt spacing, so
    // the three shapes stand apart at rest.
    let frames = AppBar.frames(width: 402)
    #expect(frames.capsule.minX - frames.account.maxX == 24)
    #expect(AppBar.meltSpacing < 24)
  }

  @Test("the capsule is the system's: two 86 pt tabs, the pill 94 × 54 standing 4 pt inside")
  func theCapsule() {
    #expect(AppBar.capsuleWidth == 188)
    let pillInsetSide = AppBar.capsuleInset + (AppBar.tabWidth - AppBar.pillWidth) / 2
    let pillInsetTop = (AppBar.height - AppBar.pillHeight) / 2
    #expect(pillInsetSide == 4)
    #expect(pillInsetTop == 4)
  }

  @Test("the row rests where iOS 26 rests its own bar, 21 pt up from the edge on this phone")
  func resting() {
    #expect(AppBar.bottomGap(homeInset: 34) == 21)
    #expect(AppBar.bottomGap(homeInset: 0) == 8)
    // The swarm's band covers the row and 10 pt of air above it.
    #expect(AppBar.band(homeInset: 34) == 93)
    // A page's last row clears the bar, and the stepper when it rides above.
    #expect(AppBar.clearance(homeInset: 34, stepper: false) == 57)
    #expect(AppBar.clearance(homeInset: 34, stepper: true) == 115)
  }
}
