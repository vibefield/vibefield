import Foundation
import Security
import Testing

@testable import FieldTerminal

/// TM-3's sweep, witnessed as far as this host allows (TM-r3, E-F3).
///
/// `deleteAll` carried the comment "exposed for the test that proves no value
/// is read" and no such test existed — a claim about a security property with
/// nothing behind it, which is the class of thing the EL7 lens exists to catch.
///
/// **What this host cannot do, measured rather than assumed.** A SwiftPM test
/// bundle on the simulator carries no application-identifier entitlement, so
/// `SecItemAdd` answers `errSecMissingEntitlement` (-34018) — the run that
/// found this is in TM-r8's body. Nothing here can therefore write an item the
/// way the retired store did, run the sweep, and watch it go: the Keychain
/// refuses before it reaches an item, and a row asserting otherwise would be
/// blaming the code for the host. That witness belongs to a device run or to a
/// bundle with a host app, and it is OWED rather than done.
///
/// **What is witnessed here instead**, and it is the claim the comment actually
/// made: the sweep's QUERY, read directly. No `kSecReturnData` and no other
/// `kSecReturn*` is the "no value is read" property itself, statically, for
/// every host; no `kSecAttrAccount` is the "deletes by service" property. Plus
/// the once-only flag, including the rule that matters most on a host like this
/// one — a delete the Keychain refuses is NOT recorded as done, so the next
/// launch tries again.
@MainActor
@Suite(.serialized) struct RetiredWriteKeyCleanupTests {
  /// The service the deleted `KeychainMirrorWriteStore` owned
  /// (`git show 87d13ec9:…/FieldTerminal/MirrorWriteStore.swift`), spelled here
  /// rather than read off the type under test — a constant compared with itself
  /// agrees with any typo. A typo in it is silent and total: the sweep would
  /// match nothing, on every launch, forever, and the secrets it exists to
  /// destroy would sit in the Keychain with nothing able to read, use, or
  /// remove them.
  @Test func theSweepNamesTheServiceTheRetiredStoreActuallyWrote() {
    #expect(RetiredWriteKeyCleanup.retiredService == "com.jamesyong.vibefield.ios.mirror-write")
    #expect(
      RetiredWriteKeyCleanup.deleteQuery[kSecAttrService as String] as? String
        == "com.jamesyong.vibefield.ios.mirror-write")
  }

  /// The property the missing test claimed: the capability does not enter this
  /// process even for a moment on its way to being destroyed.
  @Test func theSweepAsksForNoValueAndNoAttributesAtAll() {
    let query = RetiredWriteKeyCleanup.deleteQuery
    for returned in [
      kSecReturnData, kSecReturnAttributes, kSecReturnRef, kSecReturnPersistentRef,
    ] {
      #expect(query[returned as String] == nil, "\(returned)")
    }
    // …and nothing that would make a delete behave like a search, either.
    #expect(query[kSecMatchLimit as String] == nil)
  }

  /// The other half of the design: by SERVICE, never by account.
  ///
  /// The retired store keyed items on the host's device id, and this code holds
  /// no list of hosts — so an account-scoped delete would clear exactly the
  /// desktops this build remembered and leave every other one behind.
  @Test func theSweepDeletesByServiceRatherThanByHost() {
    let query = RetiredWriteKeyCleanup.deleteQuery
    #expect(query[kSecAttrAccount as String] == nil)
    #expect(query[kSecAttrLabel as String] == nil)
    #expect(query[kSecClass as String] as? String == kSecClassGenericPassword as String)
    // The retired store wrote `synchronizable = false` — a mirror-write key was
    // a grant to ONE device — and the delete says so rather than relying on the
    // default.
    #expect(query[kSecAttrSynchronizable as String] as? Bool == false)
  }

  /// A flag already set stops the sweep before it touches the Keychain at all.
  /// That is what makes this a launch cost rather than a per-launch one.
  @Test func aFlagAlreadySetStopsTheSweepBeforeItRuns() throws {
    let name = "vibefield.tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    defer { UserDefaults().removePersistentDomain(forName: name) }
    defaults.set(true, forKey: RetiredWriteKeyCleanup.doneKey)

    #expect(!RetiredWriteKeyCleanup.runOnce(defaults: defaults))
  }

  /// The rule this host is unusually good at witnessing: the flag is set ONLY
  /// when the Keychain agrees the items are gone.
  ///
  /// A failure this build could not explain — a locked keychain at a very early
  /// launch, or the missing entitlement this very process has — must be retried
  /// on the next launch rather than recorded as done, because an undeleted
  /// secret nobody will ever look at again is exactly the outcome the sweep
  /// exists to prevent. The row asserts the RULE (`ran` iff the delete was
  /// accepted) so it holds on a host that can use the Keychain too, and names
  /// which branch it took.
  @Test func aSweepTheKeychainRefusesIsRetriedRatherThanRecordedAsDone() throws {
    let status = RetiredWriteKeyCleanup.deleteAll()
    let accepted = status == errSecSuccess || status == errSecItemNotFound

    let name = "vibefield.tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    defer { UserDefaults().removePersistentDomain(forName: name) }
    #expect(!defaults.bool(forKey: RetiredWriteKeyCleanup.doneKey))

    let ran = RetiredWriteKeyCleanup.runOnce(defaults: defaults)
    #expect(ran == accepted)
    #expect(defaults.bool(forKey: RetiredWriteKeyCleanup.doneKey) == accepted)

    if accepted {
      // A host that can reach the Keychain: the sweep is done and does not run
      // again. (`runOnce` reports whether it RAN, never what it found — a
      // caller that could tell the difference would be reading a secret's
      // shadow.)
      #expect(!RetiredWriteKeyCleanup.runOnce(defaults: defaults))
    } else {
      // This simulator, today: -34018, and nothing recorded, so the next
      // launch tries again.
      #expect(status == errSecMissingEntitlement)
      #expect(!RetiredWriteKeyCleanup.runOnce(defaults: defaults))
      #expect(!defaults.bool(forKey: RetiredWriteKeyCleanup.doneKey))
    }
  }
}
