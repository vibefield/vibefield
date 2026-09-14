import FieldProduct
import Foundation
import Testing

@testable import FieldRoutedTerminal

/// An in-memory cell door the test drives frame by frame.
///
/// The real transport carries bytes over a real socket and is witnessed by
/// `FakeCellDoorTests`; this one exists because ORDER is the part worth testing
/// — send nothing before the accept, heartbeat unconditionally, refuse a tag
/// that does not belong on this leg — and testing order should not want a
/// scheduler, a port, or a race.
actor ScriptedConnection: RoutedLegConnection {
  private var pending: [RoutedLegFrame] = []
  private var waiting: CheckedContinuation<RoutedLegFrame, any Error>?
  private var hangUpError: (any Error)?
  private var code: Int?
  private(set) var sent: [String] = []
  private(set) var sentBinary: [Data] = []
  private(set) var isClosed = false

  struct HungUp: Error {}

  func send(_ frame: RoutedLegFrame) async throws {
    switch frame {
    case .text(let text): sent.append(text)
    case .binary(let data): sentBinary.append(data)
    }
  }

  func receive() async throws -> RoutedLegFrame {
    if let error = hangUpError, pending.isEmpty { throw error }
    if !pending.isEmpty { return pending.removeFirst() }
    return try await withCheckedThrowingContinuation { continuation in
      waiting = continuation
    }
  }

  func closeCode() -> Int? { code }

  func close() { isClosed = true }

  /// Push a frame at the client.
  func deliver(_ frame: RoutedLegFrame) {
    if let continuation = waiting {
      waiting = nil
      continuation.resume(returning: frame)
    } else {
      pending.append(frame)
    }
  }

  func deliver(_ type: RoutedMessageType, _ body: [String: JSONValue]) throws {
    deliver(.text(try RoutedWire.encode(type, body)))
  }

  /// Close, with or without a code — the two are DIFFERENT facts: a policy close
  /// names one and a dropped radio does not.
  func hangUp(code: Int?) {
    self.code = code
    hangUpError = HungUp()
    if let continuation = waiting {
      waiting = nil
      continuation.resume(throwing: HungUp())
    }
  }

  /// Every text frame this client sent, decoded by tag.
  func sentTags() -> [String] {
    sent.compactMap { text in
      guard let value = try? JSONValue.parse(Data(text.utf8)) else { return nil }
      return value["type"]?.stringValue
    }
  }

  func lastSent(_ tag: String) -> JSONValue? {
    for text in sent.reversed() {
      guard let value = try? JSONValue.parse(Data(text.utf8)) else { continue }
      if value["type"]?.stringValue == tag { return value }
    }
    return nil
  }

  func allSent(_ tag: String) -> [JSONValue] {
    sent.compactMap { text in
      guard let value = try? JSONValue.parse(Data(text.utf8)),
        value["type"]?.stringValue == tag
      else { return nil }
      return value
    }
  }
}

/// Hands out one `ScriptedConnection` per URL, so a test can address the control
/// leg and the frames leg apart — which is the whole shape of a connection SET.
final class ScriptedTransport: RoutedLegTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var connections: [String: ScriptedConnection] = [:]
  private var dialed: [String] = []
  /// URLs that answer with a refusal to connect at all.
  var unreachable: Set<String> = []

  struct Unreachable: Error {}

  func connect(to url: URL) async throws -> any RoutedLegConnection {
    let isUnreachable = lock.withLock {
      dialed.append(url.absoluteString)
      return unreachable.contains(url.path)
    }
    if isUnreachable { throw Unreachable() }
    return connection(for: url.path)
  }

  /// The connection serving a path, created on first ask so a test can reach it
  /// before or after the dial.
  func connection(for path: String) -> ScriptedConnection {
    lock.withLock {
      if let existing = connections[path] { return existing }
      let made = ScriptedConnection()
      connections[path] = made
      return made
    }
  }

  /// A FRESH connection for a path — what a re-dial gets, and what makes a
  /// replaced leg distinguishable from the one it replaced.
  func rotate(_ path: String) -> ScriptedConnection {
    lock.withLock {
      let made = ScriptedConnection()
      connections[path] = made
      return made
    }
  }

  var dials: [String] { lock.withLock { dialed } }
}

// MARK: - Shapes the scripted door answers with

