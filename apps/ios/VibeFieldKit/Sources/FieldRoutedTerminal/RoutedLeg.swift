import FieldProduct
import Foundation

/// Why a leg is gone.
public enum RoutedLegFailure: Sendable, Equatable, CustomStringConvertible {
  /// A PRE-AUTHENTICATION close: `1008`, no body, no code — silent BY POLICY,
  /// with the reason in the cell's audit line and nowhere else. The client's
  /// rule is the spec's and cannot be improved on from this side: re-mint the
  /// ticket once, and if the second grant is refused the same way, UNAVAILABLE.
  case preAuthenticationRefused
  /// A post-authentication close, always named by the cell: `4000 STALE_ROUTE`,
  /// `4001 FENCED`, `4002 SUPERSEDED`, `4003 PROTOCOL`, `4004 LEG_TIMEOUT`.
  case closed(code: Int, reason: String)
  /// The socket died without a close frame — a radio that wandered off, a
  /// process that went. NOT the same fact as a policy close, and never reported
  /// as one.
  case dropped(String)
  /// This client refused what the cell said.
  case protocolViolation(String)

  public var description: String {
    switch self {
    case .preAuthenticationRefused: "the cell refused the grant before authentication (1008)"
    case .closed(let code, let reason): "the cell closed \(code) \(reason)"
    case .dropped(let reason): "the socket dropped: \(reason)"
    case .protocolViolation(let reason): "the cell broke the protocol: \(reason)"
    }
  }

  /// Whether re-ticketing can plausibly help. A `STALE_ROUTE` says the session
  /// moved and a fresh ticket is exactly the repair; a `PROTOCOL` says this
  /// build and that cell disagree, and asking again would only repeat it.
  public var isStaleRoute: Bool {
    if case .closed(let code, _) = self { return code == RoutedTerminalContract.CloseCode.staleRoute }
    return false
  }
}

/// One physical WebSocket to one door of one cell.
///
/// The leg owns the handshake and the heartbeat and NOTHING else: it does not
/// know what an activation is, it does not decide when to re-dial, and it holds
/// no session state. That belongs to the connection set above it, because the
/// set is what a replacement invalidates — a leg that decided its own recovery
/// would be a second authority for a decision that has exactly one.
@MainActor
final class RoutedLeg {
  enum Phase: Sendable, Equatable {
    case connecting
    case accepted
    case refused(String)
    case failed(RoutedLegFailure)
    case closed
  }

  struct Callbacks {
    var onAccepted: @MainActor (RoutedConnectionAccepted) -> Void = { _ in }
    var onRefused: @MainActor (RoutedConnectionRefused) -> Void = { _ in }
    var onFailed: @MainActor (RoutedLegFailure) -> Void = { _ in }
    var onText: @MainActor (RoutedMessageType, JSONValue) -> Void = { _, _ in }
    var onBinary: @MainActor (Data) -> Void = { _ in }
  }

  let channel: RoutedChannel
  private(set) var phase: Phase = .connecting
  private(set) var accepted: RoutedConnectionAccepted?

  private let url: URL
  private let transport: any RoutedLegTransport
  private let callbacks: Callbacks
  private var connection: (any RoutedLegConnection)?
  private var pump: Task<Void, Never>?
  private var heartbeat: Task<Void, Never>?
  private var writer: Task<Void, Never>?
  private var outbound: [String] = []
  private var bufferedMessages = 0
  private var bufferedBytes = 0
  // Local client bounds, including the write in flight (spec §5.4).
  static let maximumBufferedMessages = 256
  static let maximumBufferedBytes = 4 * 1024 * 1024
  private var heartbeatSequence: Int64 = 0
  private var stopped = false

  /// The floor on the heartbeat interval. The cadence is the CELL's TTL divided
  /// by three (two missed beats still leave a third inside the window), and the
  /// cell owns that TTL — but a cell announcing a tiny one must not turn this
  /// client into a spinner, so the interval never drops below 50 ms.
  private static let minimumHeartbeatMs = 50
  private static let heartbeatDivisor = 3

  init(
    channel: RoutedChannel, url: URL, transport: any RoutedLegTransport, callbacks: Callbacks
  ) {
    self.channel = channel
    self.url = url
    self.transport = transport
    self.callbacks = callbacks
  }

