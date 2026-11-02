import Foundation
import Testing

@testable import FieldAgents

@Suite @MainActor struct MockFleetUsageTests {
  /// The mock's USD lane reaches the body as the owner's cost (PG-3e), with no fold: a priced provider carries its
  /// total, complete, and its burn by the hour; an unpriced one carries none, which draws "—", unpriced.
  @Test func aPricedWorkingBodyCarriesItsCostAndAnUnpricedOneHasNone() {
    let clock = Date(timeIntervalSince1970: 1_789_560_000)
    let mock = MockAgentField(seed: 7, clock: { clock })
    for _ in 0..<3 { mock.advance() }
    var seen = 0
    for snapshot in mock.agents {
      guard let bubble = fieldBubble(from: snapshot), let usage = snapshot.state?.usage else { continue }
      seen += 1
      let priced = usage.costCoverage == .complete
      let cost = bubble.agent?.cost
      #expect((cost != nil) == priced, "\(bubble.project) priced=\(priced) cost=\(String(describing: cost))")
      if priced {
        #expect(cost?.coverage == "complete")
        #expect(cost?.usd == usage.costUsd)
        #expect(cost?.burnPerHour == usage.costRatePerMin.map { $0 * 60 })
      }
    }
    #expect(seen > 0)
  }
}
