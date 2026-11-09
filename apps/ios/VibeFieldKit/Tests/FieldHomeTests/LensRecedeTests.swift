import FieldAgents
import FieldMesh
import FieldProduct
import FieldSwarm
import Foundation
import Testing

@testable import FieldHome

/// SE-2 (SE-P6; DESIGN.md §8 "The phone's profile token": the lens on Field) — the lens shows the chosen profile's
/// sessions and recedes the rest, as the desktop's profile filter does (`useMonitorAgents.ts` :550-555, `receded =
/// !(row.device.self && row.profileSet === chosenProfile)`): it keys on the home's profiles, so every other desktop's
/// session recedes too. NOT golden: no puppeteer golden carries a lens yet; the rule and its joins are pinned here.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the lens on Field: the chosen profile's sessions stand, the rest recede")
struct LensRecedeTests {
  @Test("a row recedes under a lens unless it is the home's and under the chosen profile; nothing recedes without one")
  func recedeByLens() {
    #expect(!GodviewRecede.byLens(isSelf: true, profileSet: "work", lens: nil))
    #expect(!GodviewRecede.byLens(isSelf: false, profileSet: nil, lens: nil))
    #expect(!GodviewRecede.byLens(isSelf: true, profileSet: "work", lens: "work"))
    #expect(GodviewRecede.byLens(isSelf: true, profileSet: "native", lens: "work"))
    #expect(GodviewRecede.byLens(isSelf: true, profileSet: nil, lens: "work"))
    // a peer's profile is its own desktop's, never the home's: it recedes even under a profile of the same id
    #expect(GodviewRecede.byLens(isSelf: false, profileSet: "work", lens: "work"))
  }

  /// PG-3a's witness: every home row is under "native" (This Mac); Loft's and Attic's are peers.
  @Test("the list's rows recede by the lens: the home's under it stand, every peer's recedes")
  func listRecedesByLens() throws {
    let rows = try HomeFixture.witnessRows()
    let native = ListModel.inputs(rows: rows, activeId: nil, fieldIsLive: true, lens: "native")
    for (row, input) in zip(rows, native) {
      let expected = !(row.isSelf && row.row.monitor.profileSet == "native")
      #expect(input.receded == expected)
    }
    let peers = native.filter { !$0.isSelf }
    #expect(!peers.isEmpty)
    let peersReceded = peers.allSatisfy { $0.receded }
    #expect(peersReceded)
    let homeStands = native.contains { $0.isSelf && !$0.receded }
    #expect(homeStands)

    // a profile no session runs under recedes every row: the faintest weight
    let work = ListModel.inputs(rows: rows, activeId: nil, fieldIsLive: true, lens: "work")
    let everyReceded = GodviewRecede.every(work.map { $0.receded })
    #expect(everyReceded)

    // no lens: nothing recedes, so every golden the list is held to stands as it was
    let none = ListModel.inputs(rows: rows, activeId: nil, fieldIsLive: true)
    let anyReceded = none.contains { $0.receded }
    #expect(!anyReceded)
  }

  /// SE-2h (the S2 review's finding 2) — the rain's columns recede by the lens, as the list's rows do: a receded
  /// column keeps falling, faint (`RainFrame`'s recede steps, transcribed and joined false until now).
  @Test("the rain's columns recede by the lens: the home's under it stand, every peer's recedes; none without one")
  func rainRecedesByLens() throws {
    let rows = try HomeFixture.witnessRows()
    var receded = 0
    var standing = 0
    for row in rows {
      let expected = GodviewRecede.byLens(isSelf: row.isSelf, profileSet: row.row.monitor.profileSet, lens: "native")
      let agent = RainAgent(row: row, lens: "native")
      #expect(agent.receded == expected)
      if agent.receded { receded += 1 } else { standing += 1 }
      // no lens: nothing recedes, so every rain golden stands as it was
      let plain = RainAgent(row: row)
      #expect(!plain.receded)
    }
    // the witness holds both, so a constant cannot pass this row
    #expect(receded > 0)
    #expect(standing > 0)
  }

  /// SE-2h — the timeline's lanes recede by the lens: a receded lane is quiet (`TimelineLanes.laneAlpha`) and leaves
  /// the pulse map's count, as the desktop's do under its profile filter.
  @Test("the timeline's lanes recede by the lens: the home's under it stand, every peer's recedes; none without one")
  func timelineRecedesByLens() throws {
    let rows = try HomeFixture.witnessRows()
    var receded = 0
    var standing = 0
    for row in rows {
      let expected = GodviewRecede.byLens(isSelf: row.isSelf, profileSet: row.row.monitor.profileSet, lens: "native")
      let lane = TimelineRow(row, unread: false, colour: nil, active: false, lens: "native")
      #expect(lane.receded == expected)
      if lane.receded { receded += 1 } else { standing += 1 }
      // no lens: nothing recedes, so the timeline's golden stands as it was
      let plain = TimelineRow(row, unread: false, colour: nil, active: false)
      #expect(!plain.receded)
    }
    #expect(receded > 0)
    #expect(standing > 0)
  }

  // RETIRED 2026-11-06 (SE-2h): `bubbleCarriesTheProfile`. `FieldBubble.profileSet` was written and never read — the
  // swarm does not recede yet (owed: a recede weight in FieldSwarm's renderer, which brings the body's profile back
  // with its reader). *Back 2026-11-06 (SE-2n), with its reader:* the swarm's recede (`GodviewRecede.swarm`).

