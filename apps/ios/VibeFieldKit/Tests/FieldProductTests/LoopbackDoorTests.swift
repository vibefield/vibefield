import Foundation
import Network
import Testing

@testable import FieldProduct

// H-0's own question, answered without a desktop: does
// `URLSessionWebSocketTask` speak the door AS-IS?
//
// Every other test in this target drives the client through the transport SEAM,
// which is right — the state machine is the part worth testing and it wants no
// server. But it also means `URLSessionProductTransport` itself, the only piece
// that ever touches a socket, would ship having carried no bytes at all. This
// suite stands a real RFC 6455 listener on loopback and makes the real
// transport talk to it: the handshake, a text frame each way, a call, a
// subscription's delta, and a server-side close that the client survives by
// re-dialing.
//
// It is NOT a claim about fieldd. The door here answers from a script, and what
// it witnesses is the transport and the framing — that a desktop's tailnet door
// answers this client is James's device run (see the slice's report).

/// A WebSocket door on 127.0.0.1, made of `Network.framework`.
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
    parameters.defaultProtocolStack.applicationProtocols.insert(
      NWProtocolWebSocket.Options(), at: 0)

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

  /// Hang up on whoever is connected, without stopping the door — the client
  /// should re-dial and be served again.
  func hangUp() {
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

@MainActor
private func waitUntil(
  _ what: String, timeout: Duration = .seconds(10), _ condition: @MainActor () async -> Bool
) async throws {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if await condition() { return }
    try await Task.sleep(for: .milliseconds(10))
  }
  Issue.record("timed out waiting for \(what)")
}

@MainActor
@Suite(.serialized) struct LoopbackTransportTests {
  /// The real transport, over a real socket: hello, a call, a subscription, a
  /// delta — and a hang-up the client answers by dialing again.
  @Test func theUrlSessionTransportSpeaksTheDoorAsIs() async throws {
    let ack = try Fixture.json("hello-ack.valid")
    let snapshot = try Fixture.json("agent-field-snapshot.valid")
    let delta = try Fixture.json("agent-field-delta.valid")
    let door = LoopbackDoor { method, id, _ in
      switch method {
      case "system.hello": return [Frame.result(id: id, ack)]
      case "agent.list": return [Frame.result(id: id, .object(["sessions": .array([])]))]
      case "agent.subscribe":
        return [
          Frame.result(id: id, .object(["subId": .string("sub-1"), "snapshot": snapshot])),
          Frame.subscriptionEvent(
            method: "agent.subscribe.delta", subId: "sub-1", payload: delta),
        ]
      default: return []
      }
    }
    let port = try await door.start()
    defer { Task { await door.stop() } }

    let client = FieldProductClient(
      url: URL(string: "ws://127.0.0.1:\(port)/t/a-secret-path")!,
      transport: URLSessionProductTransport(timeout: 10),
      options: .init(maxBackoff: .milliseconds(50), callTimeout: .seconds(10)))
    defer { client.close() }

    client.connect()
    try await waitUntil("a real hello to be answered") {
      if case .ready = client.state { true } else { false }
    }
    guard case .ready(let ready) = client.state else {
      Issue.record("expected ready, got \(client.state)")
      return
    }
    #expect(ready.contractsVersion == "0.1.0")
    #expect(ready.serverKind == "fieldd")

    let list = try await client.call("agent.list", as: AgentListResult.self)
    #expect(list.sessions.isEmpty)

    let snapshots = LoopbackCounter()
    let deltas = LoopbackCounter()
    let handle = try await client.subscribe(
      "agent.subscribe", params: AgentSubscribeParams.phoneField.json,
      onSnapshot: { payload in
        snapshots.record((try? AgentFieldSnapshot(json: payload))?.rows.count ?? -1)
      },
      onDelta: { payload in
        deltas.record((try? AgentFieldDelta(json: payload))?.upserts.count ?? -1)
      })
    #expect(handle.subId == "sub-1")
    #expect(snapshots.values == [5])
    try await waitUntil("a delta over the wire") { deltas.values == [2] }

    // The door hangs up. A dropped socket is the phone's normal weather, and
    // the client answers it by dialing again and re-subscribing.
    await door.hangUp()
    try await waitUntil("a second connection") { await door.accepted == 2 }
    try await waitUntil("a fresh snapshot on the new socket") { snapshots.values.count == 2 }
  }

  /// A door that is not there at all. The honest answer is `reconnecting` with
  /// the system's own words — never a hang, and never a fabricated "empty".
  @Test func aDoorThatIsNotThereFailsHonestlyAndKeepsTrying() async throws {
    // Port 1 on loopback: nothing listens, and nothing is allowed to.
    let client = FieldProductClient(
      url: URL(string: "ws://127.0.0.1:1/t/nothing-here")!,
      transport: URLSessionProductTransport(timeout: 2),
      options: .init(maxBackoff: .milliseconds(50), callTimeout: .seconds(2)))
    defer { client.close() }

    client.connect()
    try await waitUntil("an honest refusal") { client.lastError != nil }
    #expect(client.lastError?.kind == "UNAVAILABLE")
    #expect(client.lastError?.retryable == true)
    #expect(client.state == .reconnecting)
  }
}

@MainActor
private final class LoopbackCounter {
  private(set) var values: [Int] = []
  func record(_ value: Int) { values.append(value) }
}
