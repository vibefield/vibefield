import FieldProduct
import FieldRoutedTerminal
import Foundation
import Testing

@testable import FieldFreeway

func golden(_ name: String) throws -> JSONValue {
  let url = try #require(
    Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
  return try JSONValue.parse(Data(contentsOf: url))
}

/// A transport that records what it was asked to dial and dials nothing.
final class RecordingTransport: RoutedLegTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var urls: [URL] = []
  var dialed: [URL] { lock.withLock { urls } }

  struct NotHere: Error {}

  func connect(to url: URL) async throws -> any RoutedLegConnection {
    lock.withLock { urls.append(url) }
    throw NotHere()
  }
}

/// The host's side of one open: read the phone's OPEN, answer it OPENED with `answer`.
func answerOpen(_ host: ScriptedHost, with answer: JSONValue) async throws -> (UInt64, JSONValue) {
  let open = try await within(5, "the open") { try await host.nextFrame() }
  #expect(open.kind == .open)
  try await host.sendJSON(.opened, stream: open.stream, answer)
  return (open.stream, try JSONValue.parse(open.payload))
}

@Suite("the routed client's terminals on the link", .timeLimit(.minutes(1)))
struct FreewayLegTests {
  @Test("a leg is a terminal-leg stream for the URL's cell and channel, carried verbatim both ways")
  func leg() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let transport = FreewayLegTransport { link }
    let url = try #require(URL(string: "freeway://cell/cb-7f3a9c1e-2026/control"))
    let dialing = Task { try await transport.connect(to: url) }
    let (stream, open) = try await answerOpen(host, with: .object([:]))
    #expect(
      open
        == .object([
          "kind": .string("terminal-leg"), "cellBootId": .string("cb-7f3a9c1e-2026"),
          "channel": .string("control"),
        ]))
    let connection = try await within(5, "the leg") { try await dialing.value }
    try await connection.send(.text("{\"type\":\"ConnectionHello\"}"))
    let hello = try await within(5, "the hello") { try await host.nextFrame() }
    #expect(hello.kind == .text && hello.stream == stream)
    #expect(String(decoding: hello.payload, as: UTF8.self) == "{\"type\":\"ConnectionHello\"}")
    try await host.send(FreewayFrame(kind: .binary, stream: stream, payload: Data([7, 7])))
    guard case .binary(let unit) = try await connection.receive() else {
      Issue.record("a presentation unit is binary")
      return
    }
    #expect(unit == Data([7, 7]))
    // the cell closes the leg LEG_TIMEOUT: the code is the leg's, as a socket's would be
    try await host.sendJSON(.close, stream: stream, .object(["code": .int(4004)]))
    await #expect(throws: FreewayLegError.closed(code: 4004)) { try await connection.receive() }
    #expect(await connection.closeCode() == 4004)
    await link.close()
  }

  @Test("a link that goes is a dropped leg — no code — never a close the cell made")
  func droppedLeg() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let transport = FreewayLegTransport { link }
    let dialing = Task {
      try await transport.connect(to: URL(string: "freeway://cell/cb-1/frames")!)
    }
    _ = try await answerOpen(host, with: .object([:]))
    let connection = try await within(5, "the leg") { try await dialing.value }
    try await host.close(code: 4409, reason: "SUPERSEDED")
    await #expect(throws: FreewayLegError.closed(code: nil)) { try await connection.receive() }
    #expect(await connection.closeCode() == nil)
  }

  @Test("the focused cell's frames ride live and every other cell's sync, said only when a leg's class changes")
  func focus() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let focus = FreewayFocus()
    let transport = FreewayLegTransport(focus: focus) { link }
    func leg(_ path: String) async throws -> (connection: any RoutedLegConnection, stream: UInt64) {
      let dialing = Task { try await transport.connect(to: URL(string: "freeway://cell/\(path)")!) }
      let (stream, _) = try await answerOpen(host, with: .object([:]))
      return (try await within(5, "the leg") { try await dialing.value }, stream)
    }
    func priority(_ stream: UInt64, _ streamClass: String) -> JSONValue {
      .object([
        "type": .string("Priority"), "streamId": .int(Int64(stream)), "class": .string(streamClass),
      ])
    }
    let a = try await leg("cb-a/frames")
    let b = try await leg("cb-b/frames")
    _ = try await leg("cb-a/control")  // a control leg is P0, never the focus's
    // the host opened both frames legs live: focusing A says nothing of A, and B goes to sync
    await focus.focus("cb-a")
    #expect(try await within(5, "the priority") { try await host.nextLink() } == priority(b.stream, "sync"))
    await focus.focus("cb-b")
    #expect(try await within(5, "a priority") { try await host.nextLink() } == priority(a.stream, "sync"))
    #expect(try await within(5, "a priority") { try await host.nextLink() } == priority(b.stream, "live"))
    // a frames leg opened behind the focus rides sync from its first frame on
    let c = try await leg("cb-c/frames")
    #expect(try await within(5, "the new leg's") { try await host.nextLink() } == priority(c.stream, "sync"))
    // a leg that ended is classed no more: focusing its own cell says nothing of it, and B goes
    // to sync; then C's focus is the next thing said, so nothing was said between
    await a.connection.close()
    let close = try await within(5, "the close") { try await host.nextFrame() }
    #expect(close.kind == .close && close.stream == a.stream)
    await focus.focus("cb-a")
    #expect(try await within(5, "a priority") { try await host.nextLink() } == priority(b.stream, "sync"))
    await focus.focus("cb-c")
    #expect(try await within(5, "a priority") { try await host.nextLink() } == priority(c.stream, "live"))
    await link.close()
  }

  @Test("each endpoint goes to the transport its shape names")
  func routing() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let fallback = RecordingTransport()
    let transport = FreewayRoutedTransport(freeway: FreewayLegTransport { link }, fallback: fallback)
    let door = try #require(URL(string: "ws://desk.tail1234.ts.net:9422/cell/cb-1/control"))
    await #expect(throws: RecordingTransport.NotHere.self) { try await transport.connect(to: door) }
    #expect(fallback.dialed == [door])
    let dialing = Task {
      try await transport.connect(to: URL(string: "freeway://cell/cb-1/control")!)
    }
    _ = try await answerOpen(host, with: .object([:]))
    _ = try await within(5, "the leg") { try await dialing.value }
    #expect(fallback.dialed == [door])
    await #expect(throws: FreewayLegError.notAFreewayLeg) {
      try await FreewayLegTransport { link }.connect(to: door)
    }
    await link.close()
  }

  @Test("the ticket door answers the host's ticket, which the routed reader reads, and says its refusal")
  func tickets() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let opened = try golden("freeway-opened.tickets")
    let asking = Task { try await FreewayTerminalDoors.ticket("sess-01J8Z3K9", on: link) }
    let (_, open) = try await answerOpen(host, with: opened)
    #expect(open["kind"]?.stringValue == "terminal-tickets")
    #expect(open["sessionIds"] == .array([.string("sess-01J8Z3K9")]))
    let ticket = try RoutedTerminalTicket(json: try await within(5, "the ticket") { try await asking.value })
    #expect(ticket.endpoints.controlUrl.absoluteString == "freeway://cell/cb-7f3a9c1e-2026/control")
    #expect(RoutedCellEndpoints.freewayLeg(ticket.endpoints.framesUrl)?.channel == .frames)

    let refused = Task { try await FreewayTerminalDoors.ticket("sess-01J8Z4QX", on: link) }
    _ = try await answerOpen(host, with: opened)
    await #expect(
      throws: FieldProductError(
        kind: "NOT_FOUND", message: "no such session on this desktop", retryable: false)
    ) { try await within(5, "the refusal") { try await refused.value } }

    let doorDown = Task { try await FreewayTerminalDoors.ticket("sess-1", on: link) }
    let open3 = try await within(5, "the open") { try await host.nextFrame() }
    try await host.sendJSON(
      .openRefused, stream: open3.stream,
      .object(["code": .int(4401), "state": .string("the approval lapsed; renew it"), "retryable": .bool(true)]))
    await #expect(
      throws: FieldProductError(
        kind: "UNAVAILABLE", message: "the approval lapsed; renew it", retryable: true,
        details: .object(["service": .string("freeway"), "code": .int(4401)]))
    ) { try await within(5, "the refused open") { try await doorDown.value } }
    await link.close()
  }

  @Test("the renewal door answers the host's grant as `{attachGrant}`, and a lost CAS as CONFLICT")
  func renewals() async throws {
    let (link, host, _) = try await within(5, "connect") { try await connected() }
    let renewing = Task {
      try await FreewayTerminalDoors.renew(
        "sess-01J8Z3K9", expectGeneration: 1, requestId: "rq-1", on: link)
    }
    let granted = try golden("freeway-opened.attach-grant")
    let (_, open) = try await answerOpen(host, with: granted)
    #expect(
      open
        == .object([
          "kind": .string("terminal-renew"), "sessionId": .string("sess-01J8Z3K9"),
          "expectGeneration": .int(1), "requestId": .string("rq-1"),
        ]))
    #expect(try await within(5, "the grant") { try await renewing.value } == granted)

    let lost = Task {
      try await FreewayTerminalDoors.renew(
        "sess-01J8Z3K9", expectGeneration: 1, requestId: "rq-2", on: link)
    }
    _ = try await answerOpen(host, with: try golden("freeway-opened.renew-refused"))
    await #expect(
      throws: FieldProductError(
        kind: "CONFLICT", message: "the session's grant is at generation 2, not 1", retryable: false)
    ) { try await within(5, "the refusal") { try await lost.value } }
    await link.close()
  }
}
