import Foundation
import Security

/// A host this phone may hold a write key for.
///
/// The NAME is stored beside the secret rather than looked up on the mesh: the
/// settings sheet lists keys, and a host that is offline today — or gone for
/// good — still has to be nameable there. A device id alone would leave the
/// user deciding which ULID to revoke.
public struct MirrorWriteHost: Hashable, Sendable, Identifiable {
  public let deviceID: String
  public let deviceName: String
  public var id: String { deviceID }

  public init(deviceID: String, deviceName: String) {
    self.deviceID = deviceID
    self.deviceName = deviceName
  }

  /// The id in a form that fits beside a name. Enough to tell two hosts apart,
  /// never enough to be mistaken for the whole handle — the ellipsis says so.
  /// Sixteen because a ULID's first sixteen characters are its timestamp plus
  /// four of randomness, and because eliding two characters off a short id
  /// costs the disambiguating end and saves nothing.
  public var shortDeviceID: String {
    deviceID.count <= 16 ? deviceID : String(deviceID.prefix(16)) + "…"
  }
}

/// Where this phone keeps the desktop's `FIELD_NATIVE_TERMINAL_MIRROR_WRITE`
/// secrets, one per host (GT-4a's asymmetry from the client side).
///
/// The value is presented as the attachment's `accessToken`, which is the only
/// thing that can turn an attach into a read-write one. It is therefore a
/// secret in the EL7 sense: it is never rendered, never logged, and never
/// leaves this protocol — `capability(for:)` hands it to exactly one caller,
/// `TerminalAttachment.init`.
///
/// `AnyObject` because the two implementations are reference types with
/// process-wide identity (a keychain, or one dictionary), and `Sendable`
/// because the host reads it from the main actor while nothing here is
/// actor-bound.
public protocol MirrorWriteStoring: AnyObject, Sendable {
  /// The secret for one host, or `nil` — which is the honest default: a
  /// viewer, not a typist.
  func capability(for deviceID: String) -> String?
  /// Upsert. The name rides along so `hosts()` can name what it lists.
  func set(_ capability: String, for host: MirrorWriteHost) throws
  func remove(for deviceID: String) throws
  /// Every host this phone holds a key for, sorted by name — the settings
  /// sheet renders this list and nothing else, because the secrets are not
  /// showable.
  func hosts() -> [MirrorWriteHost]
}

/// A keychain failure, carried whole rather than flattened to a Bool: the
/// difference between "the item was not there" and "this device is locked" is
/// what the card's note has to say.
public struct MirrorWriteStoreError: Error, CustomStringConvertible, Sendable {
  public let status: OSStatus

  public init(status: OSStatus) {
    self.status = status
  }

  public var description: String {
    guard let message = SecCopyErrorMessageString(status, nil) as String? else {
      return "keychain error \(status)"
    }
    return message
  }
}

/// The product's store: one generic-password item per host.
///
/// Two attributes are the whole security decision, and both are deliberate.
/// `AfterFirstUnlockThisDeviceOnly` because the terminal attaches from the
/// background (a resume from foreground re-presents the token) but the secret
/// must not ride a backup to another phone; `kSecAttrSynchronizable = false`
/// because a mirror-write key is a grant to ONE device, and iCloud Keychain
/// would quietly widen it to every device the user owns.
public final class KeychainMirrorWriteStore: MirrorWriteStoring {
  /// One service for the whole app; the account is the host's device id, which
  /// is what makes the items per-host without a second index.
  public static let service = "com.jamesyong.vibefield.ios.mirror-write"

  public init() {}

