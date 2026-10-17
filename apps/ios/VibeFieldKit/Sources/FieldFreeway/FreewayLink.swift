import FieldProduct
import Foundation

// FW (thinking-freeway.md v0.3 §3, §5) — the phone's link to one desktop, the host's `freeway::link`
// on the dialing side. One WebSocket over one raw tailnet stream carries:
// - stream 0, the link's own: the hello with the phone's approval, the welcome, a `Ping` every
//   heartbeat each way (answered `Pong` with every byte received so far), an `Ack` every
//   `ackEveryBytes` between, `Renew` for the approval, and the host's `Restarting` before a planned
//   close. Three heartbeats with no pong is a dead link.
// - streams ≥ 1, odd because the phone dials: an OPEN of a kind (`terminal-leg`, `terminal-tickets`,
//   `terminal-renew`), the host's OPENED or OPEN_REFUSED, messages both ways (fragmented at the
//   welcome's `fragmentBytes`), and one CLOSE from each side; the link's end ends each one `.ended`.
// It reads off the main actor (FW-DF-6): every frame is handled on this actor, and a stream's
// messages reach their consumer through that stream's own ordered queue.

/// What the host said when it took the link (`FreewayWelcome`), read tolerantly.
public struct FreewayWelcome: Sendable, Equatable {
  public let linkId: String
  public let hostBootId: String
  public let floorBootId: String
  /// The desktop's roster id: a consistency check against the one dialed (FW-L9), never authority.
  public let deviceId: String
  public let clientId: String?
  public let rights: [String]
  public let fragmentBytes: Int
  public let streamWindowBytes: Int
  public let maxStreams: Int
  public let heartbeatMs: Int
  public let approvalExpiresAt: Int64?
  public let unknownFields: [String]

  public init(json: JSONValue) throws {
    var object = try WireObject(shape: "FreewayWelcome", value: json)
    guard object.string("type") == "FreewayWelcome" else {
      throw WireDecodeError(shape: "FreewayWelcome", reason: "not a welcome")
    }
    linkId = try object.requiredString("linkId")
    hostBootId = try object.requiredString("hostBootId")
    floorBootId = try object.requiredString("floorBootId")
    deviceId = try object.requiredString("deviceId")
    clientId = object.string("clientId")
    rights = (object.array("rights") ?? []).compactMap(\.stringValue)
    var limits = object.object("limits")
    fragmentBytes = Int(try limits.requiredInt("fragmentBytes"))
    streamWindowBytes = Int(try limits.requiredInt("streamWindowBytes"))
    maxStreams = Int(try limits.requiredInt("maxStreams"))
    heartbeatMs = Int(try object.requiredInt("heartbeatMs"))
    approvalExpiresAt = object.int("approvalExpiresAt")
    // The path the floor's peer row names (FW-L8): carried, read by the path slice.
    _ = object.value("path")
    unknownFields = object.unknownFields
    guard fragmentBytes > 0, maxStreams > 0, heartbeatMs > 0 else {
      throw WireDecodeError(shape: "FreewayWelcome", reason: "a limit of zero")
    }
  }
}

/// How a link ended. Every pending open and renewal, and every open stream (`.ended`), hears it.
public enum FreewayLinkEnd: Error, Sendable, Equatable {
  /// The host refused the hello (`FreewayRefused`) — `APPROVAL_EXPIRED`, `NOT_ADMITTED`, … — and
  /// closed.
  case refused(code: String, retryable: Bool, message: String)
  /// The welcome named another desktop than the one dialed (FW-L9); this side closed 4403.
  case wrongDesktop(expected: String, welcomed: String)
  /// A planned restart: `Restarting` came first, then the close. Wait `ttlMs` (§7).
  case restarting(ttlMs: Int64, reason: String)
  /// The host closed the link: a `FreewayContract.Code` (4401 revoked, 4409 superseded, 4410 peer
  /// gone, …) or a WebSocket code; nil for a close with no code.
  case closed(code: Int?, reason: String)
  /// `missedPings` heartbeats went unanswered.
  case dead
  /// This side ended it: the host's bytes broke the protocol (4400), or the caller closed it.
  case local(code: Int)
  /// The stream under it failed.
  case transport(String)
}

