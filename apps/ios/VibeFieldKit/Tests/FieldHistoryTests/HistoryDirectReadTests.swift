import FieldProduct
import Foundation
import RosettaClient
import Testing

@testable import FieldHistory

// SP-7b's 7b-2b — a session read DIRECTLY: the ticket asked at the home, rosetta's own client over the phone's
// network, the projection into the same rows the door fills. Over a scripted socket and an HTTP stub: a snapshot, a
// mutation, a resync, a page, a rewritten cursor, an expired grant, and the four roads back to the door's pages.
// The header stays on the door; a session the direct plane cannot serve reads as it always has.

// MARK: - rosetta's wire, written out

/// One row's members, as rosetta's client holds them (`TimelineEntry`).
private func row(_ ordinal: Int, _ words: String = "row") -> String {
  let identity = #""timeline_id":"r\#(ordinal)","session_id":"s1","ordinal":\#(ordinal)"#
  let group = #""group":{"id":"cycle-\#(ordinal)","kind":"agent_cycle"},"at":3600000"#
  let body = #""body":{"type":"agent","text":{"type":"inline","text":"\#(words)"},"attachments":[]}"#
  return "\(identity),\(group),\(body)"
}

/// Item 362f — one tool row's members: a shell command run in a folder, as rosetta's client holds it.
private func commandRow(_ ordinal: Int, _ command: String, in folder: String) -> String {
  let identity = #""timeline_id":"r\#(ordinal)","session_id":"s1","ordinal":\#(ordinal)"#
  let group = #""group":{"id":"cycle-\#(ordinal)","kind":"agent_cycle"},"at":3600000"#
  let source = #""command":{"type":"inline","text":"\#(command)"}"#
  let place = #""cwd":{"type":"directory","path":"\#(folder)","resolved":true}"#
  let outcome = #""outcome":{"exit_code":0,"signal":null,"process_id":null}"#
  let action = #"{"type":"shell",\#(source),\#(place),"timeout_ms":null,"background":false,\#(outcome)}"#
  let made = #""correlation":{"key":"k\#(ordinal)","derivation":"native_id"},"native":{"name":"Bash"}"#
  let state = #""status":{"value":"succeeded","basis":"native_terminal_record"}"#
  let tool = #"{\#(made),\#(state),"action":\#(action),"failure":null,"timing":null}"#
  return #"\#(identity),\#(group),"body":{"type":"tool_use","tool":\#(tool)}"#
}

private enum Frame {
  static let hello = #"{"frame":"hello","protocol_version":\#(Rosetta.protocolVersion)}"#
  static let resync = #"{"frame":"resync"}"#

  static func snapshot(_ rows: [String], cursor: String? = "c1", watermark: String = "w1") -> String {
    let entries = rows.map { "{\($0)}" }.joined(separator: ",")
    let next = cursor.map { "\"\($0)\"" } ?? "null"
    let meta = #"{"tasks":[],"workflows":[],"plans":[],"artifacts":[]}"#
    let head = #"{"frame":"timeline_snapshot","stamp":{"epoch":9,"seq":1},"entries":[\#(entries)]"#
    return #"\#(head),"timeline_meta":\#(meta),"cursor":\#(next),"watermark":"\#(watermark)"}"#
  }

  static func message(_ row: String, seq: Int) -> String {
    #"{"frame":"mutation","stamp":{"epoch":9,"seq":\#(seq)},"mutation":{"type":"message",\#(row)}}"#
  }
}

private func pageBody(_ rows: [String], cursor: String? = nil, watermark: String = "w1") -> Data {
  let entries = rows.map { "{\($0)}" }.joined(separator: ",")
  let next = cursor.map { "\"\($0)\"" } ?? "null"
  return Data(#"{"entries":[\#(entries)],"watermark":"\#(watermark)","cursor":\#(next)}"#.utf8)
}

// MARK: - The instruments

private final class ScriptedSocket: RosettaSocket, @unchecked Sendable {
  private let lock = NSLock()
  private var queue: [String] = []
  private var waiter: CheckedContinuation<String, any Error>?
  private var closed = false

  func receive() async throws -> String {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, any Error>) in
      lock.lock()
      if !queue.isEmpty {
        let next = queue.removeFirst()
        lock.unlock()
        continuation.resume(returning: next)
      } else if closed {
        lock.unlock()
        continuation.resume(throwing: CancellationError())
      } else {
        waiter = continuation
        lock.unlock()
      }
    }
  }

  func deliver(_ frame: String) {
    lock.lock()
    let pending = waiter
    waiter = nil
    if pending == nil { queue.append(frame) }
    lock.unlock()
    pending?.resume(returning: frame)
  }

  func close() {
    lock.lock()
    closed = true
    let pending = waiter
    waiter = nil
    lock.unlock()
    pending?.resume(throwing: CancellationError())
  }

  var isClosed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return closed
  }
}

