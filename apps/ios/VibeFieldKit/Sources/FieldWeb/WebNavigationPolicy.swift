import Foundation

// SP-4b — where a page in an app's web view may go (sync-planes §5.5, SP-D6's rules; MA-L7). Pure: no WebKit, so the
// whole table is a unit row. The host (SP-4c) asks it for every navigation and every frame.
//
// - The app's own origin loads (MA-L6), its sockets included.
// - A tailnet address off the origin is refused and never handed to Safari: Safari's sheet cannot ride the mesh, so
//   it would fail silently there (§5.5: "refused with a sentence rather than failing silently").
// - A public link at the top opens outside, in `SFSafariViewController`.
// - A frame or a socket reaches only the hosts the page was written for (`reach`), over TLS.
//
// The words for a refusal are DESIGN.md's to give (‹to pick›); this file names the reason, never the sentence.

/// What the host does with a navigation.
public enum WebNavigation: Sendable, Equatable {
  /// Load it in the app's web view.
  case allow
  /// Open it outside the app, in the system's Safari sheet (it cannot ride the mesh).
  case outside
  /// Refuse it, and say why.
  case refuse(WebRefusal)
}

/// Why a navigation is refused. The words are DESIGN.md's (‹to pick›).
public enum WebRefusal: String, Sendable, Equatable {
  /// A tailnet address off the app's origin: another device, or another app on this one.
  case tailnetOffOrigin
  /// A frame or socket to a host the page was not written for (MA-L7).
  case undeclaredHost
  /// A scheme a page may not go to: anything but http(s), ws(s), `about:blank` and `about:srcdoc`, and, in a frame,
  /// `data:` and the origin's own `blob:`.
  case scheme
}

/// One open app's navigation rule: its origin and the hosts its page declares.
public struct WebNavigationPolicy: Sendable, Equatable {
  public let origin: WebOrigin
  /// The page's declared hosts (`ArtifactOpenResult.reach`), as `WebRuleList` admits them.
  public let reach: Set<String>

  public init(origin: WebOrigin, reach: [String]) {
    self.origin = origin
    self.reach = Set(WebRuleList.admitted(reach))
  }

  public func decide(_ url: URL, mainFrame: Bool) -> WebNavigation {
    let scheme = url.scheme?.lowercased() ?? ""
    switch scheme {
    case "about":
      return ["about:blank", "about:srcdoc"].contains(url.absoluteString.lowercased()) ? .allow : .refuse(.scheme)
    case "data":
      return mainFrame ? .refuse(.scheme) : .allow
    case "blob":
      let inner = URL(string: String(url.absoluteString.dropFirst("blob:".count)))
      guard !mainFrame, let inner, origin.contains(inner) else { return .refuse(.scheme) }
      return .allow
    case "http", "https", "ws", "wss":
      break
    default:
      return .refuse(.scheme)
    }
    if origin.contains(url) { return .allow }
    guard let other = WebOrigin(url: url) else { return .refuse(.scheme) }
    if Self.isTailnet(host: other.host) { return .refuse(.tailnetOffOrigin) }
    if mainFrame { return scheme == "http" || scheme == "https" ? .outside : .refuse(.scheme) }
    let tls = scheme == "https" || scheme == "wss"
    return tls && reach.contains(other.host) ? .allow : .refuse(.undeclaredHost)
  }

  /// A tailnet address: a MagicDNS name (`ts.net` or under it), Tailscale's IPv4 range 100.64.0.0/10, or its IPv6
  /// prefix fd7a:115c:a1e0::/48.
  public static func isTailnet(host: String) -> Bool {
    let host = WebOrigin.bare(host)
    if host == "ts.net" || host.hasSuffix(".ts.net") { return true }
    if host.hasPrefix("fd7a:115c:a1e0:") { return true }
    let octets = host.split(separator: ".", omittingEmptySubsequences: false)
    guard octets.count == 4, let first = Int(octets[0]), let second = Int(octets[1]),
      octets.allSatisfy({ Int($0).map { (0...255).contains($0) } ?? false })
    else { return false }
    return first == 100 && (64...127).contains(second)
  }
}
