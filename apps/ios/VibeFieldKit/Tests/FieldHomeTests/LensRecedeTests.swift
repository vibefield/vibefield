import FieldAgents
import FieldMesh
import FieldProduct
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

  @Test("a body carries the home's profile on the home's rows, none on a peer's")
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
}
