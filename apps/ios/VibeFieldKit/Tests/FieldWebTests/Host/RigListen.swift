import Foundation
import Network

/// SP-4c's rig — every listener a row starts says where it binds, as `SP4C-LISTEN <who> <host>`:
/// the kit's runner STOPs on any host other than 127.0.0.1 or ::1, and on a host row that printed none.
/// An NWListener's host is read back off the live listener's parameters once it is ready; `RigReset` passes its
/// `getsockname` address. A loopback literal and a role, never a port, a name or a peer.
enum RigListen {
  static func say(_ who: String, _ endpoint: NWEndpoint?) {
    print("SP4C-LISTEN \(who) \(host(endpoint))")
  }

  static func say(_ who: String, address: String) {
    print("SP4C-LISTEN \(who) \(address)")
  }

  static func host(_ endpoint: NWEndpoint?) -> String {
    guard case .hostPort(let host, _) = endpoint else { return "unknown" }
    switch host {
    case .ipv4(let address): return text(AF_INET, address.rawValue)
    case .ipv6(let address): return text(AF_INET6, address.rawValue)
    case .name(let name, _): return name
    @unknown default: return "unknown"
    }
  }

  /// An address in `inet_ntop`'s words: 127.0.0.1, ::1.
  static func text(_ family: Int32, _ raw: Data) -> String {
    var buffer = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
    let written = raw.withUnsafeBytes { bytes in
      inet_ntop(family, bytes.baseAddress, &buffer, socklen_t(buffer.count))
    }
    guard written != nil else { return "unknown" }
    return String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
  }
}
