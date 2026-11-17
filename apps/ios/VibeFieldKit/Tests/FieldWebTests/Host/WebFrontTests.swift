import Foundation
import Network
import Testing

@testable import FieldWeb

/// Item 522 — the front itself, on loopback, with no web view and no rig identity: which dial carries each admitted
/// CONNECT and the name it is handed; that everything else is answered before any dial; what a client that never
/// brings a CONNECT gets; and that every dial is owned to its end. A declared host goes by the system's own dial and
/// never the mesh's: a name behind a tailnet subnet route, or one only the tailnet's DNS answers, no longer reaches
/// through the page (a change from tsnet's proxy, as item 373 wants it). With the system's own VPN up, a declared name
/// that resolves into the tailnet's range still goes in, as any app's connection does: item 373's.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("522 — the front at its socket", .serialized, .timeLimit(.minutes(1)))
struct WebFrontTests {
  static let policy = WebNavigationPolicy(
    origin: WebOrigin(claim: "https://studio.tail1234.ts.net:13377")!, reach: ["declared.example"])

  /// How a row's dials answer: each fails, or each gives a stream after a while.
  enum Answer: Sendable {
    case fail
    case stream(after: Duration)
  }

  /// Every dial asked, in order ("which name:port"), and the streams the dials gave.
  final class Asked: @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [String] = []
    private var made: [Fake] = []

