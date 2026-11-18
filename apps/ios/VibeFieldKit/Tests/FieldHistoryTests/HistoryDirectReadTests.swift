import FieldProduct
import Foundation
import RosettaClient
import Testing

@testable import FieldHistory

// SP-7b's 7b-2b — a session read DIRECTLY: the ticket asked at the home, rosetta's own client over the phone's
// network, the projection into the same rows the door fills. Over a scripted socket and an HTTP stub: a snapshot, a
// mutation, a resync, a page, a rewritten cursor, an expired grant, and the four roads back to the door's pages.
// The header stays on the door; a session the direct plane cannot serve reads as it always has.
//
// Item 362g: and a session's recorded pictures, asked of rosettad by the same client: where each size is asked, its
// bound, the turn, what a failure says, where none is read, and when they go.

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

/// Item 362g — a stored member's own members, as an entry names it: its address is `/api/assets/<digest>.<ext>`.
private func stored(_ digit: Character, _ ext: String, _ mediaType: String) -> String {
  let digest = String(repeating: digit, count: 64)
  let address = #""url":"/api/assets/\#(digest).\#(ext)","digest":"\#(digest)""#
  return #"\#(address),"media_type":"\#(mediaType)","byte_len":1234"#
}

/// Item 362g — a recorded original: a PNG with no map of sizes, which rosettad renders on request. `digit` makes
/// its digest, so two digits are two pictures.
private func original(_ digit: Character) -> String {
  "{" + stored(digit, "png", "image/png") + "}"
}

private let recordedOriginal = original("d")

/// Item 362g — a legacy WebP bundle: the member and its four sized members, each at its own address.
private let legacyBundle: String = {
  let sizes: [(name: String, digit: Character)] = [("rail", "1"), ("tile", "2"), ("tile2x", "3"), ("preview", "4")]
  let members = sizes.map { size in
    let member = stored(size.digit, "webp", "image/webp")
    return #""\#(size.name)":{\#(member)}"#
  }
  let base = stored("a", "webp", "image/webp")
  let map = members.joined(separator: ",")
  return #"{\#(base),"image_variants":{\#(map)}}"#
}()

/// Item 362g — one attachment's members: an image whose source names the stored member `asset`.
private func pictureAttachment(_ id: String, asset: String) -> String {
  let named = #""id":"\#(id)","kind":"image","name":"shot.png","label":null,"media_type":"image/png""#
  let sized = #""byte_len":1234,"dimensions":null,"message_ranges":[]"#
  let source = #""source":{"type":"asset","asset":\#(asset)}"#
  return "{" + named + "," + sized + "," + source + "}"
}

