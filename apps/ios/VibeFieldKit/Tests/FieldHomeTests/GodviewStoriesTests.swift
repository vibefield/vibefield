import CoreGraphics
import Foundation
import SwiftUI
import Testing

@testable import FieldHome

// PG-4t — THE PHONE'S STORIES ROW AND THE STAGE UNDER IT (host + kit): the row's geometry, the stage's reserve and
// its dissolve, the views the row draws, the stage a view takes and the still flag. Every number is DESIGN.md §8
// "The phone's Stories row".
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-4t — the Stories row's geometry and the stage's reserve")
struct GodviewStoriesGeometryTests {
  /// S1 — the row's top: 8 under the island's foot (48) on every island phone, 8 under the safe area's top line where
  /// that line stands higher (a notch, a status bar, a phone on its side).
  @Test func theRowStandsEightUnderTheIslandOrTheSafeLine() {
    let island: [CGFloat] = [59, 62, 68]
    for safeTop in island {
      let top = GodviewStories.top(safeTop: safeTop)
      #expect(top == 56, "island, safe top \(safeTop)")
    }
    let others: [(safeTop: CGFloat, top: CGFloat)] = [
      (50, 56), (48, 56), (47, 55), (44, 52), (24, 32), (20, 28), (0, 8),
    ]
    for (safeTop, expected) in others {
      let top = GodviewStories.top(safeTop: safeTop)
      #expect(top == expected, "safe top \(safeTop)")
    }
  }

  /// S2 — the reserve, the stage's top inset: the row's foot plus 8, from the screen's top (108 on an island phone;
  /// 104–108 on a notch phone, 80 on the SE, 84 on an iPad, 60 on a landscape iPhone).
  @Test func theReserveIsTheRowsFootPlusEight() {
    let cases: [(safeTop: CGFloat, reserve: CGFloat)] = [
      (62, 108), (59, 108), (68, 108), (48, 108), (47, 107), (44, 104), (24, 84), (20, 80), (0, 60),
    ]
    for (safeTop, expected) in cases {
      let reserve = GodviewStories.reserve(safeTop: safeTop)
      let top = GodviewStories.top(safeTop: safeTop)
      #expect(reserve == expected, "safe top \(safeTop)")
      #expect(reserve == top + GodviewStories.circle + GodviewStories.reserveGap, "safe top \(safeTop): foot + 8")
    }
  }

  /// S3 — the circles: 44 across, 10 apart, the row centred. Five on the iPhone 17 stand at the PG-4s page's 71, 125,
  /// 179, 233, 287; one stands at 179.
  @Test func theCirclesAreCentredFiftyFourApart() {
    let five = GodviewStories.circleMinX(count: 5, width: 402)
    #expect(five == [71, 125, 179, 233, 287])
    let one = GodviewStories.circleMinX(count: 1, width: 402)
    #expect(one == [179])
    let none = GodviewStories.circleMinX(count: 0, width: 402)
    #expect(none.isEmpty)
    let widths: [CGFloat] = [375, 402, 440, 874]
    for width in widths {
      for count in 1...5 {
        let xs = GodviewStories.circleMinX(count: count, width: width)
        #expect(xs.count == count, "\(count) on \(width)")
        let first = xs.first ?? -1
        let last = xs.last ?? -1
        #expect(first == width - (last + GodviewStories.circle), "\(count) on \(width): centred")
        for (a, b) in zip(xs, xs.dropFirst()) {
          #expect(b - a == GodviewStories.circle + GodviewStories.gap, "\(count) on \(width): 54 apart")
        }
      }
    }
  }

  /// S11 — the dissolve: clear down to the row's axis (its top + 22, 78 on an island phone), whole from the reserve
  /// (108), a 30 ramp, whatever the reserve.
  @Test func theStageDissolvesFromTheRowsAxisToTheReserve() {
    let island = GodviewStories.dissolve(topInset: 108)
    #expect(island.from == 78)
    #expect(island.to == 108)
    let landscape = GodviewStories.dissolve(topInset: 60)
    #expect(landscape.from == 30)
    #expect(landscape.to == 60)
    for safeTop: CGFloat in [62, 59, 47, 44, 20, 0] {
      let reserve = GodviewStories.reserve(safeTop: safeTop)
      let fade = GodviewStories.dissolve(topInset: reserve)
      let axis = GodviewStories.top(safeTop: safeTop) + GodviewStories.circle / 2
      #expect(fade.from == axis, "safe top \(safeTop): clear at the row's axis")
      #expect(fade.to == reserve, "safe top \(safeTop): whole at the reserve")
      #expect(fade.to - fade.from == 30, "safe top \(safeTop): a 30 ramp")
    }
  }
}

