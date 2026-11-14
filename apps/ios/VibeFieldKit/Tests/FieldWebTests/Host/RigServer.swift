import Foundation
import Network

/// SP-4c's rig — one HTTPS server on 127.0.0.1 with the rig's test identity: HTTP/1.1, one request per connection,
/// answered from a fixed table by path. It keeps no request beyond the count of paths asked (`asked`).
final class RigServer: @unchecked Sendable {
  struct Answer: Sendable {
    var status = 200
    var headers: [String: String] = ["Content-Type": "text/html; charset=utf-8"]
    var body = ""

    static func page(_ html: String) -> Answer { Answer(body: html) }

    static func redirect(_ location: String) -> Answer {
      Answer(status: 302, headers: ["Location": location, "Content-Type": "text/plain"], body: "")
    }
  }

  private let identity: sec_identity_t
  private let table: [String: Answer]
  private let queue = DispatchQueue(label: "sp4c.rig.server")
  private var listener: NWListener?
  private var counts: [String: Int] = [:]

  init(identity: sec_identity_t, table: [String: Answer]) {
    self.identity = identity
    self.table = table
  }

  /// How many requests asked for `path`.
  func asked(_ path: String) -> Int { queue.sync { counts[path, default: 0] } }

  func start() throws -> UInt16 {
    let tls = NWProtocolTLS.Options()
    sec_protocol_options_set_local_identity(tls.securityProtocolOptions, identity)
    let parameters = NWParameters(tls: tls)
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    let listener = try NWListener(using: parameters)
    let ready = DispatchSemaphore(value: 0)
    listener.stateUpdateHandler = { state in
      if case .ready = state { ready.signal() }
    }
    listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
    listener.start(queue: queue)
    self.listener = listener
    guard ready.wait(timeout: .now() + 5) == .success, let port = listener.port?.rawValue else {
      throw URLError(.cannotConnectToHost)
    }
    RigListen.say("server", listener.parameters.requiredLocalEndpoint)
    return port
  }

  func stop() { queue.sync { listener?.cancel() } }

  private func serve(_ connection: NWConnection) {
    connection.start(queue: queue)
    receiveHead(connection, Data())
  }

  private func receiveHead(_ connection: NWConnection, _ held: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { data, _, complete, error in
      var held = held
      if let data { held.append(data) }
      if let end = held.range(of: Data("\r\n\r\n".utf8)) {
        let head = String(decoding: held[..<end.lowerBound], as: UTF8.self)
        return self.answer(connection, head)
      }
      if complete || error != nil || held.count > 65_536 { return connection.cancel() }
      self.receiveHead(connection, held)
    }
  }

  private func answer(_ connection: NWConnection, _ head: String) {
    let parts = head.split(separator: "\r\n").first?.split(separator: " ") ?? []
    let path = parts.count > 1 ? String(parts[1].split(separator: "?").first ?? "") : ""
    counts[path, default: 0] += 1
    let answer = table[path] ?? Answer(status: 404, headers: ["Content-Type": "text/plain"], body: "")
    let body = Data(answer.body.utf8)
    var lines = ["HTTP/1.1 \(answer.status) \(answer.status == 200 ? "OK" : "Other")"]
    lines += answer.headers.sorted { $0.key < $1.key }.map { "\($0.key): \($0.value)" }
    lines += ["Content-Length: \(body.count)", "Connection: close", "", ""]
    var bytes = Data(lines.joined(separator: "\r\n").utf8)
    bytes.append(body)
    connection.send(
      content: bytes, contentContext: .finalMessage, isComplete: true,
      completion: .contentProcessed { _ in connection.cancel() })
  }
}
