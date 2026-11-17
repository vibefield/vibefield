#if DEBUG || VF_WEB_RELAY
  import Foundation
  import Network

  // Item 522 (2026-11-17) — the filtering front: the ONLY proxy an app's page has. A SOCKS5 listener bound to loopback,
  // with a credential made for it alone; at every CONNECT, before any dial, it holds the page's rule (`WebFrontRule`).
  // The origin at its port is carried over the mesh node's own dial; a declared host, at any port the rule list admits,
  // by the system's own connection; everything else is refused (0x02) with nothing dialled, and counted by class, never
  // named. Every connection WebKit sends through its proxy meets the rule here: a navigation's connect-ahead, a
  // subresource, a socket. (Whether WebRTC or WebTransport leave the page around a proxy is item 524's to measure.)
  // Every dial is owned to its end: one that fails is cancelled, and one that comes back after its client or the front
  // has gone is closed, never tunnelled. A client is held only on its way to a tunnel or in one: `handshakeDeadline` to
  // bring its CONNECT, `dialDeadline` for its dial, `maxClients` at once. One front per page: `FieldWebAppHost.open`
  // makes it and `release()` stops it. Item 373: this whole file compiles only in a Debug build or with SP-4d's relay.
  // What stays item 373's: an admitted name that resolves into the tailnet or a private range (the front sees names,
  // never what they resolve to).

  /// One connection the front carries an admitted CONNECT on. `close()` may be called more than once; the front calls
  /// it once per tunnel.
  public protocol WebFrontStream: Sendable {
    /// Up to `max` bytes; nil at the end of the stream.
    func read(_ max: Int) async throws -> Data?
    func write(_ data: Data) async throws
    func close() async
  }

  /// How the front carries an admitted CONNECT: the policy's own spelling of the name, and the port asked.
  public typealias WebFrontDial = @Sendable (_ host: String, _ port: UInt16) async throws -> any WebFrontStream

  /// The front's two dials: the origin over the mesh node's own dial (handed in by the app, which holds the mesh), a
  /// declared host by the system's own connection unless a row hands its own.
  public struct WebFrontDials: Sendable {
    public var origin: WebFrontDial
    public var declared: WebFrontDial

    public init(origin: @escaping WebFrontDial, declared: @escaping WebFrontDial = WebFrontSystemStream.dial) {
      self.origin = origin
      self.declared = declared
    }
  }

  /// Why a client never brought a CONNECT the rule could read, by class: counted, never a name.
  public enum WebFrontHandshake: String, Sendable, Hashable, CaseIterable {
    /// Not SOCKS5's version, in its greeting or its request.
    case version
    /// No user-and-password method offered.
    case method
    /// A wrong credential, or a sub-negotiation not of RFC 1929's version.
    case credential
    /// A command other than CONNECT: BIND, UDP ASSOCIATE.
    case command
    /// An address type SOCKS5 does not define.
    case addressType
    /// Past `WebFront.maxClients`.
    case full
    /// No tunnel within `WebFront.handshakeDeadline`.
    case deadline
  }

  /// What the front did, by count only.
  public struct WebFrontCounts: Equatable, Sendable {
    public var refused: [WebFrontRefusal: Int] = [:]
    public var handshake: [WebFrontHandshake: Int] = [:]
    public var origin = 0
    public var declared = 0
    /// Admitted, and its dial failed while its client still waited.
    public var unreached = 0
    /// Admitted, and its dial outlasted `WebFront.dialDeadline`: its client was let go.
    public var abandoned = 0
  }

  public final class WebFront: @unchecked Sendable {
    public enum Failure: Error, Equatable {
      /// The listener did not start.
      case listener
    }

    /// A page's own client brings its CONNECT within moments of connecting; one that has not in ten seconds is not a
    /// page's, or its page gave up, and it is closed so that it holds no descriptor. It ends at an admitted CONNECT:
    /// the dial has its own bound.
    public static let handshakeDeadline: DispatchTimeInterval = .seconds(10)
    /// How long an admitted CONNECT waits for its dial. A first dial to a peer still finding its path may take
    /// seconds (not measured); one that has not answered in thirty is not coming, and its client is let go so that the
    /// page's load fails into its honest screen. The dial's own return is closed when it comes.
    public static let dialDeadline: DispatchTimeInterval = .seconds(30)
    /// WebKit keeps a handful of connections to a host; 128 is far past any page's and far short of the app's
    /// descriptors, which its mesh shares. When full, the oldest client without the credential is let go for the
    /// newcomer; only when every client has it is the newcomer turned away. What remains: a process on the phone that
    /// opens connections as fast as they are let go can still race the page's own (nothing on loopback says who calls).
    public static let maxClients = 128

    private let rule: WebFrontRule
    private let dials: WebFrontDials
    private let deadline: DispatchTimeInterval
    private let dialBound: DispatchTimeInterval
    private let cap: Int
    /// The credential made for this front alone; read by the test target's rows, never by the app.
    let user = "front"
    let password = UUID().uuidString
    private let userBytes: [UInt8]
    private let secretBytes: [UInt8]
    private let queue = DispatchQueue(label: "vibefield.web-front")
    private var listener: NWListener?
    private var clients: [NWConnection] = []
    /// Clients past the credential, past an admitted CONNECT, and in a tunnel.
    private var authenticated: Set<ObjectIdentifier> = []
    private var admitted: Set<ObjectIdentifier> = []
    private var tunnelled: Set<ObjectIdentifier> = []
    private var stopped = false
    private var lost: (@Sendable () -> Void)?
    /// A loss heard before `whenLost` was registered.
    private var latched = false
    private var tally = WebFrontCounts()

    public convenience init(rule: WebFrontRule, dials: WebFrontDials) {
      self.init(
        rule: rule, dials: dials, deadline: Self.handshakeDeadline, dialDeadline: Self.dialDeadline,
        cap: Self.maxClients)
    }

    /// A row's own bounds.
    init(
      rule: WebFrontRule, dials: WebFrontDials, deadline: DispatchTimeInterval, dialDeadline: DispatchTimeInterval,
      cap: Int
    ) {
      self.rule = rule
      self.dials = dials
      self.deadline = deadline
      dialBound = dialDeadline
      self.cap = cap
      userBytes = Array(user.utf8)
      secretBytes = Array(password.utf8)
    }

    deinit {
      listener?.cancel()
      for client in clients { client.cancel() }
    }

    public var counts: WebFrontCounts { queue.sync { tally } }

    /// The listener's port once started; read by the test target's rows.
    var port: UInt16? { queue.sync { listener?.port?.rawValue } }

    /// The endpoint the listener is bound to and the interface it is held to; read by the test target's rows.
    var bound: (endpoint: NWEndpoint?, interface: NWInterface.InterfaceType?) {
      queue.sync { (listener?.parameters.requiredLocalEndpoint, listener?.parameters.requiredInterfaceType) }
    }

    /// Heard once if the listener fails after it started (iOS may reclaim a loopback listener in the background), never
    /// after `stop()`. A loss before this is registered is kept, and heard on registration.
    func whenLost(_ heard: @escaping @Sendable () -> Void) {
      let now: Bool = queue.sync {
        guard !stopped else { return false }
        if latched {
          latched = false
          return true
        }
        lost = heard
        return false
      }
      if now { heard() }
    }

    /// The listener's loss, as its state reports one; called by the test target's rows, which cannot make a loopback
    /// listener fail.
    func loseForRows() {
      queue.sync { listenerLost() }
    }

    /// Starts on 127.0.0.1 alone and answers the page's one proxy configuration, its credential applied.
    public func start() async throws -> ProxyConfiguration {
      try await start(port: .any)
    }

    /// `port`: any, for the app; a row asks for one already taken, to see a start fail.
    func start(port: NWEndpoint.Port) async throws -> ProxyConfiguration {
      let parameters = NWParameters.tcp
      parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: port)
      parameters.requiredInterfaceType = .loopback
      guard let listener = try? NWListener(using: parameters) else { throw Failure.listener }
      listener.newConnectionHandler = { [weak self] client in self?.accept(client) }
      let once = WebFrontOnce()
      try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, any Error>) in
        listener.stateUpdateHandler = { [weak self, weak listener] state in
          switch state {
          case .ready:
            if once.first() { done.resume() }
          case .failed, .waiting:
            listener?.cancel()
            if once.first() { done.resume(throwing: Failure.listener) } else { self?.listenerLost() }
          case .cancelled:
            if once.first() { done.resume(throwing: Failure.listener) }
          default: break
          }
        }
        queue.sync { self.listener = listener }
        listener.start(queue: queue)
      }
      guard let at = listener.port else { throw Failure.listener }
      let configuration = ProxyConfiguration(socksv5Proxy: .hostPort(host: .ipv4(.loopback), port: at))
      configuration.applyCredential(username: user, password: password)
      return configuration
    }

    /// Stops listening and lets every client and tunnel go; a dial still out is closed when it comes back.
    public func stop() {
      queue.sync {
        stopped = true
        lost = nil
        latched = false
        listener?.cancel()
        listener = nil
        for client in clients { client.cancel() }
        clients = []
        authenticated = []
        admitted = []
        tunnelled = []
      }
    }

    // MARK: - On the front's one queue

    private func listenerLost() {
      guard !stopped else { return }
      guard let heard = lost else {
        latched = true
        return
      }
      lost = nil
      heard()
    }

    /// Lets a client go at once, before its state reports the cancel.
    private func letGo(_ client: NWConnection) {
      forget(client)
      client.cancel()
    }

    private func forget(_ client: NWConnection) {
      clients.removeAll { $0 === client }
      let id = ObjectIdentifier(client)
      authenticated.remove(id)
      admitted.remove(id)
      tunnelled.remove(id)
    }

    // MARK: - SOCKS5 (RFC 1928, with RFC 1929's user and password)

    private func accept(_ client: NWConnection) {
      guard !stopped else { return client.cancel() }
      if clients.count >= cap {
        guard let oldest = clients.first(where: { !authenticated.contains(ObjectIdentifier($0)) }) else {
          return turnAway(client, .full)
        }
        turnAway(oldest, .full)
      }
      clients.append(client)
      client.stateUpdateHandler = { [weak self, weak client] state in
        switch state {
        case .failed: client?.cancel()
        case .cancelled:
          guard let self, let client else { return }
          self.forget(client)
        default: break
        }
      }
      client.start(queue: queue)
      queue.asyncAfter(deadline: .now() + deadline) { [weak self, weak client] in
        guard let self, let client, self.clients.contains(where: { $0 === client }),
          !self.admitted.contains(ObjectIdentifier(client))
        else { return }
        self.turnAway(client, .deadline)
      }
      read(client, 2) { head in
        guard head[0] == 5 else { return self.turnAway(client, .version) }
        self.read(client, Int(head[1])) { methods in
          guard methods.contains(2) else {
            self.tally.handshake[.method, default: 0] += 1
            return self.write(client, [5, 0xFF]) { client.cancel() }
          }
          self.write(client, [5, 2]) { self.authenticate(client) }
        }
      }
    }

    private func authenticate(_ client: NWConnection) {
      read(client, 2) { head in
        guard head[0] == 1 else {
          self.tally.handshake[.credential, default: 0] += 1
          return self.write(client, [1, 1]) { client.cancel() }
        }
        self.read(client, Int(head[1])) { name in
          self.read(client, 1) { length in
            self.read(client, Int(length[0])) { secret in
              let matched = Self.same(name, self.userBytes) && Self.same(secret, self.secretBytes)
              if matched {
                self.authenticated.insert(ObjectIdentifier(client))
              } else {
                self.tally.handshake[.credential, default: 0] += 1
              }
              self.write(client, [1, matched ? 0 : 1]) {
                if matched { self.request(client) } else { client.cancel() }
              }
            }
          }
        }
      }
    }

    private func request(_ client: NWConnection) {
      read(client, 4) { head in
        guard head[0] == 5 else { return self.turnAway(client, .version) }
        guard head[1] == 1 else {
          self.tally.handshake[.command, default: 0] += 1
          return self.reply(client, 7)
        }
        let atyp = head[3]
        let address: (@escaping @Sendable (String, Bool) -> Void) -> Void = { done in
          switch atyp {
          case 1: self.read(client, 4) { ip in done(ip.map(String.init).joined(separator: "."), false) }
          case 3:
            self.read(client, 1) { n in
              self.read(client, Int(n[0])) { done(String(decoding: $0, as: UTF8.self), true) }
            }
          case 4: self.read(client, 16) { _ in done("", false) }
          default:
            self.tally.handshake[.addressType, default: 0] += 1
            self.reply(client, 8)
          }
        }
        address { name, isName in
          self.read(client, 2) { bytes in
            let port = Int(bytes[0]) << 8 | Int(bytes[1])
            self.carry(client, port: port, admit: self.rule.admit(name: name, port: port, isName: isName))
          }
        }
      }
    }

    /// The rule's answer: refused before any dial, or carried by the dial its class takes, to the policy's own name.
    private func carry(_ client: NWConnection, port: Int, admit: WebFrontRule.Admit) {
      let host: String
      let dial: WebFrontDial
      switch admit {
      case .refused(let why):
        tally.refused[why, default: 0] += 1
        return reply(client, 2)
      case .origin:
        tally.origin += 1
        host = rule.policy.origin.host
        dial = dials.origin
      case .declared(let name):
        tally.declared += 1
        host = name
        dial = dials.declared
      }
      admitted.insert(ObjectIdentifier(client))
      queue.asyncAfter(deadline: .now() + dialBound) { [weak self, weak client] in
        guard let self, let client, self.clients.contains(where: { $0 === client }),
          !self.tunnelled.contains(ObjectIdentifier(client))
        else { return }
        self.tally.abandoned += 1
        self.letGo(client)
      }
      Task {
        let stream: any WebFrontStream
        do {
          stream = try await dial(host, UInt16(port))
        } catch {
          self.queue.async {
            guard self.clients.contains(where: { $0 === client }) else { return }
            self.tally.unreached += 1
            self.reply(client, 5)
          }
          return
        }
        self.queue.async { self.open(client, stream) }
      }
    }

    /// A dial that came back: tunnelled only while the front and its client still stand, else closed.
    private func open(_ client: NWConnection, _ stream: any WebFrontStream) {
      guard !stopped, clients.contains(where: { $0 === client }) else {
        client.cancel()
        Task { await stream.close() }
        return
      }
      tunnelled.insert(ObjectIdentifier(client))
      client.send(
        content: Data([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
        completion: .contentProcessed { error in
          if error == nil {
            self.tunnel(client, stream)
          } else {
            client.cancel()
            Task { await stream.close() }
          }
        })
    }

    /// Carries bytes both ways until either side ends; then both go, the stream closed once. A half-close from the
    /// client ends both ways too, so a response still in flight then is cut: known, and left so.
    private func tunnel(_ client: NWConnection, _ stream: any WebFrontStream) {
      let queue = self.queue
      let end = WebFrontOnce()
      let finish: @Sendable () async -> Void = {
        client.cancel()
        if end.first() { await stream.close() }
      }
      Task {
        while let data = await Self.receive(client, on: queue) {
          guard !data.isEmpty else { continue }
          do { try await stream.write(data) } catch { break }
        }
        await finish()
      }
      Task {
        while true {
          let data: Data?
          do { data = try await stream.read(65_536) } catch { break }
          guard let data, await Self.send(client, data) else { break }
        }
        await finish()
      }
    }

    private func turnAway(_ client: NWConnection, _ why: WebFrontHandshake) {
      tally.handshake[why, default: 0] += 1
      letGo(client)
    }

    private func reply(_ client: NWConnection, _ code: UInt8) {
      write(client, [5, code, 0, 1, 0, 0, 0, 0, 0, 0]) { client.cancel() }
    }

    private func read(_ connection: NWConnection, _ count: Int, _ then: @escaping @Sendable ([UInt8]) -> Void) {
      guard count > 0 else { return then([]) }
      connection.receive(minimumIncompleteLength: count, maximumLength: count) { data, _, _, error in
        guard let data, data.count == count, error == nil else { return connection.cancel() }
        then(Array(data))
      }
    }

    private func write(_ connection: NWConnection, _ bytes: [UInt8], _ then: @escaping @Sendable () -> Void) {
      connection.send(
        content: Data(bytes),
        completion: .contentProcessed { error in
          if error == nil { then() } else { connection.cancel() }
        })
    }

    /// Equal bytes, in a time that depends on their length alone.
    static func same(_ a: [UInt8], _ b: [UInt8]) -> Bool {
      guard a.count == b.count else { return false }
      var differ: UInt8 = 0
      for index in a.indices { differ |= a[index] ^ b[index] }
      return differ == 0
    }

    /// The client's next bytes; nil once it ends.
    private static func receive(_ client: NWConnection, on queue: DispatchQueue) async -> Data? {
      await withCheckedContinuation { (done: CheckedContinuation<Data?, Never>) in
        queue.async {
          client.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, complete, error in
            if let data, !data.isEmpty { return done.resume(returning: data) }
            done.resume(returning: complete || error != nil ? nil : Data())
          }
        }
      }
    }

    /// Writes to the client; false if it could not.
    private static func send(_ client: NWConnection, _ data: Data) async -> Bool {
      await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
        client.send(content: data, completion: .contentProcessed { error in done.resume(returning: error == nil) })
      }
    }
  }

  /// A declared host by the system's own connection: plain TCP, the page's own TLS inside it, never the phone's own
  /// loopback whatever the name resolves to (not its ports, the front's listener among them).
  public final class WebFrontSystemStream: WebFrontStream, @unchecked Sendable {
    private let connection: NWConnection
    private let queue = DispatchQueue(label: "vibefield.web-front.system")

    private init(_ connection: NWConnection) {
      self.connection = connection
    }

    /// The front's default dial for a declared host.
    public static let dial: WebFrontDial = { host, port in try await WebFrontSystemStream.connect(host, port) }

    static func connect(_ host: String, _ port: UInt16) async throws -> WebFrontSystemStream {
      guard let to = NWEndpoint.Port(rawValue: port) else { throw URLError(.badURL) }
      let tcp = NWProtocolTCP.Options()
      // A SYN with no answer is given up at ten seconds, the front's own deadline, not at the system's default.
      // No row stands for it: nothing on loopback leaves a SYN unanswered.
      tcp.connectionTimeout = 10
      let parameters = NWParameters(tls: nil, tcp: tcp)
      parameters.prohibitedInterfaceTypes = [.loopback]
      let stream = WebFrontSystemStream(NWConnection(host: NWEndpoint.Host(host), port: to, using: parameters))
      let once = WebFrontOnce()
      try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, any Error>) in
        stream.connection.stateUpdateHandler = { [weak stream] state in
          switch state {
          case .ready:
            if once.first() { done.resume() }
          case .failed, .waiting, .cancelled:
            // A waiting connection would connect later, owned by nobody: cancelled before the throw.
            stream?.connection.cancel()
            if once.first() { done.resume(throwing: URLError(.cannotConnectToHost)) }
          default: break
          }
        }
        stream.connection.start(queue: stream.queue)
      }
      return stream
    }

    public func read(_ max: Int) async throws -> Data? {
      try await withCheckedThrowingContinuation { (done: CheckedContinuation<Data?, any Error>) in
        connection.receive(minimumIncompleteLength: 1, maximumLength: max) { data, _, complete, error in
          if let data, !data.isEmpty { return done.resume(returning: data) }
          if let error { return done.resume(throwing: error) }
          done.resume(returning: complete ? nil : Data())
        }
      }
    }

    public func write(_ data: Data) async throws {
      try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, any Error>) in
        connection.send(
          content: data,
          completion: .contentProcessed { error in
            if let error { done.resume(throwing: error) } else { done.resume() }
          })
      }
    }

    /// Cancelling a cancelled connection does nothing, so this may be called more than once.
    public func close() async {
      connection.cancel()
    }
  }

  /// True the first time only.
  final class WebFrontOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var fired = false

    func first() -> Bool {
      lock.lock()
      defer { lock.unlock() }
      defer { fired = true }
      return !fired
    }
  }
#endif
