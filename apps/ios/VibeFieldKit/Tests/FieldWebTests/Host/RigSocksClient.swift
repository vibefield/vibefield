import Foundation
import Network

/// SP-4c's rig — a SOCKS5 client for the stand-in's own row (W4): user and password, ONE CONNECT by name, then whatever
/// the tunnel carries until it closes or `waitSeconds` runs out, counted and never kept.
enum RigSocksClient {
  struct Heard: Sendable {
    /// The CONNECT's reply code; 0xFF when no reply came.
    let code: UInt8
    /// The bytes the tunnel carried after the reply, before it closed.
    let after: Int
  }

  static func connect(port: UInt16, user: String, password: String, name: String, waitSeconds: Double)
    async throws -> Heard
  {
    let queue = DispatchQueue(label: "sp4c.rig.client")
    let connection = NWConnection(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port) ?? 9, using: .tcp)
    try await ready(connection, queue)
    defer { connection.cancel() }
    let none = Heard(code: 0xFF, after: 0)
    send(connection, [5, 1, 2])
    guard await receive(connection, exactly: 2) == [5, 2] else { return none }
    let user = Array(user.utf8)
    let password = Array(password.utf8)
    send(connection, [1, UInt8(user.count)] + user + [UInt8(password.count)] + password)
    guard await receive(connection, exactly: 2) == [1, 0] else { return none }
    let name = Array(name.utf8)
    send(connection, [5, 1, 0, 3, UInt8(name.count)] + name + [1, 187])
    guard let reply = await receive(connection, exactly: 10) else { return none }
    queue.asyncAfter(deadline: .now() + waitSeconds) { connection.cancel() }
    var after = 0
    while true {
      let chunk = await receiveSome(connection)
      after += chunk.count
      if chunk.closed { break }
    }
    return Heard(code: reply[1], after: after)
  }

  private struct Chunk: Sendable {
    let count: Int
    let closed: Bool
  }

  /// True the first time only; read on the client's one serial queue.
  private final class Once: @unchecked Sendable {
    private var fired = false

    func first() -> Bool {
      defer { fired = true }
      return !fired
    }
  }

  private static func ready(_ connection: NWConnection, _ queue: DispatchQueue) async throws {
    let once = Once()
    try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, any Error>) in
      connection.stateUpdateHandler = { state in
        switch state {
        case .ready:
          if once.first() { done.resume() }
        case .failed, .waiting, .cancelled:
          if once.first() { done.resume(throwing: URLError(.cannotConnectToHost)) }
        default: break
        }
      }
      connection.start(queue: queue)
    }
  }

  private static func send(_ connection: NWConnection, _ bytes: [UInt8]) {
    connection.send(content: Data(bytes), completion: .idempotent)
  }

  private static func receive(_ connection: NWConnection, exactly count: Int) async -> [UInt8]? {
    await withCheckedContinuation { (done: CheckedContinuation<[UInt8]?, Never>) in
      connection.receive(minimumIncompleteLength: count, maximumLength: count) { data, _, _, error in
        guard let data, data.count == count, error == nil else { return done.resume(returning: nil) }
        done.resume(returning: Array(data))
      }
    }
  }

  private static func receiveSome(_ connection: NWConnection) async -> Chunk {
    await withCheckedContinuation { (done: CheckedContinuation<Chunk, Never>) in
      connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, complete, error in
        done.resume(returning: Chunk(count: data?.count ?? 0, closed: complete || error != nil))
      }
    }
  }
}
