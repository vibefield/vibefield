import FieldProduct
import FieldRoutedTerminal
import Foundation
import Network
import Testing

/// A cell door on 127.0.0.1, made of `Network.framework`.
///
/// A COPY of TM-4's `FakeCellDoor` (`Tests/FieldRoutedTerminalTests`), which it
/// tracks line for line minus the pieces this bundle does not use. Copied and
/// not shared because a SwiftPM source file belongs to exactly one target and
/// the alternative — moving a just-landed lane's harness into a support library
/// — would churn TM-4 to save a duplicate. What it witnesses here is different:
/// TM-4 drove the CLIENT against this door, TM-5 drives the ATTACHMENT, which
/// is the ticket, the sink, the renderer's frame path and the faces.
///
/// **What it is not.** The door answers from a script written against
/// `field-native/src/tp/door.rs`; it is a claim about THIS PHONE, never about
/// that cell. The real door is Phase 0's — James's hardware run.
///
/// **One divergence, stated (TM-4's, unchanged):** the real cell serves
/// `/control` and `/frames` on ONE port and refuses a hello whose `channel`
/// disagrees with its path. Network.framework's server-side WebSocket handler
/// is handed only the subprotocols and the request headers — never the path —
/// so this door routes by the hello's `channel`. Both URLs still name the real
/// paths on one port, so what goes unwitnessed is exactly the path↔channel
/// cross-check.