  /// Dial, and send the hello as the FIRST frame — the door's own rule, and the
  /// reason nothing else may be sent until an accept has been read.
  func open(hello: JSONValue) {
    // `Task` inherits this method's actor context, so the whole pump runs on the
    // main actor: every `await` suspends without blocking it, and the state this
    // leg touches never needs a second isolation to reason about.
    pump = Task { [weak self] in
      guard let self else { return }
      do {
        let connection = try await self.transport.connect(to: self.url)
        self.adopt(connection)
        guard let text = try? RoutedWire.encode(.connectionHello, Self.body(hello)) else {
          self.fail(.protocolViolation("the hello would not encode"))
          return
        }
        try await connection.send(.text(text))
        while !Task.isCancelled {
          let frame = try await connection.receive()
          if self.receive(frame) { return }
        }
      } catch {
        // A throw from `receive()` is how a leg learns it is gone. WHICH kind of
        // gone is the close code's to say, and only the socket knows it.
        let code = await self.connection?.closeCode()
        guard !self.stopped else { return }
        switch code {
        case RoutedTerminalContract.CloseCode.policyPreAuth where self.accepted == nil:
          self.fail(.preAuthenticationRefused)
        case .some(let code):
          self.fail(.closed(code: code, reason: Self.name(of: code)))
        case .none:
          self.fail(.dropped(String(describing: error)))
        }
      }
    }
  }

  func send(_ type: RoutedMessageType, _ body: [String: JSONValue]) {
    guard case .accepted = phase, let connection else { return }
    guard RoutedLegVocabulary.outbound(channel).contains(type) else {
      fail(.protocolViolation("\(type.rawValue) is not sent on the \(channel.rawValue) leg"))
      return
    }
    guard let text = try? RoutedWire.encode(type, body) else { return }
    let bytes = text.utf8.count
    guard bufferedMessages < Self.maximumBufferedMessages,
      bytes <= Self.maximumBufferedBytes - bufferedBytes
    else {
      fail(.dropped("outgoing queue exceeded its capacity"))
      return
    }
    outbound.append(text)
    bufferedMessages += 1
    bufferedBytes += bytes
    guard writer == nil else { return }
    // A task per message permits overtaking at an async send. One writer owns
    // the FIFO, including input sequences, heartbeat sequences and credit.
    writer = Task { [weak self] in
      guard let self else { return }
      while !self.stopped, !Task.isCancelled, !self.outbound.isEmpty {
        let text = self.outbound.removeFirst()
        do {
          try await connection.send(.text(text))
        } catch {
          self.fail(.dropped("outbound write failed"))
          return
        }
        guard !self.stopped else { return }
        self.bufferedMessages -= 1
        self.bufferedBytes -= text.utf8.count
      }
      self.writer = nil
    }
  }

  func close() {
    guard !stopped else { return }
    stopped = true
    phase = .closed
    heartbeat?.cancel()
    heartbeat = nil
    discardWrites()
    pump?.cancel()
    pump = nil
    let connection = self.connection
    self.connection = nil
    Task { await connection?.close() }
  }

  // MARK: Private

  private func adopt(_ connection: any RoutedLegConnection) {
    guard !stopped else {
      Task { await connection.close() }
      return
    }
    self.connection = connection
  }

  /// One inbound frame. Returns true when the pump should stop.
  private func receive(_ frame: RoutedLegFrame) -> Bool {
    guard !stopped else { return true }
    switch frame {
    case .binary(let data):
      // Binary before an accept is not a hello, and the first frame must be one.
      guard case .accepted = phase else {
        fail(.protocolViolation("a binary frame arrived before the accept"))
        return true
      }
      guard channel == .frames else {
        fail(.protocolViolation("a binary frame arrived on the control leg"))
        return true
      }
      callbacks.onBinary(data)
      return false
    case .text(let text):
      let allowed = RoutedLegVocabulary.inbound(channel)
      let message: RoutedTaggedMessage
      do {
        message = try RoutedWire.decode(text, allowed: allowed)
      } catch {
        fail(.protocolViolation(String(describing: error)))
        return true
      }
      switch message.type {
      case .connectionAccepted:
        return !accept(message.body)
      case .connectionRefused:
        guard let refusal = try? RoutedConnectionRefused(json: message.body) else {
          fail(.protocolViolation("a refusal this client could not read"))
          return true
        }
        phase = .refused(refusal.code)
        callbacks.onRefused(refusal)
        return true
      case .legHeartbeatAck:
        // The ack is READ, not required: the cell's own liveness rule is that IT
        // must hear from US inside the TTL, and this client keeps its own
        // deadline on the socket rather than on an ack that a busy cell may
        // batch behind frames.
        return false
      default:
        guard case .accepted = phase else {
          fail(.protocolViolation("\(message.type.rawValue) arrived before the accept"))
          return true
        }
        callbacks.onText(message.type, message.body)
        return false
      }
    }
  }