/// Item 362g — one reply's members with a recorded picture attached, as rosetta's client holds it: the attachment
/// `attachment` over the stored member `asset`, and after it any `more` (each a `pictureAttachment`).
private func pictureRow(
  _ ordinal: Int, id: String? = nil, attachment: String = "a1", asset: String, more: [String] = []
) -> String {
  let timelineId = id ?? "r\(ordinal)"
  let identity = #""timeline_id":"\#(timelineId)","session_id":"s1","ordinal":\#(ordinal)"#
  let group = #""group":{"id":"cycle-\#(ordinal)","kind":"agent_cycle"},"at":3600000"#
  let attached = ([pictureAttachment(attachment, asset: asset)] + more).joined(separator: ",")
  let words = #""text":{"type":"inline","text":"see"}"#
  return #"\#(identity),\#(group),"body":{"type":"agent",\#(words),"attachments":[\#(attached)]}"#
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
  /// Item 362g — while held, a request is seen and left unanswered until `release()`: an ask kept on its way.
  nonisolated(unsafe) private static var holding = false
  nonisolated(unsafe) private static var parked: [StubHTTP] = []

  static func reset(_ answers: [Answer]) {
    lock.lock()
    script = answers
    seen = []
    holding = false
    parked = []
    lock.unlock()
  }

  static func hold() {
    lock.lock()
    holding = true
    lock.unlock()
  }

  /// Answer every request held so far, in the order they came, and hold no more.
  static func release() {
    lock.lock()
    holding = false
    let waiting = parked
    parked = []
    let answers = waiting.map { _ in take() }
    lock.unlock()
    for (stub, answer) in zip(waiting, answers) { stub.deliver(answer) }
  }

  static var requests: [URLRequest] {
    lock.lock()
    defer { lock.unlock() }
    return seen
  }

  /// The request is seen. Its answer, or nil while requests are held: it is parked, and answered at `release()`.
  private static func next(_ stub: StubHTTP) -> Answer? {
    lock.lock()
    defer { lock.unlock() }
    seen.append(stub.request)
    if holding {
      parked.append(stub)
      return nil
    }
    return take()
  }

  /// The script's next answer; its last answers every request after it. Called under the lock.
  private static func take() -> Answer {
    if script.count > 1 { return script.removeFirst() }
    return script.first ?? Answer(status: 500)
  }

  private static func forget(_ stub: StubHTTP) {
    lock.lock()
    parked.removeAll { $0 === stub }
    lock.unlock()
  }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    guard let answer = Self.next(self) else { return }
    deliver(answer)
  }

  private func deliver(_ answer: Answer) {
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

  /// A request cancelled while it was held is answered by nothing.
  override func stopLoading() { Self.forget(self) }
}

@MainActor
private final class Door: HistoryDoor {
  var asked: [String] = []
  /// Item 366 — the door's `index.timeline`, scripted by its params (nil: the fixture, as every earlier row reads).
  /// Item 362g — it may refuse, as a door refuses the cursor of a session rewritten under it.
  var timeline: ((FieldProduct.JSONValue?) throws -> FieldProduct.JSONValue)?

