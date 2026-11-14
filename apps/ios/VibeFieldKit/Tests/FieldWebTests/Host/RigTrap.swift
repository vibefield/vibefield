import Foundation
import Network

/// SP-4c's rig — R9's counting traps: plain TCP listeners on 127.0.0.1 (a label ending in "6": on ::1), one per label,
/// each counting the connections it accepts and closing them unread. A count above 0 is a load that reached the
/// device's own loopback: route B's P1a-ip read that WebKit sends a loopback address AROUND its proxy, so the content
/// rule list is the only fence there. It keeps no byte and no peer.
final class RigTrap: @unchecked Sendable {
  let labels: [String]
  private let queue = DispatchQueue(label: "sp4c.rig.trap")
  private var listeners: [NWListener] = []
  private var ports: [String: UInt16] = [:]
  private var accepted: [String: Int] = [:]

  init(_ labels: [String]) throws {
    self.labels = labels
    for label in labels {
      let parameters = NWParameters.tcp
      let host: NWEndpoint.Host = label.hasSuffix("6") ? .ipv6(.loopback) : .ipv4(.loopback)
      parameters.requiredLocalEndpoint = .hostPort(host: host, port: .any)
      let listener = try NWListener(using: parameters)
      let ready = DispatchSemaphore(value: 0)
      listener.stateUpdateHandler = { state in
        if case .ready = state { ready.signal() }
      }
      listener.newConnectionHandler = { [weak self] connection in
        self?.accepted[label, default: 0] += 1
        connection.cancel()
      }
      listener.start(queue: queue)
      listeners.append(listener)
      guard ready.wait(timeout: .now() + 5) == .success, let port = listener.port?.rawValue else {
        stop()
        throw URLError(.cannotConnectToHost)
      }
      ports[label] = port
      RigListen.say("trap-\(label)", listener.parameters.requiredLocalEndpoint)
    }
  }

  func port(_ label: String) -> UInt16 { ports[label] ?? 9 }

  func count(_ label: String) -> Int { queue.sync { accepted[label, default: 0] } }

  func stop() { queue.sync { listeners.forEach { $0.cancel() } } }
}
