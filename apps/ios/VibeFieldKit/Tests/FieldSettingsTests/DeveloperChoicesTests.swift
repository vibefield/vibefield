import Foundation
import Testing

@testable import FieldSettings

/// RB-2 — the Developer page's choices (DESIGN.md §8 "The phone's Settings", amended 2026-11-12): this phone's own,
/// kept in its defaults under their two keys, and Off and Your own remove the key, so nothing chosen is nothing stored.
/// The removal row asserts the keys stand before it asserts them gone, so a store that keeps nothing is red.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("the Developer page's choices are this phone's own, and Off lets them go")
struct DeveloperChoicesTests {
  private func store() throws -> (defaults: UserDefaults, done: () -> Void) {
    let name = "vibefield.tests.developer-choices.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    return (defaults, { defaults.removePersistentDomain(forName: name) })
  }

  @Test("a choice is kept under its key in this phone's defaults, and read back as chosen")
  func kept() throws {
    let (d, done) = try store()
    defer { done() }
    let keys = [DeveloperChoices.demoFieldKey, DeveloperChoices.accountKey]
    #expect(keys == ["vibefield.developer.demo-field", "vibefield.developer.account"])
    DeveloperChoices.setDemoField(true, in: d)
    DeveloperChoices.setAccount("approval", in: d)
    let field = d.object(forKey: DeveloperChoices.demoFieldKey) as? Bool
    let account = d.string(forKey: DeveloperChoices.accountKey)
    #expect(field == true)
    #expect(account == "approval")
    let read = DeveloperChoices.read(d)
    #expect(read == DeveloperChoices(demoField: true, account: "approval"))
  }

  @Test("Off and Your own remove the key: never a stored false, never an empty name")
  func offLetsGo() throws {
    let (d, done) = try store()
    defer { done() }
    DeveloperChoices.setDemoField(true, in: d)
    DeveloperChoices.setAccount("approval", in: d)
    let keys = [DeveloperChoices.demoFieldKey, DeveloperChoices.accountKey]
    let before = keys.map { d.object(forKey: $0) != nil }
    #expect(before == [true, true])
    DeveloperChoices.setDemoField(false, in: d)
    DeveloperChoices.setAccount(nil, in: d)
    let after = keys.map { d.object(forKey: $0) == nil }
    #expect(after == [true, true])
  }
}