private final class ScriptedSockets: RosettaSocketFactory, @unchecked Sendable {
  struct Dial {
    let url: URL
    let protocols: [String]
    let socket: ScriptedSocket
  }

  private let lock = NSLock()
  private var opened: [Dial] = []

  func open(url: URL, protocols: [String]) -> any RosettaSocket {
    let socket = ScriptedSocket()
    lock.lock()
    opened.append(Dial(url: url, protocols: protocols, socket: socket))
    lock.unlock()
    return socket
  }

  var dials: [Dial] {
    lock.lock()
    defer { lock.unlock() }
    return opened
  }

  var latest: ScriptedSocket? { dials.last?.socket }
}

/// Answers every request of a session this rig built. One at a time: the suite is serialized.
private final class StubHTTP: URLProtocol, @unchecked Sendable {
  struct Answer: Sendable {
    var status: Int
    var headers: [String: String] = [:]
    var body = Data()
  }

  private static let lock = NSLock()
  nonisolated(unsafe) private static var script: [Answer] = []
  nonisolated(unsafe) private static var seen: [URLRequest] = []

  static func reset(_ answers: [Answer]) {
    lock.lock()
    script = answers
    seen = []
    lock.unlock()
  }

  static var requests: [URLRequest] {
    lock.lock()
    defer { lock.unlock() }
    return seen
  }

  private static func next(_ request: URLRequest) -> Answer {
    lock.lock()
    defer { lock.unlock() }
    seen.append(request)
    if script.count > 1 { return script.removeFirst() }
    return script.first ?? Answer(status: 500)
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let answer = Self.next(request)
    var headers = answer.headers
    headers[Rosetta.protocolVersionHeader] = String(Rosetta.protocolVersion)
    guard let url = request.url,
      let response = HTTPURLResponse(
        url: url, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: headers)
    else { return }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: answer.body)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}

@MainActor
private final class Door: HistoryDoor {
  var asked: [String] = []
  /// Item 366 — the door's `index.timeline`, scripted by its params (nil: the fixture, as every earlier row reads).
  var timeline: ((FieldProduct.JSONValue?) -> FieldProduct.JSONValue)?

  func call(_ method: String, params: FieldProduct.JSONValue?) async throws -> FieldProduct.JSONValue {
    asked.append(method)
    switch method {
    case "index.status": return try Fixture.json("index-status.valid")
    case "index.session": return try Fixture.json("index-session.valid")
    case "index.timeline":
      if let timeline { return timeline(params) }
      return try Fixture.json("index-timeline.valid")
    default: throw FieldProductError(kind: "NOT_FOUND", message: method)
    }
  }

  func tail(
    _ method: String, params: FieldProduct.JSONValue?, shape: SubscriptionShape,
    onSnapshot: @escaping @MainActor (FieldProduct.JSONValue) -> Void,
    onDelta: @escaping @MainActor (FieldProduct.JSONValue) -> Void
  ) async throws -> HistoryTailHandle {
    asked.append(method)
    return HistoryTailHandle {}
  }

  func close() {}
}

@MainActor
private final class Tickets {
  var asked: [String] = []
  var rest: String? = "http://desk.test:9424"
  var refusal: (any Error)?

  func answer(_ sessionId: String) throws -> FieldProduct.JSONValue {
    asked.append(sessionId)
    if let refusal { throw refusal }
    var endpoints: [String: FieldProduct.JSONValue] = [
      "sessionUrl": .string("ws://desk.test:9424/ws/sessions/\(sessionId)")
    ]
    if let rest { endpoints["restUrl"] = .string(rest) }
    return .object([
      "device": .string("dev-1"),
      "endpoints": .object(endpoints),
      "grant": .string("grant-\(asked.count)"),
      "expiresAt": .int(1_790_000_060_000),
    ])
  }
}

/// The phone's network, in these tests: every request answered by `StubHTTP`.
private let stubProvider: HistoryDirectPlane.SessionProvider = { configuration in
  configuration.protocolClasses = [StubHTTP.self]
  return URLSession(configuration: configuration)
}

