import Foundation
import Security

/// TM-3 (2026-09-14) — remove what the retired mirror-write store left behind.
///
/// Until this build the phone kept one Keychain item per desktop, each holding
/// that floor's mirror-write capability: a durable secret it presented on every
/// attach to earn the right to type. TM-D3 replaced that with a claim in the
/// attach grant — per client, per session, expiring — and TM-3 deleted the
/// store, the sheet, the settings section and the desktop door that filled them.
///
/// The items themselves do not go away on their own. A phone upgrading from an
/// older build would keep secrets in its Keychain that nothing can read, use, or
/// show a person a way to remove. So this runs once at launch and deletes them.
///
/// Two properties are the whole design, and both are deliberate:
///
/// - **It never reads a value.** The query carries no `kSecReturnData`, so the
///   capability does not enter this process even for a moment on its way to
///   being destroyed. There is nothing to leak into a log, a crash report, or a
///   debugger, and nothing here could be repurposed into a reader.
/// - **It deletes by SERVICE, not by account.** The retired store indexed items
///   by the host's device id and this code has no list of hosts — deleting the
///   whole service is what makes the sweep complete rather than as complete as
///   whatever the phone happens to know about today.
///
/// `errSecItemNotFound` is the expected outcome on a clean install and on every
/// launch after the first, and it is success: the state asked for is "no items",
/// and a phone that never held one is already there.
public enum RetiredWriteKeyCleanup {
  /// The retired store's Keychain service, spelled here because the store that
  /// owned the constant is deleted. It is a literal on purpose: reviving the
  /// type just to name a string would put the store back in the build.
  static let retiredService = "com.jamesyong.vibefield.ios.mirror-write"

  /// The defaults key that makes this once rather than per launch.
  static let doneKey = "vibefield.tm3.write-keys-removed"

  /// Delete the retired items if this build has not already done so.
  ///
  /// Returns whether the sweep RAN, not whether it found anything — a caller
  /// that wants to know the difference is a caller reading a secret's shadow,
  /// and there is no reason to offer it one.
  @discardableResult
  public static func runOnce(defaults: UserDefaults = .standard) -> Bool {
    guard !defaults.bool(forKey: doneKey) else { return false }
    let status = deleteAll()
    // The flag is only set when the Keychain agrees the items are gone. A
    // failure this build could not explain (a locked keychain at a very early
    // launch, say) must be retried on the next launch rather than recorded as
    // done — an undeleted secret that nobody will ever look at again is exactly
    // the outcome this exists to prevent.
    if status == errSecSuccess || status == errSecItemNotFound {
      defaults.set(true, forKey: doneKey)
      return true
    }
    return false
  }

  /// The delete itself, exposed for the test that proves no value is read.
  @discardableResult
  static func deleteAll() -> OSStatus {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: retiredService,
      // The retired store wrote `kSecAttrSynchronizable = false`, and a delete
      // that does not say so matches only non-synchronizable items by default —
      // which is what we want, and is stated rather than relied upon.
      kSecAttrSynchronizable as String: false,
    ]
    return SecItemDelete(query as CFDictionary)
  }
}
