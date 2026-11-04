import FieldAgents
import FieldMesh
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-7 — SPEND ON THE PHONE'S STAGE (pair 5, host): the view's one case and arm, and what it reads from the stage —
// the rows as spend reads them, its box under the Stories row's reserve, its clock (a still's frozen one), how often
// now moves, and a drag on the list as the wheel's steps. Hand rows, said: the stage is the phone's (PG-4t), so no
// golden of the window's speaks for it. Host-buildable; an extension of the one suite.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

extension SpendParityTests {
  /// K1 — the dispatch: `-vf-godview-view=spend` is the spend view, its raw value the manifest's id, in the Stories
  /// row in the registry's order; a flow stage (it ends at the band), and no swarm atmosphere over it (J-S3).
  @Test func spendIsAViewTheStageDispatches() throws {
    let launched = GodviewViewChoice.launch(["-vf-godview-view=spend"])
    #expect(launched == .spend)
    #expect(GodviewViewChoice.spend.rawValue == "spend")
    #expect(GodviewViewChoice.registryOrder.contains("spend"))
    let shown = GodviewViewChoice.shown.map { $0.rawValue }
    #expect(shown.contains("spend"))
    #expect(shown == GodviewViewChoice.ordered(Set(shown)), "the Stories row draws spend in the registry's order")
    #expect(GodviewViewChoice.spend.allocation == .flow)
    #expect(!GodviewViewChoice.spend.wearsAtmosphere)
  }

  /// H7 — the clock: a still's `-vf-godview-now=<ms>` is the view's now to the ms (whole ms, as `Date.now()`), and
  /// at it the model lays out the golden's open step.
  @Test func aStillsFrozenClockIsTheGoldensNow() throws {
    let frozen = try #require(GodviewViewChoice.frozenNow(["-vf-godview-now=1790803300000"]))
    let nowMs = SpendModel.nowMs(frozen)
    #expect(nowMs == SpendWitness.nowMs)
    #expect(SpendModel.nowMs(Date(timeIntervalSince1970: 1_790_803_300.0004)) == 1_790_803_300_000)
    let golden = try SpendGolden.step("open")
    let box = SpendDOM.box(golden["stage"])
    let agents = try SpendWitness.open()
    let input = SpendModel.Input(
      agents: agents, nowMs: nowMs, width: box.width, height: box.height, timeZone: try SpendGolden.zone(),
      measure: SpendDOM.averageGlyph)
    var state = SpendModel.State()
    let frame = SpendDOM.settled(input, &state)
    #expect(frame.hero.big == golden["view"]?["hero"]?["big"]?.stringValue)
    let rows = golden["viewRows"]?.arrayValue?.count
    #expect(frame.rows.count == rows)
  }

  /// H11 — the rows as spend reads them from the stage: the window's `self`, the STAGE's unread (`unreadIds`, S2: the
  /// open card's row held out, never the row's raw `unread`), active for the open card's row alone (Q-S6 (a)).
  @Test func theStagesRowsAsSpendReadsThem() throws {
    let steps = try HomeFixture.witnessSteps()
    let open = try #require(steps.first { $0.at == "open" }?.rows)
    let unread = open.filter { $0.unread }
    let card = try #require(unread.first, "the witness has an unread row")
    let unreadIds = Set(unread.map { $0.id }).subtracting([card.id])
    let agents = SpendModel.agents(open, unreadIds: unreadIds, activeId: card.id)
    #expect(agents.count == open.count)
    for (agent, row) in zip(agents, open) {
      #expect(agent.id == row.id && agent.monitor == row.row.monitor && agent.isSelf == row.isSelf, "\(row.id)")
      #expect(agent.unread == unreadIds.contains(row.id), "\(row.id): the stage's unread")
      #expect(agent.active == (row.id == card.id), "\(row.id): active")
    }
    let held = agents.first { $0.id == card.id }
    #expect(held?.unread == false && card.unread, "the open card's row is held out")
  }

  /// H12 — the box: the stage less the reserve its words start below (the window's `stageBox`); never negative.
  @Test func theBoxIsTheStageUnderTheReserve() {
    let box = SpendModel.box(width: 402, height: 781, topInset: 108)
    #expect(box.width == 402 && box.height == 673)
    let crushed = SpendModel.box(width: 402, height: 90, topInset: 108)
    #expect(crushed.height == 0)
  }

  /// H13 — how often now moves: about a pixel at a time, never more than once in 250 ms nor less than once a second.
  @Test func nowMovesAboutAPixelAtATime() {
    let phone = SpendModel.geometryFor(width: 402, height: 673)
    #expect(SpendModel.clockEveryMs(phone) == 1000)
    let wide = SpendModel.geometryFor(width: 1000, height: 673)
    let perPx = SpendScale.windowMs / (wide.x1 - wide.x0)
    #expect(perPx > 250 && perPx < 1000)
    #expect(SpendModel.clockEveryMs(wide) == perPx)
    let huge = SpendModel.geometryFor(width: 400_000, height: 673)
    #expect(SpendModel.clockEveryMs(huge) == 250)
  }

  /// H14 — a drag on the list (fd's Q3): every whole row of travel is one step of the wheel, a finger moving up
  /// stepping the list down; back where it began, no steps.
  @Test func aDragOnTheListStepsWholeRows() {
    #expect(SpendModel.listSteps(from: 0, to: -53, rowH: 54) == 0)
    #expect(SpendModel.listSteps(from: 0, to: -54, rowH: 54) == 1)
    #expect(SpendModel.listSteps(from: 0, to: -108, rowH: 54) == 2)
    #expect(SpendModel.listSteps(from: -108, to: -60, rowH: 54) == -1)
    #expect(SpendModel.listSteps(from: -60, to: 0, rowH: 54) == -1)
    #expect(SpendModel.listSteps(from: 0, to: 70, rowH: 30) == -2)
    #expect(SpendModel.listSteps(from: 0, to: .nan, rowH: 30) == 0)
  }
}