@MainActor
private func reached(
  _ what: String, within limit: Duration = .seconds(5), _ condition: @MainActor () -> Bool
) async -> Bool {
  let clock = ContinuousClock()
  let deadline = clock.now + limit
  while !condition() {
    if clock.now >= deadline {
      Issue.record("not within \(limit): \(what)")
      return false
    }
    try? await Task.sleep(for: .milliseconds(5))
  }
  return true
}

@MainActor
private struct Rig {
  let door = Door()
  let tickets = Tickets()
  let sockets = ScriptedSockets()

  func reader(
    renewEvery: Duration = .seconds(3_600), deadline: Duration = .seconds(3_600)
  ) -> HistoryDesktopReader {
    let tickets = self.tickets
    let plane = HistoryDirectPlane(
      ticket: { sessionId in try tickets.answer(sessionId) },
      session: { stubProvider },
      sockets: sockets, renewEvery: renewEvery, openDeadline: deadline)
    let reader = HistoryDesktopReader(
      deviceId: "dev-1", name: "studio", door: door, direct: plane, log: { _ in })
    reader.start()
    return reader
  }

  /// A session opened and its socket live on `rows`.
  func open(_ reader: HistoryDesktopReader, rows: [String]) async -> Bool {
    reader.need(.session(device: "dev-1", id: "s1"))
    let sockets = self.sockets
    guard await reached("a dial", { !sockets.dials.isEmpty }) else { return false }
    sockets.latest?.deliver(Frame.hello)
    sockets.latest?.deliver(Frame.snapshot(rows))
    return await reached("the live document") { reader.corpus.document("s1")?.liveSince != nil }
  }
}

@MainActor
private func ids(_ reader: HistoryDesktopReader, _ session: String = "s1") -> [String] {
  let turns = reader.corpus.document(session)?.turns ?? []
  return turns.flatMap { $0.segments.map(\.id) }
}

private func authorization(_ request: URLRequest?) -> String? {
  request?.value(forHTTPHeaderField: "authorization")
}

