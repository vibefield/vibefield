import Foundation
import Testing

@testable import FieldProduct

// The review's rows: the replay that abandoned its siblings, the socket nobody
// closed, and the dial window three callers could walk through at once.

/// A connection that counts its own closes. The real one invalidates a
/// URLSession here, which is the only thing that ends a session — so "did the
/// client close what it walked away from" is a counting question.
private actor CountingConnection: ProductConnection {
  private let script: FakeDoor.Script
  private var queue: [String] = []
  private var waiter: CheckedContinuation<String, any Error>?
  private var failure: (any Error)?
  private(set) var closeCalls = 0

  init(script: @escaping FakeDoor.Script) { self.script = script }

  func send(_ text: String) async throws {
    if let failure { throw failure }
    guard let value = try? JSONValue.parse(Data(text.utf8)),
      let method = value["method"]?.stringValue
    else { return }
    let id = value["id"]?.intValue ?? -1
    for frame in script(method, id, value["params"] ?? .null) { deliver(frame) }
  }

  func receive() async throws -> String {
    if let failure, queue.isEmpty { throw failure }
    if !queue.isEmpty { return queue.removeFirst() }
    return try await withCheckedThrowingContinuation { waiter = $0 }
  }

  func close() { closeCalls += 1 }

  func deliver(_ text: String) {
    if let waiter {
      self.waiter = nil
      waiter.resume(returning: text)
    } else {
      queue.append(text)
    }
  }

  func drop() {
    guard failure == nil else { return }
    failure = FakeDoorError.dropped
    if let waiter {
      self.waiter = nil
      waiter.resume(throwing: FakeDoorError.dropped)
    }
  }

  var methods: [String] {
    []
  }
}

private actor CountingDoor: ProductTransport {
  private let script: FakeDoor.Script
  private var made: [CountingConnection] = []
  /// A dial that takes a beat, so the window `connect()` used to leave open is
  /// wide enough for a second caller to walk through.
  private let dialDelay: Duration

  init(dialDelay: Duration = .zero, script: @escaping FakeDoor.Script) {
    self.script = script
    self.dialDelay = dialDelay
  }

  func connect(to url: URL) async throws -> any ProductConnection {
    if dialDelay > .zero { try? await Task.sleep(for: dialDelay) }
    let connection = CountingConnection(script: script)
    made.append(connection)
    return connection
  }

  var dials: Int { made.count }
  func connection(_ index: Int) -> CountingConnection? {
    made.indices.contains(index) ? made[index] : nil
  }
  func closes() async -> Int {
    var total = 0
    for connection in made { total += await connection.closeCalls }
    return total
  }
}

@MainActor
private func waitFor(
  _ what: String, timeout: Duration = .seconds(5), _ condition: @MainActor () async -> Bool
) async throws {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if await condition() { return }
    try await Task.sleep(for: .milliseconds(2))
  }
  Issue.record("timed out waiting for \(what)")
}

private let liveAck = JSONValue.object([
  "contractsVersion": .string("0.1.0"), "serverKind": .string("fieldd"),
  "grantedScopes": .array([]),
])

@MainActor
@Suite struct ReplayLifetimeTests {
  /// THE BLOCKER. A door that refuses ONE board on the replay — a restarted
  /// desktop answering NOT_FOUND for a board that is gone — used to end the
  /// whole loop: every subscription after it went unsent, its route had been
  /// cleared with the socket, and the client sat in `.ready`. A frozen field
  /// under a state that said fine, for the life of that socket.
  ///
  /// Now the failure takes the socket down, and the re-dial replays all of
  /// them from the top.
  @Test func aRefusedReplayReDialsInsteadOfFreezingTheRest() async throws {
    let snapshot = JSONValue.object(["rows": .array([])])
    // Call 1 is the original subscribe and is answered; call 2 is the first
    // REPLAY and is refused — a restarted desktop that no longer has that
    // board; every later call is answered again.
    let calls = Tally()
    let door = FakeDoor { method, id, params in
      switch method {
      case "system.hello": return [Frame.result(id: id, liveAck)]
      case "a.subscribe":
        if calls.next() == 2 {
          return [Frame.failure(id: id, kind: "NOT_FOUND", message: "that board is gone")]
        }
        return [Frame.result(id: id, .object(["subId": .string("a"), "snapshot": snapshot]))]
      case "b.subscribe":
        return [Frame.result(id: id, .object(["subId": .string("b"), "snapshot": snapshot]))]
      default: return []
      }
    }
    let client = FieldProductClient(
      url: URL(string: "ws://door.test/t/x")!, transport: door,
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)))
    defer { client.close() }

    let a = Counter()
    let b = Counter()
    _ = try await client.subscribe(
      "a.subscribe", params: nil, onSnapshot: { _ in a.record(1) }, onDelta: { _ in })
    _ = try await client.subscribe(
      "b.subscribe", params: nil, onSnapshot: { _ in b.record(1) }, onDelta: { _ in })
    #expect(a.values.count == 1)
    #expect(b.values.count == 1)

    // The socket dies. The replay refuses `a` — and `b` must not be stranded.
    await door.connection(0)?.drop()
    try await waitFor("both boards back") { a.values.count >= 2 && b.values.count >= 2 }
    #expect(await door.dials >= 3)
    // And the client is not sitting in `.ready` pretending: it re-dialed and
    // came back up.
    if case .ready = client.state {} else {
      Issue.record("expected ready after the repair, got \(client.state)")
    }
  }

  /// A handle cancelled DURING a replay must not end the loop either: the
  /// boards after it in key order are still owned.
  @Test func aBoardCancelledMidReplayDoesNotStrandTheNextOne() async throws {
    let snapshot = JSONValue.object(["rows": .array([])])
    let door = FakeDoor { method, id, _ in
      switch method {
      case "system.hello": return [Frame.result(id: id, liveAck)]
      case "a.subscribe":
        return [Frame.result(id: id, .object(["subId": .string("a"), "snapshot": snapshot]))]
      case "b.subscribe":
        return [Frame.result(id: id, .object(["subId": .string("b"), "snapshot": snapshot]))]
      default: return []
      }
    }
    let client = FieldProductClient(
      url: URL(string: "ws://door.test/t/x")!, transport: door,
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)))
    defer { client.close() }

    let b = Counter()
    let a = try await client.subscribe(
      "a.subscribe", params: nil, onSnapshot: { _ in }, onDelta: { _ in })
    _ = try await client.subscribe(
      "b.subscribe", params: nil, onSnapshot: { _ in b.record(1) }, onDelta: { _ in })

    a.cancel()
    await door.connection(0)?.drop()
    try await waitFor("b replayed") { b.values.count >= 2 }
  }
}

