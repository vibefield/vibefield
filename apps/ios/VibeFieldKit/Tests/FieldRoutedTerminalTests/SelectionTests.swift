import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

@MainActor
@Suite(.serialized) struct SelectionTests {
  private let session = "sess-01J8Z3K9"

  private func attached(capability: Bool = true, rights: [String] = ["read"]) async throws
    -> (RoutedTerminalClient, ScriptedConnection)
  {
    let transport = ScriptedTransport()
    let client = RoutedTerminalClient(transport: transport, sink: RoutedFrameRecorder())
    client.open(try TicketFactory.make(sessionId: session, rights: rights))
    let control = transport.connection(for: "/control")
    let frames = transport.connection(for: "/frames")
    try await settle("selection hellos") {
      let a = await control.sentTags().contains("ConnectionHello")
      let b = await frames.sentTags().contains("ConnectionHello")
      return a && b
    }
    try await control.deliver(.connectionAccepted,
      Script.accepted(channel: .control, heartbeatTtlMs: 15_000,
        capabilities: capability ? ["selection-text"] : []))
    try await frames.deliver(.connectionAccepted,
      Script.accepted(channel: .frames, heartbeatTtlMs: 15_000))
    let attach = try await settled("selection attach") { await control.lastSent("AttachControlLeg") }
    let activation = try #require(attach["activationId"]?.stringValue)
    try await control.deliver(.controlLegAttached,
      Script.controlAttached(session: session, activation: activation, rights: rights))
    try await settle("read-only control attached") { client.sessions[session]?.control == .attached }
    return (client, control)
  }

  private func reply(_ request: JSONValue, text: String? = nil, error: String? = nil) -> [String: JSONValue] {
    var fields = request.objectValue!.filter {
      ["requestId", "sessionId", "activationId", "leaseEpoch"].contains($0.key)
    }
    if let text { fields["text"] = .string(text) }
    if let error { fields["error"] = .string(error) }
    return fields
  }

  @Test func readOnlyUnicodeAndEmptyRepliesCanArriveOutOfOrder() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    let first = Task { try await client.selectionText(.init(selectAll: true), for: session) }
    let request1 = try await settled("first copy") { await control.lastSent("SelectionTextRequest") }
    let second = Task { try await client.selectionText(.init(endColumn: 4), for: session) }
    try await settle("second copy") { await control.allSent("SelectionTextRequest").count == 2 }
    let request2 = try #require(await control.lastSent("SelectionTextRequest"))
    try await control.deliver(.selectionTextResult, reply(request2, text: ""))
    try await control.deliver(.selectionTextResult, reply(request1, text: "中-é-👩‍💻-🛙X\nrow 160"))
    #expect(try await first.value == "中-é-👩‍💻-🛙X\nrow 160")
    #expect(try await second.value == "")
    #expect(await control.allSent("SendInput").isEmpty)
    #expect(await control.allSent("ClaimGeometry").isEmpty)
  }

  @Test func olderHostsAndMissingReadRightsSendNoCopyMessage() async throws {
    let (old, oldControl) = try await attached(capability: false)
    defer { old.close() }
    await #expect(throws: RoutedSelectionError.unsupported) {
      try await old.selectionText(.init(selectAll: true), for: session)
    }
    #expect(await oldControl.allSent("SelectionTextRequest").isEmpty)
    let (noRead, control) = try await attached(rights: ["input"])
    defer { noRead.close() }
    await #expect(throws: RoutedSelectionError.unavailable) {
      try await noRead.selectionText(.init(selectAll: true), for: session)
    }
    #expect(await control.allSent("SelectionTextRequest").isEmpty)
  }

  @Test func foreignRepliesCloseTheLegAndCancelTheCopy() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    let copy = Task { try await client.selectionText(.init(selectAll: true), for: session) }
    let request = try await settled("copy") { await control.lastSent("SelectionTextRequest") }
    var foreign = reply(request, text: "another terminal")
    foreign["sessionId"] = .string("foreign")
    try await control.deliver(.selectionTextResult, foreign)
    await #expect(throws: CancellationError.self) { try await copy.value }
    try await settle("foreign response closed") { await control.isClosed }
  }

  @Test func timeoutAndOversizeRefusalLeaveTheConnectionUsable() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    client.selectionDeadline = .milliseconds(30)
    await #expect(throws: RoutedSelectionError.timedOut) {
      try await client.selectionText(.init(selectAll: true), for: session)
    }
    let old = try #require(await control.lastSent("SelectionTextRequest"))
    client.selectionDeadline = .seconds(5)
    let copy = Task { try await client.selectionText(.init(selectAll: true), for: session) }
    try await settle("new request") { await control.allSent("SelectionTextRequest").count == 2 }
    let request = try #require(await control.lastSent("SelectionTextRequest"))
    try await control.deliver(.selectionTextResult, reply(old, text: "late"))
    try await control.deliver(.selectionTextResult, reply(request, error: "TOO_LARGE"))
    await #expect(throws: RoutedSelectionError.tooLarge) { try await copy.value }
    #expect(await !control.isClosed)
  }

  @Test func parkingAndTaskCancellationDiscardPendingCopies() async throws {
    let (client, control) = try await attached()
    defer { client.close() }
    let copy = Task { try await client.selectionText(.init(selectAll: true), for: session) }
    _ = try await settled("copy") { await control.lastSent("SelectionTextRequest") }
    client.declare(demand: .none, for: session)
    await #expect(throws: CancellationError.self) { try await copy.value }
    client.declare(demand: .live, for: session)
    let cancelled = Task { try await client.selectionText(.init(selectAll: true), for: session) }
    try await settle("cancellable copy") { await control.allSent("SelectionTextRequest").count == 2 }
    cancelled.cancel()
    await #expect(throws: CancellationError.self) { try await cancelled.value }
  }

  @Test func pendingCopiesAreBoundedAndClosingCancelsAll() async throws {
    let (client, control) = try await attached()
    var pending: [Task<String, any Error>] = []
    for count in 1...16 {
      pending.append(Task { try await client.selectionText(.init(selectAll: true), for: session) })
      try await settle("copy queued") { await control.allSent("SelectionTextRequest").count == count }
    }
    await #expect(throws: RoutedSelectionError.busy) {
      try await client.selectionText(.init(selectAll: true), for: session)
    }
    client.close()
    for task in pending {
      await #expect(throws: CancellationError.self) { try await task.value }
    }
  }

  @Test func resultHasExactlyOneBoundedOutcomeAndSafeIdentity() throws {
    let valid = try Vector.json("tp-selection-text-result.unicode")
    #expect(try RoutedSelectionResult(json: valid).result.get() == "中-é-👩‍💻-🛙X\nrow 160")
    var body = valid.objectValue!
    body["error"] = .string("UNAVAILABLE")
    #expect(throws: RoutedSelectionError.self) { try RoutedSelectionResult(json: .object(body)) }
    body["error"] = nil
    body["leaseEpoch"] = .int(9_007_199_254_740_992)
    #expect(throws: RoutedSelectionError.self) { try RoutedSelectionResult(json: .object(body)) }
  }
}
