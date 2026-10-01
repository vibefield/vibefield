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
  /// SP-1/SP-2 — the door's keepalive NOTIFICATION (no `id`):
  /// `{method: "system.tick", params: {at, intervalMs}}`, sent on every hello'd
  /// connection every `intervalMs`.
  public static let tickMethod = "system.tick"
  /// The door's tick interval until its first `system.tick` names one —
  /// `PRODUCT_API_LIMITS.TICK_INTERVAL_MS` in `registries.ts` (SP-1's row, built
  /// by its own lane). `pnpm check:ios-fixtures` arms its pin on this literal the
  /// day that row is readable, and prints a NOTICE until then.
  public static let doorTickIntervalMs: Int64 = 120_000
}

/// A connection that cannot send a WebSocket ping says so — it never reports a
/// pong it did not hear.
public struct ProductPingUnsupported: Error, Sendable, Equatable {
  public init() {}
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
  /// SP-2 (b) — one WebSocket protocol PING, returning when its PONG arrives
  /// and throwing if the socket fails first.
  ///
  /// The phone's half of the keepalive. The sidecar that serves a desktop's
  /// door reaps each DIRECTION of a served WebSocket after ten silent minutes
  /// (truffle `sidecar-slim` `idleCopy`, fixed for served sockets), so a phone
  /// whose board is idle — and which therefore sends nothing — loses its half
  /// even while the door ticks. A ping is bytes in the phone's direction and its
  /// pong is bytes in the door's, and fieldd's server answers every ping on its
  /// own (`ws` `autoPong`), so the door needs no method for it.
  func ping() async throws
}

extension ProductConnection {
  /// A connection with no ping of its own. The client treats this as "no pong
  /// to count", never as a broken socket.
  public func ping() async throws {
    throw ProductPingUnsupported()
  }
}

public protocol ProductTransport: Sendable {
  func connect(to url: URL) async throws -> any ProductConnection
}

/// The real one: `URLSessionWebSocketTask`.
///
/// The SESSION is injected, and that is not a testing seam — it is the whole
/// difference between reaching a desktop and not. This phone's tailnet runs
/// IN PROCESS (TailscaleKit, userspace netstack), so a plain
/// `URLSession(configuration:)` does not route over it: a `100.x` address goes
/// nowhere, and a MagicDNS name resolves — if it resolves at all — on the
/// device's ordinary network to whatever the public DNS says. truffle hands
/// out a session bound to its own backend (`MeshNode.urlSession(configuration:)`),
/// and FieldMesh passes it in. The default below is the system's, which is
/// right for a loopback door and wrong for a tailnet one.
public struct URLSessionProductTransport: ProductTransport {
  /// How a session is obtained for a dial. Async because truffle's is.
  public typealias SessionProvider = @Sendable (URLSessionConfiguration) async throws -> URLSession

  private let configuration: URLSessionConfiguration
  private let provider: SessionProvider

  /// The request timeout is the PHONE's, not the desktop's: a radio that has
  /// wandered off the tailnet should fail a dial in seconds so the honest
  /// "reconnecting" face appears, rather than in the system default's minute.
  public init(timeout: TimeInterval = 15, session: SessionProvider? = nil) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = timeout
    configuration.waitsForConnectivity = false
    self.configuration = configuration
    self.provider = session ?? { URLSession(configuration: $0) }
  }

  /// The biggest frame this phone will take.
  ///
  /// `URLSessionWebSocketTask` defaults to 1 MiB and FAILS THE TASK past it,
  /// which on this client is a drop and a re-dial — and the same oversized
  /// snapshot again, forever. The door's own outbound ceiling is
  /// `MESH_CONTROL_LIMITS.PRODUCT_FRAME_BYTES`, 128 MiB, and matching it is
  /// the wrong trade on a phone: 128 MiB of somebody else's bytes into this
  /// process's memory is a worse failure than a refused frame. 16 MiB is far
  /// above any legitimate product frame for a phone — the field projection is
  /// ~300–500 B a row, and `agent.list`'s full rows are 2–5 KB each — so a
  /// frame past it is a defect or an attack, and either way the honest answer
  /// is to refuse it rather than to keep asking for it.
  public static let maximumFrameBytes = 16 * 1024 * 1024

  public func connect(to url: URL) async throws -> any ProductConnection {
    let session = try await provider(configuration)
    let task = session.webSocketTask(with: url)
    task.maximumMessageSize = Self.maximumFrameBytes
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

  /// SP-2 (b) — RFC 6455's PING. The system calls the handler exactly once:
  /// with nothing when the PONG arrives, with an error when the connection is
  /// lost first — so a closed socket answers at once and never strands this.
  func ping() async throws {
    try await withCheckedThrowingContinuation { (pong: CheckedContinuation<Void, any Error>) in
      task.sendPing { error in
        if let error {
          pong.resume(throwing: error)
        } else {
          pong.resume()
        }
      }
    }
  }
}
