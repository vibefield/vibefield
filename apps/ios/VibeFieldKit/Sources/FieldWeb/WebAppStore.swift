import CryptoKit
import Foundation

// SP-4c — where an app's page keeps what it saves. Ephemeral for the first cut: a store
// that survives launches would let an agent's page keep cookies, storage and caches on the phone, and what survives,
// what removing an app clears and what a backup carries are still to be ruled. The choice
// is the one line `chosen`.

public enum WebAppStore: Sendable, Equatable {
  /// Each open starts clean; the warm app keeps its store for its ten minutes, and a released view's goes with it.
  case ephemeral
  /// One store per app, kept across launches.
  case perApp

  /// THE choice.
  public static let chosen: WebAppStore = .ephemeral

  /// A per-app store's identifier: a UUID from the app's id, the same on every launch (RFC 9562 §5.8's layout over
  /// SHA-256: version 8, the variant bits set).
  public static func identifier(appId: String) -> UUID {
    var bytes = Array(SHA256.hash(data: Data("vibefield.app-store.\(appId)".utf8)).prefix(16))
    bytes[6] = (bytes[6] & 0x0F) | 0x80
    bytes[8] = (bytes[8] & 0x3F) | 0x80
    return UUID(
      uuid: (
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9], bytes[10],
        bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
      ))
  }
}
