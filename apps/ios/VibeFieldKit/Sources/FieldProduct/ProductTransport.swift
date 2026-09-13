import Foundation

/// The contract facts this client speaks, pinned in ONE place.
///
/// `contractsVersion` mirrors `CONTRACTS_VERSION` in
/// `packages/contracts/src/index.ts`. It is not derived from anything at build
/// time — this app is deliberately outside `pnpm verify` and has no generator
/// pointed at it — so moving it is a deliberate event, like every other pin in
/// this repo, and a major mismatch is the door's to refuse (`INCOMPATIBLE`).
public enum FieldProductContract {
  public static let contractsVersion = "0.1.0"
  /// The oldest contracts version this client can work against. Same as the
  /// current one while the wire is pre-1.0: there is no older shape to be
  /// tolerant of yet, and claiming otherwise would be a promise nothing keeps.
  public static let minCompatible = "0.1.0"
  /// `ClientKind.ios` (`envelope.ts`). A CLAIM, and restrict-only: it can
  /// narrow what this connection may do and can never widen it.
  public static let clientKind = "ios"
}

/// One live socket to a product door.
///
/// A protocol rather than a `URLSessionWebSocketTask` in the client, because a
/// subscription state machine — snapshot, deltas, a drop, a fresh snapshot —
/// is the part worth testing, and testing it should not want a server.
public protocol ProductConnection: Sendable {
  func send(_ text: String) async throws
  /// The next frame. Throws when the socket closes, which is how the client
  /// learns to re-dial; it never returns a sentinel for "closed".
  func receive() async throws -> String
  func close() async
}

public protocol ProductTransport: Sendable {
  func connect(to url: URL) async throws -> any ProductConnection
}

/// The real one: `URLSessionWebSocketTask`.
public struct URLSessionProductTransport: ProductTransport {
  private let configuration: URLSessionConfiguration

  /// The request timeout is the PHONE's, not the desktop's: a radio that has
  /// wandered off the tailnet should fail a dial in seconds so the honest
  /// "reconnecting" face appears, rather than in the system default's minute.
  public init(timeout: TimeInterval = 15) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = timeout
    configuration.waitsForConnectivity = false
    self.configuration = configuration
  }

  public func connect(to url: URL) async throws -> any ProductConnection {
    let session = URLSession(configuration: configuration)
    let task = session.webSocketTask(with: url)
    task.resume()
    return WebSocketConnection(task: task, session: session)
  }
}

/// An actor so the task's own "one receive at a time" rule is structural rather
/// than a comment. Sends may interleave with a receive in flight, which is the
/// whole point of a duplex socket, and actor reentrancy gives exactly that.
private actor WebSocketConnection: ProductConnection {
  private let task: URLSessionWebSocketTask
  private let session: URLSession
  private var closed = false

  init(task: URLSessionWebSocketTask, session: URLSession) {
    self.task = task
    self.session = session
  }

  func send(_ text: String) async throws {
    try await task.send(.string(text))
  }

  func receive() async throws -> String {
    let message = try await task.receive()
    switch message {
    case .string(let text):
      return text
    case .data(let data):
      // The door speaks text frames. A binary one is not fatal — it is decoded
      // as UTF-8 and handed on, and the codec calls it unreadable if it is not.
      return String(data: data, encoding: .utf8) ?? ""
    @unknown default:
      return ""
    }
  }

  func close() {
    guard !closed else { return }
    closed = true
    task.cancel(with: .goingAway, reason: nil)
    session.invalidateAndCancel()
  }
}
