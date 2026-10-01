import FieldDesign
import Foundation
import Testing

@testable import FieldMesh

/// IOS-8c — what the phone remembers about an account, on a scratch defaults
/// suite so no row here can touch what a real user has.
@Suite("an account's desktops and face are remembered by login")
struct AccountMemoryTests {
  private func scratch() -> UserDefaults {
    let name = "vf.test.account-memory." + UUID().uuidString
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
  }

  private func desktop(id: String, name: String) -> FieldDesktop {
    FieldDesktop(deviceId: id, name: name, platform: "darwin", state: .ready, feed: .door)
  }

  @Test("a listed desktop is remembered, by device id, with the name it reports now")
  func remembers() {
    let memory = DesktopMemory(defaults: scratch())
    let t0 = Date(timeIntervalSince1970: 1_000)
    memory.record([desktop(id: "a", name: "studio")], login: "Me@Example.com", at: t0)
    #expect(memory.remembered(for: "me@example.com") == [.init(deviceId: "a", name: "studio", lastSeen: t0)])
    // Seen again under a new name: the same row, renamed, re-dated.
    let t1 = Date(timeIntervalSince1970: 2_000)
    memory.record([desktop(id: "a", name: "studio-2"), desktop(id: "b", name: "mini")], login: "me@example.com", at: t1)
    #expect(memory.remembered(for: "me@example.com").map(\.name) == ["studio-2", "mini"])
    #expect(memory.remembered(for: "me@example.com").allSatisfy { $0.lastSeen == t1 })
  }

  @Test("an absent desktop stays remembered until the account is forgotten")
  func staysUntilForgotten() {
    let memory = DesktopMemory(defaults: scratch())
    memory.record([desktop(id: "a", name: "studio"), desktop(id: "b", name: "mini")], login: "me@example.com")
    memory.record([desktop(id: "a", name: "studio")], login: "me@example.com")
    #expect(memory.remembered(for: "me@example.com").map(\.deviceId) == ["a", "b"])
    memory.forget(login: "me@example.com")
    #expect(memory.remembered(for: "me@example.com").isEmpty)
  }

  @Test("another login's desktops are another login's")
  func perLogin() {
    let memory = DesktopMemory(defaults: scratch())
    memory.record([desktop(id: "a", name: "studio")], login: "alice@corp.com")
    #expect(memory.remembered(for: "bob@corp.com").isEmpty)
    memory.forget(login: "bob@corp.com")
    #expect(memory.remembered(for: "alice@corp.com").count == 1)
  }

  @Test("an empty listing records nothing and an empty login records nowhere")
  func nothingToRecord() {
    let memory = DesktopMemory(defaults: scratch())
    memory.record([], login: "me@example.com")
    memory.record([desktop(id: "a", name: "studio")], login: "")
    #expect(memory.remembered(for: "me@example.com").isEmpty)
    #expect(memory.remembered(for: "").isEmpty)
  }

  @Test("the face is dealt once from the first user id and kept")
  func faceDealtOnce() {
    let store = AccountFaceStore(defaults: scratch())
    #expect(store.face(for: "me@example.com") == nil)
    let dealt = store.dealIfNeeded(login: "me@example.com", userId: "01J8F2ZQ9K3M4N5P6Q7R8S9T0V")
    #expect(dealt == UserFace(emoji: "🐳", frame: .sticker))
    // A second desktop of the same login, another ULID: the face does not move.
    #expect(store.dealIfNeeded(login: "me@example.com", userId: "01J9AAAAAAAAAAAAAAAAAAAAAA") == dealt)
    #expect(store.face(for: "ME@EXAMPLE.COM") == dealt)
  }

  @Test("the last home is remembered per login, replaced by the next, and forgotten with the account")
  func lastHome() {
    let memory = HomeMemory(defaults: scratch())
    #expect(memory.lastHome(for: "me@example.com") == nil)
    memory.record("dev-studio", login: "Me@Example.com")
    #expect(memory.lastHome(for: "me@example.com") == "dev-studio")
    // A re-home replaces it: there is one last home, never a list.
    memory.record("dev-mini", login: "me@example.com")
    #expect(memory.lastHome(for: "ME@EXAMPLE.COM") == "dev-mini")
    // Another login's home is another login's.
    #expect(memory.lastHome(for: "bob@corp.com") == nil)
    // An empty login remembers nowhere — the pre-login window knows no account.
    memory.record("dev-x", login: "")
    #expect(memory.lastHome(for: "") == nil)
    memory.forget(login: "me@example.com")
    #expect(memory.lastHome(for: "me@example.com") == nil)
  }

  @Test("the desktop's own face overrides the deal, and sign out forgets it")
  func setAndForget() {
    let store = AccountFaceStore(defaults: scratch())
    store.dealIfNeeded(login: "me@example.com", userId: "01J8F2ZQ9K3M4N5P6Q7R8S9T0V")
    store.set(UserFace(emoji: "🦊", frame: .coin), for: "me@example.com")
    #expect(store.face(for: "me@example.com") == UserFace(emoji: "🦊", frame: .coin))
    store.forget(login: "me@example.com")
    #expect(store.face(for: "me@example.com") == nil)
  }
}
