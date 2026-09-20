import Foundation
import Testing

@testable import FieldAgents

@Suite @MainActor struct MockFleetUsageTests {
  @Test func aPricedWorkingBodyKeepsItsTotalThroughTheFoldAndAnUnpricedOneHasNone() {
    let clock = Date(timeIntervalSince1970: 1_789_560_000)
    let mock = MockAgentField(seed: 7, clock: { clock })
    for _ in 0..<3 { mock.advance() }
    var assembly = FieldAssembly(tint: .light)
    let bubbles = mock.agents.compactMap(fieldBubble(from:))
    let rows = assembly.fold(bubbles, cardSubjectID: nil, nowMs: clock.timeIntervalSince1970 * 1000)
    for row in rows {
      guard let facet = row.agent, row.status == .working, let live = facet.monitorUsage else { continue }
      let priced = live.costCoverage == .complete
      #expect((facet.usage?.total != nil) == priced, "\(row.project) priced=\(priced) live.costUsd=\(String(describing: live.costUsd)) total=\(String(describing: facet.usage?.total))")
    }
  }
}
