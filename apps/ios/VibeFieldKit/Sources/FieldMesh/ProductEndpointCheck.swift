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
/// **DORMANT since UA-P-1b (`FieldStoreBus`).** This is the STORE leg's check:
/// it exists because `field.devices.v1` carried a URL a desktop wrote, and
/// under James's ruling of 2026-09-15 no desktop publishes that slice. The
/// phone builds its own dial target now (`peerProductDoorURL` below), so
/// nothing in the product path calls this. It stays with the reader it belongs
/// to — UA-P-4 turns the bus back on — and its tests stay and run.
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

// MARK: - UA-P-1a: the door the PHONE builds

/// The dial target for one peer's product door, built from what the mesh says
/// about that peer — and then held to the same pin a published one is.
///
/// Discovery by the door (UA-P-1a) inverts where the string comes from: the
/// store used to carry a URL a desktop wrote, and now the phone composes one
/// from the peer's own MagicDNS name and the registry port. That removes the
/// redirect primitive `verifyProductEndpoint` exists to refuse — a peer cannot
/// name a machine it is not, because it names nothing at all.
///
/// **The pin stays anyway, and it is not ceremony.** What it now asserts is
/// that this app dialed an address THE MESH VOUCHES FOR: a peer that truffle
/// reports with no hostname and no tailnet IP has no door to dial, and a node
/// with no MagicDNS suffix of its own cannot build a fully-qualified name. Both
/// are states, both used to be silent, and running the composed URL back
/// through `vouched` is what turns them into the reason string a face can say.
/// It is also the line that catches the composition itself going wrong: if the
/// builder ever learns a host from somewhere other than the peer, this refuses
/// it the same day rather than the day somebody reads the diff.
///
/// The preference is the fully-qualified MagicDNS name, then a tailnet IP —
/// the bare slug is deliberately last, because a phone that has no suffix of
/// its own is a phone whose resolver may answer a short name from the public
/// DNS.
public func peerProductDoorURL(
  hostname: String?, tailnetIPs: [String], magicDNSSuffix: String?
) -> ProductEndpointVerdict {
  let addresses = ([hostname] + tailnetIPs.map { Optional($0) })
    .compactMap { $0 }
    .filter { !$0.isEmpty }
  guard !addresses.isEmpty else {
    return .refused("this desktop has no address the mesh will vouch for")
  }
  guard let host = dialHost(hostname: hostname, tailnetIPs: tailnetIPs, suffix: magicDNSSuffix)
  else {
    return .refused("this desktop has no address the mesh will vouch for")
  }
  guard let url = FieldMeshContract.productDoorURL(host: host) else {
    return .refused("this desktop's address does not spell a URL")
  }
  // The composed host, held to the peer exactly as a published one is.
  guard vouched(host: host, addresses: addresses, magicDNSSuffix: magicDNSSuffix) else {
    return .refused("the door this phone built points somewhere this desktop is not")
  }
  return .ok(url)
}

/// The best spelling of "where this peer answers", in order.
private func dialHost(hostname: String?, tailnetIPs: [String], suffix: String?) -> String? {
  let slug = hostname?.lowercased()
  if let slug, !slug.isEmpty, let suffix = suffix?.lowercased(), !suffix.isEmpty,
    !slug.contains(":"), !isIPv4(slug)
  {
    // Already fully qualified (a node that reports its own dns name): leave it.
    return slug.hasSuffix(".\(suffix)") ? slug : "\(slug).\(suffix)"
  }
  if let ip = tailnetIPs.first(where: { !$0.isEmpty }) { return ip.lowercased() }
  if let slug, !slug.isEmpty { return slug }
  return nil
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
