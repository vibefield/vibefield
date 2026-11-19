import Foundation
import QuartzCore
import Testing

@testable import FieldSplash

/// WI-1 — the splash's hold (DESIGN.md §8 "The phone's way in"): while the content holds it the splash never
/// leaves, however steady the content and however long its field has stood; released, it leaves by its own exit;
/// and a hold taken once it has gone brings it back over the content. Driven through the gate's own model, as the
/// view drives it (the field's first frame, the content's hold), with Reduce Motion's halved fades — on a stepped
/// timer and a steadiness said by hand (WI-1's review, L7), so no row waits on the wall clock or fails for a loaded
/// host (item 157's lesson).
@MainActor
@Suite("WI-1: the content holds the splash up, and brings it back")
struct SplashHoldTests {
  /// The reduced-motion exit.
  private static let fade: Duration = .milliseconds(120)
  /// One millisecond past the end of each entrance fade.
  private static let reducedEntrance: Duration = .milliseconds(81)
  private static let liveEntrance: Duration = .milliseconds(161)

  /// A gate on the stepped timer, begun and not yet shown.
  private func gate(reduceMotion: Bool = true) -> (SplashGateModel, SplashSteps, SteadyByHand) {
    let steps = SplashSteps()
    let watch = SteadyByHand()
    let model = SplashGateModel(timer: steps, watch: watch)
    model.begin(reduceMotion: reduceMotion)
    return (model, steps, watch)
  }

  @Test("the live launch waits for unlock and hands over on the final GPU frame")
  func tearAfterUnlock() throws {
    let (model, steps, watch) = gate(reduceMotion: false)
    model.setVisible(false)
    model.fieldPresented(at: CACurrentMediaTime())
    watch.steady()
    steps.advance(by: .seconds(12))
    #expect(model.covers && !model.revealing)
    model.setVisible(true)
    let tear = try #require(model.tear)
    steps.advance(by: .milliseconds(700))
    #expect(!model.gone && !model.fading)
    model.tearFinished(tear)
    #expect(model.gone)
    model.setVisible(false)
    model.setVisible(true)
    #expect(model.gone && model.tear == nil)
  }

  @Test("a hold or an obscured window cancels the tear and rejects late GPU callbacks")
  func interruptedTear() throws {
    let (model, steps, watch) = gate(reduceMotion: false)
    model.fieldPresented(at: CACurrentMediaTime())
    watch.steady()
    steps.advance(by: Self.liveEntrance)
    let first = try #require(model.tear)
    model.setHold(true)
    model.setHold(false)
    watch.steady()
    let second = try #require(model.tear)
    model.setVisible(false)
    model.tearFinished(second)
    #expect(model.covers && !model.gone)
    model.setVisible(true)
    let last = try #require(model.tear)
    model.tearFinished(first)
    model.tearFinished(second)
    #expect(!model.gone && model.tear == last)
    model.tearFinished(last)
    #expect(model.gone)
  }

  @Test("a ready Field opens as the entrance finishes and a stalled exit falls back after 950ms")
  func tearTimeout() throws {
    let (model, steps, watch) = gate(reduceMotion: false)
    model.fieldPresented(at: CACurrentMediaTime())
    watch.steady()
    steps.advance(by: .milliseconds(159))
    #expect(model.tear == nil)
    steps.advance(by: .milliseconds(2))
    let tear = try #require(model.tear)
    steps.advance(by: .milliseconds(940))
    #expect(!model.fading && !model.gone)
    steps.advance(by: .milliseconds(10))
    #expect(model.tear == tear && model.fading && !model.gone)
    steps.advance(by: .milliseconds(240))
    #expect(model.gone)
  }

  @Test("Reduce Motion and an unavailable Metal surface use the short fade")
  func shaderFallbacks() {
    let (model, steps, watch) = gate()
    model.fieldPresented(at: CACurrentMediaTime())
    watch.steady()
    steps.advance(by: Self.reducedEntrance)
    #expect(model.tear == nil && model.fading)
    steps.advance(by: Self.fade)
    #expect(model.gone)

    let (still, timer, frames) = gate(reduceMotion: false)
    still.fieldFailed("Metal unavailable")
    frames.steady()
    #expect(still.tear == nil && still.fading)
    timer.advance(by: .milliseconds(240))
    #expect(still.gone)
  }

  @Test("turning on Reduce Motion mid-tear finishes with the 120ms fade")
  func reduceMotionDuringTear() throws {
    let (model, steps, watch) = gate(reduceMotion: false)
    model.fieldPresented(at: CACurrentMediaTime())
    watch.steady()
    steps.advance(by: Self.liveEntrance)
    let tear = try #require(model.tear)
    model.setReduceMotion(true)
    model.tearFinished(tear)
    #expect(model.fading && !model.gone)
    steps.advance(by: Self.fade)
    #expect(model.gone)
  }

