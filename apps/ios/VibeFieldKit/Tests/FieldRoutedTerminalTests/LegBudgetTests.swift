import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

/// SP-2 (g) — a routed connection set is two legs, and the phone's budget is
/// three of them (`PhoneBudget.terminalLegs`; FW-D2, 2026-10-16: a LANE per
/// terminal cell the phone shows, each carrying every session on that cell). A
/// fourth set's legs WAIT until one of the three is torn down — never more
/// sockets at once than the budget says.
@MainActor
@Suite(.serialized) struct LegBudgetTests {
  private func lane(_ name: String, _ ledger: PhoneConnectionBudget, _ transport: ScriptedTransport)
    throws -> RoutedTerminalClient
  {
    let client = RoutedTerminalClient(
      transport: transport, sink: RoutedFrameRecorder(),
      options: .init(viewId: "view-\(name)", legBudget: ledger))
    client.open(
      try TicketFactory.make(
        controlUrl: "ws://127.0.0.1:9/\(name)/control", framesUrl: "ws://127.0.0.1:9/\(name)/frames",
        cellBootId: "cb-\(name)", sessionId: "sess-\(name)"))
    return client
  }

  @Test func aFourthLanesLegsWaitForOneOfTheThreeToClose() async throws {
    let ledger = PhoneConnectionBudget()
    let transport = ScriptedTransport()
    let lanes = try ["a", "b", "c"].map { try lane($0, ledger, transport) }
    try await settle("three lanes' legs") { transport.dials.count == 6 }
    #expect(ledger.inUse(.terminalLegs) == 6)

    let fourth = try lane("d", ledger, transport)
    try await settle("the fourth lane queued") { ledger.waiting(for: .terminalLegs) == 1 }
    try await Task.sleep(for: .milliseconds(30))
    #expect(transport.dials.count == 6)

    lanes[0].close()
    try await settle("the fourth lane's legs") { transport.dials.count == 8 }
    #expect(ledger.inUse(.terminalLegs) == 6)
    #expect(transport.dials.suffix(2).allSatisfy { $0.contains("/d/") })
    for client in lanes.dropFirst() { client.close() }
    fourth.close()
    try await settle("every lane's slots back") { ledger.inUse(.terminalLegs) == 0 }
  }
}
