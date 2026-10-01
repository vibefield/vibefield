import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

/// SP-2 (g) — a routed attachment is two legs, and the phone's budget is one
/// attachment's worth (`PhoneBudget.terminalLegs`): a second attachment's legs
/// WAIT until the first's are torn down, never two terminals' sockets at once.
@MainActor
@Suite(.serialized) struct LegBudgetTests {
  @Test func aSecondAttachmentsLegsWaitForTheFirstsToClose() async throws {
    let ledger = PhoneConnectionBudget()
    let transport = ScriptedTransport()
    let first = RoutedTerminalClient(
      transport: transport, sink: RoutedFrameRecorder(),
      options: .init(viewId: "view-a", legBudget: ledger))
    first.open(
      try TicketFactory.make(
        controlUrl: "ws://127.0.0.1:9/a/control", framesUrl: "ws://127.0.0.1:9/a/frames",
        cellBootId: "cb-a", sessionId: "sess-a"))
    try await settle("the first attachment's two legs") { transport.dials.count == 2 }
    #expect(ledger.inUse(.terminalLegs) == 2)

    let second = RoutedTerminalClient(
      transport: transport, sink: RoutedFrameRecorder(),
      options: .init(viewId: "view-b", legBudget: ledger))
    second.open(
      try TicketFactory.make(
        controlUrl: "ws://127.0.0.1:9/b/control", framesUrl: "ws://127.0.0.1:9/b/frames",
        cellBootId: "cb-b", sessionId: "sess-b"))
    try await settle("the second attachment queued") { ledger.waiting(for: .terminalLegs) == 1 }
    try await Task.sleep(for: .milliseconds(30))
    #expect(transport.dials.count == 2)

    first.close()
    try await settle("the second attachment's legs") { transport.dials.count == 4 }
    #expect(ledger.inUse(.terminalLegs) == 2)
    #expect(transport.dials.suffix(2).allSatisfy { $0.contains("/b/") })
    second.close()
    try await settle("both attachments' slots back") { ledger.inUse(.terminalLegs) == 0 }
  }
}