  /// A gate on the stepped timer after its entrance, with the content steady.
  /// Unheld, the splash has started to leave; held, it stands.
  private func launched(held: Bool = false) -> (SplashGateModel, SplashSteps, SteadyByHand) {
    let (model, steps, watch) = gate()
    if held { model.setHold(true) }
    model.fieldPresented(at: CACurrentMediaTime())
    watch.steady()
    steps.advance(by: Self.reducedEntrance)
    return (model, steps, watch)
  }

  @Test("the hold keeps a steady Field covered until release")
  func aHoldKeepsTheSplash() {
    let (model, steps, watch) = gate()
    model.setHold(true)
    model.fieldPresented(at: CACurrentMediaTime())
    #expect(model.contentMounted)
    #expect(model.holding)
    watch.steady()
    // A held splash also stays past the steadiness timeout.
    steps.advance(by: SplashTiming.stableLimit + .milliseconds(500))
    #expect(!model.revealing)
    #expect(!model.gone)
    model.setHold(false)
    #expect(!model.holding)
    #expect(!model.revealing, "released, it watches the content again first")
    watch.steady()
    #expect(model.revealing)
    steps.advance(by: Self.fade)
    #expect(model.gone, "and is gone after its fade")
  }

  @Test("a hold taken once the splash has gone brings it back over the content; released, it leaves again")
  func aHoldBringsTheSplashBack() {
    let (model, steps, watch) = launched()
    steps.advance(by: Self.fade)
    #expect(model.gone, "unheld, the splash leaves at launch")
    model.setHold(true)
    // back at once, the content still mounted under it
    #expect(model.holding)
    #expect(!model.gone)
    #expect(!model.revealing)
    #expect(model.contentMounted)
    // The hold outlasts the new surface's entrance.
    model.fieldPresented(at: CACurrentMediaTime())
    steps.advance(by: Self.reducedEntrance + .milliseconds(400))
    #expect(!model.revealing)
    model.setHold(false)
    watch.steady()
    #expect(model.revealing)
    steps.advance(by: Self.fade)
    #expect(model.gone, "released, it leaves by its own exit again")
  }

  @Test("L7: a hold taken mid-fade brings it back, whole once its own fade has run; the leaving fade's end leaves it")
  func aHoldMidFade() {
    let (model, steps, _) = launched()
    #expect(model.revealing)
    steps.advance(by: .milliseconds(60))
    model.setHold(true)
    #expect(!model.revealing && !model.gone, "back at once, from where its fade had reached")
    #expect(!model.covers)
    steps.advance(by: Self.fade + .milliseconds(10))
    #expect(!model.gone, "the leaving fade's end does not take it away")
    #expect(model.covers, "whole once its own fade has run")
  }

  @Test("L7: a hold released before the content is mounted strands nothing: the splash leaves as a launch's does")
  func aReleaseBeforeMount() {
    let (model, steps, watch) = gate()
    model.setHold(true)
    model.setHold(false)
    #expect(!model.contentMounted, "nothing under it yet")
    model.fieldPresented(at: CACurrentMediaTime())
    #expect(model.contentMounted)
    watch.steady()
    #expect(!model.revealing, "the entrance is still fading in")
    steps.advance(by: Self.reducedEntrance)
    #expect(model.revealing)
    steps.advance(by: Self.fade)
    #expect(model.gone)
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
    steps.advance(by: Self.reducedEntrance - .milliseconds(2))
    #expect(model.covers)
    #expect(!model.revealing)
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
    // A new surface finishes entering before it leaves.
    model.fieldPresented(at: CACurrentMediaTime())
    model.setHold(false)
    watch.steady()
    #expect(model.covers && !model.revealing)
    steps.advance(by: Self.reducedEntrance)
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
    #expect(model.revealing)
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
    #expect(model.revealing)
    // the first fade's end, 80 ms into the second
    steps.advance(by: .milliseconds(80))
    #expect(!model.gone, "the first fade's end is not the second's")
    steps.advance(by: .milliseconds(45))
    #expect(model.gone, "gone at the second fade's own end")
  }

  @Test("L1: a hold caught mid-fade reuses the same surface without replaying the entrance")
  func aMidFadeComeBackKeepsItsField() {
    let (model, steps, watch) = launched()
    steps.advance(by: .milliseconds(50))
    model.setHold(true)
    // the same surface, back in its window, says a first frame again
    model.fieldPresented(at: CACurrentMediaTime())
    model.setHold(false)
    watch.steady()
    #expect(model.revealing)
  }

  @Test("L2: a re-hold ends the release's limit: the splash waits past the earlier limits for the next release's own")
  func aReHoldEndsTheReleasesLimit() {
    let (model, steps, _) = launched(held: true)
    #expect(!model.revealing, "held, it stands")
    model.setHold(false)
    steps.advance(by: .seconds(1))
    model.setHold(true)
    steps.advance(by: .seconds(1))
    model.setHold(false)
    // the content never says it is steady: only a limit shows it, and past the mount's and the first release's it
    // stands
    steps.advance(by: .milliseconds(2500))
    #expect(!model.revealing, "the earlier limits are not this release's")
    steps.advance(by: .milliseconds(1600))
    #expect(model.revealing, "its own limit: shown anyway")
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
