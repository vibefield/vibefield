import FieldProduct
import Foundation

// EL7 M1 — a published dial target is somebody else's string until it is
// pinned to the peer that published it.
//
// `field.devices.v1` is same-user-private, which is a statement about the
// TAILNET and not about this process: every node on it can write, and the
// review's own probe put an attacker's URL under another desktop's name. The
// attribution check in `FieldStore` closes the "whose slice is this" half. This
// is the other half: even a correctly attributed desktop only gets to name
// ITSELF as the place to dial.

public enum ProductEndpointVerdict: Sendable, Equatable {
  case ok(URL)
  case refused(String)

  public var url: URL? {
    if case .ok(let url) = self { return url }
    return nil
  }

  public var reason: String? {
    if case .refused(let reason) = self { return reason }
    return nil
  }
}

/// The schemes a product door is ever published under.
///
/// A DELIBERATE deviation from the review, which asked for `wss` alone: the
/// contracts' own golden publishes `http://mac.tail1234.ts.net:443/t/…`, and
/// fieldd builds the string from truffle's serve URL (`daemon.ts:828`), so
/// pinning `wss` would refuse every endpoint that exists today. `URLSession`
/// treats `http(s)` and `ws(s)` alike for a WebSocket task, and the transport
/// is the tailnet's own WireGuard either way. What is actually worth refusing
/// is a scheme that is not a socket at all — `file`, a custom app scheme, a
/// redirect into something that can read this device's disk.
private let dialableSchemes: Set<String> = ["ws", "wss", "http", "https"]

/// Verify a desktop's published dial target against the peer that published it.
///
/// `addresses` is what truffle says about that peer: its slugged tailscale
/// hostname and its tailnet IPs. A URL that names anything else is refused —
/// this is the one check that stops a peer redirecting the phone's connection,
/// with its WhoIs-granted `self` scopes, at a machine of its choosing.
///
/// MagicDNS is why one address becomes two candidates: the hostname truffle
/// reports is the slug (`studio`) and the published URL usually carries the
/// fully-qualified name (`studio.tail1234.ts.net`). `magicDNSSuffix` is this
/// node's own tailnet domain, so the FQDN is built rather than guessed at and
/// every comparison stays an equality — see `vouched`.
public func verifyProductEndpoint(
  _ raw: String?, from addresses: [String], magicDNSSuffix: String? = nil
) -> ProductEndpointVerdict {
  guard let raw, !raw.isEmpty else { return .refused("this desktop is not serving a door") }
  guard let url = URL(string: raw), let scheme = url.scheme?.lowercased() else {
    return .refused("the published door is not a URL")
  }
  guard dialableSchemes.contains(scheme) else {
    return .refused("the published door is not a socket (\(scheme))")
  }
  guard let host = url.host?.lowercased(), !host.isEmpty else {
    return .refused("the published door names no host")
  }
  // C3 — the door is the secret path. A published URL that is not one is not
  // this door, whatever else it is.
  guard url.path.hasPrefix("/t/") else {
    return .refused("the published door is not a capability path")
  }
  guard !addresses.isEmpty else {
    return .refused("this desktop has no address the mesh will vouch for")
  }
  guard vouched(host: host, addresses: addresses, magicDNSSuffix: magicDNSSuffix) else {
    return .refused("the published door points somewhere this desktop is not")
  }
  return .ok(url)
}

/// Every spelling of "this peer", and nothing else.
///
/// A PREFIX match on the slug would have been the obvious thing and is exactly
/// wrong: `studio.` also begins `studio.attacker.example`, and tailscale's
/// MagicDNS forwards names it does not own to the upstream resolver, so that
/// name can resolve. The tailnet's own suffix closes it — taken from THIS
/// node's dns name, which is a fact about the tailnet we are on rather than a
/// guess — and the comparison stays an equality throughout.
private func vouched(host: String, addresses: [String], magicDNSSuffix: String?) -> Bool {
  var accepted = Set(addresses.map { $0.lowercased() }.filter { !$0.isEmpty })
  if let suffix = magicDNSSuffix?.lowercased(), !suffix.isEmpty {
    for address in accepted where !address.contains(":") && !isIPv4(address) {
      accepted.insert("\(address).\(suffix)")
    }
  }
  return accepted.contains(host)
}

private func isIPv4(_ text: String) -> Bool {
  let parts = text.split(separator: ".", omittingEmptySubsequences: false)
  guard parts.count == 4 else { return false }
  return parts.allSatisfy { UInt8($0) != nil }
}