@Suite("PG-4t — the views the row draws, and the stage each takes")
struct GodviewStoriesViewsTests {
  /// S4 — the registry's order, whatever order the ids come in; an id the registry does not name is dropped.
  @Test func idsComeInTheRegistrysOrder() {
    let three = GodviewViewChoice.ordered(["rain", "swarm", "list"])
    #expect(three == ["swarm", "list", "rain"])
    let all = GodviewViewChoice.ordered(["spend", "timeline", "rain", "list", "swarm"])
    #expect(all == ["swarm", "list", "rain", "timeline", "spend"])
    let stray = GodviewViewChoice.ordered(["bogus", "spend"])
    #expect(stray == ["spend"])
    let none = GodviewViewChoice.ordered([])
    #expect(none.isEmpty)
  }

  /// S12 (PIN; VF-PM 2026-11-04) — the row's circles are the views the phone has, every case and nothing else, in
  /// the registry's order: never a placeholder. While the swarm is the only case, the row is its one circle.
  @Test func theRowDrawsEveryViewThePhoneHasAndNoOther() {
    let shown = GodviewViewChoice.shown
    let cases = GodviewViewChoice.allCases
    #expect(Set(shown) == Set(cases))
    #expect(shown.count == cases.count)
    let order = GodviewViewChoice.ordered(Set(cases.map { $0.rawValue }))
    #expect(shown.map { $0.rawValue } == order)
    if cases.count == 1 {
      #expect(shown == [.swarm], "one circle while only the swarm exists")
    }
  }

  /// P1 (PIN; J-S3, drop) — the scanlines and the vignette stand over the swarm alone. Green while the swarm is the
  /// only case; it bites the first view lane's case.
  @Test func onlyTheSwarmWearsTheAtmosphere() {
    for choice in GodviewViewChoice.allCases {
      #expect(choice.wearsAtmosphere == (choice == .swarm), "\(choice)")
    }
  }

  /// P3 (PIN) — the stage each view takes mirrors its manifest: `'full'` is the swarm's alone; every other view's
  /// stage ends at the bar's band.
  @Test func onlyTheSwarmTakesTheFullStage() {
    for choice in GodviewViewChoice.allCases {
      let expected: GodviewStageAllocation = choice == .swarm ? .full : .flow
      #expect(choice.allocation == expected, "\(choice)")
    }
  }

  /// S7 / S7b — the stage's chrome as data inside a view's stage: the reserve on top always; the bar's band at the
  /// bottom only inside a full stage, which runs under the bar (a flow stage ends at the band).
  @MainActor
  @Test func theInsetsAreTheReserveAndTheBandAsData() {
    let input = StageInputs.make(topInset: 108, bandHeight: 93)
    let flow = input.insets(.flow)
    #expect(flow == EdgeInsets(top: 108, leading: 0, bottom: 0, trailing: 0))
    let full = input.insets(.full)
    #expect(full == EdgeInsets(top: 108, leading: 0, bottom: 93, trailing: 0))
  }
}

@Suite("PG-4t — the still flag")
struct GodviewStillFlagTests {
  /// S9 — `-vf-godview-still` is the whole argument: a longer flag or a value is not it.
  @Test func theStillFlagIsTheWholeArgument() {
    let still = GodviewViewChoice.still(["VibeField", "-vf-godview-still"])
    #expect(still)
    for arguments in [[], ["-vf-godview-stillness"], ["-vf-godview-still=1"], ["-vf-godview-view=swarm"]] {
      let none = GodviewViewChoice.still(arguments)
      #expect(!none, "\(arguments)")
    }
  }

  /// S10 — the latch's three flags compose: one argument list names the view, the clock and the still.
  @Test func theThreeFlagsCompose() {
    let arguments = [
      "-vf-demo-field-slice", "-vf-godview-view=swarm", "-vf-godview-now=1790803300000", "-vf-godview-still",
    ]
    let view = GodviewViewChoice.launch(arguments)
    let now = GodviewViewChoice.frozenNow(arguments)
    let still = GodviewViewChoice.still(arguments)
    #expect(view == .swarm)
    #expect(now == Date(timeIntervalSince1970: 1_790_803_300))
    #expect(still)
  }
}

/// A stage input built by hand: the witness's facts left empty, the chrome's numbers given.
@MainActor
enum StageInputs {
  static func make(topInset: CGFloat, bandHeight: CGFloat, isStill: Bool = false) -> GodviewStageInput {
    GodviewStageInput(
      isActive: true, rows: [], fieldIsLive: true, unreadIds: [], activeId: nil, colour: { _ in nil },
      now: { Date(timeIntervalSince1970: 1_790_803_300) }, bandHeight: bandHeight, topInset: topInset,
      skin: GodviewSkin(scheme: .light), isStill: isStill, onOpen: { _ in })
  }
}