  /// Returns false when the accept was refused by this side.
  private func accept(_ body: JSONValue) -> Bool {
    guard let accepted = try? RoutedConnectionAccepted(json: body) else {
      fail(.protocolViolation("an accept this client could not read"))
      return false
    }
    guard accepted.channel == channel else {
      fail(.protocolViolation("the accept names the \(accepted.channel.rawValue) leg"))
      return false
    }
    guard accepted.protocolMajor == Int64(RoutedTerminalContract.protocolMajor) else {
      // The cell selects within the client's major or refuses; a DIFFERENT major
      // in an accept is the cell contradicting its own rule.
      fail(.protocolViolation("the accept selects protocol major \(accepted.protocolMajor)"))
      return false
    }
    self.accepted = accepted
    phase = .accepted
    startHeartbeat(ttlMs: accepted.heartbeatTtlMs, connectionSetId: accepted.connectionSetId,
      legGeneration: accepted.legGeneration)
    callbacks.onAccepted(accepted)
    return true
  }

  /// The cell re-arms its receipt deadline on a `LegHeartbeat` (or, on the
  /// frames leg, a `CalibrationPing`) and on NOTHING ELSE — not on credit, not
  /// on `SceneApplied`, not on input. So this beats unconditionally rather than
  /// only while idle: a busy leg that stopped beating would be closed `4004`
  /// mid-stream.
  private func startHeartbeat(ttlMs: Int64, connectionSetId: String, legGeneration: Int64) {
    heartbeat?.cancel()
    let interval = max(Self.minimumHeartbeatMs, Int(ttlMs) / Self.heartbeatDivisor)
    heartbeat = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(interval))
        if Task.isCancelled { return }
        await MainActor.run { [weak self] in
          guard let self, case .accepted = self.phase else { return }
          self.heartbeatSequence += 1
          self.send(
            .legHeartbeat,
            [
              "connectionSetId": .string(connectionSetId),
              "channel": .string(self.channel.rawValue),
              "legGeneration": .int(legGeneration),
              "sequence": .int(self.heartbeatSequence),
            ])
        }
      }
    }
  }

  private func fail(_ failure: RoutedLegFailure) {
    guard !stopped else { return }
    stopped = true
    phase = .failed(failure)
    heartbeat?.cancel()
    heartbeat = nil
    discardWrites()
    let connection = self.connection
    self.connection = nil
    Task { await connection?.close() }
    callbacks.onFailed(failure)
  }

  private func discardWrites() {
    writer?.cancel()
    writer = nil
    outbound.removeAll()
    bufferedMessages = 0
    bufferedBytes = 0
  }

  private static func body(_ value: JSONValue) -> [String: JSONValue] {
    value.objectValue ?? [:]
  }

  /// The cell names every post-authentication close; this is the name, for a
  /// face and a log. An unknown code is reported as its number rather than
  /// guessed at.
  static func name(of code: Int) -> String {
    switch code {
    case RoutedTerminalContract.CloseCode.policyPreAuth: "POLICY"
    case RoutedTerminalContract.CloseCode.serverError: "SERVER_ERROR"
    case RoutedTerminalContract.CloseCode.staleRoute: "STALE_ROUTE"
    case RoutedTerminalContract.CloseCode.fenced: "FENCED"
    case RoutedTerminalContract.CloseCode.superseded: "SUPERSEDED"
    case RoutedTerminalContract.CloseCode.protocolError: "PROTOCOL"
    case RoutedTerminalContract.CloseCode.legTimeout: "LEG_TIMEOUT"
    case 1000: "NORMAL"
    case 1001: "GOING_AWAY"
    default: "\(code)"
    }
  }
}
