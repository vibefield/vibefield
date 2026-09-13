import Testing

@testable import FieldTerminal

/// The store's contract, pinned on the fake.
///
/// `KeychainMirrorWriteStore` is deliberately NOT exercised here: a package
/// test host has its own keychain access group, so what these tests would
/// prove is that the simulator's keychain works — not that the product's
/// items are written where the product will look for them. The keychain leg
/// is a device/app-run witness (the README's smoke recipe), and its shape is
/// held by the protocol both stores implement.
@Suite("mirror write store")
struct MirrorWriteStoreTests {
  private let studio = MirrorWriteHost(deviceID: "device-studio", deviceName: "studio")
  private let laptop = MirrorWriteHost(deviceID: "device-laptop", deviceName: "laptop")

  @Test("a key goes in and comes back for its own host")
  func roundTrip() throws {
    let store = InMemoryMirrorWriteStore()
    #expect(store.capability(for: studio.deviceID) == nil, "no key is the honest default")
    try store.set("s3cret", for: studio)
    #expect(store.capability(for: studio.deviceID) == "s3cret")
    #expect(store.hosts() == [studio], "the name is stored beside the secret")
  }

  /// A host that rotated its secret is the normal case, not an error: the
  /// second write replaces the first rather than duplicating the host.
  @Test("setting a second key for one host replaces it")
  func setUpserts() throws {
    let store = InMemoryMirrorWriteStore()
    try store.set("first", for: studio)
    try store.set("second", for: MirrorWriteHost(deviceID: studio.deviceID, deviceName: "studio-2"))
    #expect(store.capability(for: studio.deviceID) == "second")
    #expect(store.hosts().count == 1)
    #expect(store.hosts().first?.deviceName == "studio-2", "the name follows the key")
  }

  /// The whole point of keying by device: a grant is from ONE desktop, and a
  /// key for one host must never be presented to another.
  @Test("hosts are isolated from each other")
  func perHostIsolation() throws {
    let store = InMemoryMirrorWriteStore()
    try store.set("studio-key", for: studio)
    #expect(store.capability(for: laptop.deviceID) == nil)
    try store.set("laptop-key", for: laptop)
    #expect(store.capability(for: studio.deviceID) == "studio-key")
    #expect(store.capability(for: laptop.deviceID) == "laptop-key")
  }

  @Test("removing a key removes it and nothing else")
  func remove() throws {
    let store = InMemoryMirrorWriteStore()
    try store.set("studio-key", for: studio)
    try store.set("laptop-key", for: laptop)
    try store.remove(for: studio.deviceID)
    #expect(store.capability(for: studio.deviceID) == nil)
    #expect(store.capability(for: laptop.deviceID) == "laptop-key")
    #expect(store.hosts() == [laptop])
  }

  /// Pinned rather than left to chance: removing a key this phone does not
  /// hold is the state the caller asked for. Throwing would put a settings row
  /// in the business of explaining a race it cannot see, and the keychain
  /// store agrees (`errSecItemNotFound` is success there).
  @Test("removing an unknown host is not an error")
  func removeUnknownIsSilent() throws {
    let store = InMemoryMirrorWriteStore()
    try store.remove(for: "device-nobody")
    #expect(store.hosts().isEmpty)
  }

  /// The settings list is read top to bottom by a human; case is not an
  /// ordering, and the id breaks ties so two hosts sharing a name stay put
  /// between renders.
  @Test("hosts come back sorted by name")
  func hostsSortedByName() throws {
    let store = InMemoryMirrorWriteStore()
    let zeta = MirrorWriteHost(deviceID: "d-zeta", deviceName: "zeta")
    let alpha = MirrorWriteHost(deviceID: "d-alpha", deviceName: "Alpha")
    let twinB = MirrorWriteHost(deviceID: "d-2", deviceName: "twin")
    let twinA = MirrorWriteHost(deviceID: "d-1", deviceName: "twin")
    for host in [zeta, twinB, alpha, twinA] { try store.set("k", for: host) }
    #expect(store.hosts() == [alpha, twinA, twinB, zeta])
  }

  /// The DEBUG smoke path: a headless run knows the secret but not the device
  /// id it will discover, so the wildcard answers for hosts it has never seen.
  @Test("a wildcard answers for unknown hosts")
  func wildcardAnswersUnknownHosts() {
    let store = InMemoryMirrorWriteStore(wildcard: "smoke")
    #expect(store.capability(for: "any-device-at-all") == "smoke")
  }

