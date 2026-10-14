import Foundation
import Network
import Testing

@testable import FieldHistory
@testable import FieldProduct

// SP-6 — the phone's History reads over a REAL socket.
//
// Every other row in this target drives the reader through a scripted
// `HistoryDoor`, which is right: the fold and the states are the part worth
// testing and they want no server. But it also means the seam the phone will
// actually cross — the real product client, its framing, a rows subscription
// resumed by cursor — would carry no History bytes at all before James's
// device run. This row stands an RFC 6455 door on loopback and puts the real
// client between the reader and it: hello, the ledger's reads, a session's
// header and page, the tail opened as a rows subscription at the floor, and a
// delta over the wire that moves the document and counts the arrival.
//
// PJ-7 — the ledger's reads are `project.*` now (`HistoryProjects` over the
// same client): `project.list`, the pings opened as rows at the floor and a
// ping over the wire that re-keys a regrouped project, then `project.get` and
// `project.sessions` for the project opened.
//
// It is NOT a claim about fieldd. The door answers from the contracts' goldens;
// what it witnesses is that the reader's asks are the contracts' methods and
// shapes, over the client as shipped (witness 4's floor — the live loopback
// over fieldd + rosettad is the desktop run, see the slice's report).

/// A WebSocket door on 127.0.0.1, made of `Network.framework` — the product
/// tests' harness, copied as the terminal targets copy theirs (a test target
/// cannot import another's).
private actor LoopbackDoor {
  typealias Script = @Sendable (_ method: String, _ id: Int64, _ params: JSONValue) -> [String]

  private let script: Script
  private var listener: NWListener?
  private var connections: [NWConnection] = []
  private(set) var accepted = 0

  init(script: @escaping Script) {
    self.script = script
  }

  func start() async throws -> UInt16 {
    let parameters = NWParameters.tcp
    parameters.allowLocalEndpointReuse = true
    parameters.requiredInterfaceType = .loopback
    let websocket = NWProtocolWebSocket.Options()
    websocket.autoReplyPing = true
    parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)

    let listener = try NWListener(using: parameters)
    self.listener = listener
    listener.newConnectionHandler = { [weak self] connection in
      Task { await self?.accept(connection) }
    }

    return try await withCheckedThrowingContinuation { continuation in
      let once = OnceBox(continuation)
      listener.stateUpdateHandler = { state in
        switch state {
        case .ready:
          once.resume(with: .success(listener.port?.rawValue ?? 0))
        case .failed(let error), .waiting(let error):
          once.resume(with: .failure(error))
        default:
          break
        }
      }
      listener.start(queue: .global())
    }
  }

  func stop() {
    listener?.cancel()
    listener = nil
    for connection in connections { connection.cancel() }
    connections.removeAll()
  }

  private func accept(_ connection: NWConnection) {
    accepted += 1
    connections.append(connection)
    connection.start(queue: .global())
    receive(on: connection)
  }

  private nonisolated func receive(on connection: NWConnection) {
    connection.receiveMessage { [weak self] data, _, _, error in
      guard let self else { return }
      if error != nil { return }
      if let data { Task { await self.answer(data, on: connection) } }
      self.receive(on: connection)
    }
  }

  private func answer(_ data: Data, on connection: NWConnection) {
    guard let value = try? JSONValue.parse(data),
      let method = value["method"]?.stringValue
    else { return }
    let id = value["id"]?.intValue ?? -1
    for frame in script(method, id, value["params"] ?? .null) {
      send(frame, on: connection)
    }
  }

  private nonisolated func send(_ text: String, on connection: NWConnection) {
    let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
    let context = NWConnection.ContentContext(identifier: "text", metadata: [metadata])
    connection.send(
      content: Data(text.utf8), contentContext: context, isComplete: true,
      completion: .contentProcessed { _ in })
  }
}

/// `NWListener`'s state handler fires more than once; a continuation may be
/// resumed exactly once.
private final class OnceBox: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<UInt16, any Error>?

  init(_ continuation: CheckedContinuation<UInt16, any Error>) {
    self.continuation = continuation
  }

  func resume(with result: Result<UInt16, any Error>) {
    lock.lock()
    let pending = continuation
    continuation = nil
    lock.unlock()
    pending?.resume(with: result)
  }
}

/// The frames a door sends — the product tests' `Frame`, the two the door here needs.
private enum Frame {
  static func result(id: Int64, _ value: JSONValue) -> String {
    encode(.object(["jsonrpc": .string("2.0"), "id": .int(id), "result": value]))
  }

