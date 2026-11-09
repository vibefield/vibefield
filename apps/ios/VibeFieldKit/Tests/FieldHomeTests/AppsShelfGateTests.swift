import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// MA-6's gate (VF-PM, 2026-11-09 13:07Z): nothing inert lands. Until 6e draws the shelf, the sheet mounts no strip,
/// offers no All apps, and shows no Apps group, each of whose taps would do nothing. 6e's first green turns these over.
///
/// What this holds is what the sheet is given to mount; HomeScreen's two slots read `inSheet`.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@MainActor
@Suite("MA-6 — nothing inert lands: the strip and the group wait for the shelf")
struct AppsShelfGateTests {
  private static func reading(_ names: [String]) throws -> AppsFeed.Reading {
    let page = try IndexAppsResult(json: AppsWire.page(names))
    var reading = AppsFeed.Reading()
    reading.phase = .live
    reading.apps = page.rows
    reading.sources = page.sources
    return reading
  }

  @Test("with apps to show, the sheet is given no strip, so no All apps")
  func stripWaits() throws {
    let reading = try Self.reading(["a", "b"])
    let built = AppsStripContent.of(reading: reading, opened: [], here: "This desktop")
    #expect(built != nil)
    let mounted = AppsStripContent.inSheet(reading: reading, opened: [], here: "This desktop")
    #expect(mounted == nil)
  }

  @Test("with a title matching, the sheet is given no Apps group")
  func groupWaits() throws {
    var reading = try Self.reading(["alpha"])
    reading.matches = reading.apps
    reading.matchWords = "alpha"
    let built = AppsSearchGroup.of(reading: reading, words: "alpha", here: "This desktop")
    #expect(built != nil)
    let mounted = AppsSearchGroup.inSheet(reading: reading, words: "alpha", here: "This desktop")
    #expect(mounted == nil)
  }

  @Test("the gate stands shut until the shelf is drawn")
  func gateShut() {
    let drawn = AppsShelfGate.drawn
    #expect(drawn == false)
  }
}