  /// …and it is a FALLBACK, never an override: a stored key is what the host
  /// actually granted, and it wins.
  @Test("an explicit key beats the wildcard")
  func explicitBeatsWildcard() throws {
    let store = InMemoryMirrorWriteStore(wildcard: "smoke")
    try store.set("real", for: studio)
    #expect(store.capability(for: studio.deviceID) == "real")
    #expect(store.capability(for: laptop.deviceID) == "smoke")
  }

  /// A wildcard is not a stored grant, so it appears in no settings list —
  /// which is also what makes it revocable by relaunching.
  @Test("a wildcard is not a host")
  func wildcardIsNotListed() {
    #expect(InMemoryMirrorWriteStore(wildcard: "smoke").hosts().isEmpty)
  }

  /// Enough of the id to tell two desktops apart, never enough to read as the
  /// whole handle — the ellipsis is the part that says so.
  @Test("the short device id is elided only when it has to be")
  func shortDeviceID() {
    #expect(MirrorWriteHost(deviceID: "short", deviceName: "a").shortDeviceID == "short")
    #expect(
      MirrorWriteHost(deviceID: "demo-device-01", deviceName: "a").shortDeviceID
        == "demo-device-01",
      "a 14-character id keeps the two characters that tell it from its neighbour")
    #expect(
      MirrorWriteHost(deviceID: "01J8ZQ4M7N2KP5R3", deviceName: "a").shortDeviceID
        == "01J8ZQ4M7N2KP5R3")
    #expect(
      MirrorWriteHost(deviceID: "01J8ZQ4M7N2KP5R3T9WXYZ", deviceName: "a").shortDeviceID
        == "01J8ZQ4M7N2KP5R3…")
  }
}

/// IOS-4d — the granted key takes exactly the path a pasted one takes, and is
/// no more visible for having arrived over a door.
///
/// The grant's own type redacts its capability (`TerminalMirrorWriteGrant`'s
/// `description`, pinned in FieldProductTests). This is the other half: once
/// the capability is IN the store, nothing the store renders carries it either
/// — not the host list the settings sheet draws, not a host's description, and
/// not the error of a store that refused. A secret that survives its type's
/// redaction only to be printed by the thing it was handed to is not redacted.
@Suite struct GrantedWriteKeyRedactionTests {
  private static let secret = "mw_EXAMPLE_not_a_real_capability_0000"

  @Test func aStoredCapabilityIsNeverRenderedByTheStore() throws {
    let store = InMemoryMirrorWriteStore()
    let host = MirrorWriteHost(deviceID: "dev-studio", deviceName: "studio")
    try store.set(Self.secret, for: host)

    // It went in, and it comes back exactly once — at the attach.
    #expect(store.capability(for: "dev-studio") == Self.secret)

    // And nothing the settings sheet can reach renders it.
    let hosts = store.hosts()
    #expect(hosts.count == 1)
    #expect(!String(describing: hosts).contains("mw_EXAMPLE"))
    #expect(!String(describing: host).contains("mw_EXAMPLE"))
    #expect(String(describing: hosts).contains("studio"))
  }

  /// A store that refuses says why, and the reason is about the KEYCHAIN and
  /// never about the key.
  @Test func aRefusedWriteNeverEchoesTheCapability() {
    // -25293 is `errSecAuthFailed`, spelled as its number so this test needs
    // no Security import to say what it is about.
    let error = MirrorWriteStoreError(status: -25293)
    #expect(!error.description.contains("mw_EXAMPLE"))
    #expect(!error.description.isEmpty)
  }

  /// Replacing a granted key with a pasted one (or the other way) is an
  /// upsert, not a second item: one host, one key, whichever door it came in
  /// through.
  @Test func aGrantAndAPasteShareOneSlotPerHost() throws {
    let store = InMemoryMirrorWriteStore()
    let host = MirrorWriteHost(deviceID: "dev-studio", deviceName: "studio")
    try store.set(Self.secret, for: host)
    try store.set("pasted-by-hand", for: host)
    #expect(store.hosts().count == 1)
    #expect(store.capability(for: "dev-studio") == "pasted-by-hand")
  }
}
