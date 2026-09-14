import Foundation

/// One frame on a cell door. Both kinds ride both legs in ONE direction each:
/// the client sends only text (a binary message from a client is a `PROTOCOL`
/// close at the real door), and the cell sends text on both legs plus BINARY
/// presentation units on the frames leg.
public enum RoutedLegFrame: Sendable {
  case text(String)
  case binary(Data)
}

/// One live socket to a cell door.
///
/// A protocol rather than a `URLSessionWebSocketTask` in the client, for the
/// reason `ProductTransport` gives: the state machine is the part worth testing
/// and testing it should not want a server. Unlike `ProductConnection` this one
/// carries BINARY as itself — a presentation unit is not text and must never be
/// lossily decoded into some — and it can report the CLOSE CODE, because the
/// whole pre-authentication policy is a code with no body.
public protocol RoutedLegConnection: Sendable {
  func send(_ frame: RoutedLegFrame) async throws
  /// The next frame. Throws when the socket closes, which is how a leg learns it
  /// is gone; it never returns a sentinel for "closed".
  func receive() async throws -> RoutedLegFrame
  /// The code the peer closed with, once it has. `nil` while the socket is live
  /// or when the close carried none (a dropped TCP connection has no code —
  /// which is a different fact from a policy close, and the two must not be
  /// reported as each other).
  func closeCode() async -> Int?
  func close() async
}

public protocol RoutedLegTransport: Sendable {
  func connect(to url: URL) async throws -> any RoutedLegConnection
}

/// The real one: `URLSessionWebSocketTask` over the MESH's own session.
///
/// The session provider is the whole difference between reaching a desktop and
/// not: the phone's tailnet is a userspace netstack in this process, so a plain
/// `URLSession` sends a `100.x` dial nowhere. `FieldMesh`'s
/// `node.urlSession(configuration:)` is the one that routes, and it is injected
/// here exactly as `URLSessionProductTransport` takes it.
public struct URLSessionRoutedTransport: RoutedLegTransport {
  public typealias SessionProvider = @Sendable (URLSessionConfiguration) async throws -> URLSession

  private let configuration: URLSessionConfiguration
  private let provider: SessionProvider

  /// The biggest frame this client will take.
  ///
  /// `URLSessionWebSocketTask` defaults to 1 MiB and FAILS THE TASK past it —
  /// on this client a leg loss, a new credit epoch and a reseed, then the same
  /// oversized unit again, forever. A presentation unit is bounded by the CELL's
  /// `maxPresentationChunkBytes` (1 MiB at the registry's default, 256 KiB as
  /// the shipped cell announces), plus a header under 4 KiB. 4 MiB is four
  /// times the largest unit the contract permits — enough that a legitimate unit
  /// can never be refused, small enough that a defective or hostile door cannot
  /// spend this process's memory a message at a time.
  public static let maximumFrameBytes = 4 * 1024 * 1024

  public init(timeout: TimeInterval = 15, session: SessionProvider? = nil) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = timeout
    configuration.waitsForConnectivity = false
    self.configuration = configuration
    self.provider = session ?? { URLSession(configuration: $0) }
  }

  public func connect(to url: URL) async throws -> any RoutedLegConnection {
    let session = try await provider(configuration)
    let task = session.webSocketTask(with: url)
    task.maximumMessageSize = Self.maximumFrameBytes
    task.resume()
    return WebSocketLeg(task: task, session: session)
  }
}

/// An actor so the task's "one receive at a time" rule is structural rather than
/// a comment. Sends interleave with a receive in flight, which is the point of a
/// duplex socket, and actor reentrancy gives exactly that.
private actor WebSocketLeg: RoutedLegConnection {
  private let task: URLSessionWebSocketTask
  private let session: URLSession
  private var closed = false

  init(task: URLSessionWebSocketTask, session: URLSession) {
    self.task = task
    self.session = session
  }

  func send(_ frame: RoutedLegFrame) async throws {
    switch frame {
    case .text(let text): try await task.send(.string(text))
    case .binary(let data): try await task.send(.data(data))
    }
  }

  func receive() async throws -> RoutedLegFrame {
    let message = try await task.receive()
    switch message {
    case .string(let text): return .text(text)
    case .data(let data): return .binary(data)
    @unknown default:
      // A message kind this SDK does not name. It is not text and not a
      // presentation unit, so it is reported as an empty binary frame and the
      // leg's own decoder calls it a protocol error — never silently dropped.
      return .binary(Data())
    }
  }

  /// `URLSessionWebSocketTask.CloseCode` is an ObjC enum with no case for the
  /// 4000+ range the cell uses, so the RAW VALUE is what is read; `.invalid` (0)
  /// means the socket died without a close frame.
  func closeCode() -> Int? {
    let code = task.closeCode.rawValue
    return code == 0 ? nil : code
  }

  func close() {
    guard !closed else { return }
    closed = true
    task.cancel(with: .goingAway, reason: nil)
    session.invalidateAndCancel()
  }
}
