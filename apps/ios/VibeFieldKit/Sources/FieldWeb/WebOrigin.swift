import FieldProduct
import Foundation

// SP-4b — an app's origin, as the phone's web host pins it: the scheme, host and port of the root `artifact.open`
// answered (`ArtifactRootURL`'s claim). MA-L6, as clarified: one origin per (desktop, app), its host included.

/// A web origin: scheme, host (lowercased, no brackets) and port, the scheme's default filled in.
public struct WebOrigin: Sendable, Hashable {
  public let scheme: String
  public let host: String
  public let port: Int

  /// The origin of an app's root, from the URL `artifact.open` answered. Nil unless it is a root claim
  /// (`ArtifactRootURL.isClaim`: https, a canonical DNS host, a port in the artifacts' range, nothing past the `/`).
  public init?(claim: String) {
    guard ArtifactRootURL.isClaim(claim), let url = URL(string: claim) else { return nil }
    self.init(url: url)
  }

  /// The origin of an http, https, ws or wss URL; nil for another scheme or no host.
  public init?(url: URL) {
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
      let scheme = parts.scheme?.lowercased(), let fallback = Self.defaultPorts[scheme],
      let host = parts.host.map(Self.bare), !host.isEmpty
    else { return nil }
    self.scheme = scheme
    self.host = host
    port = parts.port ?? fallback
  }

  /// Whether `url` is this origin. A socket to the origin's own host and port is the origin too, over TLS when the
  /// origin is TLS (`https` ~ `wss`, `http` ~ `ws`); a downgrade never is.
  public func contains(_ url: URL) -> Bool {
    guard let other = WebOrigin(url: url) else { return false }
    return Self.family(other.scheme) == Self.family(scheme) && other.host == host && other.port == port
  }

  private static let defaultPorts = ["https": 443, "wss": 443, "http": 80, "ws": 80]

  private static func family(_ scheme: String) -> String {
    scheme == "https" || scheme == "wss" ? "tls" : "plain"
  }

  /// A host as compared: lowercased, an IPv6 literal without its brackets.
  static func bare(_ host: String) -> String {
    var host = host.lowercased()
    if host.hasPrefix("["), host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
    return host
  }
}
