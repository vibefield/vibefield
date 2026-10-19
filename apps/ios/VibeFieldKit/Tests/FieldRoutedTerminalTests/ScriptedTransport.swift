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
  private var pauseSend = false
  private var sendWaiter: CheckedContinuation<Void, Never>?
  private var rejectSend = false
  var sendIsPaused: Bool { sendWaiter != nil }

  func pauseNextSend() { pauseSend = true }
  func releaseSend() {
    sendWaiter?.resume()
    sendWaiter = nil
  }
  func failNextSend() { rejectSend = true }

  struct HungUp: Error {}

  func send(_ frame: RoutedLegFrame) async throws {
    if pauseSend {
      pauseSend = false
      await withCheckedContinuation { sendWaiter = $0 }
    }
    if rejectSend {
      rejectSend = false
      throw HungUp()
    }
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

  func close() {
    isClosed = true
    releaseSend()
  }

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

/// A sink that can REFUSE, which `RoutedFrameRecorder` deliberately cannot.
///
/// The recorder holds bytes and a stamp and has no decoder, so the only frames
/// it turns down are deltas whose base it does not hold. The real sink
/// (`RoutedTerminalFrameSink`) refuses three further ways — a superseded
/// activation, handles the cell did not declare, and bytes that will not parse
/// as TRF1 at all — and it is the LAST of those that K-H1 was about: the client
/// could not tell a refusal from an apply, so it acknowledged one. This stands
/// in for a sink that says no, without dragging the Metal renderer and its TRF1
/// decoder into a bundle that deliberately names neither.
actor RefusingSink: RoutedFrameSink {
  private var refusing = true
  private var content: RoutedSceneStamp?
  private(set) var refusedFull = 0
  private(set) var refusedDelta = 0
  private(set) var appliedFull = 0
  private(set) var appliedDelta = 0
  private(set) var identities: [String: RoutedTrfIdentity] = [:]
  private(set) var endings: [String] = []

  /// Take frames from now on — a race that resolved, rather than a build that
  /// cannot show anything.
  func accept() { refusing = false }
  func refuse() { refusing = true }

  func bindActivation(session: String, activation: String, identity: RoutedTrfIdentity) {
    identities[activation] = identity
  }

  func applyFullFrame(
    _ payload: Data, session: String, activation: String, content: RoutedSceneStamp
  ) -> Bool {
    if refusing {
      refusedFull += 1
      return false
    }
    self.content = content
    appliedFull += 1
    return true
  }

  func applyDeltaFrame(
    _ payload: Data, session: String, activation: String, base: RoutedSceneStamp?,
    result: RoutedSceneStamp
  ) -> Bool {
    if refusing {
      refusedDelta += 1
      return false
    }
    content = result
    appliedDelta += 1
    return true
  }

  func activationEnded(session: String, activation: String, reason: String) {
    endings.append("\(activation):\(reason)")
  }
}

// MARK: - Shapes the scripted door answers with

enum Script {
  /// `ConnectionAccepted`, DERIVED from `tp-connection-accepted.frames.json`
  /// rather than typed out (TM-r3, 2026-09-14).
  ///
  /// The hand-written version omitted SEVEN of the golden's fourteen
  /// `protocolLimits` — the writer-side numbers this client happens not to read
  /// — so every row here drove the reader against a body no cell would ever
  /// send, and a limit the schema added would have reached the phone first on
  /// James's hardware. Deriving makes the fixture the source: a field added
  /// upstream arrives the moment `check:ios-fixtures` refreshes the copy, and
  /// nothing has to remember to add it twice.
  ///
  /// Overridden are exactly the values a TEST varies, each for a reason:
  /// `channel` (the golden is the frames one), `legGeneration` and the
  /// `creditEpoch` that tracks it, `heartbeatTtlMs` (600 ms, so a liveness row
  /// is not a six-second wait), `capabilities` (the golden negotiates `resume`
  /// alone; most rows here want `session-events` too) and the connection credit
  /// window.  Everything else is the golden's.
  ///
  /// The CONTROL leg drops `creditEpoch` and `initialWindows`, which is not a
  /// convenience: `door.rs` builds both as `(channel == Channel::Frames).then(…)`,
  /// so a control accept carrying them would be a shape the real cell never
  /// writes.
  static func accepted(
    channel: RoutedChannel, legGeneration: Int64 = 1, heartbeatTtlMs: Int64 = 600,
    capabilities: [String] = ["resume", "session-events"],
    creditWindow: Int64 = 2_097_152, connectionSetId: String = "cs-win-3c4d-2-cb-7f3a9c1e"
  ) throws -> [String: JSONValue] {
    guard var body = try Vector.json("tp-connection-accepted.frames").objectValue else {
      throw Vector.Failure.missing("tp-connection-accepted.frames")
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
/// the contract's own) pointed at whatever endpoints a test wants. `clientId`
/// renames the client BOTH grants name, as fieldd mints them after a restart
/// (TP-R21) — the vector's `win-3c4d-incarnation-2` otherwise.
enum TicketFactory {
  static func make(
    controlUrl: String = "ws://127.0.0.1:9/control", framesUrl: String = "ws://127.0.0.1:9/frames",
    cellBootId: String = "cb-7f3a9c1e-2026", sessionId: String? = nil,
    rights: [String]? = nil, issuedAt: Int64? = nil, expiresAt: Int64? = nil,
    clientId: String? = nil
  ) throws -> RoutedTerminalTicket {
    let vector = try Vector.json("tp-grant-mac.vector")
    func grant(_ which: String) -> JSONValue {
      var claims = vector[which]?["claims"]?.objectValue ?? [:]
      claims["audienceCellBootId"] = .string(cellBootId)
      if let clientId { claims["clientId"] = .string(clientId) }
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

  /// A ticket whose two grants carry DIFFERENT windows: the transport grant
  /// live, the attach grant at whatever the caller asks for.
  ///
  /// `open` validates the TRANSPORT grant alone — the attach grant is the
  /// cell's to judge — so this is the only way a test reaches `attach()` with
  /// an attach grant nothing on this device has checked, which is exactly where
  /// its `expiresAt` meets the renewal-margin subtraction.
  static func makeMixed(
    controlUrl: String = "ws://127.0.0.1:9/control", framesUrl: String = "ws://127.0.0.1:9/frames",
    cellBootId: String = "cb-7f3a9c1e-2026", sessionId: String,
    attachIssuedAt: Int64, attachExpiresAt: Int64
  ) throws -> RoutedTerminalTicket {
    let live = try make(
      controlUrl: controlUrl, framesUrl: framesUrl, cellBootId: cellBootId, sessionId: sessionId)
    var attach = live.attachGrant.raw.objectValue ?? [:]
    var claims = attach["claims"]?.objectValue ?? [:]
    claims["issuedAt"] = .int(attachIssuedAt)
    claims["expiresAt"] = .int(attachExpiresAt)
    attach["claims"] = .object(claims)
    return try RoutedTerminalTicket(
      json: .object([
        "route": .object([
          "cellBootId": .string(cellBootId), "routeRevision": .int(12), "leaseEpoch": .int(4),
        ]),
        "endpoints": .object([
          "controlUrl": .string(controlUrl), "framesUrl": .string(framesUrl),
        ]),
        "transportGrant": live.transportGrant.raw,
        "attachGrant": .object(attach),
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
///
/// It THROWS on a timeout as well as recording the issue (TM-r3, T-L(a)). It
/// used to record and RETURN, so the row carried on against a state that had
/// not arrived and failed again at whatever expectation ran next — one timeout
/// reported as two or three failures, with the LAST one naming a line that was
/// never the problem. That is how a flake gets blamed on the wrong code. The
/// sibling bundle's `until` already throws, for the same reason.
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
  throw SettleTimedOut(what: what)
}

/// The same, for a VALUE that arrives rather than a flag that flips — and it
/// hands back the value it MATCHED on (TM-r3, T-L(b)).
///
/// A row that settles on a condition and then re-reads the source is reading it
/// twice, and on a cumulative surface the second read can see something the
/// first did not: the credit row waited for a return covering two units and
/// then fetched "the last TransportCredit", which a prune between the two reads
/// could have replaced with a different one. Returning the match closes that.
@MainActor
func settled<T: Sendable>(
  _ what: String, timeout: Duration = .seconds(5), _ read: @MainActor () async -> T?
) async throws -> T {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if let value = await read() { return value }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("timed out waiting for \(what)")
  throw SettleTimedOut(what: what)
}

struct SettleTimedOut: Error, CustomStringConvertible {
  let what: String
  var description: String { "timed out waiting for \(what)" }
}

/// A sink that holds ONE apply open until released — the `holding`th, the
/// first by default — and records the stamps it applied in the order it
/// applied them. D1's witness (the second audit, 2026-10-16) holds the first: a
/// client that hands frames over one task each lets the second frame in while
/// the first is still applying — the actor is reentrant — and `started` reads
/// 2; a client that waits per session never does. Holding a later one is a
/// frame in flight over a scene already applied (§5.4's `active`, 2026-10-17).
actor HeldApplySink: RoutedFrameSink {
  private(set) var started = 0
  private(set) var applied: [Int64] = []
  private let holding: Int
  private var gate: CheckedContinuation<Void, Never>?
  private var released = false

  init(holding: Int = 1) {
    self.holding = holding
  }

  func release() {
    released = true
    gate?.resume()
    gate = nil
  }

  func bindActivation(session: String, activation: String, identity: RoutedTrfIdentity) {}

  func applyFullFrame(
    _ payload: Data, session: String, activation: String, content: RoutedSceneStamp
  ) async -> Bool {
    await admit()
    applied.append(content.sceneRevision)
    return true
  }

  func applyDeltaFrame(
    _ payload: Data, session: String, activation: String, base: RoutedSceneStamp?,
    result: RoutedSceneStamp
  ) async -> Bool {
    await admit()
    applied.append(result.sceneRevision)
    return true
  }

  func activationEnded(session: String, activation: String, reason: String) {}

  private func admit() async {
    started += 1
    guard started == holding, !released else { return }
    await withCheckedContinuation { gate = $0 }
  }
}
