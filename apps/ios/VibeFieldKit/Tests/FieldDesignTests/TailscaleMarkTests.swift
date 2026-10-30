import Testing

@testable import FieldDesign

/// TS-7 (a2-mark) — Tailscale's logomark on the phone, kept exact (DESIGN.md
/// §13, TS-D4). The constants are held to the desktop's `tailscale-mark.tsx`
/// by `pnpm check:ios-fixtures`; these rows hold what the copy draws.
@Suite("the phone's Tailscale mark is the desktop's, two-toned, never below its floor")
@MainActor
struct TailscaleMarkTests {
  @Test("nine dots on a three-by-three grid, four solid in the T and five faint")
  func twoTones() {
    #expect(TailscaleMark.at.count == 3)
    let all = TailscaleMark.at.indices.flatMap { x in TailscaleMark.at.indices.map { y in "\(x),\(y)" } }
    #expect(all.count == 9)
    #expect(TailscaleMark.solid.isSubset(of: Set(all)))
    #expect(TailscaleMark.solid.count == 4)
    #expect(TailscaleMark.faintOpacity == 0.4)
  }

  @Test("drawn at 56 on the welcome, never below the 48 floor")
  func floor() {
    #expect(TailscaleMark().drawn == 56)
    #expect(TailscaleMark(size: 20).drawn == TailscaleMark.minimum)
    #expect(TailscaleMark.minimum == 48)
  }

  @Test("the grid sits inside its box with the dots whole")
  func geometry() {
    #expect(TailscaleMark.at.allSatisfy { $0 - TailscaleMark.radius >= 0 && $0 + TailscaleMark.radius <= TailscaleMark.box })
  }
}
