import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

/// F1 — the third endpoint shape the reader takes: the freeway's, `freeway://cell/<boot>/<channel>`
/// (`FreewayCellEndpointSet`), as strict as the contract — each URL its own channel, both one cell —
/// read off the contracts' own golden, the host's ticket over the link.
@Suite struct FreewayEndpointTests {
  private func endpoints(_ control: String, _ frames: String) throws -> RoutedCellEndpoints {
    try RoutedCellEndpoints(json: .object(["controlUrl": .string(control), "framesUrl": .string(frames)]))
  }

  @Test("the host's ticket over the link reads, its legs naming one cell")
  func golden() throws {
    let opened = try Vector.json("freeway-opened.tickets")
    let row = try #require(opened["tickets"]?.arrayValue?.first)
    let ticket = try RoutedTerminalTicket(json: try #require(row["ticket"]))
    #expect(ticket.endpoints.url(for: .control).absoluteString == "freeway://cell/cb-7f3a9c1e-2026/control")
    let leg = try #require(RoutedCellEndpoints.freewayLeg(ticket.endpoints.url(for: .frames)))
    #expect(leg.cellBootId == "cb-7f3a9c1e-2026")
    #expect(leg.channel == .frames)
  }

  @Test("a pair split across cells or shapes, a leg on the wrong channel, or anything riding along is refused")
  func refused() {
    let refusals: [(String, String)] = [
      ("freeway://cell/cb-1/control", "freeway://cell/cb-2/frames"),
      ("freeway://cell/cb-1/control", "wss://desk.ts.net:9422/cell/cb-1/frames"),
      ("freeway://cell/cb-1/frames", "freeway://cell/cb-1/frames"),
      ("freeway://cell/cb-1/control?grant=x", "freeway://cell/cb-1/frames"),
      ("freeway://cell/cb-1/control#x", "freeway://cell/cb-1/frames"),
      ("freeway://desk/cb-1/control", "freeway://desk/cb-1/frames"),
      ("freeway://cell/cb 1/control", "freeway://cell/cb 1/frames"),
      ("freeway://cell/cb-1/extra/control", "freeway://cell/cb-1/extra/frames"),
      ("freeway://cell:9425/cb-1/control", "freeway://cell:9425/cb-1/frames"),
    ]
    for (control, frames) in refusals {
      #expect(throws: WireDecodeError.self, "\(control) · \(frames)") {
        try endpoints(control, frames)
      }
    }
  }

  @Test("the tailnet shape is read as it always was")
  func tailnet() throws {
    let doors = try endpoints(
      "wss://desk.tail1234.ts.net:9422/cell/cb-1/control",
      "wss://desk.tail1234.ts.net:9422/cell/cb-1/frames")
    #expect(RoutedCellEndpoints.freewayLeg(doors.url(for: .control)) == nil)
  }
}
