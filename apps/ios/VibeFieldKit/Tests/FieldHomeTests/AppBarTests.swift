import CoreGraphics
import FieldAgents
import Foundation
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

  /// IOS-12b (PC-D1 A; DESIGN.md §8 "The phone's Chat") — the capsule keeps the system's 188 and its 8 pt inset, and
  /// holds three tabs: 172 / 3 = 57⅓ each, the pill the tab plus 8 (the overhang 94 had on 86), so it still stands
  /// 4 pt inside. A third is not a binary fraction: the sums are held to a hair, not to the bit.
  @Test("the capsule is the system's 188: three tabs of 57⅓, the pill 65⅓ × 54 standing 4 pt inside")
  func theCapsule() {
    #expect(AppBar.capsuleWidth == 188)
    #expect(AppBar.capsuleInset == 8)
    #expect(AppTab.capsule == [.field, .history, .chat])
    #expect(abs(AppBar.tabWidth - 172.0 / 3) < 1e-9)
    #expect(abs(AppBar.capsuleInset * 2 + AppBar.tabWidth * 3 - 188) < 1e-9)
    #expect(abs(AppBar.pillWidth - (AppBar.tabWidth + 8)) < 1e-9)
    #expect(AppBar.pillHeight == 54)
    let pillInsetSide = AppBar.capsuleInset + (AppBar.tabWidth - AppBar.pillWidth) / 2
    let pillInsetTop = (AppBar.height - AppBar.pillHeight) / 2
    #expect(abs(pillInsetSide - 4) < 1e-9)
    #expect(pillInsetTop == 4)
  }

  /// VF-PM's Q1 (2026-11-05, at the lean; DESIGN.md §8): Chat's `tab-chat` is drawn at History's 22, Field's own
  /// asset keeps its 26.
  @Test("Chat stands third, its glyph History's size, 22")
  func chatGlyph() {
    #expect(AppBar.chatGlyph == 22)
    #expect(AppBar.chatGlyph == AppBar.symbolSize)
    #expect(AppBar.fieldGlyph == 26)
    #expect(AppTab.chat.title == "Chat")
    // hoisted: no key path inside an #expect argument (T10f's kit trap)
    let titles = AppTab.capsule.map { $0.title }
    #expect(titles == ["Field", "History", "Chat"])
  }

  /// PC-D5 A, "one need, one count" (VF-PM's Q2; DESIGN.md §8): Chat's mark is the orange count of the sparks that
  /// need you; with none, a cyan dot while a thread is unread; else nothing. Field's is its own agents waiting.
  /// History wears none.
  @Test("Chat's mark: the count of sparks that need you, else the cyan dot while a thread is unread")
  func chatMark() {
    #expect(TabMark.chat(needing: 2, unread: false) == .count(2))
    #expect(TabMark.chat(needing: 2, unread: true) == .count(2))
    #expect(TabMark.chat(needing: 0, unread: true) == .unread)
    #expect(TabMark.chat(needing: 0, unread: false) == TabMark.none)
    #expect(TabMark.field(waiting: 3) == .count(3))
    #expect(TabMark.field(waiting: 0) == TabMark.none)
    // the dot: 10 pt of `--vf-cyan`, where the design page sets it off the glyph's centre
    #expect(AppBar.dotSize == 10)
    #expect(AppBar.dotOffset == CGSize(width: 13, height: -9))
    #expect(AppBar.badgeSize == 20)
  }

  /// One need, one count: a spark's own run, or an agent a spark started, waiting on you is counted on Chat (with its
  /// spark), never again on Field. Field counts a blocked run that is no spark's.
  @Test("Field's count is your own agents waiting: a spark's runs are counted on Chat")
  func fieldCountsYourOwn() {
    let at = Date(timeIntervalSince1970: 1_790_803_300)
    func bubble(_ id: String, _ status: AgentVisualStatus, ofSpark: Bool) -> FieldBubble {
      FieldBubble(
        id: id, project: "vibe-field", detail: "", status: status, identityKey: id, createdAt: at, ofSpark: ofSpark)
    }
    let bubbles = [
      bubble("yours-asks", .blocked, ofSpark: false),
      bubble("yours-works", .working, ofSpark: false),
      bubble("vela-asks", .blocked, ofSpark: true),
      bubble("lyra-agent-asks", .blocked, ofSpark: true),
    ]
    #expect(TabMark.fieldWaiting(bubbles) == 1)
    #expect(TabMark.fieldWaiting([]) == 0)
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

  /// SE-2 (SE-D3 A; DESIGN.md §8 "The phone's search") — the glass sheet over the field: 10 from each side, its foot 10
  /// above the search field, never higher than 56 from the screen's top, corners 34. On the iPhone 17 at rest the
  /// field's top is 874 − 21 − 62 = 791, so the sheet may stand 725 tall; typing over a 336 keyboard, the field's top
  /// is 874 − 336 − 8 − 48 = 482, and 416.
  @Test("the search sheet: 10 from the sides and above the field, never past 56 from the top, corners 34")
  func searchSheet() {
    #expect(SearchSheet.side == 10)
    #expect(SearchSheet.gapAboveField == 10)
    #expect(SearchSheet.topLimit == 56)
    #expect(SearchSheet.radius == 34)
    #expect(SearchSheet.maxHeight(fieldTop: 791) == 725)
    #expect(SearchSheet.maxHeight(fieldTop: 482) == 416)
    // a field too low for any sheet leaves none, never a negative one
    #expect(SearchSheet.maxHeight(fieldTop: 40) == 0)
    // the sheet stands where the keyboard's typing row's margin would: inside the bar's own side margin
    #expect(SearchSheet.side == AppBar.marginTyping)
  }

  /// SE-D3 A — its motion: it rises from the middle of its foot, 24 up and from 0.94, over 420ms on the island curve;
  /// the scrim fades in over 240ms. Reduce Motion (M6) turns the rise and the tokens' pop into 120ms fades in place.
  @Test("the sheet rises 24 from 0.94 over 420ms, the scrim fades over 240ms, and Reduce Motion fades in 120ms")
  func searchSheetMotion() {
    #expect(SearchSheet.riseOffset == 24)
    #expect(SearchSheet.riseScale == 0.94)
    #expect(SearchSheet.rise == 0.42)
    #expect(SearchSheet.scrimFade == 0.24)
    #expect(SearchSheet.reducedFade == 0.12)
  }

  /// SE-D3/SE-D5 A — the sheet's parts as drawn (`search.css`): the switch, the chips, the rows, the offer, the foot.
  @Test("the sheet's parts: the switch, the chips, the rows, the offer and the foot at the drawing's measure")
  func searchSheetParts() {
    #expect(SearchSheet.headInset == 14 && SearchSheet.headBelow == 6)
    #expect(SearchSheet.switchPadding == 2 && SearchSheet.switchRadius == 10)
    #expect(SearchSheet.switchItemHeight == 30 && SearchSheet.switchItemRadius == 8 && SearchSheet.switchText == 13.5)
    #expect(SearchSheet.chipsTop == 2 && SearchSheet.chipsSide == 14 && SearchSheet.chipsBottom == 8)
    #expect(SearchSheet.chipsFade == 28)
    #expect(SearchSheet.chipHeight == 32 && SearchSheet.chipLeading == 10 && SearchSheet.chipTrailing == 12)
    #expect(SearchSheet.chipGap == 6 && SearchSheet.chipGlyph == 13 && SearchSheet.waitingDot == 6)
    #expect(SearchSheet.groupRule == CGSize(width: 1, height: 18))
    #expect(SearchSheet.listVertical == 4 && SearchSheet.listSide == 6 && SearchSheet.rowGap == 1)
    #expect(SearchSheet.rowRadius == 18 && SearchSheet.rowVertical == 11)
    #expect(SearchSheet.rowLeading == 16 && SearchSheet.rowTrailing == 14 && SearchSheet.rowParts == 10)
    #expect(SearchSheet.stateDot == 8)
    #expect(SearchSheet.offerDisc == 32 && SearchSheet.offerGlyph == 16 && SearchSheet.filterHeight == 30)
    #expect(SearchSheet.footTop == 9 && SearchSheet.footSide == 20 && SearchSheet.footBottom == 14)
  }

  /// SE-D5 A — a token in the field: 30 tall, corners 15, padded 9 and 4, its glyph 13, 5 before its name, its × a 20
  /// round holding `xmark` at 8; a second token 2 closer; it pops from 0.7. It fits the 48 typing field with 9 to
  /// spare above and below.
  @Test("a token in the field: 30 tall with a 20 ×, padded 9 and 4, a second 2 closer, popping from 0.7")
  func fieldTokens() {
    #expect(AppBar.tokenHeight == 30)
    #expect(AppBar.tokenLeading == 9 && AppBar.tokenTrailing == 4)
    #expect(AppBar.tokenGlyph == 13 && AppBar.tokenGap == 5)
    #expect(AppBar.tokenClose == 20 && AppBar.tokenCloseGlyph == 8)
    #expect(AppBar.tokenOverlap == 2)
    #expect(AppBar.tokenPopFrom == 0.7)
    #expect((AppBar.fieldHeightTyping - AppBar.tokenHeight) / 2 == 9)
  }
}