private let cursorExpired = StubHTTP.Answer(
  status: 410, body: Data(#"{"error":{"code":"cursor_expired","message":"rewritten"}}"#.utf8))
private let grantExpired = StubHTTP.Answer(status: 401, headers: [Rosetta.authReasonHeader: "expired"])

private func unavailable(_ state: String, device: String? = nil) -> FieldProductError {
  var details: [String: FieldProduct.JSONValue] = ["service": .string("index"), "state": .string(state)]
  if let device { details["device"] = .string(device) }
  return FieldProductError(kind: "UNAVAILABLE", message: "m", details: .object(details))
}

/// Item 366 — a row as the door gives it (`IndexTimelineRow`), named as the direct read's `row(_:)` names it: a
/// row's name is the same on both ways.
private func doorRow(
  _ ordinal: Int, id: String? = nil, text: String = "row", clipped: Bool = false
) -> FieldProduct.JSONValue {
  var row: [String: FieldProduct.JSONValue] = [
    "timelineId": .string(id ?? "r\(ordinal)"), "sessionId": .string("s1"), "ordinal": .int(Int64(ordinal)),
    "kind": .string("agent"), "at": .int(3_600_000),
    "group": .object(["id": .string("cycle-\(ordinal)"), "kind": .string("agent_cycle")]), "text": .string(text),
  ]
  if clipped { row["textClipped"] = .bool(true) }
  return .object(row)
}

private func doorPage(_ rows: [FieldProduct.JSONValue], next: String? = nil) -> FieldProduct.JSONValue {
  var page: [String: FieldProduct.JSONValue] = [
    "sessionId": .string("s1"), "entries": .array(rows), "watermark": .string("w1"),
  ]
  if let next { page["nextCursor"] = .string(next) }
  return .object(page)
}

/// The door's pages of one session of a hundred rows: its newest forty, then the forty above, then the top twenty.
private func hundredByTheDoor(_ params: FieldProduct.JSONValue?) -> FieldProduct.JSONValue {
  switch params?["cursor"]?.stringValue {
  case "d1": return doorPage((21...60).map { doorRow($0) }, next: "d2")
  case "d2": return doorPage((1...20).map { doorRow($0) })
  default: return doorPage((61...100).map { doorRow($0) }, next: "d1")
  }
}

@Suite(.serialized) @MainActor struct HistoryDirectReadTests {
  // MARK: - The read

  @Test func theSnapshotFillsTheDocumentAndTheDoorReadsNoPages() async {
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(1), row(2)]) else { return }
    #expect(ids(reader) == ["r1", "r2"])
    let document = reader.corpus.document("s1")
    #expect(document?.nextCursor == "c1")
    #expect(document?.watermark == "w1")
    #expect(rig.door.asked.contains("index.session"))
    #expect(!rig.door.asked.contains("index.timeline"))
    #expect(!rig.door.asked.contains("index.session.subscribe"))
    #expect(rig.tickets.asked == ["s1"])
    let dial = rig.sockets.dials.first
    #expect(dial?.url.absoluteString == "ws://desk.test:9424/ws/sessions/s1")
    #expect(dial?.protocols.contains("rosetta.grant.grant-1") == true)
    reader.close()
  }

  @Test func theReaderDoesNotShowTheDocumentAsReadingOnceItIsLive() async {
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(1)]) else { return }
    guard await reached("reading ended", { reader.reading.isEmpty }) else { return }
    #expect(reader.reading.isEmpty)
    reader.close()
  }

  @Test func aMutationMovesARowAndANewRowCountsOneArrival() async {
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(1), row(2)]) else { return }
    rig.sockets.latest?.deliver(Frame.message(row(3, "new"), seq: 2))
    guard await reached("the arrival", { reader.arrivals["s1"] == 1 }) else { return }
    #expect(ids(reader) == ["r1", "r2", "r3"])

    rig.sockets.latest?.deliver(Frame.message(row(3, "whole"), seq: 3))
    let changed = await reached("the patch") {
      let segments = reader.corpus.document("s1")?.turns.last?.segments ?? []
      return segments.contains { segment in
        if case .prose(_, _, let text, _) = segment { return text == "whole" }
        return false
      }
    }
    guard changed else { return }
    #expect(reader.arrivals["s1"] == 1)
    reader.close()
  }

  @Test func aResyncReplacesTheRowsAndTheCursor() async {
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(1), row(2)]) else { return }
    rig.sockets.latest?.deliver(Frame.resync)
    rig.sockets.latest?.deliver(Frame.snapshot([row(7)], cursor: "c9", watermark: "w2"))
    guard await reached("the new generation", { ids(reader) == ["r7"] }) else { return }
    let document = reader.corpus.document("s1")
    #expect(document?.nextCursor == "c9")
    #expect(document?.watermark == "w2")
    #expect(rig.sockets.dials.count == 1)
    reader.close()
  }

  // MARK: - The older pages

  @Test func anOlderPageIsRevealedAndMovesTheCursor() async {
    StubHTTP.reset([StubHTTP.Answer(status: 200, body: pageBody([row(1), row(2)], cursor: "c0"))])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(5), row(6)]) else { return }
    reader.need(.older(device: "dev-1", session: "s1"))
    guard await reached("the older rows", { ids(reader) == ["r1", "r2", "r5", "r6"] }) else { return }
    let moved = await reached("the cursor") { reader.corpus.document("s1")?.nextCursor == "c0" }
    #expect(moved)
    let request = StubHTTP.requests.first
    #expect(authorization(request) == "Rosetta-Grant grant-1")
    #expect(request?.url?.path == "/api/sessions/s1/timeline")
    #expect(request?.url?.query?.contains("cursor=c1") == true)
    #expect(request?.url?.query?.contains("limit=\(HistoryReads.pageRows)") == true)
    #expect(!rig.door.asked.contains("index.timeline"))
    reader.close()
  }

  @Test func aRewrittenCursorReopensFromRosettasOwnSnapshot() async {
    StubHTTP.reset([cursorExpired])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(5)]) else { return }
    reader.need(.older(device: "dev-1", session: "s1"))
    guard await reached("a second dial", { rig.sockets.dials.count == 2 }) else { return }
    rig.sockets.latest?.deliver(Frame.hello)
    rig.sockets.latest?.deliver(Frame.snapshot([row(9)], cursor: "c8", watermark: "w2"))
    guard await reached("the new head", { ids(reader) == ["r9"] }) else { return }
    #expect(reader.corpus.document("s1")?.nextCursor == "c8")
    #expect(!rig.door.asked.contains("index.timeline"))
    reader.close()
  }

  @Test func anExpiredGrantRenewsOnceAndTheReadGoesOn() async {
    let page = StubHTTP.Answer(status: 200, body: pageBody([row(1)]))
    StubHTTP.reset([grantExpired, page])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(5)]) else { return }
    reader.need(.older(device: "dev-1", session: "s1"))
    guard await reached("the older row", { ids(reader) == ["r1", "r5"] }) else { return }
    #expect(rig.tickets.asked.count == 2)
    let requests = StubHTTP.requests
    #expect(requests.count == 2)
    #expect(authorization(requests.last) == "Rosetta-Grant grant-2")
    reader.close()
  }

  @Test func aGrantRefusedAgainReadsThroughTheDoor() async {
    StubHTTP.reset([grantExpired])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(5)]) else { return }
    reader.need(.older(device: "dev-1", session: "s1"))
    guard await reached("the door's page", { rig.door.asked.contains("index.timeline") }) else { return }
    #expect(rig.tickets.asked.count == 2)
    #expect(StubHTTP.requests.count == 2)
    #expect(reader.failure == HistoryDirectFallback.socket.said)
    reader.close()
  }

  // MARK: - The grant's life

  @Test func aFreshTicketRenewsTheGrantBeforeItsLifeEnds() async {
    StubHTTP.reset([StubHTTP.Answer(status: 200, body: pageBody([row(1)]))])
    let rig = Rig()
    let reader = rig.reader(renewEvery: .milliseconds(20))
    guard await rig.open(reader, rows: [row(5)]) else { return }
    guard await reached("a renewal", { rig.tickets.asked.count >= 2 }) else { return }
    reader.need(.older(device: "dev-1", session: "s1"))
    guard await reached("the request", { !StubHTTP.requests.isEmpty }) else { return }
    #expect(authorization(StubHTTP.requests.first) != "Rosetta-Grant grant-1")
    #expect(rig.sockets.dials.count == 1, "an open socket is left alone")
    reader.close()
  }

  @Test func theLifeOfARenewalIsWithinTheGrants() {
    #expect(HistoryReads.directRenewMs < IndexTicketLimits.ttlMs)
    #expect(HistoryReads.directRenewMs > 0)
  }

  // MARK: - The four roads back to the door

  @Test func aTicketWithNoPagesReadsThroughTheDoor() async {
    let rig = Rig()
    rig.tickets.rest = nil
    let reader = rig.reader()
    reader.need(.session(device: "dev-1", id: "s1"))
    guard await reached("the door's page", { rig.door.asked.contains("index.timeline") }) else { return }
    #expect(rig.tickets.asked == ["s1"])
    #expect(rig.sockets.dials.isEmpty)
    #expect(reader.failure == HistoryDirectFallback.noPages.said)
    guard await reached("the door's tail", { rig.door.asked.contains("index.session.subscribe") }) else { return }
    #expect(rig.tickets.asked == ["s1"], "the tail asks no second ticket for a session the door is reading")
    reader.close()
  }

  @Test func noTicketReadsThroughTheDoor() async {
    let rig = Rig()
    rig.tickets.refusal = unavailable("starting")
    let reader = rig.reader()
    reader.need(.session(device: "dev-1", id: "s1"))
    guard await reached("the door's page", { rig.door.asked.contains("index.timeline") }) else { return }
    #expect(rig.tickets.asked == ["s1"])
    #expect(reader.failure == HistoryDirectFallback.noTicket.said)
    #expect(reader.standing == .connected, "a ticket refused is not a door that stopped")
    reader.close()
  }

  @Test func aRoadRefusalReadsThroughTheDoorAndTheNextSessionAsksAgain() async {
    let rig = Rig()
    rig.tickets.refusal = unavailable("egress_unavailable", device: "dev-1")
    let reader = rig.reader()
    reader.need(.session(device: "dev-1", id: "s1"))
    guard await reached("the door's page", { rig.door.asked.contains("index.timeline") }) else { return }
    let road = HistoryDirectFallback.refused(.egressUnavailable(device: "dev-1"))
    #expect(reader.failure == road.said)
    reader.need(.session(device: "dev-1", id: "s2"))
    guard await reached("the next ask", { rig.tickets.asked.count == 2 }) else { return }
    #expect(rig.tickets.asked == ["s1", "s2"])
    reader.close()
  }

  @Test func aPlaneSwitchedOffIsNotAskedAgain() async {
    let rig = Rig()
    rig.tickets.refusal = unavailable("direct-plane-off")
    let reader = rig.reader()
    reader.need(.session(device: "dev-1", id: "s1"))
    guard await reached("the door's page", { rig.door.asked.contains("index.timeline") }) else { return }
    reader.need(.session(device: "dev-1", id: "s2"))
    let pages = await reached("the second page") {
      rig.door.asked.filter { $0 == "index.timeline" }.count == 2
    }
    guard pages else { return }
    #expect(rig.tickets.asked == ["s1"])
    reader.close()
  }

  @Test func anOlderOwnersUnbuiltIsNotAskedAgain() async {
    let rig = Rig()
    rig.tickets.refusal = unavailable("direct-plane-unbuilt")
    let reader = rig.reader()
    reader.need(.session(device: "dev-1", id: "s1"))
    guard await reached("the door's page", { rig.door.asked.contains("index.timeline") }) else { return }
    #expect(reader.failure == HistoryDirectFallback.refused(.directPlaneUnbuilt).said)
    reader.need(.session(device: "dev-1", id: "s2"))
    let pages = await reached("the second page") {
      rig.door.asked.filter { $0 == "index.timeline" }.count == 2
    }
    guard pages else { return }
    #expect(rig.tickets.asked == ["s1"])
    reader.close()
  }

  @Test func aSocketThatNeverAnswersReadsThroughTheDoor() async {
    let rig = Rig()
    let reader = rig.reader(deadline: .milliseconds(30))
    reader.need(.session(device: "dev-1", id: "s1"))
    guard await reached("the door's page", { rig.door.asked.contains("index.timeline") }) else { return }
    #expect(rig.sockets.dials.count == 1)
    #expect(rig.sockets.latest?.isClosed == true, "the socket that did not answer is closed")
    #expect(reader.failure == HistoryDirectFallback.socket.said)
    guard await reached("the document", { reader.corpus.document("s1") != nil }) else { return }
    reader.close()
  }

  @Test func aSocketLostAfterItWasLiveReopensThroughTheDoor() async {
    let rig = Rig()
    let reader = rig.reader(deadline: .milliseconds(30))
    guard await rig.open(reader, rows: [row(5)]) else { return }
    rig.sockets.latest?.close()
    guard await reached("the door's page", { rig.door.asked.contains("index.timeline") }) else { return }
    #expect(reader.failure == HistoryDirectFallback.socket.said)
    guard await reached("the door's tail", { rig.door.asked.contains("index.session.subscribe") }) else { return }
    reader.close()
  }

  // MARK: - Its lifetime

  @Test func pauseClosesTheSocketAndResumeDialsWithAFreshTicket() async {
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(5)]) else { return }
    let first = rig.sockets.latest
    reader.pause()
    #expect(first?.isClosed == true)
    reader.resume()
    guard await reached("the second dial", { rig.sockets.dials.count == 2 }) else { return }
    #expect(rig.tickets.asked.count == 2)
    #expect(rig.sockets.dials.last?.protocols.contains("rosetta.grant.grant-2") == true)
    reader.close()
  }

  @Test func closeClosesTheSocket() async {
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(5)]) else { return }
    let socket = rig.sockets.latest
    reader.close()
    #expect(socket?.isClosed == true)
  }

  @Test func anotherSessionTakesTheOnlySocket() async {
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(5)]) else { return }
    let first = rig.sockets.latest
    reader.need(.session(device: "dev-1", id: "s2"))
    guard await reached("the second dial", { rig.sockets.dials.count == 2 }) else { return }
    #expect(first?.isClosed == true)
    #expect(rig.tickets.asked == ["s1", "s2"])
    reader.close()
  }

  // MARK: - rosetta's own entries through the seam

  // MARK: - The road changes under an open document (item 366)

  /// Item 366 (found reading for 362f; VF-PM numbered it 2026-11-12 21:05:29Z) — the direct read lost under an
  /// open document `reopen`ed the session: the rows went, and the door's newest forty stood where up to two
  /// hundred and the pages above them had been. `ids` are the document's segment ids: what the view keeps a
  /// reader's place and its opened groups by, so the same ids in the same order are the same page.
  @Test func aDirectReadLostLeavesEveryRowThatWasOnThePage() async {
    let rig = Rig()
    rig.door.timeline = hundredByTheDoor
    let reader = rig.reader(deadline: .milliseconds(30))
    guard await rig.open(reader, rows: (1...100).map { row($0) }) else { return }
    let shown = ids(reader)
    #expect(shown == (1...100).map { "r\($0)" })
    rig.sockets.latest?.close()
    guard await reached("the door's tail", { rig.door.asked.contains("index.session.subscribe") }) else { return }
    #expect(rig.door.asked.contains("index.timeline"), "the door's own page is read: its cursor comes with it")
    // every row that was on the page is on the page, in order
    #expect(ids(reader) == shown, "\(shown.count) rows were on the page and \(ids(reader).count) are left")
    #expect(reader.corpus.document("s1")?.nextCursor == "d1", "the cursor is the door's now, not rosetta's")
    // the rows above the door's page are read on by its own cursor: each is already on the page, and none lands
    // twice or out of order
    reader.need(.older(device: "dev-1", session: "s1"))
    guard await reached("the session's top, by the door", { reader.corpus.document("s1")?.nextCursor == nil })
    else { return }
    #expect(ids(reader) == shown)
    #expect(Set(ids(reader)).count == shown.count)
    reader.close()
  }

  /// The other way: the pages the door read stay when the direct read comes back with its own newest rows.
  @Test func aDirectReadComingBackLeavesThePagesTheDoorRead() async {
    let rig = Rig()
    rig.tickets.refusal = unavailable("starting")
    rig.door.timeline = hundredByTheDoor
    let reader = rig.reader()
    reader.need(.session(device: "dev-1", id: "s1"))
    guard await reached("the door's page", { ids(reader).count == 40 }) else { return }
    reader.need(.older(device: "dev-1", session: "s1"))
    guard await reached("the door's older page", { ids(reader).count == 80 }) else { return }
    let shown = ids(reader)
    #expect(shown == (21...100).map { "r\($0)" })
    // the phone reaches the desktop again: the direct read opens on its own newest rows, ten of them new
    rig.tickets.refusal = nil
    let dials = rig.sockets.dials.count
    reader.pause()
    reader.resume()
    guard await reached("a dial", { rig.sockets.dials.count > dials }) else { return }
    rig.sockets.latest?.deliver(Frame.hello)
    rig.sockets.latest?.deliver(Frame.snapshot((71...110).map { row($0) }))
    guard await reached("the direct read's rows", { ids(reader).last == "r110" }) else { return }
    #expect(
      ids(reader) == (21...110).map { "r\($0)" },
      "\(shown.count) rows were on the page before the direct read came back, and \(ids(reader).count) are left")
    reader.close()
  }

  /// The evidence rule: rows go only when the record itself changed. A door's page that shares no row with what
  /// is held, inside what is held, is a session rewritten on the desktop: the document is read again from its end.
  @Test func aSessionRewrittenUnderTheChangeIsReadAgainFromItsEnd() async {
    let rig = Rig()
    rig.door.timeline = { _ in doorPage((61...100).map { doorRow($0, id: "n\($0)") }, next: "d1") }
    let reader = rig.reader(deadline: .milliseconds(30))
    guard await rig.open(reader, rows: (1...100).map { row($0) }) else { return }
    rig.sockets.latest?.close()
    guard await reached("the door's tail", { rig.door.asked.contains("index.session.subscribe") }) else { return }
    #expect(ids(reader) == (61...100).map { "n\($0)" }, "rows of the record that was rewritten are not kept beside it")
    reader.close()
  }

  // MARK: - Read straight from the desktop, a message is whole (item 362f)

  /// The words of the document's last reply, and whether a cut mark stands in the document.
  private func reply(_ reader: HistoryDesktopReader) -> (text: String?, cut: Bool) {
    let segments = reader.corpus.document("s1")?.turns.flatMap(\.segments) ?? []
    var text: String?
    var cut = false
    for segment in segments {
      if case .prose(_, _, let words, _) = segment { text = words }
      if case .clipped = segment { cut = true }
    }
    return (text, cut)
  }

  /// Item 362f — the door cuts a reply's words at 2,000 units; read straight from the desktop the entry has them
  /// all, and the document shows them all with no cut mark under them.
  @Test func aReplyTheDoorWouldCutIsWholeOnTheDirectRead() async {
    let rig = Rig()
    let reader = rig.reader()
    let whole = String(repeating: "word ", count: 1_000)
    guard await rig.open(reader, rows: [row(5, whole)]) else { return }
    let shown = reply(reader)
    #expect(shown.text == whole, "\(shown.text?.utf16.count ?? 0) of 5000 units are on the page")
    #expect(shown.cut == false, "no cut mark stands under words that are whole")
    reader.close()
  }

  /// The whole stays when the direct read is lost and the door sends the very row the entry projects to.
  @Test func theWholeStaysWhenTheDoorReadsOnWithTheSameRow() async {
    let rig = Rig()
    let whole = String(repeating: "word ", count: 1_000)
    let cutAtTheDoor = String(whole.prefix(2_000))
    rig.door.timeline = { _ in doorPage([doorRow(5, text: cutAtTheDoor, clipped: true)]) }
    let reader = rig.reader(deadline: .milliseconds(30))
    guard await rig.open(reader, rows: [row(5, whole)]) else { return }
    rig.sockets.latest?.close()
    guard await reached("the door's tail", { rig.door.asked.contains("index.session.subscribe") }) else { return }
    let shown = reply(reader)
    #expect(shown.text == whole, "the door sent the row this entry projects to: its whole words stay")
    #expect(shown.cut == false)
    reader.close()
  }

  /// And it goes when the door's row under that id is another row: the door's words stand, as the door sent them.
  @Test func theWholeGoesWhenTheDoorsRowIsAnother() async {
    let rig = Rig()
    rig.door.timeline = { _ in doorPage([doorRow(5, text: "rewritten on the desktop")]) }
    let reader = rig.reader(deadline: .milliseconds(30))
    guard await rig.open(reader, rows: [row(5, String(repeating: "word ", count: 1_000))]) else { return }
    rig.sockets.latest?.close()
    guard await reached("the door's tail", { rig.door.asked.contains("index.session.subscribe") }) else { return }
    #expect(reply(reader).text == "rewritten on the desktop")
    reader.close()
  }

  /// Item 362f — read straight from the desktop, a tool line's detail reaches the reader beside the document, by
  /// the line's id, and the document itself does not carry it (the document is written to the cache at every
  /// rebuild).
  @Test func aToolLinesDetailStandsBesideTheDocumentOnTheDirectRead() async throws {
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [commandRow(5, "ls", in: "/work/marker-362f")]) else { return }
    #expect(reader.toolDetails["s1"]?["r5"]?.folder == "/work/marker-362f")
    #expect(reader.toolDetails["s1"]?["r5"]?.command == "ls")
    let document = try #require(reader.corpus.document("s1"))
    let data = try JSONEncoder().encode(document)
    let written = String(decoding: data, as: UTF8.self)
    #expect(!written.contains("marker-362f"), "the detail is not in what the cache is handed")
    reader.close()
  }

  /// And it goes when the door's row under that id is another row.
  @Test func aToolLinesDetailGoesWhenTheDoorsRowIsAnother() async {
    let rig = Rig()
    rig.door.timeline = { _ in doorPage([doorRow(5, text: "rewritten on the desktop")]) }
    let reader = rig.reader(deadline: .milliseconds(30))
    guard await rig.open(reader, rows: [commandRow(5, "ls", in: "/work/app")]) else { return }
    rig.sockets.latest?.close()
    guard await reached("the door's tail", { rig.door.asked.contains("index.session.subscribe") }) else { return }
    guard await reached("the detail gone", { reader.toolDetails["s1"] == nil }) else { return }
    #expect(reader.toolDetails["s1"] == nil)
    reader.close()
  }

  @Test func everyPairProjectsThroughRosettasOwnEntry() throws {
    let document = try Fixture.json("index-timeline-pairs.golden")
    let cases = document["cases"]?.arrayValue ?? []
    #expect(cases.count == 55)
    for item in cases {
      let name = item["name"]?.stringValue ?? "?"
      let raw = try #require(item["entry"], "\(name): no entry")
      let wanted = try #require(item["row"], "\(name): no row")
      let held = try JSONDecoder().decode(TimelineEntry.self, from: raw.encoded())
      let row = HistoryProjection.row(entry: held)
      let expected = try IndexTimelineRow(json: wanted)
      #expect(row == expected, "\(name)")
    }
  }

  // MARK: - A reader with no plane

  @Test func aReaderWithNoPlaneReadsThroughTheDoorAndSaysNothing() async {
    let door = Door()
    let reader = HistoryDesktopReader(deviceId: "dev-1", name: "studio", door: door, log: { _ in })
    reader.start()
    reader.need(.session(device: "dev-1", id: "s1"))
    guard await reached("the door's page", { door.asked.contains("index.timeline") }) else { return }
    #expect(reader.failure == nil)
    reader.close()
  }
}