/// The host's refusal of one open (`FreewayOpenRefused`): `DOOR_DOWN` for a cell that did not
/// answer, `APPROVAL` once the approval has lapsed, `KIND_NOT_SERVED`, ….
public struct FreewayOpenRefusal: Error, Sendable, Equatable {
  public let code: Int
  public let state: String
  public let retryable: Bool
}

/// Why a call on a standing link was not made.
public enum FreewayLinkError: Error, Sendable, Equatable {
  /// The welcome's `maxStreams` are all open.
  case tooManyStreams
  /// This side has closed the stream.
  case streamClosed
  /// One renewal at a time.
  case renewInFlight
  /// The host refused the renewal (`FreewayRefused`); the link stands on the old approval.
  case renewRefused(code: String, message: String)
}

/// One event of one stream, in the host's order.
public enum FreewayStreamEvent: Sendable, Equatable {
  case text(String)
  case binary(Data)
  /// The host's CLOSE: the stream's protocol close code verbatim (§5.1).
  case closed(code: Int, reason: String?)
  /// The link under the stream ended — no code of the stream's own, which is how a leg tells its
  /// link going (a dropped socket) from its cell closing it.
  case ended(FreewayLinkEnd)
}

/// A stream the phone opened, and its host's answer.
public struct FreewayStream: Sendable {
  public let id: UInt64
  /// The OPENED payload: `{}` for a leg that is up, the tickets, a renewal's grant or its refusal.
  public let opened: JSONValue
  public let events: AsyncStream<FreewayStreamEvent>
  let link: FreewayLink

  public func send(text: String) async throws {
    try await link.send(stream: id, kind: .text, payload: Data(text.utf8))
  }

  public func send(binary: Data) async throws {
    try await link.send(stream: id, kind: .binary, payload: binary)
  }

  /// This side's CLOSE, once. The host answers with its own, which ends `events`.
  public func close(code: Int = 1000, reason: String? = nil) async {
    await link.closeStream(id, code: code, reason: reason)
  }
}

