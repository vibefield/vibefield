import Foundation
import Network

@testable import FieldWeb

/// Item 522's rig — the dials the page's front carries on with in the rows: each admitted CONNECT goes on to the
/// stand-in (`RigProxy`) by a CONNECT of its own, so the stand-in still sees, by class, everything the front lets
/// through, and a refused class reads as the stand-in seeing nothing of it while the front counts it.
enum RigDial {
  /// Both of the front's dials, to the stand-in on `port`.
  static func dials(port: UInt16, user: String, password: String) -> WebFrontDials {
    let dial: WebFrontDial = { host, to in
      try await RigDialStream.open(port: port, user: user, password: password, host: host, to: to)
    }
    return WebFrontDials(origin: dial, declared: dial)
  }
}

/// One tunnel through the stand-in: user and password, ONE CONNECT by name, then the bytes.
final class RigDialStream: WebFrontStream, @unchecked Sendable {
  private let connection: NWConnection
  private static let queue = DispatchQueue(label: "i522.rig.dial")

  private init(_ connection: NWConnection) {
    self.connection = connection
  }

  static func open(port: UInt16, user: String, password: String, host: String, to: UInt16) async throws
    -> RigDialStream
  {
    let stream = RigDialStream(
      NWConnection(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: port) ?? 9, using: .tcp))
    try await stream.ready()
    try await stream.write(Data([5, 1, 2]))
    guard try await stream.exactly(2) == [5, 2] else { throw stream.refused() }
    let user = Array(user.utf8)
    let password = Array(password.utf8)
    try await stream.write(Data([1, UInt8(user.count)] + user + [UInt8(password.count)] + password))
    guard try await stream.exactly(2) == [1, 0] else { throw stream.refused() }
    let name = Array(host.utf8)
    try await stream.write(Data([5, 1, 0, 3, UInt8(name.count)] + name + [UInt8(to >> 8), UInt8(to & 0xFF)]))
    guard try await stream.exactly(10)[1] == 0 else { throw stream.refused() }
    return stream
  }

  private func refused() -> URLError {
    connection.cancel()
    return URLError(.cannotConnectToHost)
  }

  private func ready() async throws {
    let once = WebFrontOnce()
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
      connection.start(queue: Self.queue)
    }
  }

  private func exactly(_ count: Int) async throws -> [UInt8] {
    try await withCheckedThrowingContinuation { (done: CheckedContinuation<[UInt8], any Error>) in
      connection.receive(minimumIncompleteLength: count, maximumLength: count) { data, _, _, error in
        guard let data, data.count == count, error == nil else {
          return done.resume(throwing: URLError(.cannotConnectToHost))
        }
        done.resume(returning: Array(data))
      }
    }
  }

  func read(_ max: Int) async throws -> Data? {
    try await withCheckedThrowingContinuation { (done: CheckedContinuation<Data?, any Error>) in
      connection.receive(minimumIncompleteLength: 1, maximumLength: max) { data, _, complete, error in
        if let data, !data.isEmpty { return done.resume(returning: data) }
        if let error { return done.resume(throwing: error) }
        done.resume(returning: complete ? nil : Data())
      }
    }
  }

  func write(_ data: Data) async throws {
    try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, any Error>) in
      connection.send(
        content: data,
        completion: .contentProcessed { error in
          if let error { done.resume(throwing: error) } else { done.resume() }
        })
    }
  }

  func close() async {
    connection.cancel()
  }
}