  public func capability(for deviceID: String) -> String? {
    var query = Self.baseQuery
    query[kSecAttrAccount as String] = deviceID
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    // A read that fails is indistinguishable from a key we do not hold, on
    // purpose: every failure here means the same thing to the caller — no
    // token to present — and inventing a louder answer would put keychain
    // vocabulary on a card about a terminal.
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  public func set(_ capability: String, for host: MirrorWriteHost) throws {
    let value = Data(capability.utf8)
    var attributes = Self.baseQuery
    attributes[kSecAttrAccount as String] = host.deviceID
    attributes[kSecAttrLabel as String] = host.deviceName
    attributes[kSecValueData as String] = value
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(attributes as CFDictionary, nil)
    guard status == errSecDuplicateItem else {
      guard status == errSecSuccess else { throw MirrorWriteStoreError(status: status) }
      return
    }
    // Re-entering a key for a host we already know is the normal case (the
    // desktop rotated its secret), so a duplicate is an update, not an error.
    // The accessibility class rides the update too: an item written by an
    // older build must not keep an older protection class.
    var query = Self.baseQuery
    query[kSecAttrAccount as String] = host.deviceID
    let update: [String: Any] = [
      kSecValueData as String: value,
      kSecAttrLabel as String: host.deviceName,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let updated = SecItemUpdate(query as CFDictionary, update as CFDictionary)
    guard updated == errSecSuccess else { throw MirrorWriteStoreError(status: updated) }
  }

  /// Removing a key this phone does not hold is the state the caller asked
  /// for, so `errSecItemNotFound` is success — the alternative is a settings
  /// row that throws at the user for a race it cannot see.
  public func remove(for deviceID: String) throws {
    var query = Self.baseQuery
    query[kSecAttrAccount as String] = deviceID
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw MirrorWriteStoreError(status: status)
    }
  }

  public func hosts() -> [MirrorWriteHost] {
    var query = Self.baseQuery
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitAll
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let rows = item as? [[String: Any]]
    else { return [] }
    // No `kSecReturnData` here: this list exists to be RENDERED, and the one
    // way to keep a secret off the screen is not to fetch it.
    return sortedByName(
      rows.compactMap { row in
        guard let deviceID = row[kSecAttrAccount as String] as? String else { return nil }
        let label = row[kSecAttrLabel as String] as? String
        // A label we never wrote is not a name; falling back to the id keeps
        // the row honest rather than blank.
        let name = (label?.isEmpty == false) ? label! : deviceID
        return MirrorWriteHost(deviceID: deviceID, deviceName: name)
      })
  }

  private static var baseQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrSynchronizable as String: false,
    ]
  }
}

/// The test double, and the DEBUG smoke seed.
///
/// `wildcard` is the reason this is not simply a dictionary: a headless run
/// against a real desktop knows the secret but not the device id it will
/// discover, so one capability standing in for every host it has no explicit
/// entry for is what lets `-vf-auto-attach` type with no finger on the glass.
/// An explicit entry always wins over it — the wildcard is a fallback, never
/// an override — and it is deliberately NOT a host: `hosts()` lists what was
/// stored, so a wildcard shows up in no settings list and can be revoked by
/// relaunching, which is exactly what a debugging aid should be.
public final class InMemoryMirrorWriteStore: MirrorWriteStoring, @unchecked Sendable {
  private struct Entry {
    let host: MirrorWriteHost
    let capability: String
  }

  /// `@unchecked` is honest here and nowhere else in this file: the dictionary
  /// is mutable, and this lock is what makes every access to it exclusive.
  private let lock = NSLock()
  private var entries: [String: Entry] = [:]
  private let wildcard: String?

  public init(wildcard: String? = nil) {
    self.wildcard = wildcard
  }

  public func capability(for deviceID: String) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return entries[deviceID]?.capability ?? wildcard
  }

  public func set(_ capability: String, for host: MirrorWriteHost) throws {
    lock.lock()
    defer { lock.unlock() }
    entries[host.deviceID] = Entry(host: host, capability: capability)
  }

  /// Same rule as the keychain's: a key that is not there is already removed.
  public func remove(for deviceID: String) throws {
    lock.lock()
    defer { lock.unlock() }
    entries[deviceID] = nil
  }

  public func hosts() -> [MirrorWriteHost] {
    lock.lock()
    defer { lock.unlock() }
    return sortedByName(entries.values.map(\.host))
  }
}

/// One ordering for both stores. The id breaks ties so a list of two hosts
/// that share a name is still stable between renders.
private func sortedByName(_ hosts: [MirrorWriteHost]) -> [MirrorWriteHost] {
  hosts.sorted { left, right in
    let names = left.deviceName.localizedCaseInsensitiveCompare(right.deviceName)
    if names != .orderedSame { return names == .orderedAscending }
    return left.deviceID < right.deviceID
  }
}