  static func failure(id: Int64, kind: String, message: String) -> String {
    encode(
      .object([
        "jsonrpc": .string("2.0"), "id": .int(id),
        "error": .object([
          "code": .int(-32000), "message": .string(message),
          "data": .object(["kind": .string(kind), "retryable": .bool(false)]),
        ]),
      ]))
  }

  static func subscriptionEvent(method: String, subId: String, payload: JSONValue) -> String {
    encode(
      .object([
        "jsonrpc": .string("2.0"), "method": .string(method),
        "params": .object(["subId": .string(subId), "payload": payload]),
      ]))
  }

  static func encode(_ value: JSONValue) -> String {
    String(data: (try? value.encoded()) ?? Data(), encoding: .utf8) ?? ""
  }
}

/// What crossed the wire, written from the door's queue and read by the test.
private final class AskLog: @unchecked Sendable {
  private let lock = NSLock()
  private var stored: [(method: String, params: JSONValue)] = []

  func record(_ method: String, _ params: JSONValue) {
    lock.withLock { stored.append((method, params)) }
  }

  var methods: [String] { lock.withLock { stored.map(\.method) } }

  func params(for method: String) -> JSONValue? {
    lock.withLock { stored.first { $0.method == method }?.params }
  }
}

@MainActor
private func waitUntil(
  _ what: String, timeout: Duration = .seconds(20), _ condition: @MainActor () async -> Bool
) async throws {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if await condition() { return }
    try await Task.sleep(for: .milliseconds(10))
  }
  Issue.record("timed out waiting for \(what)")
}