  /// SE-2n — a body carries the home's profile on the home's own rows, agents and bare terminals alike; a peer's
  /// carries none, its profile being its own desktop's (the lead's ruling 17).
  @Test("a body carries the home's profile on the home's rows, and none on a peer's")
  func bubbleCarriesTheProfile() throws {
    let rows = try HomeFixture.witnessRows()
    let catalog = AgentCatalog(entries: [])
    var homeProfiles = 0
    for row in rows {
      let bubble = fieldBubble(from: row, fieldIsLive: true, catalog: catalog, suppressUnread: false)
      let expected = row.isSelf ? row.row.monitor.profileSet : nil
      #expect(bubble.profileSet == expected)
      if bubble.profileSet != nil { homeProfiles += 1 }
    }
    #expect(homeProfiles > 0)
  }

  /// UM-5b — a plan's filter recedes by the same predicate as the lens: the home's rows whose run is on the plan stand,
  /// every other row, a peer's or a terminal's too, recedes — the list's rows, the rain's columns and the timeline's
  /// lanes alike.
  @Test("a plan's filter: the home's runs on it stand, a peer's and a terminal's recede, on every view (UM-5b)")
  func planRecedes() throws {
    let rows = try HomeFixture.witnessRows()
    let onPlan = rows.first { $0.isSelf && $0.row.monitor.kind == .agent }?.row.monitor
    let provider = try #require(onPlan?.provider?.id)
    let plan = PlanSessions.Lens(planRuns: ["\(onPlan?.profileSet ?? "")\u{0}\(provider)"])
    let list = ListModel.inputs(rows: rows, activeId: nil, fieldIsLive: true, lens: plan)
    var standing = 0
    for (row, input) in zip(rows, list) {
      let monitor = row.row.monitor
      let expected = PlanSessions.recedes(plan, isSelf: row.isSelf, profileSet: monitor.profileSet, provider: monitor.provider?.id)
      #expect(input.receded == expected)
      if !row.isSelf {
        #expect(input.receded)
      }
      if monitor.kind == .terminal {
        #expect(input.receded)
      }
      if !input.receded { standing += 1 }
      let agent = RainAgent(row: row, lens: plan)
      #expect(agent.receded == expected)
      let lane = TimelineRow(row, unread: false, colour: nil, active: false, lens: plan)
      #expect(lane.receded == expected)
    }
    #expect(standing > 0)
    let catalog = AgentCatalog(entries: [])
    let bubbles = rows.map { fieldBubble(from: $0, fieldIsLive: true, catalog: catalog, suppressUnread: false) }
    let swarm = GodviewRecede.swarm(bubbles, lens: plan)
    // per body: a constant, or a swarm that ignores the plan, cannot pass (the upper bound alone let either through)
    for (row, bubble) in zip(rows, bubbles) {
      let monitor = row.row.monitor
      let recedes = PlanSessions.recedes(
        plan, isSelf: row.isSelf, profileSet: monitor.profileSet, provider: monitor.provider?.id)
      let expected: Double? = recedes ? GodviewRecede.receded : nil
      #expect(swarm.targets[bubble.id] == expected)
    }
    #expect(swarm.targets.count == rows.count - standing)
    #expect(swarm.targets.count < bubbles.count)
  }

  /// SE-2n (the S2 review's finding 2, its owed half) — the swarm's bodies recede by the lens, as the list's rows do:
  /// a body the rule recedes settles at the toolkit's weight, the faintest while every body recedes, and steps there
  /// at the toolkit's pace; with no lens nothing recedes, and a receded body comes back at the same pace.
  @Test("the swarm's bodies recede by the lens: the home's under it stand, every other body at the recede's weight")
  func swarmRecedesByLens() throws {
    let rows = try HomeFixture.witnessRows()
    let catalog = AgentCatalog(entries: [])
    let bubbles = rows.map { fieldBubble(from: $0, fieldIsLive: true, catalog: catalog, suppressUnread: false) }
    let native = GodviewRecede.swarm(bubbles, lens: "native")
    var receded = 0
    var standing = 0
    for (row, bubble) in zip(rows, bubbles) {
      let recedes = GodviewRecede.byLens(isSelf: row.isSelf, profileSet: row.row.monitor.profileSet, lens: "native")
      let expected: Double? = recedes ? GodviewRecede.receded : nil
      let target = native.targets[bubble.id]
      #expect(target == expected)
      if recedes { receded += 1 } else { standing += 1 }
    }
    // the witness holds both, so a constant cannot pass this row
    #expect(receded > 0)
    #expect(standing > 0)
    let step = native.approach(1, GodviewRecede.receded, 16)
    #expect(step == GodviewRecede.approach(1, toward: GodviewRecede.receded, deltaMs: 16))

    // a profile no session runs under recedes every body, to the faintest weight
    let work = GodviewRecede.swarm(bubbles, lens: "work")
    let count = work.targets.count
    #expect(count == bubbles.count)
    let weights = Set(work.targets.values)
    #expect(weights == [GodviewRecede.recededEmpty])

    // no lens: nothing recedes, and a body receded before comes back at the toolkit's pace
    let none = GodviewRecede.swarm(bubbles, lens: nil)
    let nothing = none.targets.isEmpty
    #expect(nothing)
    let back = none.approach(GodviewRecede.receded, 1, 16)
    #expect(back == GodviewRecede.approach(GodviewRecede.receded, toward: 1, deltaMs: 16))
  }
}
