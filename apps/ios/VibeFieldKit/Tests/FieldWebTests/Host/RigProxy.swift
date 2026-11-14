import Foundation
import Network

/// SP-4c's rig — the ONLY proxy an app page in the rows has: SOCKS5 on 127.0.0.1, RFC 1928 CONNECT with RFC 1929
/// user and password, as tsnet's loopback proxy is. A name it is given is routed to that name's loopback server
/// whatever port is asked; every other CONNECT is refused (0x02) before any dial, so no byte leaves the host. It counts
/// CONNECTs by the name's CLASS and never keeps a name (route B's Relay, cut down to what the rows read).
final class RigProxy: @unchecked Sendable {
  enum Class: Hashable, Sendable {
    case origin
    case declared
    /// A `ts.net` name that is not the origin.
    case tailnetOther
    /// Any other name.
    case undeclared
    /// An IPv4 or IPv6 address, not a name.
    case address
  }

  let user = "rig"
  let password = UUID().uuidString
  private let originName: String
  private let routes: [String: UInt16]
  private let queue = DispatchQueue(label: "sp4c.rig.proxy")
  private var listener: NWListener?
  private var seen: [Class: Int] = [:]

  /// `routes`: a name to the loopback port that serves it; `originName` is the one counted as the origin.
  init(originName: String, routes: [String: UInt16]) {
    self.originName = originName
    self.routes = routes
  }

  func count(_ kind: Class) -> Int { queue.sync { seen[kind, default: 0] } }

  /// Starts on 127.0.0.1 and answers its port.
  func start() throws -> UInt16 {
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    let listener = try NWListener(using: parameters)
    let ready = DispatchSemaphore(value: 0)
    listener.stateUpdateHandler = { state in
      if case .ready = state { ready.signal() }
    }
    listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
    listener.start(queue: queue)
    self.listener = listener
    guard ready.wait(timeout: .now() + 5) == .success, let port = listener.port?.rawValue else {
      throw URLError(.cannotConnectToHost)
    }
    RigListen.say("proxy", listener.parameters.requiredLocalEndpoint)
    return port
  }

  func stop() { queue.sync { listener?.cancel() } }

  private func classify(_ atyp: UInt8, _ name: String) -> Class {
    guard atyp == 3 else { return .address }
    if name == originName { return .origin }
    if routes[name] != nil { return .declared }
    if name == "ts.net" || name.hasSuffix(".ts.net") { return .tailnetOther }
    return .undeclared
  }

  private func accept(_ client: NWConnection) {
    client.start(queue: queue)
    read(client, 2) { head in
      guard head[0] == 5 else { return client.cancel() }
      self.read(client, Int(head[1])) { methods in
        guard methods.contains(2) else { return self.write(client, [5, 0xFF]) { client.cancel() } }
        self.write(client, [5, 2]) { self.authenticate(client) }
      }
    }
  }

  private func authenticate(_ client: NWConnection) {
    read(client, 2) { head in
      self.read(client, Int(head[1])) { name in
        self.read(client, 1) { length in
          self.read(client, Int(length[0])) { secret in
            let matched = String(decoding: name, as: UTF8.self) == self.user
              && String(decoding: secret, as: UTF8.self) == self.password
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
      let atyp = head[3]
      let address: (@escaping @Sendable (String) -> Void) -> Void = { done in
        switch atyp {
        case 1: self.read(client, 4) { ip in done(ip.map(String.init).joined(separator: ".")) }
        case 3: self.read(client, 1) { n in self.read(client, Int(n[0])) { done(String(decoding: $0, as: UTF8.self)) } }
        case 4: self.read(client, 16) { _ in done("") }
        default: client.cancel()
        }
      }
      address { name in
        self.read(client, 2) { _ in
          let kind = self.classify(atyp, name.lowercased())
          self.seen[kind, default: 0] += 1
          guard kind == .origin || kind == .declared, let port = self.routes[name.lowercased()] else {
            return self.reply(client, 2)
          }
          self.connect(client, port: port)
        }
      }
    }
  }

  private func connect(_ client: NWConnection, port: UInt16) {
    guard let to = NWEndpoint.Port(rawValue: port) else { return reply(client, 2) }
    let upstream = NWConnection(host: "127.0.0.1", port: to, using: .tcp)
    upstream.stateUpdateHandler = { state in
      switch state {
      case .ready:
        self.reply(client, 0) {
          self.pipe(client, upstream)
          self.pipe(upstream, client)
        }
      case .failed, .waiting:
        upstream.cancel()
        self.reply(client, 5)
      default: break
      }
    }
    upstream.start(queue: queue)
  }

  private func reply(_ client: NWConnection, _ code: UInt8, then: (@Sendable () -> Void)? = nil) {
    write(client, [5, code, 0, 1, 0, 0, 0, 0, 0, 0]) {
      if let then { then() } else { client.cancel() }
    }
  }

  private func pipe(_ from: NWConnection, _ to: NWConnection) {
    from.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, complete, error in
      if let data, !data.isEmpty { to.send(content: data, completion: .contentProcessed { _ in }) }
      if complete || error != nil {
        to.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .idempotent)
        return
      }
      self.pipe(from, to)
    }
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
}