enum Script {
  static func accepted(
    channel: RoutedChannel, legGeneration: Int64 = 1, heartbeatTtlMs: Int64 = 600,
    capabilities: [String] = ["resume", "session-events"],
    creditWindow: Int64 = 2_097_152
  ) -> [String: JSONValue] {
    var body: [String: JSONValue] = [
      "selectedProtocolVersion": .object(["major": .int(1), "minor": .int(0)]),
      "connectionSetId": .string("cs-test"),
      "channel": .string(channel.rawValue),
      "legGeneration": .int(legGeneration),
      "heartbeatTtlMs": .int(heartbeatTtlMs),
      "protocolLimits": .object([
        "maxControlMessageBytes": .int(65_536),
        "maxPresentationChunkBytes": .int(262_144),
        "maxCreditReturnDelayMs": .int(16),
        "sceneAppliedRefreshMs": .int(1_000),
        "activationAttachDeadlineMs": .int(5_000),
        "maxCatchupBytes": .int(8_388_608),
        "creditAccountDrainTtlMs": .int(5_000),
      ]),
      "capabilities": .array(capabilities.map(JSONValue.string)),
    ]
    if channel == .frames {
      body["creditEpoch"] = .int(legGeneration)
      body["initialWindows"] = .object([
        "connectionCreditBytes": .int(creditWindow),
        "perActivationCreditBytes": .int(524_288),
        "stagingBytesPerSession": .int(4_194_304),
        "stagingBytesTotal": .int(16_777_216),
        "maxConcurrentActivations": .int(8),
        "maxConcurrentSeeds": .int(2),
      ])
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

  static func transferUnits(
    session: String, activation: String, creditEpoch: Int64, firstSequence: Int64,
    kind: String, base: RoutedSceneStamp?, result: RoutedSceneStamp, payload: Data,
    chunkBytes: Int = 64, transferId: String = "t-1"
  ) throws -> [Data] {
    var chunks: [Data] = []
    var offset = 0
    while offset < payload.count {
      let end = min(offset + chunkBytes, payload.count)
      chunks.append(payload[offset..<end])
      offset = end
    }
    func header(_ kindTag: String, _ sequence: Int64, _ transfer: [String: JSONValue]) -> JSONValue {
      var body: [String: JSONValue] = [
        "creditEpoch": .int(creditEpoch),
        "activationSequence": .int(sequence),
        "sessionId": .string(session),
        "activationId": .string(activation),
        "leaseEpoch": .int(4),
        "kind": .string(kindTag),
        "transfer": .object(transfer),
      ]
      if kindTag == "transfer-begin" {
        body["resultContent"] = result.json
        body["baseContent"] = base.map(\.json) ?? .null
      }
      return .object(body)
    }
    var units: [Data] = []
    var sequence = firstSequence
    units.append(
      try RoutedPresentationEnvelope.encode(
        header: header(
          "transfer-begin", sequence,
          [
            "transferId": .string(transferId), "kind": .string(kind),
            "totalBytes": .int(Int64(payload.count)), "chunkCount": .int(Int64(chunks.count)),
            "checksum": .object([
              "alg": .string("crc32c"), "value": .int(Int64(RoutedCrc32c.checksum(payload))),
            ]),
            "targetLayout": .object([
              "cols": .int(80), "rows": .int(24), "scrollbackRows": .int(1000),
            ]),
          ]), payload: Data()))
    var byteOffset = 0
    for (index, chunk) in chunks.enumerated() {
      sequence += 1
      units.append(
        try RoutedPresentationEnvelope.encode(
          header: header(
            "transfer-chunk", sequence,
            [
              "transferId": .string(transferId), "chunkIndex": .int(Int64(index)),
              "byteOffset": .int(Int64(byteOffset)),
            ]), payload: chunk))
      byteOffset += chunk.count
    }
    sequence += 1
    units.append(
      try RoutedPresentationEnvelope.encode(
        header: header("transfer-end", sequence, ["transferId": .string(transferId)]),
        payload: Data()))
    return units
  }
}

/// A ticket for the scripted door: real grants (the vector's, so the claims are
/// the contract's own) pointed at whatever endpoints a test wants.
enum TicketFactory {
  static func make(
    controlUrl: String = "ws://127.0.0.1:9/control", framesUrl: String = "ws://127.0.0.1:9/frames",
    cellBootId: String = "cb-7f3a9c1e-2026", sessionId: String? = nil,
    rights: [String]? = nil, issuedAt: Int64? = nil, expiresAt: Int64? = nil
  ) throws -> RoutedTerminalTicket {
    let vector = try Vector.json("tp-grant-mac.vector")
    func grant(_ which: String) -> JSONValue {
      var claims = vector[which]?["claims"]?.objectValue ?? [:]
      claims["audienceCellBootId"] = .string(cellBootId)
      if let sessionId, which == "attach" { claims["sessionId"] = .string(sessionId) }
      if let rights, which == "attach" {
        claims["rights"] = .array(rights.sorted().map(JSONValue.string))
      }
      if let issuedAt { claims["issuedAt"] = .int(issuedAt) }
      if let expiresAt { claims["expiresAt"] = .int(expiresAt) }
      var header = vector[which]?["protected"]?.objectValue ?? [:]
      header["kid"] = .object([
        "cellBootId": .string(cellBootId), "keyGeneration": .int(1),
      ])
      return .object([
        "protected": .object(header), "claims": .object(claims),
        "mac": vector[which]?["mac"] ?? .null,
      ])
    }
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    return try RoutedTerminalTicket(
      json: .object([
        "route": .object([
          "cellBootId": .string(cellBootId), "routeRevision": .int(12), "leaseEpoch": .int(4),
        ]),
        "endpoints": .object([
          "controlUrl": .string(controlUrl), "framesUrl": .string(framesUrl),
        ]),
        "transportGrant": withWindow(grant("transport"), now: now, given: (issuedAt, expiresAt)),
        "attachGrant": withWindow(grant("attach"), now: now, given: (issuedAt, expiresAt)),
      ]))
  }

  /// The vector's grants were minted in 2026-05 and every validity check is
  /// against the CLOCK, so a test that wants a live grant re-stamps the window.
  /// The MAC is not re-computed — no test here verifies one, and the cell is the
  /// verifier in every path that would.
  private static func withWindow(
    _ grant: JSONValue, now: Int64, given: (Int64?, Int64?)
  ) -> JSONValue {
    guard given.0 == nil, given.1 == nil else { return grant }
    var envelope = grant.objectValue ?? [:]
    var claims = envelope["claims"]?.objectValue ?? [:]
    claims["issuedAt"] = .int(now - 1_000)
    claims["expiresAt"] = .int(now + 300_000)
    envelope["claims"] = .object(claims)
    return .object(envelope)
  }
}

/// Poll a main-actor condition until it holds. Swift has no async `defer`, and a
/// state machine driven by tasks needs a settle point that is not a sleep.
@MainActor
func settle(
  _ what: String, timeout: Duration = .seconds(5), _ condition: @MainActor () async -> Bool
) async throws {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if await condition() { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("timed out waiting for \(what)")
}
