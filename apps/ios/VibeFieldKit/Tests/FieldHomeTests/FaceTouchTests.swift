import CoreGraphics
import Testing

@testable import FieldHome

/// Item 346 (DESIGN.md §8 "The phone's corner": "Hold it") — one touch on the face, read whole by the corner itself
/// (`FaceHold.Touch`): let go inside the slop it is the menu's tap; left there until the hold's clock runs out it
/// opens the held face, and its let-go is the lens's; carried past the slop first it is neither.
///
/// These rows hold the decision only. What they cannot hold is the fault itself: on an iPhone (iOS 26.6) the two
/// gestures the face wore, `holdGesture.exclusively(before: tap)`, gave the hold and never the tap. That is SwiftUI's
/// arbitration on a device, which no package-hosted run touches; its witness is the phone's own trace (the item's
/// record).
///
/// No mutating call inside an #expect: each is hoisted into a statement of its own first.
@Suite("the face's touch: the menu's tap, the held face, or neither")
@MainActor
struct FaceTouchTests {
  @Test("let go inside the slop before the hold's clock runs out, the touch is the menu's tap")
  func tap() {
    var touch = FaceHold.Touch()
    touch.moved(CGSize(width: 3, height: -4))
    #expect(touch.standing == .down)
    #expect(touch.letGo == .tap)
  }

  @Test("the slop is 10: a touch 10 from where it came down is still inside it, and one past it has strayed")
  func slop() {
    var inside = FaceHold.Touch()
    inside.moved(CGSize(width: 6, height: 8))
    #expect(inside.standing == .down)
    #expect(inside.letGo == .tap)

    var past = FaceHold.Touch()
    past.moved(CGSize(width: 6, height: 8.5))
    #expect(past.standing == .strayed)
    #expect(past.letGo == .nothing)
  }

  @Test("the clock run out inside the slop opens the held face: the finger then reaches, and its let-go releases")
  func hold() {
    var touch = FaceHold.Touch()
    touch.moved(CGSize(width: 2, height: 2))
    let opened = touch.clockRanOut()
    #expect(opened)
    #expect(touch.standing == .held)
    // the reach is far past the slop, and the touch stays the hold's
    touch.moved(CGSize(width: 120, height: -160))
    #expect(touch.standing == .held)
    #expect(touch.letGo == .release)
  }

  @Test("a touch carried past the slop first is neither: the clock opens nothing on it, and coming back is no tap")
  func strayed() {
    var touch = FaceHold.Touch()
    touch.moved(CGSize(width: 0, height: 24))
    #expect(touch.standing == .strayed)
    let opened = touch.clockRanOut()
    #expect(!opened)
    touch.moved(.zero)
    #expect(touch.standing == .strayed)
    #expect(touch.letGo == .nothing)
  }
}
