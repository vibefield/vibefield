import Foundation
import QuartzCore
import Testing

@testable import FieldSplash

/// WI-1 — the splash's hold (DESIGN.md §8 "The phone's way in"): while the content holds it the splash never
/// leaves, however steady the content and however long its field has stood; released, it leaves by its own exit;
/// and a hold taken once it has gone brings it back over the content. Driven through the gate's own model, as the
/// view drives it (the field's first frame, the content's hold), with Reduce Motion's halved fades.
@MainActor
@Suite("WI-1: the content holds the splash up, and brings it back")
struct SplashHoldTests {
  /// Polls on the main actor until `done` holds; false once `limit` has passed without it.
  private func waited(_ limit: Duration = .seconds(10), until done: () -> Bool) async -> Bool {
    let clock = ContinuousClock()
    let end = clock.now.advanced(by: limit)
    while !done() {
      if clock.now >= end { return false }
      try? await Task.sleep(for: .milliseconds(20))
    }
    return true
  }

  @Test(
    "held, the splash stays past its floor and the content's steadiness; released, it leaves by its own exit",
    .timeLimit(.minutes(1)))
  func aHoldKeepsTheSplash() async {
    let model = SplashGateModel()
    model.begin(reduceMotion: true)
    model.setHold(true)
    model.fieldPresented(at: CACurrentMediaTime())
    #expect(model.contentMounted)
    #expect(model.holding)
    // past the floor and past the steadiness limit: a splash not held has left by now whatever the frames did
    try? await Task.sleep(for: SplashTiming.stableLimit + .milliseconds(500))
    #expect(!model.revealing)
    #expect(!model.gone)
    model.setHold(false)
    #expect(!model.holding)
    #expect(await waited { model.revealing }, "the splash leaves once released")
    #expect(await waited { model.gone }, "and is gone after its fade")
  }

  @Test(
    "a hold taken once the splash has gone brings it back over the content; released, it leaves again",
    .timeLimit(.minutes(1)))
  func aHoldBringsTheSplashBack() async {
    let model = SplashGateModel()
    model.begin(reduceMotion: true)
    model.fieldPresented(at: CACurrentMediaTime())
    #expect(await waited { model.gone }, "unheld, the splash leaves at launch")
    model.setHold(true)
    // back at once, the content still mounted under it
    #expect(model.holding)
    #expect(!model.gone)
    #expect(!model.revealing)
    #expect(model.contentMounted)
    // the new surface's first frame: it stands its floor again, and the hold keeps it past that
    model.fieldPresented(at: CACurrentMediaTime())
    try? await Task.sleep(for: SplashTiming.floor + .milliseconds(400))
    #expect(!model.revealing)
    model.setHold(false)
    #expect(await waited { model.gone }, "released, it leaves by its own exit again")
  }

  @Test("the hold is any asker's: one holding is enough, and none holding releases it")
  func anyAskerHolds() {
    var value = SplashHoldKey.defaultValue
    #expect(!value)
    SplashHoldKey.reduce(value: &value) { false }
    #expect(!value)
    SplashHoldKey.reduce(value: &value) { true }
    SplashHoldKey.reduce(value: &value) { false }
    #expect(value)
  }
}
