import FieldSettings
import Foundation
import Testing

@testable import FieldHome

/// RB-2 — the demo an open stands in (DESIGN.md §8 "The phone's Settings", amended 2026-11-12): read once for the
/// launch, a launch argument first and the Developer page's choices second; an account state let go in the same read,
/// so it stands for one open; Demo field kept until it is switched off; and the picker offering exactly the states the
/// fixtures stamp. Each row writes the store by its keys directly, never through `DeveloperChoices`' own setters, and
/// asserts a positive read before any absence.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("a demo is read once per launch: an argument first, the page's choices second, an account state for one open")
@MainActor
struct LaunchFixturesTests {
  /// A defaults domain of the row's own, so no row reads another's choices, and its removal when the row ends.
  private func store() throws -> (defaults: UserDefaults, done: () -> Void) {
    let name = "vibefield.tests.launch-fixtures.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    return (defaults, { defaults.removePersistentDomain(forName: name) })
  }

  @Test("a stored account state is this open's, and its choice is let go in the same read")
  func readOnce() throws {
    let (d, done) = try store()
    defer { done() }
    d.set("approval", forKey: DeveloperChoices.accountKey)
    let read = LaunchFixtures.read(arguments: [], defaults: d)
    #expect(read == LaunchFixtures(demoField: false, account: "approval"))
    let left = d.string(forKey: DeveloperChoices.accountKey)
    #expect(left == nil)
  }

  @Test("the open after it is your own again")
  func nextOpen() throws {
    let (d, done) = try store()
    defer { done() }
    d.set("approval", forKey: DeveloperChoices.accountKey)
    let first = LaunchFixtures.read(arguments: [], defaults: d)
    let second = LaunchFixtures.read(arguments: [], defaults: d)
    #expect(first == LaunchFixtures(demoField: false, account: "approval"))
    #expect(second == .off)
  }

  @Test("Demo field stays on from open to open until it is switched off")
  func demoFieldStays() throws {
    let (d, done) = try store()
    defer { done() }
    d.set(true, forKey: DeveloperChoices.demoFieldKey)
    let reads = [LaunchFixtures.read(arguments: [], defaults: d), LaunchFixtures.read(arguments: [], defaults: d)]
    let on = LaunchFixtures(demoField: true, account: nil)
    #expect(reads == [on, on])
    let kept = d.object(forKey: DeveloperChoices.demoFieldKey) as? Bool
    #expect(kept == true)
  }

  @Test("an argument wins over a stored choice, and leaves the store as it was")
  func argumentWins() throws {
    let (d, done) = try store()
    defer { done() }
    d.set(true, forKey: DeveloperChoices.demoFieldKey)
    d.set("signedin", forKey: DeveloperChoices.accountKey)
    let read = LaunchFixtures.read(arguments: ["-vf-demo-account=approval"], defaults: d)
    #expect(read == LaunchFixtures(demoField: false, account: "approval"))
    let account = d.string(forKey: DeveloperChoices.accountKey)
    let field = d.object(forKey: DeveloperChoices.demoFieldKey) as? Bool
    #expect(account == "signedin")
    #expect(field == true)
  }

  @Test("Demo field's argument is a demo; no argument and nothing stored is none")
  func offByDefault() throws {
    let (d, done) = try store()
    defer { done() }
    let mocked = LaunchFixtures.read(arguments: ["-vf-mock"], defaults: d)
    let none = LaunchFixtures.read(arguments: [], defaults: d)
    #expect(mocked == LaunchFixtures(demoField: true, account: nil))
    #expect(none == .off)
  }

  @Test("the picker offers exactly the 23 states the fixtures stamp, in the fixtures' order")
  func pickerParity() {
    let names = AccountFixtures.names
    let keys = DeveloperWords.accountStates.map { $0.key }
    #expect(names.count == 23)
    #expect(keys == names)
    let unstamped = names.filter { AccountFixtures.demo(named: $0) == nil }
    #expect(unstamped == [])
  }
}