    func add(_ call: String) { lock.withLock { calls.append(call) } }
    func keep(_ stream: Fake) { lock.withLock { made.append(stream) } }
    var all: [String] { lock.withLock { calls } }
    var streams: [Fake] { lock.withLock { made } }
  }

  /// A stream whose reads wait until it is closed or ended from its far side; it keeps what it is sent and counts its
  /// closes.
  final class Fake: WebFrontStream, @unchecked Sendable {
    private let lock = NSLock()
    private var closes = 0
    private var ended = false
    private var bytes = Data()
    private var waiter: CheckedContinuation<Data?, Never>?

    var closed: Int { lock.withLock { closes } }
    var written: Data { lock.withLock { bytes } }

    func read(_ max: Int) async throws -> Data? {
      await withCheckedContinuation { (done: CheckedContinuation<Data?, Never>) in
        let now: Bool = lock.withLock {
          if ended || closes > 0 { return true }
          waiter = done
          return false
        }
        if now { done.resume(returning: nil) }
      }
    }

    func write(_ data: Data) async throws { lock.withLock { bytes.append(data) } }

    func close() async {
      lock.withLock { closes += 1 }
      wake()
    }

    /// Ends the stream from its far side: its read answers nil.
    func end() {
      lock.withLock { ended = true }
      wake()
    }

    private func wake() {
      let waiting: CheckedContinuation<Data?, Never>? = lock.withLock {
        defer { waiter = nil }
        return waiter
      }
      waiting?.resume(returning: nil)
    }
  }

  static func dials(_ asked: Asked, _ answer: Answer) -> WebFrontDials {
    let dial: @Sendable (String) -> WebFrontDial = { kind in
      { host, port in
        asked.add("\(kind) \(host):\(port)")
        switch answer {
        case .fail:
          throw URLError(.cannotConnectToHost)
        case .stream(let after):
          try await Task.sleep(for: after)
          let stream = Fake()
          asked.keep(stream)
          return stream
        }
      }
    }
    return WebFrontDials(origin: dial("origin"), declared: dial("declared"))
  }

  /// A started front for one row, its dials answering as `answer` says.
  static func started(
    _ answer: Answer, deadline: DispatchTimeInterval = WebFront.handshakeDeadline,
    dialDeadline: DispatchTimeInterval = WebFront.dialDeadline, cap: Int = WebFront.maxClients
  ) async throws -> (front: WebFront, asked: Asked, port: UInt16) {
    let asked = Asked()
    let front = WebFront(
      rule: WebFrontRule(policy: policy), dials: dials(asked, answer), deadline: deadline, dialDeadline: dialDeadline,
      cap: cap)
    _ = try await front.start()
    let port = try #require(front.port)
    return (front, asked, port)
  }

  /// The greeting and the credential, as the page's own client sends them.
  static func hello(_ front: WebFront) -> [UInt8] {
    let user = Array(front.user.utf8)
    let secret = Array(front.password.utf8)
    return [5, 1, 2, 1, UInt8(user.count)] + user + [UInt8(secret.count)] + secret
  }

  /// One request: its command (1, CONNECT), its address type and bytes, its port.
  static func ask(_ command: UInt8, _ atyp: UInt8, _ address: [UInt8], port: UInt16 = 443) -> [UInt8] {
    [5, command, 0, atyp] + address + [UInt8(port >> 8), UInt8(port & 0xFF)]
  }

  /// A name as SOCKS5 carries it: its length, then its bytes.
  static func named(_ name: [UInt8]) -> [UInt8] { [UInt8(name.count)] + name }

  /// The CONNECT to the declared host, after the greeting and the credential.
  static func toDeclared(_ front: WebFront) -> [UInt8] {
    hello(front) + ask(1, 3, named(Array("declared.example".utf8)))
  }

  /// Waits up to `seconds` for `done`.
  static func until(_ seconds: Double, _ done: () -> Bool) async throws {
    let clock = ContinuousClock()
    let end = clock.now + .milliseconds(Int(seconds * 1000))
    while !done(), clock.now < end { try await Task.sleep(for: .milliseconds(20)) }
  }

  /// This machine's own IPv4 addresses that are up and not loopback, numerically.
  static func ownAddresses() -> [String] {
    var list: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&list) == 0, let first = list else { return [] }
    defer { freeifaddrs(list) }
    var found: [String] = []
    for entry in sequence(first: first, next: { $0.pointee.ifa_next }) {
      let flags = Int32(entry.pointee.ifa_flags)
      guard let address = entry.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_INET),
        flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0
      else { continue }
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      let named = getnameinfo(
        address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST)
      guard named == 0 else { continue }
      found.append(String(decoding: host.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self))
    }
    return found
  }

  /// Whether a plain TCP connection to `host` at `port` is made within two seconds.
  static func reaches(_ host: String, _ port: UInt16) async -> Bool {
    guard let to = NWEndpoint.Port(rawValue: port) else { return false }
    let connection = NWConnection(host: NWEndpoint.Host(host), port: to, using: .tcp)
    let queue = DispatchQueue(label: "i522.rig.reach")
    let once = WebFrontOnce()
    let made = await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
      connection.stateUpdateHandler = { state in
        switch state {
        case .ready:
          if once.first() { done.resume(returning: true) }
        case .failed, .waiting, .cancelled:
          if once.first() { done.resume(returning: false) }
        default: break
        }
      }
      connection.start(queue: queue)
      queue.asyncAfter(deadline: .now() + 2) { if once.first() { done.resume(returning: false) } }
    }
    connection.cancel()
    return made
  }

  @Test("the origin by the mesh's dial, a declared host by the system's, each handed the policy's own name")
  func dialChoice() async throws {
    let (front, asked, port) = try await Self.started(.fail)
    defer { front.stop() }
    let tries: [(String, UInt16, UInt8)] = [
      ("studio.tail1234.ts.net", 13377, 5),
      ("declared.example", 443, 5),
      ("declared.example", 8443, 5),
      ("Declared.Example.", 443, 5),
      ("studio.tail1234.ts.net", 443, 2),
      ("other.tail1234.ts.net", 13377, 2),
      ("undeclared.example.org", 443, 2),
    ]
    for (name, at, want) in tries {
      let heard = try await RigSocksClient.connect(
        port: port, user: front.user, password: front.password, name: name, at: at, waitSeconds: 1)
      #expect(heard.code == want, "\(name):\(at)")
      #expect(heard.after == 0, "\(name):\(at)")
    }
    let counts = front.counts
    let order = asked.all
    print("I522-F asked=\(order.count) counts=\(counts)")
    #expect(
      order == [
        "origin studio.tail1234.ts.net:13377", "declared declared.example:443", "declared declared.example:8443",
        "declared declared.example:443",
      ])
    #expect(counts.origin == 1)
    #expect(counts.declared == 3)
    #expect(counts.unreached == 4)
    #expect(counts.refused == [.port: 1, .tailnet: 1, .undeclared: 1])
  }

  @Test("addresses and odd names over the socket are refused, undialled")
  func oddNames() async throws {
    let (front, asked, port) = try await Self.started(.fail)
    defer { front.stop() }
    let long = Array(String(repeating: "a", count: 251).utf8) + Array(".org".utf8)
    let requests: [[UInt8]] = [
      Self.ask(1, 1, [127, 0, 0, 1]),
      Self.ask(1, 4, [UInt8](repeating: 0, count: 15) + [1]),
      Self.ask(1, 3, Self.named(Array("127.0.0.1".utf8))),
      Self.ask(1, 3, Self.named(Array("0x7f.0x1".utf8))),
      Self.ask(1, 3, Self.named([])),
      Self.ask(1, 3, Self.named(long)),
      Self.ask(1, 3, Self.named([0xFF, 0xFE, 0xFD])),
      Self.ask(1, 3, Self.named(Array(".declared.example".utf8))),
    ]
    for (index, request) in requests.enumerated() {
      let heard = try await RigSocksClient.raw(
        port: port, send: Self.hello(front) + request, read: 14, waitSeconds: 2)
      let code = heard.count == 14 ? heard[5] : 0xFF
      #expect(code == 2, "request \(index)")
    }
    let counts = front.counts
    let order = asked.all
    #expect(order.isEmpty)
    #expect(counts.refused == [.address: 4, .undeclared: 4])
  }

  @Test("BIND, UDP ASSOCIATE and an unknown address type are answered and counted, undialled")
  func commands() async throws {
    let (front, asked, port) = try await Self.started(.fail)
    defer { front.stop() }
    let name = Self.named(Array("declared.example".utf8))
    let cases: [([UInt8], UInt8)] = [(Self.ask(2, 3, name), 7), (Self.ask(3, 3, name), 7), (Self.ask(1, 9, []), 8)]
    for (request, want) in cases {
      let heard = try await RigSocksClient.raw(
        port: port, send: Self.hello(front) + request, read: 14, waitSeconds: 2)
      let code = heard.count == 14 ? heard[5] : 0xFF
      #expect(code == want)
    }
    let counts = front.counts
    let order = asked.all
    #expect(order.isEmpty)
    #expect(counts.handshake == [.command: 2, .addressType: 1])
  }

  @Test("no credential method, a wrong credential, and a request before the credential are refused")
  func credentials() async throws {
    let (front, asked, port) = try await Self.started(.fail)
    defer { front.stop() }
    let user = Array(front.user.utf8)
    let wrong = Array(Array(front.password.utf8).dropLast()) + [UInt8(ascii: "x")]
    let request = Self.ask(1, 3, Self.named(Array("declared.example".utf8)))
    let none = try await RigSocksClient.raw(port: port, send: [5, 1, 0], read: 2, waitSeconds: 2)
    let bad = try await RigSocksClient.raw(
      port: port, send: [5, 1, 2, 1, UInt8(user.count)] + user + [UInt8(wrong.count)] + wrong, read: 4,
      waitSeconds: 2)
    let early = try await RigSocksClient.raw(port: port, send: [5, 1, 2] + request, read: 4, waitSeconds: 2)
    #expect(none == [5, 0xFF])
    #expect(bad == [5, 2, 1, 1])
    #expect(early == [5, 2, 1, 1])
    let counts = front.counts
    let order = asked.all
    #expect(order.isEmpty)
    #expect(counts.handshake == [.method: 1, .credential: 2])
  }

  @Test("bytes sent ahead of the reply to a refused CONNECT are dropped, undialled")
  func earlyBytes() async throws {
    let (front, asked, port) = try await Self.started(.fail)
    defer { front.stop() }
    let request = Self.ask(1, 3, Self.named(Array("undeclared.example.org".utf8)))
    let heard = try await RigSocksClient.raw(
      port: port, send: Self.hello(front) + request + Array("GET / HTTP/1.1\r\n\r\n".utf8), read: 14, waitSeconds: 2)
    let code = heard.count == 14 ? heard[5] : 0xFF
    let counts = front.counts
    let order = asked.all
    #expect(code == 2)
    #expect(order.isEmpty)
    #expect(counts.refused == [.undeclared: 1])
  }

  @Test("bytes sent ahead of the reply to an admitted CONNECT reach its stream whole")
  func earlyBytesAdmitted() async throws {
    let (front, asked, port) = try await Self.started(.stream(after: .zero))
    defer { front.stop() }
    let early = Array("GET / HTTP/1.1\r\nHost: declared.example\r\n\r\n".utf8)
    let heard = try await RigSocksClient.raw(port: port, send: Self.toDeclared(front) + early, read: 14, waitSeconds: 2)
    try await Self.until(2) { asked.streams.first?.written.count == early.count }
    let code = heard.count == 14 ? heard[5] : 0xFF
    let written = asked.streams.first?.written
    #expect(code == 0)
    #expect(written == Data(early))
  }

  @Test("the listener answers on loopback alone: not at this machine's own other address; a taken port throws")
  func bind() async throws {
    let (front, _, port) = try await Self.started(.fail)
    defer { front.stop() }
    let bound = front.bound
    var loopback = false
    if case .hostPort(let host, _)? = bound.endpoint { loopback = host == .ipv4(.loopback) }
    #expect(loopback)
    #expect(bound.interface == .loopback)
    let onLoopback = await Self.reaches("127.0.0.1", port)
    #expect(onLoopback)
    if let other = Self.ownAddresses().first {
      let reached = await Self.reaches(other, port)
      print("I522-BIND exercised at a non-loopback address: reached=\(reached)")
      #expect(!reached)
    } else {
      print("I522-BIND not exercised: this machine has no non-loopback IPv4 address")
    }
    let second = WebFront(rule: WebFrontRule(policy: Self.policy), dials: Self.dials(Asked(), .fail))
    let taken = try #require(NWEndpoint.Port(rawValue: port))
    await #expect(throws: WebFront.Failure.listener) {
      _ = try await second.start(port: taken)
    }
    second.stop()
  }

  @Test("stop() with an open tunnel ends its client at once and closes its stream, once")
  func stopWithTunnel() async throws {
    let (front, asked, port) = try await Self.started(.stream(after: .zero))
    let user = front.user
    let password = front.password
    let client = Task {
      try await RigSocksClient.connect(
        port: port, user: user, password: password, name: "declared.example", waitSeconds: 5)
    }
    try await Self.until(2) { asked.streams.count == 1 }
    try await Task.sleep(for: .milliseconds(200))
    let clock = ContinuousClock()
    let stopped = clock.now
    front.stop()
    let heard = try await client.value
    let took = clock.now - stopped
    try await Task.sleep(for: .milliseconds(200))
    let streams = asked.streams
    let closed = streams.first?.closed
    #expect(heard.code == 0)
    #expect(took < .seconds(1))
    #expect(streams.count == 1)
    #expect(closed == 1)
  }

  @Test("a dial that comes back after stop() is closed, never tunnelled")
  func dialAfterStop() async throws {
    let (front, asked, port) = try await Self.started(.stream(after: .milliseconds(500)))
    let user = front.user
    let password = front.password
    let client = Task {
      try await RigSocksClient.connect(
        port: port, user: user, password: password, name: "declared.example", waitSeconds: 3)
    }
    try await Self.until(2) { asked.all.count == 1 }
    front.stop()
    let heard = try await client.value
    try await Self.until(2) { asked.streams.first?.closed == 1 }
    let closed = asked.streams.first?.closed
    #expect(heard.code == 0xFF)
    #expect(closed == 1)
  }

  @Test("a client gone before its reply: its dial is closed when it comes back")
  func clientGone() async throws {
    let (front, asked, port) = try await Self.started(.stream(after: .milliseconds(500)))
    defer { front.stop() }
    _ = try await RigSocksClient.raw(port: port, send: Self.toDeclared(front), read: 0, waitSeconds: 0.2)
    try await Self.until(2) { asked.streams.first?.closed == 1 }
    try await Task.sleep(for: .milliseconds(200))
    let closed = asked.streams.first?.closed
    let counts = front.counts
    #expect(closed == 1)
    #expect(counts.declared == 1)
  }

  @Test("the handshake's deadline ends at an admitted CONNECT: a dial longer than it still tunnels")
  func deadlineEndsAtConnect() async throws {
    let (front, asked, port) = try await Self.started(.stream(after: .milliseconds(500)), deadline: .milliseconds(100))
    defer { front.stop() }
    let heard = try await RigSocksClient.connect(
      port: port, user: front.user, password: front.password, name: "declared.example", waitSeconds: 1)
    let counts = front.counts
    let streams = asked.streams.count
    #expect(heard.code == 0)
    #expect(streams == 1)
    #expect(counts.handshake[.deadline] == nil)
  }

  @Test("a dial that outlasts its own deadline: its client is let go, and its stream closed when it comes")
  func dialDeadline() async throws {
    let (front, asked, port) = try await Self.started(
      .stream(after: .milliseconds(800)), dialDeadline: .milliseconds(200))
    defer { front.stop() }
    let clock = ContinuousClock()
    let began = clock.now
    let heard = try await RigSocksClient.connect(
      port: port, user: front.user, password: front.password, name: "declared.example", waitSeconds: 3)
    let took = clock.now - began
    try await Self.until(2) { asked.streams.first?.closed == 1 }
    let closed = asked.streams.first?.closed
    let counts = front.counts
    #expect(heard.code == 0xFF)
    #expect(took < .milliseconds(700))
    #expect(closed == 1)
    #expect(counts.abandoned == 1)
  }

  @Test("the front closes each tunnel's stream once: the client ending first")
  func closeOnce() async throws {
    let (front, asked, port) = try await Self.started(.stream(after: .zero))
    defer { front.stop() }
    let heard = try await RigSocksClient.raw(port: port, send: Self.toDeclared(front), read: 14, waitSeconds: 2)
    try await Self.until(2) { asked.streams.first?.closed == 1 }
    try await Task.sleep(for: .milliseconds(200))
    let code = heard.count == 14 ? heard[5] : 0xFF
    let closed = asked.streams.first?.closed
    #expect(code == 0)
    #expect(closed == 1)
  }

  @Test("the front closes each tunnel's stream once: its far side ending first, the client let go with it")
  func upstreamEnds() async throws {
    let (front, asked, port) = try await Self.started(.stream(after: .zero))
    defer { front.stop() }
    let user = front.user
    let password = front.password
    let client = Task {
      try await RigSocksClient.connect(
        port: port, user: user, password: password, name: "declared.example", waitSeconds: 5)
    }
    try await Self.until(2) { asked.streams.count == 1 }
    try await Task.sleep(for: .milliseconds(200))
    let clock = ContinuousClock()
    let ended = clock.now
    asked.streams.first?.end()
    let heard = try await client.value
    let took = clock.now - ended
    try await Task.sleep(for: .milliseconds(200))
    let closed = asked.streams.first?.closed
    #expect(heard.code == 0)
    #expect(took < .seconds(1))
    #expect(closed == 1)
  }

  @Test("a client that brings no CONNECT by its deadline is let go")
  func deadline() async throws {
    let (front, _, port) = try await Self.started(.fail, deadline: .milliseconds(300))
    defer { front.stop() }
    async let first = (try? await RigSocksClient.raw(port: port, send: [], read: 1, waitSeconds: 3)) ?? []
    async let second = (try? await RigSocksClient.raw(port: port, send: [5, 1, 2], read: 3, waitSeconds: 3)) ?? []
    _ = await (first, second)
    let counts = front.counts
    #expect(counts.handshake == [.deadline: 2])
  }

  @Test("full: the oldest client without the credential is let go for a newcomer, which is taken")
  func capLetsGoTheOldest() async throws {
    let (front, _, port) = try await Self.started(.fail, cap: 2)
    defer { front.stop() }
    let first = Task { (try? await RigSocksClient.raw(port: port, send: [], read: 1, waitSeconds: 5)) ?? [] }
    let second = Task { (try? await RigSocksClient.raw(port: port, send: [], read: 1, waitSeconds: 5)) ?? [] }
    try await Task.sleep(for: .milliseconds(200))
    let heard = try await RigSocksClient.connect(
      port: port, user: front.user, password: front.password, name: "declared.example", waitSeconds: 1)
    let counts = front.counts
    first.cancel()
    second.cancel()
    #expect(heard.code == 5)
    #expect(counts.handshake == [.full: 1])
    #expect(counts.unreached == 1)
  }

  @Test("full of clients past the credential: a newcomer is turned away")
  func capFull() async throws {
    let (front, asked, port) = try await Self.started(.stream(after: .seconds(3)), cap: 2)
    defer { front.stop() }
    let user = front.user
    let password = front.password
    for _ in 0..<2 {
      Task {
        try await RigSocksClient.connect(
          port: port, user: user, password: password, name: "declared.example", waitSeconds: 5)
      }
    }
    try await Self.until(2) { asked.all.count == 2 }
    _ = try? await RigSocksClient.raw(port: port, send: [5, 1, 2], read: 2, waitSeconds: 1)
    let counts = front.counts
    #expect(counts.handshake == [.full: 1])
  }

  @Test("a loss of the listener before the host listens is kept and heard once on its registration; none after stop()")
  func lostBeforeRegistration() async throws {
    let (front, _, _) = try await Self.started(.fail)
    let heard = Asked()
    front.loseForRows()
    front.whenLost { heard.add("early") }
    front.whenLost { heard.add("again") }
    front.loseForRows()
    front.stop()
    front.whenLost { heard.add("stopped") }
    front.loseForRows()
    let calls = heard.all
    #expect(calls == ["early", "again"])
  }

  @Test("the system's own dial never reaches the phone's loopback, the front's own listener included")
  func systemDialNotLoopback() async throws {
    let (front, _, port) = try await Self.started(.fail)
    defer { front.stop() }
    for host in ["127.0.0.1", "localhost"] {
      await #expect(throws: (any Error).self, "\(host)") {
        _ = try await WebFrontSystemStream.connect(host, port)
      }
    }
  }
}
