import CoreGraphics
import Testing

@testable import FieldHistory

/// Item 391 (James, 2026-11-13 23:28:32Z, session qa-01, of a session's document on his phone, the area over its
/// foot marked: "[Image #17] make the messages start fade, blur and dim at the marked area like how it looks at the
/// top edge area") — a band stands over the document's foot, under the pill, the slot and the bar.
///
/// These rows hold the band's RULE: where it begins, and that it deepens from nothing at its top to its strongest
/// at the screen's edge. How it looks beside the head is his to see.
@Suite("item 391 — a session's document fades, blurs and dims over its foot")
struct HistoryFootFadeTests {
  private typealias Stop = HistoryFootFade.Stop

  @Test("the band begins 24 points above the top of what stands over the foot, and runs to the screen's edge")
  func theHeight() {
    // a phone with a home indicator: the bar's row stands 21 up and is 62 tall, the slot 10 above it and 48 tall
    #expect(HistoryFootFade.height(over: 141) == 165, "the slot stands")
    #expect(HistoryFootFade.height(over: 83) == 107, "the bar alone")
    // a phone with none: the bar's row stands 8 up
    #expect(HistoryFootFade.height(over: 70) == 94)
  }

  @Test("where nothing stands over the foot there is no band")
  func noBand() {
    #expect(HistoryFootFade.height(over: 0) == 0)
    #expect(HistoryFootFade.height(over: -12) == 0)
  }

  @Test("at its end the document's last row stands whole above the band")
  func theLead() {
    #expect(HistoryFootFade.lead == 24)
    // the last row rests 32 pt above the top of what stands over the foot (items 387 and 389)
    #expect(HistoryFootFade.lead < 32)
  }

  @Test("the blur and the dim are both clear at the band's top and strongest at the screen's edge")
  func clearAtTheTopStrongestAtTheEdge() {
    for ramp in [HistoryFootFade.blur, HistoryFootFade.dim] {
      #expect(ramp.first == Stop(strength: 0, at: 0))
      #expect(ramp.last?.at == 1)
      #expect(ramp.last?.strength == ramp.map(\.strength).max())
      #expect((ramp.last?.strength ?? 0) > 0)
    }
  }

  @Test("neither weakens on the way down, and their stops stand in order")
  func neverWeakens() {
    for ramp in [HistoryFootFade.blur, HistoryFootFade.dim] {
      #expect(ramp.count >= 2)
      for (above, below) in zip(ramp, ramp.dropFirst()) {
        #expect(above.at <= below.at)
        #expect(above.strength <= below.strength)
      }
    }
  }

  @Test("the blur is whole from half the band's depth down")
  func theBlur() {
    #expect(
      HistoryFootFade.blur == [
        Stop(strength: 0, at: 0), Stop(strength: 1, at: 0.5), Stop(strength: 1, at: 1),
      ])
  }

  @Test("the dim reaches nine tenths of the page at the screen's edge, and never the whole of it")
  func theDim() {
    #expect(HistoryFootFade.dim == [Stop(strength: 0, at: 0), Stop(strength: 0.9, at: 1)])
    #expect(HistoryFootFade.dimAtEdge < 1)
  }
}
