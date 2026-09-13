import Foundation

@testable import FieldProduct

/// A product door made of a script.
///
/// The point of the transport seam: everything worth testing about this client
/// is ORDER — hello before calls, the route installed before the caller wakes,
/// one reconnect timer, a fresh snapshot on every re-dial — and none of it
/// wants a server. Each dial mints a NEW connection, which is what lets a test
/// assert that a reconnect really re-dialed rather than reusing a corpse.
actor FakeDoor: ProductTransport {
  /// What the door says when a request arrives. Returns the frames to deliver,
  /// in order; an empty array is a door that heard the request and said nothing
  /// (which is how a timeout is tested).
  typealias Script = @Sendable (_ method: String, _ id: Int64, _ params: JSONValue) -> [String]

  private let script: Script
  private var connections: [FakeConnection] = []
  private var dialFailures = 0
  private var dialAttempts = 0

  init(script: @escaping Script) {
    self.script = script
  }

  func connect(to url: URL) async throws -> any ProductConnection {
    dialAttempts += 1
    if dialFailures > 0 {
      dialFailures -= 1
      throw FakeDoorError.refused
    }
    let connection = FakeConnection(script: script)
    connections.append(connection)
    return connection
  }

  /// How many times a client has dialed this door — INCLUDING the dials that
  /// never reached a socket, because "it kept trying" is the thing a backoff
  /// test is asking about.
  var dials: Int { dialAttempts }

  /// How many of those dials produced a socket.
  var sockets: Int { connections.count }

  var latest: FakeConnection? { connections.last }

  func connection(_ index: Int) -> FakeConnection? {
    connections.indices.contains(index) ? connections[index] : nil
  }

  /// Refuse the next `count` dials at the socket, before any hello.
  func refuseDials(_ count: Int) { dialFailures = count }
}

enum FakeDoorError: Error, Equatable {
  case refused
  case dropped
}

actor FakeConnection: ProductConnection {
  private let script: FakeDoor.Script
  private var queue: [String] = []
  private var waiter: CheckedContinuation<String, any Error>?
  private var failure: (any Error)?
  private var sentFrames: [String] = []

  init(script: @escaping FakeDoor.Script) {
    self.script = script
  }

  // MARK: ProductConnection

  func send(_ text: String) async throws {
    if let failure { throw failure }
    sentFrames.append(text)
    guard let value = try? JSONValue.parse(Data(text.utf8)),
      let method = value["method"]?.stringValue
    else { return }
    let id = value["id"]?.intValue ?? -1
    for frame in script(method, id, value["params"] ?? .null) { deliver(frame) }
  }

  func receive() async throws -> String {
    if let failure, queue.isEmpty { throw failure }
    if !queue.isEmpty { return queue.removeFirst() }
    return try await withCheckedThrowingContinuation { continuation in
      waiter = continuation
    }
  }

  func close() {
    drop(FakeDoorError.dropped)
  }

  // MARK: The test's side

  /// Push a frame the client did not ask for — a delta, or a snapshot the
  /// server re-sent of its own accord.
  func deliver(_ text: String) {
    if let waiter {
      self.waiter = nil
      waiter.resume(returning: text)
    } else {
      queue.append(text)
    }
  }

  /// The socket dies. The receive loop learns it the way a real one does.
  func drop(_ error: any Error = FakeDoorError.dropped) {
    guard failure == nil else { return }
    failure = error
    if let waiter {
      self.waiter = nil
      waiter.resume(throwing: error)
    }
  }

  /// Every request frame this connection was sent, as methods.
  var methods: [String] {
    sentFrames.compactMap { frame in
      guard let value = try? JSONValue.parse(Data(frame.utf8)) else { return nil }
      return value["method"]?.stringValue
    }
  }

  var frames: [String] { sentFrames }
}

// MARK: - Frames a door sends

enum Frame {
  static func result(id: Int64, _ value: JSONValue) -> String {
    encode(.object(["jsonrpc": .string("2.0"), "id": .int(id), "result": value]))
  }

  static func failure(
    id: Int64, kind: String, message: String, retryable: Bool = false,
    details: JSONValue? = nil, code: Int64 = -32000
  ) -> String {
    var data: [String: JSONValue] = [
      "kind": .string(kind), "retryable": .bool(retryable),
    ]
    if let details { data["details"] = details }
    return encode(
      .object([
        "jsonrpc": .string("2.0"), "id": .int(id),
        "error": .object([
          "code": .int(code), "message": .string(message), "data": .object(data),
        ]),
      ]))
  }

  static func subscriptionEvent(
    method: String, subId: String, payload: JSONValue
  ) -> String {
    encode(
      .object([
        "jsonrpc": .string("2.0"), "method": .string(method),
        "params": .object(["subId": .string(subId), "payload": payload]),
      ]))
  }

  static func notification(method: String, params: JSONValue = .object([:])) -> String {
    encode(.object(["jsonrpc": .string("2.0"), "method": .string(method), "params": params]))
  }

  static func encode(_ value: JSONValue) -> String {
    String(data: (try? value.encoded()) ?? Data(), encoding: .utf8) ?? ""
  }
}

// MARK: - Fixtures

enum Fixture {
  static func json(_ name: String) throws -> JSONValue {
    guard let url = Bundle.module.url(forResource: name, withExtension: "json",
      subdirectory: "Fixtures")
    else {
      throw FixtureError.missing(name)
    }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  enum FixtureError: Error, CustomStringConvertible {
    case missing(String)

    var description: String {
      switch self {
      case .missing(let name): "fixture `\(name).json` is not in the test bundle"
      }
    }
  }
}