actor CellDoorHarness {
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
      let once = CellDoorOnce(continuation)
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
        // The accept is DERIVED from the contracts' golden, so a missing copy
        // is a red rather than a door that quietly answers nothing.
        do {
          send(
            .connectionAccepted,
            try Script.accepted(
              channel: channel, legGeneration: legGeneration, heartbeatTtlMs: heartbeatTtlMs),
            on: channel)
        } catch {
          Issue.record("the accept golden is not in this bundle: \(error)")
        }
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
private final class CellDoorOnce: @unchecked Sendable {
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

// MARK: - The shapes the door answers with

/// One golden out of THIS bundle.
///
/// A SwiftPM resource belongs to exactly one target, so the file this target
/// reads is its own copy — the same argument `Vector` makes next door, and the
/// reason `check:ios-fixtures` gates copies by basename wherever they sit.
enum Golden {
  static func json(_ name: String) throws -> JSONValue {
    guard
      let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
    else { throw Missing(name: name) }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  struct Missing: Error, CustomStringConvertible {
    let name: String
    var description: String { "golden `\(name).json` is not in the test bundle" }
  }
}

/// TM-4's `Script`, copied with its door for the same reason. Every body here
/// is the contract's own shape as `field-native/src/tp/door.rs` writes it; a
/// test that invented a field would be witnessing itself.
///
/// **The duplication, since TM-r3 (2026-09-14):** these two copies are no
/// longer two statements of the accept. `accepted` DERIVES from
/// `tp-connection-accepted.frames.json` on both sides, so the contract's bytes
/// are the one source and each copy is only the small set of overrides its
/// tests vary. The Swift file stays duplicated because a SwiftPM source file
/// belongs to one target and hoisting a just-landed lane's harness into a
/// support library would churn TM-4 to save a wrapper; what the copy can drift
/// on now is the overrides, and an override that drifted would fail the row
/// that reads it rather than quietly changing the shape under every row.
enum Script {
  /// See `ScriptedTransport.swift` for the full note. In short: the seven
  /// writer-side `protocolLimits` this hand-written body used to omit are the
  /// golden's now, and the CONTROL leg drops `creditEpoch` and `initialWindows`
  /// because `door.rs` writes both only on the frames leg.
  static func accepted(
    channel: RoutedChannel, legGeneration: Int64 = 1, heartbeatTtlMs: Int64 = 600,
    capabilities: [String] = ["resume", "session-events"],
    creditWindow: Int64 = 2_097_152, connectionSetId: String = "cs-win-3c4d-2-cb-7f3a9c1e"
  ) throws -> [String: JSONValue] {
    guard var body = try Golden.json("tp-connection-accepted.frames").objectValue else {
      throw Golden.Missing(name: "tp-connection-accepted.frames")
    }
    body["connectionSetId"] = .string(connectionSetId)
    body["channel"] = .string(channel.rawValue)
    body["legGeneration"] = .int(legGeneration)
    body["heartbeatTtlMs"] = .int(heartbeatTtlMs)
    body["capabilities"] = .array(capabilities.map(JSONValue.string))
    switch channel {
    case .frames:
      body["creditEpoch"] = .int(legGeneration)
      var windows = body["initialWindows"]?.objectValue ?? [:]
      windows["connectionCreditBytes"] = .int(creditWindow)
      body["initialWindows"] = .object(windows)
    case .control:
      body["creditEpoch"] = nil
      body["initialWindows"] = nil
    }
    return body
  }

  static func controlAttached(session: String, activation: String, rights: [String]) -> [String:
    JSONValue]
  {
    [
      "sessionId": .string(session),
      "activationId": .string(activation),
      "grantGenerationAccepted": .int(1),
      "rights": .array(rights.sorted().map(JSONValue.string)),
    ]
  }

  static func framesAttached(
    session: String, activation: String, sessionHandle: String = "77", viewHandle: String = "9",
    resumeToken: String = "rt-1", seedReason: String? = "no-cursor",
    resumeFrom: RoutedSceneStamp? = nil, newest: RoutedSceneStamp? = nil
  ) -> [String: JSONValue] {
    var outcome: [String: JSONValue] = [:]
    if let resumeFrom, let newest {
      outcome = [
        "kind": .string("resume-accepted"), "from": resumeFrom.json, "newestAvailable": newest.json,
      ]
    } else {
      outcome = ["kind": .string("seed-required"), "reason": .string(seedReason ?? "no-cursor")]
    }
    return [
      "sessionId": .string(session),
      "activationId": .string(activation),
      "resumeToken": .string(resumeToken),
      "trfIdentity": .object([
        "sessionHandle": .string(sessionHandle), "viewHandle": .string(viewHandle),
      ]),
      "outcome": .object(outcome),
    ]
  }

  static func status(
    session: String, activation: String, sequence: Int64, presentation: String = "presenting",
    input: String = "allowed", reason: String? = nil, accepted: RoutedSceneStamp? = nil,
    leaseTtlMs: Int64 = 6_000
  ) -> [String: JSONValue] {
    var presentationBody: [String: JSONValue] = ["state": .string(presentation)]
    var inputBody: [String: JSONValue] = ["state": .string(input)]
    if let reason {
      if presentation != "presenting" { presentationBody["reason"] = .string(reason) }
      if input != "allowed" { inputBody["reason"] = .string(reason) }
    }
    var body: [String: JSONValue] = [
      "sessionId": .string(session),
      "activationId": .string(activation),
      "cellStatusSequence": .int(sequence),
      "leaseTtlMs": .int(leaseTtlMs),
      "presentation": .object(presentationBody),
      "input": .object(inputBody),
    ]
    if let accepted { body["acceptedContent"] = accepted.json }
    return body
  }

  static func stamp(_ revision: Int64, cell: String = "cb-7f3a9c1e-2026", model: Int64 = 0)
    -> RoutedSceneStamp
  {
    RoutedSceneStamp(cellBootId: cell, modelGeneration: model, sceneRevision: revision)
  }

  /// A `trf1-frame` presentation unit, framed as the contracts encode one.
  static func frame(
    session: String, activation: String, sequence: Int64, creditEpoch: Int64,
    base: RoutedSceneStamp?, result: RoutedSceneStamp, payload: Data
  ) throws -> Data {
    var header: [String: JSONValue] = [
      "creditEpoch": .int(creditEpoch),
      "activationSequence": .int(sequence),
      "sessionId": .string(session),
      "activationId": .string(activation),
      "leaseEpoch": .int(4),
      "kind": .string("trf1-frame"),
      "resultContent": result.json,
    ]
    header["baseContent"] = base.map(\.json) ?? .null
    return try RoutedPresentationEnvelope.encode(header: .object(header), payload: payload)
  }
}
