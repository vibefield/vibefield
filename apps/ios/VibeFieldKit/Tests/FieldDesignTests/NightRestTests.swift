import Testing

@testable import FieldDesign

/// ES-5c (DESIGN.md §6 "At rest"; ES-D7 A) — the night keeps the Mac's rest (`night.tsx`), with a touch where the Mac has
/// a pointer: live for 20 s after the last touch, easing out over 2 s, woken quickly, and still means no frame.
@Suite("ES-5c — the night's rest is the Mac's")
struct NightRestTests {
  @Test("live through 20 s after the last touch, then resting")
  func restsAfterTwenty() {
    #expect(NightRest.target(sinceTouch: 20.01, reduced: false) == 0)
  }

  @Test("live inside the 20 s")
  func liveInside() {
    #expect(NightRest.target(sinceTouch: 20, reduced: false) == 1)
  }

  @Test("reduced motion rests at once, so the night is drawn once")
  func reducedRests() {
    #expect(NightRest.target(sinceTouch: 0, reduced: true) == 0)
  }

  @Test("it eases out at a quarter of the 2 s")
  func easesOut() {
    #expect(abs(NightRest.rate(1, target: 0, dt: 0.1) - 0.8) < 0.000_001)
  }

  @Test("a touch wakes it in 0.18 s, quicker than it rests")
  func wakesQuickly() {
    #expect(abs(NightRest.rate(0, target: 1, dt: 0.1) - 0.1 / 0.18) < 0.000_001)
  }

  @Test("near still, it is still")
  func snapsStill() {
    #expect(NightRest.rate(0.011, target: 0, dt: 0.05) == 0)
  }

  @Test("by the end of the 2 s it moves at under 2% of its pace")
  func underTwoPercent() {
    var rate = 1.0
    for _ in 0..<120 { rate = NightRest.rate(rate, target: 0, dt: 1.0 / 60) }
    #expect(rate < 0.02)
  }
}
