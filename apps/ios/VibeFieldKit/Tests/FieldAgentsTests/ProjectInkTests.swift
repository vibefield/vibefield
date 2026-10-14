import Foundation
import Testing

@testable import FieldAgents

/// PJ-7 — the project ink (DESIGN.md §2.9; PJ-L7, PJ-D5 (a)): the one map from
/// a project's dealt number (`ProjectSummary.ink`) to its colour, the design
/// kit's `projectInkHue` / `projectInkHex` ported. The golden table is the ONE
/// both sides read — `packages/design-kit/fixtures/project-ink.golden.json`,
/// which `packages/field-app/test/project-ink.test.ts` holds the TypeScript to
/// and `pnpm check:ios-fixtures` keeps this copy byte-identical to. If a row
/// fails, the port has drifted — fix the port, never the golden.
@Suite struct ProjectInkTests {
  private struct Row {
    let ink: Int
    let hue: Double
    let light: String
    let dark: String
  }

  private func golden() throws -> [Row] {
    let url = try #require(Bundle.module.url(forResource: "project-ink.golden", withExtension: "json", subdirectory: "Fixtures"))
    let object = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let rows = try #require(object["rows"] as? [[String: Any]])
    return try rows.map { row in
      Row(
        ink: try #require(row["ink"] as? Int), hue: try #require(row["hue"] as? Double),
        light: try #require(row["light"] as? String), dark: try #require(row["dark"] as? String))
    }
  }

  @Test func everyDealMatchesTheDesignKitsHueAndHex() throws {
    let rows = try golden()
    #expect(rows.count == 997)
    for row in rows {
      #expect(abs(projectInkHue(row.ink) - row.hue) < 1e-9, "hue of ink \(row.ink)")
      #expect(projectInkHex(row.ink, .light) == row.light, "light ink \(row.ink)")
      #expect(projectInkHex(row.ink, .dark) == row.dark, "dark ink \(row.ink)")
    }
  }

  @Test func theHueStaysOnTheCoolHalfAndANumberThatIsNotADealReadsAsOne() {
    for ink in 0..<997 {
      let hue = projectInkHue(ink)
      #expect((hue >= 180 && hue <= 238) || (hue >= 265 && hue <= 350), "ink \(ink) → \(hue)")
    }
    #expect(projectInkHue(-3) == projectInkHue(0))
    #expect(abs(projectInkHue(0) - 197.16) < 0.01)
    #expect(SwarmColor.projectInk(412, .light) == SwarmColor(hex: projectInkHex(412, .light)))
  }
}