  func call(_ method: String, params: FieldProduct.JSONValue?) async throws -> FieldProduct.JSONValue {
    asked.append(method)
    switch method {
    case "index.status": return try Fixture.json("index-status.valid")
    case "index.session": return try Fixture.json("index-session.valid")
    case "index.timeline":
      if let timeline { return try timeline(params) }
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

/// Item 362g — what each configuration held when the direct read handed it to the provider: whether it had a
/// cache, and whether its requests are told to pass any cache by.
private enum Handed {
  private static let lock = NSLock()
  nonisolated(unsafe) private static var seen: [(cache: Bool, reloads: Bool)] = []

  static func reset() {
    lock.withLock { seen = [] }
  }

  static func note(_ configuration: URLSessionConfiguration) {
    let cache = configuration.urlCache != nil
    let reloads = configuration.requestCachePolicy == .reloadIgnoringLocalCacheData
    lock.withLock { seen.append((cache: cache, reloads: reloads)) }
  }

  static var all: [(cache: Bool, reloads: Bool)] {
    lock.withLock { seen }
  }
}

/// The phone's network, in these tests: every request answered by `StubHTTP`.
private let stubProvider: HistoryDirectPlane.SessionProvider = { configuration in
  Handed.note(configuration)
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
  /// Item 362g — what the reader and its direct read said in the log.
  let lines = Lines()

  /// The road to this rig's desktop: its tickets, the stubbed network, the scripted sockets.
  func plane(
    renewEvery: Duration = .seconds(3_600), deadline: Duration = .seconds(3_600)
  ) -> HistoryDirectPlane {
    let tickets = self.tickets
    return HistoryDirectPlane(
      ticket: { sessionId in try tickets.answer(sessionId) },
      session: { stubProvider },
      sockets: sockets, renewEvery: renewEvery, openDeadline: deadline)
  }

  func reader(
    renewEvery: Duration = .seconds(3_600), deadline: Duration = .seconds(3_600)
  ) -> HistoryDesktopReader {
    let lines = self.lines
    let reader = HistoryDesktopReader(
      deviceId: "dev-1", name: "studio", door: door, direct: plane(renewEvery: renewEvery, deadline: deadline),
      log: { lines.said.append($0) })
    reader.start()
    return reader
  }

  /// Item 362g — the same reader as its owner makes it (`HistoryDesktops.attach`), for the rows that sign out.
  /// The owner is given no cache: nothing of these rows is written to a disk.
  func attached() -> HistoryDesktops {
    let desktops = HistoryDesktops(cache: nil)
    desktops.attach(deviceId: "dev-1", name: "studio", isHome: true, door: door, ownsDoor: false, direct: plane())
    return desktops
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

/// Item 362g — what rosettad answers a rendition with: a WebP. Its first twelve bytes stand for it; nothing in
/// these rows decodes a picture.
private let webpBytes = Data([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
private let webpAnswer = StubHTTP.Answer(status: 200, headers: ["content-type": "image/webp"], body: webpBytes)
/// Item 362g — the face of a picture that was read: it holds those bytes.
private let heldFace = HistoryPictureFace.held(webpBytes)

/// Item 362g — the lines a reader said in its log, for the rows that read them.
@MainActor
private final class Lines {
  var said: [String] = []
}

/// Item 362g — the face a reader shows for one picture at one size.
@MainActor
private func face(
  _ reader: HistoryDesktopReader, _ id: String, _ size: HistoryPictureSize, session: String = "s1"
) -> HistoryPictureFace? {
  reader.pictures[session]?["\(id)/\(size.rawValue)"]
}

/// Item 362g — ask for one picture, and say whether the ask was taken (its face is `waiting` at once). A row stops
/// here on a reader that takes none, and does not wait for an answer that cannot come.
@MainActor
private func ask(_ reader: HistoryDesktopReader, _ id: String, _ size: HistoryPictureSize) -> Bool {
  reader.needPicture(session: "s1", id: id, size: size)
  let taken = face(reader, id, size) == .waiting
  #expect(taken, "the ask for \(id) at \(size.rawValue) was not taken")
  return taken
}

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

  /// Item 366 (found reading for 362f; numbered 2026-11-12) — the direct read lost under an
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

  // MARK: - Recorded pictures, read straight from the desktop (item 362g)

  /// Item 362g (picked 2026-11-12: pictures come through a rosetta release, and the direct road carries their
  /// full detail) — a recorded picture's tile is asked of rosettad itself: the stored member's own address with
  /// the `tile2x` recipe, under the ticket's grant. Nothing is read until a tile asks, and the face holds the
  /// bytes as they were answered.
  @Test func aRecordedPicturesTileIsAskedAtItsMemberUnderTheGrant() async {
    StubHTTP.reset([webpAnswer])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    #expect(reader.pictures.isEmpty, "nothing is read until a tile asks")
    #expect(StubHTTP.requests.isEmpty)
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the tile", { face(reader, "r5/a1", .tile) == heldFace }) else { return }
    let requests = StubHTTP.requests
    let digest = String(repeating: "d", count: 64)
    #expect(requests.count == 1)
    #expect(requests.first?.url?.absoluteString == "http://desk.test:9424/api/assets/\(digest).png?image=tile2x&v=1")
    #expect(authorization(requests.first) == "Rosetta-Grant grant-1")
    #expect(reader.pictureBytes == webpBytes.count)
    reader.close()
  }

  /// The full-size sheet asks rosetta's `preview` of the same member, and never its `full`.
  @Test func theFullSizeSheetAsksThePreview() async {
    StubHTTP.reset([webpAnswer])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    guard ask(reader, "r5/a1", .preview) else { return }
    guard await reached("the preview", { face(reader, "r5/a1", .preview) == heldFace }) else { return }
    let digest = String(repeating: "d", count: 64)
    let asked = StubHTTP.requests.first?.url?.absoluteString
    #expect(asked == "http://desk.test:9424/api/assets/\(digest).png?image=preview&v=1")
    #expect(face(reader, "r5/a1", .tile) == nil, "a size is read only when it is asked for")
    reader.close()
  }

  /// A legacy WebP bundle names its own sized members: each size is asked at its member's address, with no recipe.
  @Test func aLegacyBundlesSizesAreAskedAtTheirOwnAddresses() async {
    StubHTTP.reset([webpAnswer])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [pictureRow(5, asset: legacyBundle)]) else { return }
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the tile", { face(reader, "r5/a1", .tile) == heldFace }) else { return }
    guard ask(reader, "r5/a1", .preview) else { return }
    guard await reached("the preview", { face(reader, "r5/a1", .preview) == heldFace }) else { return }
    let addresses = StubHTTP.requests.compactMap { $0.url?.absoluteString }
    let tileMember = String(repeating: "3", count: 64)
    let previewMember = String(repeating: "4", count: 64)
    #expect(
      addresses == [
        "http://desk.test:9424/api/assets/\(tileMember).webp",
        "http://desk.test:9424/api/assets/\(previewMember).webp",
      ])
    #expect(authorization(StubHTTP.requests.last) == "Rosetta-Grant grant-1")
    reader.close()
  }

  /// The id is the attachment segment's whole id, "<timelineId>/<attachmentId>", and a picture is found by all of
  /// it. Neither id is promised to hold no `/`, so it is never cut back into two: cut at its last `/`, the id
  /// asked here would look for `one.png` in the row `turn/5/shots`, its neighbour, which holds none. An id the
  /// entries held name no picture under asks for nothing, and neither does another session's.
  @Test func aPictureIsFoundByItsWholeIdAndNeverByCuttingIt() async {
    StubHTTP.reset([webpAnswer])
    let rig = Rig()
    let reader = rig.reader()
    let sibling = pictureAttachment("one.png", asset: original("e"))
    let rows = [
      pictureRow(5, id: "turn/5", attachment: "shots/one.png", asset: original("d"), more: [sibling]),
      pictureRow(6, id: "turn/5/shots", attachment: "two.png", asset: original("f")),
    ]
    guard await rig.open(reader, rows: rows) else { return }
    let unknown = [
      "turn/5", "turn/5/", "turn/5/shots", "turn/5/shots/", "shots/one.png", "5/shots/one.png", "one.png", "",
    ]
    for id in unknown { reader.needPicture(session: "s1", id: id, size: .tile) }
    reader.needPicture(session: "s2", id: "turn/5/shots/one.png", size: .tile)
    #expect(reader.pictures.isEmpty, "no picture is known under those ids")
    guard ask(reader, "turn/5/shots/one.png", .tile) else { return }
    guard await reached("the tile", { face(reader, "turn/5/shots/one.png", .tile) == heldFace }) else { return }
    let asked = StubHTTP.requests.compactMap { $0.url?.path }
    let wanted = String(repeating: "d", count: 64)
    #expect(asked == ["/api/assets/\(wanted).png"], "the picture read is the one under the whole id")
    #expect(reader.pictures["s1"]?.count == 1, "its neighbours were not touched")
    reader.close()
  }

  /// A picture already waiting, or already held, is not asked for again.
  @Test func aPictureWaitingOrHeldIsNotAskedForTwice() async {
    StubHTTP.reset([webpAnswer])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    guard ask(reader, "r5/a1", .tile) else { return }
    reader.needPicture(session: "s1", id: "r5/a1", size: .tile)
    guard await reached("the tile", { face(reader, "r5/a1", .tile) == heldFace }) else { return }
    reader.needPicture(session: "s1", id: "r5/a1", size: .tile)
    #expect(face(reader, "r5/a1", .tile) == heldFace, "a held face is not set back to waiting")
    try? await Task.sleep(for: .milliseconds(50))
    #expect(StubHTTP.requests.count == 1, "one read for three asks")
    reader.close()
  }

  /// At most `HistoryReads.pictureAsks` pictures are read at once. The rest wait their turn, and each is read once.
  @Test func asksBeyondTheLimitWaitTheirTurn() async {
    StubHTTP.reset([webpAnswer])
    StubHTTP.hold()
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: (1...5).map { pictureRow($0, asset: recordedOriginal) }) else { return }
    let wanted = (1...5).map { "r\($0)/a1" }
    for id in wanted {
      guard ask(reader, id, .tile) else { return }
    }
    guard await reached("three asks", { StubHTTP.requests.count == HistoryReads.pictureAsks }) else { return }
    try? await Task.sleep(for: .milliseconds(50))
    #expect(StubHTTP.requests.count == HistoryReads.pictureAsks, "the fourth waits while three are being read")
    let waiting = wanted.allSatisfy { face(reader, $0, .tile) == .waiting }
    #expect(waiting, "all five wait: three being read, two for their turn")
    StubHTTP.release()
    let all = await reached("every tile") { wanted.allSatisfy { face(reader, $0, .tile) == heldFace } }
    guard all else { return }
    #expect(StubHTTP.requests.count == wanted.count, "each is read once")
    reader.close()
  }

  // MARK: - A picture that is not read

  /// An expired grant on a picture renews once and reads again, as an older page does.
  @Test func anExpiredGrantOnAPictureRenewsOnceAndReadsAgain() async {
    StubHTTP.reset([grantExpired, webpAnswer])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the tile", { face(reader, "r5/a1", .tile) == heldFace }) else { return }
    #expect(rig.tickets.asked.count == 2)
    let requests = StubHTTP.requests
    #expect(requests.count == 2)
    #expect(authorization(requests.first) == "Rosetta-Grant grant-1")
    #expect(authorization(requests.last) == "Rosetta-Grant grant-2")
    #expect(requests.first?.url == requests.last?.url)
    reader.close()
  }

  /// A grant refused again is a failed picture and no more than that: the session is still read straight from the
  /// desktop. (An older page refused again hands the session to the door: without its pages there is no document.)
  @Test func aGrantRefusedAgainFailsThePictureAndNotTheRead() async {
    StubHTTP.reset([grantExpired])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the failure", { face(reader, "r5/a1", .tile) == .failed }) else { return }
    #expect(rig.tickets.asked.count == 2)
    #expect(StubHTTP.requests.count == 2)
    #expect(!rig.door.asked.contains("index.timeline"), "a picture's failure does not hand the session to the door")
    #expect(reader.failure == nil)
    #expect(reader.corpus.document("s1")?.liveSince != nil, "the document is still live")
    reader.close()
  }

  /// An answer that is not a WebP is a failed picture: rosetta's client refuses it before its body is read, so
  /// recorded bytes never reach a decoder. A failed picture is asked for again when its tile next asks.
  @Test func anAnswerThatIsNotAWebPIsAFailedPictureAndIsAskedForAgain() async {
    let png = StubHTTP.Answer(status: 200, headers: ["content-type": "image/png"], body: Data([0x89, 0x50, 0x4E, 0x47]))
    StubHTTP.reset([png, webpAnswer])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the failure", { face(reader, "r5/a1", .tile) == .failed }) else { return }
    #expect(reader.pictureBytes == 0, "none of it is held")
    #expect(reader.corpus.document("s1")?.liveSince != nil, "the document is still live")
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the tile", { face(reader, "r5/a1", .tile) == heldFace }) else { return }
    #expect(StubHTTP.requests.count == 2)
    reader.close()
  }

  /// An answer past its size's bound is a failed picture and none of it is held: refused by the length it states,
  /// and by its count when it states none.
  @Test func anAnswerPastTheBoundIsAFailedPicture() async {
    let big = Data(count: HistoryDirectRead.tileBytes + 1)
    let stated = ["content-type": "image/webp", "content-length": "\(big.count)"]
    StubHTTP.reset([
      StubHTTP.Answer(status: 200, headers: stated, body: big),
      StubHTTP.Answer(status: 200, headers: ["content-type": "image/webp"], body: big),
    ])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the stated length refused", { face(reader, "r5/a1", .tile) == .failed }) else { return }
    #expect(reader.pictureBytes == 0)
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the counted body refused", { face(reader, "r5/a1", .tile) == .failed }) else { return }
    #expect(reader.pictureBytes == 0)
    #expect(StubHTTP.requests.count == 2)
    let said = rig.lines.said.filter { $0.hasSuffix("a picture was not read (past the bound)") }
    #expect(said.count == 2)
    reader.close()
  }

  /// A picture's failure says a fixed word, a status or a code in the log, and never the picture's address:
  /// rosetta's own message names the request's path, a daemon's may name anything, and a picture's path holds its
  /// digest.
  @Test func aFailedPicturesLogLineHoldsNoDigestAndNoAddress() async {
    let digest = String(repeating: "d", count: 64)
    let png = StubHTTP.Answer(status: 200, headers: ["content-type": "image/png"], body: Data([0x89, 0x50, 0x4E, 0x47]))
    let refusal = #"{"error":{"code":"not_found","message":"no such projection asset /api/assets/\#(digest).png"}}"#
    StubHTTP.reset([png, StubHTTP.Answer(status: 404, body: Data(refusal.utf8))])
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the first failure", { face(reader, "r5/a1", .tile) == .failed }) else { return }
    guard ask(reader, "r5/a1", .preview) else { return }
    guard await reached("the second failure", { face(reader, "r5/a1", .preview) == .failed }) else { return }
    let said = rig.lines.said.filter { $0.contains("a picture was not read") }
    #expect(said.count == 2, "each failure says one line")
    #expect(said.first?.hasSuffix("(not a rendition)") == true)
    #expect(said.last?.hasSuffix("(not_found)") == true)
    for line in rig.lines.said {
      #expect(!line.contains(digest), "a digest is in the log: \(line.count) characters")
      #expect(!line.contains("/api/assets"), "a picture's address is in the log")
    }
    reader.close()
  }

  // MARK: - Where pictures are not read, and when they go

  /// A reader with no plane reads through the door, where a row names no stored member: it asks for no picture.
  @Test func aReaderWithNoPlaneAsksForNoPicture() async {
    StubHTTP.reset([webpAnswer])
    let door = Door()
    let reader = HistoryDesktopReader(deviceId: "dev-1", name: "studio", door: door, log: { _ in })
    reader.start()
    reader.need(.session(device: "dev-1", id: "s1"))
    guard await reached("the door's page", { door.asked.contains("index.timeline") }) else { return }
    reader.needPicture(session: "s1", id: "r5/a1", size: .tile)
    #expect(reader.pictures.isEmpty)
    #expect(StubHTTP.requests.isEmpty)
    reader.close()
  }

  /// When a direct read is lost the door reads on, and a door's row names no stored member. The pictures already
  /// held stay on the page; no more are asked for.
  @Test func aSessionTheDoorReadsOnKeepsItsPicturesAndAsksForNoMore() async {
    StubHTTP.reset([webpAnswer])
    let rig = Rig()
    let reader = rig.reader(deadline: .milliseconds(30))
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the tile", { face(reader, "r5/a1", .tile) == heldFace }) else { return }
    rig.sockets.latest?.close()
    guard await reached("the door's tail", { rig.door.asked.contains("index.session.subscribe") }) else { return }
    #expect(face(reader, "r5/a1", .tile) == heldFace, "what was read stays on the page")
    reader.needPicture(session: "s1", id: "r5/a1", size: .preview)
    #expect(face(reader, "r5/a1", .preview) == nil)
    #expect(StubHTTP.requests.count == 1)
    reader.close()
  }

  /// A session rewritten on the desktop is let go and read again from its end: its pictures go with its rows.
  @Test func aSessionLetGoLetsItsPicturesGo() async {
    StubHTTP.reset([webpAnswer])
    let rig = Rig()
    rig.door.timeline = { params in
      if params?["cursor"] != nil { throw FieldProductError(kind: "PRECONDITION_FAILED", message: "rewritten") }
      return doorPage([doorRow(5)], next: "d1")
    }
    let reader = rig.reader(deadline: .milliseconds(30))
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the tile", { face(reader, "r5/a1", .tile) == heldFace }) else { return }
    rig.sockets.latest?.close()
    guard await reached("the door's tail", { rig.door.asked.contains("index.session.subscribe") }) else { return }
    #expect(face(reader, "r5/a1", .tile) == heldFace)
    // the door refuses the older page's cursor: the session was rewritten, and it is read again from its end
    reader.need(.older(device: "dev-1", session: "s1"))
    guard await reached("the pictures gone", { reader.pictures["s1"] == nil }) else { return }
    #expect(reader.pictureBytes == 0)
    reader.close()
  }

  /// Sign-out: the pictures a reader held in memory go with the account.
  @Test func signOutDropsThePicturesHeld() async throws {
    StubHTTP.reset([webpAnswer])
    let rig = Rig()
    let desktops = rig.attached()
    let reader = try #require(desktops.reader(for: "dev-1"))
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the tile", { face(reader, "r5/a1", .tile) == heldFace }) else { return }
    #expect(reader.pictureBytes == webpBytes.count)
    desktops.signedOut()
    #expect(reader.pictures.isEmpty)
    #expect(reader.pictureBytes == 0)
  }

  /// A picture still on its way at sign-out lands nothing. The answer is let through and the main actor is kept
  /// busy while rosetta's client reads it, so it is waiting to land when the account signs out; if it is slower
  /// than that, signing out cancels it. Either way no face and no byte is left.
  @Test func aPictureAnsweredAfterSignOutIsNotStored() async throws {
    StubHTTP.reset([webpAnswer])
    StubHTTP.hold()
    let rig = Rig()
    let desktops = rig.attached()
    let reader = try #require(desktops.reader(for: "dev-1"))
    guard await rig.open(reader, rows: [pictureRow(5, asset: recordedOriginal)]) else { return }
    guard ask(reader, "r5/a1", .tile) else { return }
    guard await reached("the ask", { StubHTTP.requests.count == 1 }) else { return }
    StubHTTP.release()
    // the one blocking wait in these rows, on purpose: nothing may land on the main actor before the sign-out
    usleep(100_000)
    desktops.signedOut()
    #expect(reader.pictures.isEmpty)
    try? await Task.sleep(for: .milliseconds(100))
    #expect(reader.pictures.isEmpty, "nothing lands on a reader that was signed out")
    #expect(reader.pictureBytes == 0)
  }

  /// The direct read's URL session keeps no cache, and its requests pass any cache by. rosettad's answers are
  /// immutable, so a session with a cache would keep pictures of its own, outside the store's count; and nothing
  /// the direct read fetches, a page or a picture, should be answered from a cache.
  @Test func theDirectReadsSessionKeepsNoCache() async {
    Handed.reset()
    let rig = Rig()
    let reader = rig.reader()
    guard await rig.open(reader, rows: [row(1)]) else { return }
    let handed = Handed.all
    #expect(handed.count == 1, "one session for one direct read")
    #expect(handed.first?.cache == false, "the configuration the provider is handed has no cache")
    #expect(handed.first?.reloads == true, "and its requests are not answered from one")
    reader.close()
  }

  /// The bounds agree with each other: a tile is the smaller ask, both are far under rosetta's own default, and
  /// the store has room for four previews at their bound, so the one being looked at is never the one that goes.
  @Test func thePicturesBoundsAgree() {
    #expect(HistoryDirectRead.tileBytes < HistoryDirectRead.previewBytes)
    #expect(HistoryDirectRead.previewBytes * 4 <= HistoryPictureStore.limit)
    #expect(HistoryDirectRead.previewBytes * 4 < RosettaClient.defaultImageBytes)
    #expect(HistoryReads.pictureAsks >= 1)
    #expect(HistoryReads.pictureAsks < 4, "rosettad encodes a cold rendition behind four permits")
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