public actor FreewayLink {
  public nonisolated let welcome: FreewayWelcome
  private let socket: FreewaySocket
  private let now: @Sendable () -> Int64

  /// The most one message may take, on the link and on a stream.
  public static let maxMessageBytes = 4 << 20

  private struct StreamState {
    var answer: Result<JSONValue, any Error>?
    var opening: CheckedContinuation<JSONValue, any Error>?
    var events: AsyncStream<FreewayStreamEvent>.Continuation
    var message: (kind: FreewayFrameType, data: Data)?
    var closeSent = false
    var closeReceived = false
    var opened = false
    /// Refused: the host retired the stream, and it leaves the table once its opener has the answer.
    var retired = false
    /// Its opener stopped waiting: an OPENED that still comes is closed at once, a refusal dropped.
    var abandoned = false
  }

  private var streams: [UInt64: StreamState] = [:]
  private var nextStream: UInt64 = 1
  private var lastPeerStream: UInt64 = 0
  private var received: UInt64 = 0
  private var acknowledged: UInt64 = 0
  private var seq: UInt64 = 0
  private var missed = 0
  private var restarting: (ttlMs: Int64, reason: String)?
  private var renewing = false
  private var renewAnswer: Result<Int64, any Error>?
  private var renewWaiter: CheckedContinuation<Int64, any Error>?
  private var endState: FreewayLinkEnd?
  private var endWaiters: [UUID: CheckedContinuation<FreewayLinkEnd, any Error>] = [:]
  private var tasks: [Task<Void, Never>] = []

  private init(welcome: FreewayWelcome, socket: FreewaySocket, now: @escaping @Sendable () -> Int64) {
    self.welcome = welcome
    self.socket = socket
    self.now = now
  }

  /// Dial the link over `stream`: upgrade it at `host`, say the hello, read the welcome. `expect`
  /// is the desktop the phone meant to reach; a welcome naming another closes the link (FW-L9).
  public static func connect(
    over stream: any FreewayByteStream,
    host: String,
    approval: JSONValue,
    deviceName: String? = nil,
    expect deviceId: String? = nil,
    now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1_000) }
  ) async throws -> FreewayLink {
    let socket = try await FreewaySocket.open(
      over: stream, host: host, port: FreewayContract.servePort, maxMessageBytes: maxMessageBytes)
    var device: [String: JSONValue] = [:]
    if let deviceName { device["name"] = .string(deviceName) }
    let hello: JSONValue = .object([
      "type": .string("FreewayHello"),
      "protocol": .object(["major": .int(Int64(FreewayContract.protocolMajor)), "minor": .int(0)]),
      "approval": approval,
      "device": .object(device),
      "capabilities": .array([]),
    ])
    try await socket.send(FreewayFrame(kind: .link, stream: 0, payload: hello.encoded()).encode())
    let welcome: FreewayWelcome
    do {
      welcome = try await Self.firstWord(socket)
    } catch {
      await socket.close(code: UInt16(FreewayContract.Code.protocolError))
      throw error
    }
    if let deviceId, welcome.deviceId != deviceId {
      await socket.close(code: UInt16(FreewayContract.Code.notAdmitted), reason: "NOT_ADMITTED")
      throw FreewayLinkEnd.wrongDesktop(expected: deviceId, welcomed: welcome.deviceId)
    }
    let link = FreewayLink(welcome: welcome, socket: socket, now: now)
    await link.start()
    return link
  }

  /// The host's first stream-0 message: the welcome, or its refusal (and then its close).
  private static func firstWord(_ socket: FreewaySocket) async throws -> FreewayWelcome {
    switch try await socket.receive() {
    case .binary(let bytes):
      let frame = try FreewayFrame.decode(bytes)
      guard frame.kind == .link else { throw FreewayLinkEnd.local(code: FreewayContract.Code.protocolError) }
      let message = try JSONValue.parse(frame.payload)
      if message["type"]?.stringValue == "FreewayRefused" {
        throw FreewayLinkEnd.refused(
          code: message["code"]?.stringValue ?? "",
          retryable: message["retryable"]?.boolValue ?? false,
          message: message["message"]?.stringValue ?? "")
      }
      return try FreewayWelcome(json: message)
    case .close(let code, let reason):
      throw FreewayLinkEnd.closed(code: code.map(Int.init), reason: reason)
    default:
      throw FreewayLinkEnd.local(code: FreewayContract.Code.protocolError)
    }
  }

  private func start() {
    tasks.append(Task { await self.readLoop() })
    tasks.append(Task { await self.heartbeat() })
  }

  // MARK: - The caller's calls

  /// Open a stream of `kind` (`FreewayOpen`'s payload) and wait for the host's answer. Throws the
  /// host's `FreewayOpenRefusal`, `tooManyStreams`, or the link's end.
  public func open(_ request: JSONValue) async throws -> FreewayStream {
    if let endState { throw endState }
    guard streams.count < welcome.maxStreams else { throw FreewayLinkError.tooManyStreams }
    let id = nextStream
    nextStream += 2
    let (events, continuation) = AsyncStream<FreewayStreamEvent>.makeStream()
    streams[id] = StreamState(events: continuation)
    do {
      try await write(FreewayFrame(kind: .open, stream: id, payload: request.encoded()))
    } catch {
      streams[id] = nil
      continuation.finish()
      throw error
    }
    let opened = try await answer(of: id)
    return FreewayStream(id: id, opened: opened, events: events, link: self)
  }

  /// Hand the host a fresh approval (`Renew`); the answer is the new `approvalExpiresAt`. A refused
  /// renewal leaves the link on the approval it has, until that lapses.
  public func renew(approval: JSONValue) async throws -> Int64 {
    if let endState { throw endState }
    guard !renewing else { throw FreewayLinkError.renewInFlight }
    renewing = true
    defer { renewing = false }
    try await sendLink(.object(["type": .string("Renew"), "approval": approval]))
    if let renewAnswer {
      self.renewAnswer = nil
      return try renewAnswer.get()
    }
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        if Task.isCancelled {
          continuation.resume(throwing: CancellationError())
        } else {
          renewWaiter = continuation
        }
      }
    } onCancel: {
      Task { await self.cancelRenew() }
    }
  }

  /// Move a stream between the host's classes (`Priority`): the focused cell's frames leg `live`.
  public func priority(stream: UInt64, class streamClass: String) async throws {
    try await sendLink(
      .object([
        "type": .string("Priority"), "streamId": .int(Int64(stream)),
        "class": .string(streamClass),
      ]))
  }

  /// End the link from this side.
  public func close(code: Int = 1000) async {
    await end(.local(code: code), closing: code)
  }

  /// How the link ended, once it has. A caller that stops waiting is told so (`CancellationError`),
  /// never an end that did not happen.
  public func ended() async throws -> FreewayLinkEnd {
    if let endState { return endState }
    let waiter = UUID()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        if let endState {
          continuation.resume(returning: endState)
        } else if Task.isCancelled {
          continuation.resume(throwing: CancellationError())
        } else {
          endWaiters[waiter] = continuation
        }
      }
    } onCancel: {
      Task { await self.cancelEndWaiter(waiter) }
    }
  }

  private func cancelEndWaiter(_ waiter: UUID) {
    endWaiters.removeValue(forKey: waiter)?.resume(throwing: CancellationError())
  }

  private func cancelRenew() {
    renewWaiter?.resume(throwing: CancellationError())
    renewWaiter = nil
  }

  // MARK: - A stream's calls

  func send(stream id: UInt64, kind: FreewayFrameType, payload: Data) async throws {
    if let endState { throw endState }
    guard let state = streams[id], state.opened, !state.closeSent else {
      throw FreewayLinkError.streamClosed
    }
    // One message's fragments go out together: nothing of another message sits between them.
    var frames: [Data] = []
    var offset = payload.startIndex
    repeat {
      let end = min(offset + welcome.fragmentBytes, payload.endIndex)
      let last = end == payload.endIndex
      let fragment = FreewayFrame(
        kind: kind, fragment: !last, stream: id, payload: Data(payload[offset..<end]))
      frames.append(try fragment.encode())
      offset = end
    } while offset < payload.endIndex
    try await socket.send(frames: frames)
  }

  func closeStream(_ id: UInt64, code: Int, reason: String?) async {
    guard var state = streams[id], !state.closeSent else { return }
    state.closeSent = true
    streams[id] = state
    var close: [String: JSONValue] = ["code": .int(Int64(code))]
    if let reason { close["reason"] = .string(reason) }
    try? await write(FreewayFrame(kind: .close, stream: id, payload: JSONValue.object(close).encoded()))
    if streams[id]?.closeReceived == true { streams[id] = nil }
  }

  // MARK: - The host's frames

  private func readLoop() async {
    do {
      while endState == nil {
        switch try await socket.receive() {
        case .binary(let bytes):
          received += UInt64(bytes.count)
          try await take(FreewayFrame.decode(bytes))
          try await acknowledge()
        case .text:
          return await end(
            .local(code: FreewayContract.Code.protocolError),
            closing: FreewayContract.Code.protocolError)
        case .close(let code, let reason):
          if let restarting, code.map(Int.init) == FreewayContract.Code.restarting {
            return await end(.restarting(ttlMs: restarting.ttlMs, reason: restarting.reason), closing: nil)
          }
          return await end(.closed(code: code.map(Int.init), reason: reason), closing: nil)
        case .ping, .pong:
          continue
        }
      }
    } catch is FreewayFrameError {
      await end(
        .local(code: FreewayContract.Code.protocolError), closing: FreewayContract.Code.protocolError)
    } catch let error as FreewayLinkEnd {
      await end(error, closing: FreewayContract.Code.protocolError)
    } catch {
      await end(.transport(String(describing: error)), closing: nil)
    }
  }

  private func take(_ frame: FreewayFrame) async throws {
    switch frame.kind {
    case .link:
      try await onLink(frame.payload)
    case .open:
      try await onPeerOpen(frame.stream)
    case .opened:
      guard var state = try stream(frame.stream) else { return }
      state.opened = true
      streams[frame.stream] = state
      resolve(frame.stream, .success(try JSONValue.parse(frame.payload)))
    case .openRefused:
      guard var state = try stream(frame.stream) else { return }
      let refused = try JSONValue.parse(frame.payload)
      let refusal = FreewayOpenRefusal(
        code: Int(refused["code"]?.intValue ?? 0),
        state: refused["state"]?.stringValue ?? "",
        retryable: refused["retryable"]?.boolValue ?? false)
      // The host retired the stream: no CLOSE is owed by either side.
      state.retired = true
      state.events.finish()
      streams[frame.stream] = state
      resolve(frame.stream, .failure(refusal))
    case .text, .binary:
      guard var state = try stream(frame.stream) else { return }
      guard state.opened, !state.closeReceived else {
        throw FreewayLinkEnd.local(code: FreewayContract.Code.protocolError)
      }
      var message = state.message ?? (frame.kind, Data())
      guard message.kind == frame.kind else {
        throw FreewayLinkEnd.local(code: FreewayContract.Code.protocolError)
      }
      message.data.append(frame.payload)
      guard message.data.count <= Self.maxMessageBytes else {
        throw FreewayLinkEnd.local(code: FreewayContract.Code.protocolError)
      }
      if frame.fragment {
        state.message = message
      } else {
        state.message = nil
        if message.kind == .text {
          state.events.yield(.text(String(decoding: message.data, as: UTF8.self)))
        } else {
          state.events.yield(.binary(message.data))
        }
      }
      streams[frame.stream] = state
    case .close:
      guard var state = try stream(frame.stream) else { return }
      let close = try? JSONValue.parse(frame.payload)
      let code = Int(close?["code"]?.intValue ?? 1005)
      state.closeReceived = true
      state.events.yield(.closed(code: code, reason: close?["reason"]?.stringValue))
      state.events.finish()
      streams[frame.stream] = state
      // Each side sends one CLOSE: the host's is answered with this side's, the same code.
      if !state.closeSent {
        await closeStream(frame.stream, code: code, reason: nil)
      } else {
        streams[frame.stream] = nil
      }
    case .window:
      // Credit for a windowed stream this side sends on. F1's kinds send nothing windowed: read
      // and dropped, after the codec checked it.
      _ = try frame.windowGrant()
    }
  }

  /// A stream frame's stream: its state, nil for one that has closed (a frame that crossed the
  /// close in flight, dropped), or a protocol error for an id nobody opened.
  private func stream(_ id: UInt64) throws -> StreamState? {
    if let state = streams[id] { return state }
    let ours = id % 2 == 1
    if ours ? id < nextStream : id <= lastPeerStream { return nil }
    throw FreewayLinkEnd.local(code: FreewayContract.Code.protocolError)
  }

  /// The host opened a stream (even ids). The phone serves no kind, so each is refused; an id that
  /// is not new, or not the host's, breaks the protocol.
  private func onPeerOpen(_ id: UInt64) async throws {
    guard id % 2 == 0, id > lastPeerStream else {
      throw FreewayLinkEnd.local(code: FreewayContract.Code.protocolError)
    }
    lastPeerStream = id
    let refused: JSONValue = .object([
      "code": .int(Int64(FreewayContract.Code.kindNotServed)),
      "state": .string("this phone serves no kind"),
      "retryable": .bool(false),
    ])
    try await write(FreewayFrame(kind: .openRefused, stream: id, payload: refused.encoded()))
  }

  private func onLink(_ payload: Data) async throws {
    guard let message = try? JSONValue.parse(payload) else { return }
    switch message["type"]?.stringValue {
    case "Ping":
      acknowledged = received
      try await sendLink(
        .object([
          "type": .string("Pong"),
          "seq": message["seq"] ?? .int(0),
          "sentAtMs": message["sentAtMs"] ?? .int(0),
          "ackBytes": .int(Int64(received)),
        ]))
    case "Pong":
      missed = 0
    case "Renewed":
      answerRenew(.success(message["approvalExpiresAt"]?.intValue ?? 0))
    case "FreewayRefused":
      // After the welcome a refusal answers a `Renew`; the link stands on its old approval.
      answerRenew(
        .failure(
          FreewayLinkError.renewRefused(
            code: message["code"]?.stringValue ?? "", message: message["message"]?.stringValue ?? "")))
    case "Restarting":
      restarting = (message["ttlMs"]?.intValue ?? 0, message["reason"]?.stringValue ?? "")
    default:
      // `Ack` (this side sends nothing it must hold back in F1), `Path` (the path slice's), and
      // whatever a newer host says: read and passed over.
      break
    }
  }

  /// An `Ack` once `ackEveryBytes` have come since the last acknowledgment (a `Pong` acknowledges
  /// too).
  private func acknowledge() async throws {
    guard received - acknowledged >= UInt64(FreewayContract.ackEveryBytes) else { return }
    acknowledged = received
    try await sendLink(.object(["type": .string("Ack"), "bytes": .int(Int64(received))]))
  }

  /// A `Ping` every heartbeat; `missedPings` unanswered is a dead link.
  private func heartbeat() async {
    let interval = UInt64(welcome.heartbeatMs) * 1_000_000
    while endState == nil {
      try? await Task.sleep(nanoseconds: interval)
      guard endState == nil, !Task.isCancelled else { return }
      if missed >= FreewayContract.missedPings {
        return await end(.dead, closing: 1001)
      }
      missed += 1
      seq += 1
      try? await sendLink(
        .object([
          "type": .string("Ping"), "seq": .int(Int64(seq)), "sentAtMs": .int(now()),
        ]))
    }
  }

  // MARK: - Answers and the end

  /// The host's answer to an open: already in, or waited for. An answer may come before the
  /// opener waits (the read loop runs whenever this actor is free), so it is held in the stream's
  /// state until taken.
  private func answer(of id: UInt64) async throws -> JSONValue {
    if let answer = takeAnswer(id) { return try answer.get() }
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        if let answer = takeAnswer(id) {
          continuation.resume(with: answer)
        } else if streams[id] == nil {
          continuation.resume(throwing: endState ?? FreewayLinkError.streamClosed)
        } else if Task.isCancelled {
          streams[id]?.abandoned = true
          continuation.resume(throwing: CancellationError())
        } else {
          streams[id]?.opening = continuation
        }
      }
    } onCancel: {
      Task { await self.abandon(id) }
    }
  }

  /// An opener that stopped waiting: told so, and its stream closed if the host has opened it or
  /// still does.
  private func abandon(_ id: UInt64) async {
    guard var state = streams[id] else { return }
    state.abandoned = true
    let opening = state.opening
    state.opening = nil
    streams[id] = state
    opening?.resume(throwing: CancellationError())
    if state.opened { await closeStream(id, code: 1000, reason: "abandoned") }
  }

  private func takeAnswer(_ id: UInt64) -> Result<JSONValue, any Error>? {
    guard let answer = streams[id]?.answer else { return nil }
    if streams[id]?.retired == true {
      streams[id] = nil
    } else {
      streams[id]?.answer = nil
    }
    return answer
  }

  private func resolve(_ id: UInt64, _ result: Result<JSONValue, any Error>) {
    guard var state = streams[id] else { return }
    if state.abandoned {
      // Nobody waits: an opened stream is closed again, a refused one is simply gone.
      if state.retired {
        streams[id] = nil
      } else {
        Task { await self.closeStream(id, code: 1000, reason: "abandoned") }
      }
      return
    }
    guard let opening = state.opening else {
      state.answer = result
      streams[id] = state
      return
    }
    state.opening = nil
    streams[id] = state.retired ? nil : state
    opening.resume(with: result)
  }

  private func answerRenew(_ result: Result<Int64, any Error>) {
    guard renewing else { return }
    if let renewWaiter {
      self.renewWaiter = nil
      renewWaiter.resume(with: result)
    } else {
      renewAnswer = result
    }
  }

  private func end(_ reason: FreewayLinkEnd, closing code: Int?) async {
    guard endState == nil else { return }
    endState = reason
    for (id, state) in streams {
      state.opening?.resume(throwing: reason)
      state.events.yield(.ended(reason))
      state.events.finish()
      streams[id] = nil
    }
    renewWaiter?.resume(throwing: reason)
    renewWaiter = nil
    for waiter in endWaiters.values { waiter.resume(returning: reason) }
    endWaiters = [:]
    for task in tasks { task.cancel() }
    await socket.close(code: UInt16(code ?? 1000))
  }

  private func write(_ frame: FreewayFrame) async throws {
    try await socket.send(try frame.encode())
  }

  private func sendLink(_ message: JSONValue) async throws {
    try await write(FreewayFrame(kind: .link, stream: 0, payload: message.encoded()))
  }
}
