import FieldAgents
import FieldDesign
import Foundation
import Testing

@testable import FieldMesh

/// IOS-8d — sign out, on a scratch state directory and a scratch defaults
/// suite: what goes, what stays, and that the model forgets the login it
/// remembered.
@Suite("sign out forgets the field's teachings and keeps the person's")
struct SignOutTests {
  private func scratchDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("vf-signout-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func scratchDefaults() -> UserDefaults {
    let name = "vf.test.signout." + UUID().uuidString
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
  }

  /// A node's state as truffle leaves it: the keys, the device id, and the
  /// login this app remembered beside them.
  private func seedNodeState(at directory: URL, login: String) throws {
    try Data("01J0000000000000000000000A".utf8).write(to: directory.appendingPathComponent("device-id.txt"))
    let keys = directory.appendingPathComponent("tailscaled.state", isDirectory: false)
    try Data("not-a-real-key".utf8).write(to: keys)
    try AccountLoginStore(stateDirectory: directory).write(login)
  }

  @Test("the login store can forget, now that forgetting is a ruling")
  func loginStoreClears() throws {
    let directory = try scratchDirectory()
    let store = AccountLoginStore(stateDirectory: directory)
    try store.write("alice@corp.com")
    #expect(store.read() == "alice@corp.com")
    try store.clear()
    #expect(store.read() == nil)
    // Clearing twice is not an error: there is nothing to forget.
    try store.clear()
  }

  @Test("the sweep removes the node's state, this login's memory and face, and the ledger — and nothing of the person's")
  func theSweep() throws {
    let directory = try scratchDirectory()
    try seedNodeState(at: directory, login: "alice@corp.com")
    // A legacy directory that survived a failed migration would bring its keys
    // back at the next launch; the sweep takes it too.
    let legacy = directory.deletingLastPathComponent().appendingPathComponent("vf-signout-legacy-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
    try Data("old-key".utf8).write(to: legacy.appendingPathComponent("tailscaled.state"))
    let defaults = scratchDefaults()
    DesktopMemory(defaults: defaults).record(
      [FieldDesktop(deviceId: "a", name: "studio", platform: nil, state: .ready, feed: .door)], login: "alice@corp.com")
    AccountFaceStore(defaults: defaults).set(UserFace(emoji: "🦊"), for: "alice@corp.com")
    // DS-8 — the desktop this login's field was last read through.
    HomeMemory(defaults: defaults).record("a", login: "alice@corp.com")
    // Another login's memory is another login's: it stays.
    AccountFaceStore(defaults: defaults).set(UserFace(emoji: "🐙"), for: "bob@corp.com")
    HomeMemory(defaults: defaults).record("b", login: "bob@corp.com")
    defaults.set(Data("ledger".utf8), forKey: UserDefaultsProjectLedgerStore.defaultKey)
    for key in SignOutSweep.kept { defaults.set(Data("mine".utf8), forKey: key) }
    defaults.set("dark", forKey: "vf.terminal.appearance.test")

    let report = SignOutSweep(login: "alice@corp.com", stateDirectory: directory, legacyStateDirectory: legacy)
      .run(defaults: defaults)

    #expect(
      report.removed == ["node state", "legacy node state", "desktops", "face", "home", "project ledger"])
    #expect(!FileManager.default.fileExists(atPath: directory.path))
    #expect(!FileManager.default.fileExists(atPath: legacy.path))
    #expect(DesktopMemory(defaults: defaults).remembered(for: "alice@corp.com").isEmpty)
    #expect(AccountFaceStore(defaults: defaults).face(for: "alice@corp.com") == nil)
    #expect(AccountFaceStore(defaults: defaults).face(for: "bob@corp.com") == UserFace(emoji: "🐙"))
    #expect(HomeMemory(defaults: defaults).lastHome(for: "alice@corp.com") == nil)
    #expect(HomeMemory(defaults: defaults).lastHome(for: "bob@corp.com") == "b")
    #expect(defaults.object(forKey: UserDefaultsProjectLedgerStore.defaultKey) == nil)
    for key in SignOutSweep.kept { #expect(defaults.data(forKey: key) == Data("mine".utf8)) }
    #expect(SignOutSweep.kept.contains("fieldterminal.appearance.v1"))
    #expect(defaults.string(forKey: "vf.terminal.appearance.test") == "dark")
  }

  @Test("with nothing to forget, the sweep reports nothing and fails nowhere")
  func nothingToForget() throws {
    let directory = try scratchDirectory().appendingPathComponent("absent", isDirectory: true)
    let report = SignOutSweep(login: nil, stateDirectory: directory).run(defaults: scratchDefaults())
    #expect(report.removed.isEmpty)
  }

  @Test("the model remembers the login from disk and forgets it at sign out, with no node running")
  @MainActor
  func theModelForgets() throws {
    let directory = try scratchDirectory()
    try seedNodeState(at: directory, login: "alice@corp.com")
    let model = MeshModel(stateDirectory: directory)
    #expect(model.rememberedLogin == "alice@corp.com")
    #expect(model.state == .off)

    model.signOut()

    #expect(model.rememberedLogin == nil)
    #expect(model.state == .off)
    #expect(!FileManager.default.fileExists(atPath: directory.path))
    // A model built on the swept directory starts with no account.
    #expect(MeshModel(stateDirectory: directory).rememberedLogin == nil)
  }
}