@MainActor
@Suite(.serialized) struct HistoryLoopbackDoorTests {
  @Test(
    "over a real socket: hello, the ledger's reads, a session's page, the tail as rows at the floor, a delta's arrival"
  )
  func theReaderSpeaksTheDoorOverARealSocket() async throws {
    let ack = try Fixture.json("hello-ack.valid")
    let status = try Fixture.json("index-status.valid")
    let projects = try Fixture.json("index-projects.mesh")
    let sessions = try Fixture.json("index-sessions.valid")
    let session = try Fixture.json("index-session.valid")
    let project = try Fixture.json("index-project.valid")
    let page = try Fixture.json("index-timeline.valid")
    let projectList = try Fixture.json("project-list.valid")
    let projectGet = try Fixture.json("project-get.valid")
    let projectSessions = try Fixture.json("project-sessions.valid")
    let projectFigures = try Fixture.json("project-figures.valid")
    let pingsOpen = try #require(try Fixture.json("project-changes-open.snapshot")["snapshot"])
    // the golden ping, continuing the open's revision (a gap would re-open)
    var ping = try #require(try Fixture.json("project-changes-delta.regrouped").objectValue)
    ping["since"] = pingsOpen["revision"]
    ping["revision"] = .int((pingsOpen["revision"]?.intValue ?? 0) + 1)
    let pingPayload = JSONValue.object(ping)
    let tailOpen = try Fixture.json("index-session-tail-open.snapshot")
    let snapshot = try #require(tailOpen["snapshot"])
    // the golden's delta with one NEW row appended: the arrival the pill counts
    let goldenDelta = try Fixture.json("index-session-tail-delta.valid")
    var delta = try #require(goldenDelta.objectValue)
    let entries = try #require(page["entries"]?.arrayValue)
    var appended = try #require(entries[2].objectValue)
    appended["timelineId"] = .string("t9")
    appended["ordinal"] = .int(99)
    appended["text"] = .string("the tail delivered this over the socket")
    delta["upserts"] = .array((delta["upserts"]?.arrayValue ?? []) + [.object(appended)])
    let deltaPayload = JSONValue.object(delta)

    let asks = AskLog()
    let door = LoopbackDoor { method, id, params in
      asks.record(method, params)
      switch method {
      case "system.hello": return [Frame.result(id: id, ack)]
      case "index.status": return [Frame.result(id: id, status)]
      case "index.projects": return [Frame.result(id: id, projects)]
      case "index.sessions": return [Frame.result(id: id, sessions)]
      case "index.session": return [Frame.result(id: id, session)]
      case "index.project": return [Frame.result(id: id, project)]
      case "index.timeline": return [Frame.result(id: id, page)]
      case "project.list": return [Frame.result(id: id, projectList)]
      case "project.get": return [Frame.result(id: id, projectGet)]
      case "project.sessions": return [Frame.result(id: id, projectSessions)]
      case "project.figures": return [Frame.result(id: id, projectFigures)]
      case "project.subscribe":
        return [
          Frame.result(id: id, .object(["subId": .string("pp-1"), "snapshot": pingsOpen])),
          Frame.subscriptionEvent(method: "project.subscribe.delta", subId: "pp-1", payload: pingPayload),
        ]
      case "index.session.subscribe":
        // fieldd's ProductAPI names a subscription's frames `<method>.delta`
        return [
          Frame.result(id: id, .object(["subId": .string("ps-1"), "snapshot": snapshot])),
          Frame.subscriptionEvent(method: "index.session.subscribe.delta", subId: "ps-1", payload: deltaPayload),
        ]
      case "system.unsubscribe": return [Frame.result(id: id, .object([:]))]
      default: return [Frame.failure(id: id, kind: "NOT_FOUND", message: "no provider for \(method)")]
      }
    }
    let port = try await door.start()
    // Torn down WITH the test (no async `defer`): every way out stops the door.

    let client = FieldProductClient(
      url: URL(string: "ws://127.0.0.1:\(port)/t/a-secret-path")!,
      transport: URLSessionProductTransport(timeout: 10),
      options: .init(maxBackoff: .milliseconds(50), callTimeout: .seconds(10)))
    defer { client.close() }
    client.connect()
    try await waitUntil("a real hello to be answered") {
      if case .ready = client.state { true } else { false }
    }

    // the reader OWNS this door: its `close()` closes the client
    let reader = HistoryDesktopReader(
      deviceId: "dev-1", name: "studio", isHome: true, door: client, ownsDoor: true,
      agentLabel: { _ in "Claude Code" })
    reader.start()
    try await waitUntil("the standing over the socket") { asks.methods.contains("index.status") }
    #expect(reader.standing == .connected)

    // PJ-7 — the ledger over the same client (the reader owns the door)
    let ledger = HistoryProjects(source: "01J9ZK3M5Q8XR2V7N4B6C1D0EF", door: client)
    ledger.start()
    try await waitUntil("the ledger over the socket") { ledger.corpus.projects.count == 2 }
    #expect(ledger.corpus.sessionCount == 452)
    #expect(ledger.corpus.desktops.map(\.name) == ["studio", "laptop"])
    try await waitUntil("the ping's key move") { !ledger.moves.isEmpty }
    #expect(ledger.moved("p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8") == "r:01JA0B1C2D3E4F5G6H7J8K9M0N")
    ledger.open("p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8")
    try await waitUntil("the opened project's sessions") {
      !ledger.corpus.sessions(of: "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8").isEmpty
    }
    #expect(ledger.corpus.sessions(of: "p1:k7m2q9x4c3v8b6n1z5r0t2w4y6a8").first?.folder == "vibe-field")

    reader.need(.session(device: "dev-1", id: "s1"))
    try await waitUntil("the document, its tail, and the delta's arrival") { reader.arrivals["s1"] == 1 }
    let document = try #require(reader.corpus.document("s1"))
    #expect(document.agentName == "Claude Code")
    #expect(document.liveSince != nil)
    let delivered = document.turns.contains { turn in
      turn.segments.contains { segment in
        if case .prose(_, _, let text, _) = segment { return text.contains("over the socket") }
        return false
      }
    }
    #expect(delivered, "the delta's new row is in the document")

    // what crossed the wire: the contracts' methods; the page and the tail
    // asked for THIS session, the tail as rows at the floor
    let methods = asks.methods
    #expect(methods.first == "system.hello")
    for method in [
      "index.status", "index.session", "index.timeline", "index.session.subscribe", "project.list",
      "project.subscribe", "project.get", "project.sessions", "project.figures",
    ] {
      #expect(methods.contains(method), "\(method) was never asked over the socket")
    }
    for retired in ["index.projects", "index.sessions", "index.project"] {
      #expect(!methods.contains(retired), "\(retired) is the ledger's old read")
    }
    #expect(asks.params(for: "project.subscribe")?["minIntervalMs"]?.intValue == Int64(HistoryReads.tailIntervalMs))
    let subscribe = asks.params(for: "index.session.subscribe")
    #expect(subscribe?["sessionId"]?.stringValue == "s1")
    #expect(subscribe?["minIntervalMs"]?.intValue == Int64(HistoryReads.tailIntervalMs))
    let timeline = asks.params(for: "index.timeline")
    #expect(timeline?["sessionId"]?.stringValue == "s1")
    #expect(timeline?["limit"]?.intValue == Int64(HistoryReads.pageRows))

    ledger.close()
    reader.close()
    await door.stop()
  }
}
