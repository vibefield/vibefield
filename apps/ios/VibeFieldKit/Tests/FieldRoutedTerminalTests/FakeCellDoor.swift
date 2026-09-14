import FieldProduct
import Foundation
import Network
import Testing

@testable import FieldRoutedTerminal

/// A cell door on 127.0.0.1, made of `Network.framework` — the product
/// transport's own loopback harness (`LoopbackDoorTests`), grown a second
/// protocol.
///
/// Everything else in this bundle drives the client through the transport SEAM,
/// which is right: the state machine is the part worth testing and it wants no
/// server. But it also means `URLSessionRoutedTransport` — the only piece that
/// ever touches a socket, and the only one that has to get BINARY frames, close
/// codes and a duplex handshake right — would ship having carried no bytes at
/// all. This door makes the real transport talk to a real socket.
///
/// **What it is not.** The door here answers from a script written against
/// `field-native/src/tp/door.rs`; it is a claim about THIS CLIENT, never about
/// that cell. The real door is Phase 0's — James's hardware run (TM-5).
///
/// **One divergence, stated:** the real cell serves `/control` and `/frames` on
/// ONE port and refuses a hello whose `channel` disagrees with its path
/// (`HELLO_MALFORMED`). Network.framework's server-side WebSocket handler is
/// handed only the subprotocols and the request headers — never the path — so
/// this door cannot see which URL was dialled and routes by the hello's
/// `channel` instead. Both URLs still name the real paths on one port, so what
/// goes unwitnessed here is exactly the path↔channel cross-check and nothing
/// else; `RoutedCellEndpoints` is tested separately for the URLs it builds.
actor FakeCellDoor {
  struct Attach: Sendable {
    let sessionId: String
    let activationId: String
  }

  /// What the door does when a hello arrives, so a test can pick a behaviour
  /// without a second door.
  enum HelloPolicy: Sendable {
    case accept
    /// A structured, POST-verification refusal: the body then a close naming it.
    case refuse(code: String, retryable: Bool)
    /// The PRE-authentication class: `1008`, no body, no code on the wire.
    case silentPolicyClose
  }

  private var listener: NWListener?
  private var legs: [RoutedChannel: NWConnection] = [:]
  private(set) var port: UInt16 = 0
  private(set) var accepted = 0
  private(set) var helloCount: [RoutedChannel: Int] = [:]
  private(set) var heartbeats: [RoutedChannel: Int] = [:]
  private(set) var credits: [JSONValue] = []
  private(set) var sceneApplied: [JSONValue] = []
  private(set) var inputs: [JSONValue] = []
  private(set) var controlAttach: Attach?
  private(set) var framesAttach: Attach?
  private(set) var framesResume: JSONValue?
  private(set) var requestHeaders: [[(name: String, value: String)]] = []
  private(set) var advertisedCapacities: JSONValue?
  private(set) var advertisedCapabilities: [String] = []

  var policy: HelloPolicy = .accept
  /// The generation the next accepted leg reports — and therefore, on the frames
  /// leg, the credit epoch (the cell's own rule).
  var legGeneration: Int64 = 1
  var heartbeatTtlMs: Int64 = 900

  func set(policy: HelloPolicy) { self.policy = policy }
  func set(legGeneration: Int64) { self.legGeneration = legGeneration }

  func start() async throws -> UInt16 {
    let parameters = NWParameters.tcp
    parameters.allowLocalEndpointReuse = true
    parameters.requiredInterfaceType = .loopback
    let websocket = NWProtocolWebSocket.Options()
    websocket.autoReplyPing = true
    // The server side sees the client's request here — the one place this
    // harness can observe what `URLSessionWebSocketTask` actually sent.
    websocket.setClientRequestHandler(.global()) { [weak self] _, headers in
      Task { await self?.record(headers: headers) }
      return NWProtocolWebSocket.Response(status: .accept, subprotocol: nil)
    }
    parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)

    let listener = try NWListener(using: parameters)
    self.listener = listener
    listener.newConnectionHandler = { [weak self] connection in
      Task { await self?.accept(connection) }
    }
    let port: UInt16 = try await withCheckedThrowingContinuation { continuation in
      let once = FakeDoorOnce(continuation)
      listener.stateUpdateHandler = { state in
        switch state {
        case .ready: once.resume(with: .success(listener.port?.rawValue ?? 0))
        case .failed(let error), .waiting(let error): once.resume(with: .failure(error))
        default: break
        }
      }
      listener.start(queue: .global())
    }
    self.port = port
    return port
  }

  func stop() {
    listener?.cancel()
    listener = nil
    for connection in legs.values { connection.cancel() }
    legs.removeAll()
  }

  /// Hang up on ONE leg without stopping the door — a leg loss the client must
  /// answer with a fresh ticket, never a re-dial.
  func hangUp(_ channel: RoutedChannel, code: UInt16? = nil) {
    guard let connection = legs[channel] else { return }
    legs[channel] = nil
    if let code {
      let metadata = NWProtocolWebSocket.Metadata(opcode: .close)
      metadata.closeCode = code < 4000 ? .protocolCode(protocolCode(code)) : .privateCode(code)
      let context = NWConnection.ContentContext(identifier: "close", metadata: [metadata])
      connection.send(
        content: nil, contentContext: context, isComplete: true,
        completion: .contentProcessed { _ in connection.cancel() })
    } else {
      connection.cancel()
    }
  }

  /// Forget the accepted legs so a REPLACEMENT set is observed apart from the
  /// one it replaced.
  func rotate() {
    helloCount = [:]
    heartbeats = [:]
    controlAttach = nil
    framesAttach = nil
    framesResume = nil
  }

  // MARK: Sending

  func send(_ type: RoutedMessageType, _ body: [String: JSONValue], on channel: RoutedChannel) {
    guard let connection = legs[channel], let text = try? RoutedWire.encode(type, body) else {
      return
    }
    let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
    let context = NWConnection.ContentContext(identifier: "text", metadata: [metadata])
    connection.send(
      content: Data(text.utf8), contentContext: context, isComplete: true,
      completion: .contentProcessed { _ in })
  }

  func sendUnit(_ bytes: Data) {
    guard let connection = legs[.frames] else { return }
    let metadata = NWProtocolWebSocket.Metadata(opcode: .binary)
    let context = NWConnection.ContentContext(identifier: "binary", metadata: [metadata])
    connection.send(
      content: bytes, contentContext: context, isComplete: true,
      completion: .contentProcessed { _ in })
  }

  // MARK: Receiving

  private func record(headers: [(name: String, value: String)]) {
    requestHeaders.append(headers)
  }

  private func accept(_ connection: NWConnection) {
    accepted += 1
    connection.start(queue: .global())
    receive(on: connection)
  }

  private nonisolated func receive(on connection: NWConnection) {
    connection.receiveMessage { [weak self] data, context, _, error in
      guard let self else { return }
      if error != nil { return }
      let isText =
        (context?.protocolMetadata(definition: NWProtocolWebSocket.definition)
          as? NWProtocolWebSocket.Metadata)?.opcode == .text
      if let data, isText, let text = String(data: data, encoding: .utf8) {
        Task { await self.handle(text, on: connection) }
      }
      self.receive(on: connection)
    }
  }

  private func handle(_ text: String, on connection: NWConnection) {
    guard let value = try? JSONValue.parse(Data(text.utf8)),
      let tag = value["type"]?.stringValue
    else { return }
    switch tag {
    case "ConnectionHello":
      guard let channelName = value["channel"]?.stringValue,
        let channel = RoutedChannel(rawValue: channelName)
      else { return }
      helloCount[channel, default: 0] += 1
      if channel == .frames {
        advertisedCapacities = value["receiverCapacities"]
        advertisedCapabilities =
          value["capabilities"]?.arrayValue?.compactMap(\.stringValue) ?? []
      }
      legs[channel] = connection
      switch policy {
      case .accept:
        send(
          .connectionAccepted,
          Script.accepted(
            channel: channel, legGeneration: legGeneration, heartbeatTtlMs: heartbeatTtlMs),
          on: channel)
      case .refuse(let code, let retryable):
        // POST-verification: the body, then a close naming the code.
        send(
          .connectionRefused, ["code": .string(code), "retryable": .bool(retryable)], on: channel)
        hangUp(channel, code: 1000)
      case .silentPolicyClose:
        // PRE-authentication: no body, no code on the wire beyond `1008`.
        hangUp(channel, code: 1008)
      }
    case "LegHeartbeat":
      guard let channelName = value["channel"]?.stringValue,
        let channel = RoutedChannel(rawValue: channelName)
      else { return }
      heartbeats[channel, default: 0] += 1
      send(.legHeartbeatAck, ["sequence": value["sequence"] ?? .int(0)], on: channel)
    case "AttachControlLeg":
      controlAttach = Attach(
        sessionId: "", activationId: value["activationId"]?.stringValue ?? "")
    case "AttachFramesLeg":
      framesAttach = Attach(
        sessionId: "", activationId: value["activationId"]?.stringValue ?? "")
      framesResume = value["resume"]
    case "TransportCredit":
      credits.append(value)
    case "SceneApplied":
      sceneApplied.append(value)
    case "SendInput":
      inputs.append(value)
    default:
      break
    }
  }

  private nonisolated func protocolCode(_ code: UInt16) -> NWProtocolWebSocket.CloseCode.Defined {
    switch code {
    case 1000: .normalClosure
    case 1001: .goingAway
    case 1008: .policyViolation
    case 1011: .internalServerError
    default: .normalClosure
    }
  }

  // MARK: Readers the tests use

  func totalCreditReturned() -> Int64 {
    credits.last?["connectionBytesReturned"]?.intValue ?? 0
  }

  func lastCreditEpoch() -> Int64? { credits.last?["creditEpoch"]?.intValue }

  func lastAppliedRevision() -> Int64? {
    sceneApplied.last?["appliedContent"]?["sceneRevision"]?.intValue
  }
}

/// `NWListener`'s state handler fires more than once; a continuation may be
/// resumed exactly once. (The product transport's harness carries the same box,
/// for the same reason.)
private final class FakeDoorOnce: @unchecked Sendable {
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

/// Two REAL TRF1 frames, verbatim from the repo's own `terminal-perf` corpus.
enum Trf1Sample {
  static func load() throws -> (seed: Data, delta: Data, provenance: String) {
    let vector = try Vector.json("trf1-frames.lane")
    let seed = try #require(vector["seedFrameBase64"]?.stringValue)
    let delta = try #require(vector["deltaFrameBase64"]?.stringValue)
    let trace = vector["source"]?["trace"]?.stringValue ?? "?"
    let version = vector["source"]?["ghostteaVersion"]?.stringValue ?? "?"
    return (
      try #require(Data(base64Encoded: seed)), try #require(Data(base64Encoded: delta)),
      "\(trace) @ ghosttea \(version)"
    )
  }
}
