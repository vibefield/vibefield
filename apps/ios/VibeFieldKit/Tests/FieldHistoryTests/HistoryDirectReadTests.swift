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

  func call(_ method: String, params: FieldProduct.JSONValue?) async throws -> FieldProduct.JSONValue {
    asked.append(method)
    switch method {
    case "index.status": return try Fixture.json("index-status.valid")
    case "index.session": return try Fixture.json("index-session.valid")
    case "index.timeline": return try Fixture.json("index-timeline.valid")
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