@MainActor
@Suite struct SocketCloseTests {
  /// Close what you walk away from. The real transport's `connect` never
  /// throws — it builds a URLSession and returns a task at once — so a dial
  /// that never reaches a door still leaves a live session, and only `close()`
  /// ends one. Dropping the reference leaked one per backoff tick.
  @Test func everySocketTheClientAbandonsIsClosed() async throws {
    let door = CountingDoor { method, id, _ in
      method == "system.hello" ? [Frame.result(id: id, liveAck)] : []
    }
    let client = FieldProductClient(
      url: URL(string: "ws://door.test/t/x")!, transport: door,
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)))
    defer { client.close() }

    client.connect()
    try await waitFor("ready") { if case .ready = client.state { true } else { false } }

    await door.connection(0)?.drop()
    try await waitFor("a second dial") { await door.dials >= 2 }
    try await waitFor("the dead socket closed") { await door.closes() >= 1 }
  }

  /// A closed client's calls were never refused by a door, so what they are
  /// told is marked retryable: the caller's next door, a fresh client, may well
  /// answer. Three of its four sites said `false`, and the terminal's re-mint
  /// now ends a session on a refusal marked final (2026-10-19).
  @Test func aClosedClientsCallsMayBeAskedAgain() async throws {
    let door = FakeDoor { method, id, _ in
      method == "system.hello" ? [Frame.result(id: id, liveAck)] : []
    }
    let client = FieldProductClient(
      url: URL(string: "ws://door.test/t/x")!, transport: door,
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)))
    client.connect()
    try await waitFor("ready") { if case .ready = client.state { true } else { false } }

    // A call the door never answers, pending when the client closes.
    let pending = Task { try await client.call("never.answered") }
    try await Task.sleep(for: .milliseconds(50))
    client.close()
    do {
      _ = try await pending.value
      Issue.record("a call pending on a closed client must fail")
    } catch let refusal as FieldProductError {
      #expect(refusal.kind == "UNAVAILABLE")
      #expect(refusal.retryable)
    }
    // …and one made after the close.
    do {
      try await client.ready()
      Issue.record("a closed client is never ready")
    } catch let refusal as FieldProductError {
      #expect(refusal.retryable)
    }
  }
}

@MainActor
@Suite struct DialWindowTests {
  /// Three concurrent calls used to build three sockets: `connect()` guarded
  /// on `connection`, which is assigned only after the dial's await. Two were
  /// abandoned — and, before the close fix, never closed.
  @Test func threeConcurrentCallsBuildOneSocket() async throws {
    let door = CountingDoor(dialDelay: .milliseconds(60)) { method, id, _ in
      switch method {
      case "system.hello": return [Frame.result(id: id, liveAck)]
      default: return [Frame.result(id: id, .object([:]))]
      }
    }
    let client = FieldProductClient(
      url: URL(string: "ws://door.test/t/x")!, transport: door,
      options: .init(maxBackoff: .milliseconds(5), callTimeout: .seconds(5)))
    defer { client.close() }

    async let first = client.call("one")
    async let second = client.call("two")
    async let third = client.call("three")
    _ = try await (first, second, third)

    #expect(await door.dials == 1)
    #expect(await door.closes() == 0)
  }
}

/// A call counter a `@Sendable` script can advance.
private final class Tally: @unchecked Sendable {
  private let lock = NSLock()
  private var count = 0
  func next() -> Int {
    lock.lock()
    defer { lock.unlock() }
    count += 1
    return count
  }
}

@MainActor
private final class Counter {
  private(set) var values: [Int] = []
  func record(_ value: Int) { values.append(value) }
}
