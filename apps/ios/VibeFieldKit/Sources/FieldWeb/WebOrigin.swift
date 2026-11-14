import FieldProduct
import Foundation

// SP-4b (red) — an app's origin, as the phone's web host pins it. A stub: no URL has an origin yet.

/// A web origin: scheme, host (lowercased, no brackets) and port, the scheme's default filled in.
public struct WebOrigin: Sendable, Hashable {
  public let scheme: String
  public let host: String
  public let port: Int

  public init?(claim: String) { return nil }

  public init?(url: URL) { return nil }

  public func contains(_ url: URL) -> Bool { false }

  static func bare(_ host: String) -> String { host }
}
