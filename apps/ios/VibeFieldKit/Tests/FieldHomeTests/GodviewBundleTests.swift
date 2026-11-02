import FieldProduct
import Foundation
import Testing

// PG-4s — FieldHomeTests' own bundle: the REAL target's resources line (`Package.swift`, FieldHomeTests) carries the
// witness every Godview view suite replays (H1), and the goldens they are held to (H2, from the toolkit's golden on).
// The kit proves the line; the host's scratch bundle proves the bytes only.
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-4s — the FieldHomeTests bundle")
struct GodviewBundleTests {
  static let home = "dev-01HQ9S7UD1"

  /// H1 — the witness open, applied as FieldLink drives it, draws the home's window: 11 rows (D1's facts,
  /// `Tests/FieldMeshTests/FieldLinkTests.swift:946-975`), the home Studio's own rows its `self`, Attic's row greyed.
  @Test func theWitnessDrawsTheHomesWindow() throws {
    let rows = try HomeFixture.witnessRows()
    #expect(rows.count == 11)
    let selfDevices = Set(rows.filter { $0.isSelf }.map { $0.device })
    #expect(selfDevices == [Self.home])
    let attic = rows.first { $0.id == "run-a-idle" }
    let atticStale = attic?.stale
    #expect(atticStale == true)
    let ids = rows.map { $0.id }
    #expect(Set(ids).count == ids.count, "one row per model id")
  }
}
