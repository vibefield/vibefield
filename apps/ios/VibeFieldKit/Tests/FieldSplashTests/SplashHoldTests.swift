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

  // --- on a stepped clock (WI-1's review): nothing here waits on the wall clock

  /// Reduce Motion's fades: the launch screen's and the splash's own, halved.
  private static let fade: Duration = .milliseconds(120)
  /// From the field's first frame, its fade and the floor, and a millisecond past them.
  private static let floorStood: Duration = .milliseconds(120) + SplashTiming.floor + .milliseconds(1)

  /// A gate on a stepped clock: begun, its field's first frame up, the content steady and the floor stood. Unheld,
  /// the splash has started to leave; held, it stands.
  private func launched(held: Bool = false) -> (SplashGateModel, SplashSteps, SteadyByHand) {
    let steps = SplashSteps()
    let watch = SteadyByHand()
    let model = SplashGateModel(timer: steps, watch: watch)
    model.begin(reduceMotion: true)
    if held { model.setHold(true) }
    model.fieldPresented(at: CACurrentMediaTime())
    watch.steady()
    steps.advance(by: Self.floorStood)
    return (model, steps, watch)
  }

  @Test("M1: the splash covers the content from launch until it starts to leave")
  func coversFromLaunch() {
    let steps = SplashSteps()
    let watch = SteadyByHand()
    let model = SplashGateModel(timer: steps, watch: watch)
    #expect(model.covers)
    model.begin(reduceMotion: true)
    model.fieldPresented(at: CACurrentMediaTime())
    #expect(model.contentMounted)
    #expect(model.covers, "the content comes under it whole")
    watch.steady()
    steps.advance(by: Self.floorStood - .milliseconds(2))
    #expect(model.covers)
    #expect(!model.revealing, "the floor still stands")
    steps.advance(by: .milliseconds(2))
    #expect(model.revealing)
    #expect(!model.covers, "leaving, it covers nothing")
    steps.advance(by: Self.fade)
    #expect(model.gone)
    #expect(!model.covers)
  }

  @Test("M1: a come-back covers the content only once its fade has run; the content stays under it till then")
  func aComeBackCoversOnceFadedIn() {
    let (model, steps, watch) = launched()
    steps.advance(by: Self.fade)
    #expect(model.gone)
    model.setHold(true)
    #expect(!model.gone && !model.revealing, "back at once")
    #expect(model.contentMounted, "the content stays under it")
    #expect(!model.covers, "fading in, it covers nothing yet")
    steps.advance(by: Self.fade - .milliseconds(10))
    #expect(!model.covers)
    steps.advance(by: .milliseconds(10))
    #expect(model.covers, "whole once its fade has run")
    // the new surface's first frame; released and steady, it leaves past its floor and covers nothing
    model.fieldPresented(at: CACurrentMediaTime())
    model.setHold(false)
    watch.steady()
    #expect(model.covers && !model.revealing, "the new field stands its floor")
    steps.advance(by: Self.floorStood)
    #expect(model.revealing)
    #expect(!model.covers)
  }

  @Test("M1: released before its fade has run, a come-back never covers the content, and leaves again")
  func aReleaseBeforeCovering() {
    let (model, steps, watch) = launched()
    steps.advance(by: Self.fade)
    model.setHold(true)
    steps.advance(by: .milliseconds(50))
    model.setHold(false)
    watch.steady()
    #expect(model.revealing, "steady, and no new field to stand a floor: it leaves at once")
    steps.advance(by: Self.fade)
    #expect(!model.covers, "the come-back's fade ended after it had started to leave again")
    #expect(model.gone)
  }

  @Test("L1: a leaving fade overtaken by a come-back does not end the next fade early")
  func anOvertakenFadeEndsNothing() {
    let (model, steps, watch) = launched()
    #expect(model.revealing)
    steps.advance(by: .milliseconds(50))
    model.setHold(true)
    #expect(!model.revealing && !model.gone, "caught mid-fade, it comes back")
    model.setHold(false)
    watch.steady()
    #expect(model.revealing, "its field up and its floor stood, it leaves again at once")
    // the first fade's end, 80 ms into the second
    steps.advance(by: .milliseconds(80))
    #expect(!model.gone, "the first fade's end is not the second's")
    steps.advance(by: .milliseconds(45))
    #expect(model.gone, "gone at the second fade's own end")
  }

  @Test("L1: a come-back caught mid-fade keeps its field: the same surface's frame again stands no second floor")
  func aMidFadeComeBackKeepsItsField() {
    let (model, steps, watch) = launched()
    steps.advance(by: .milliseconds(50))
    model.setHold(true)
    // the same surface, back in its window, says a first frame again
    model.fieldPresented(at: CACurrentMediaTime())
    model.setHold(false)
    watch.steady()
    #expect(model.revealing, "its floor stood once: it leaves at once")
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
