import Testing

@testable import FieldHome

/// RB-2 — the home's acts outside the way in, under a demo (VF-PM 21:59:10Z on PLAN-2c: Q1, Q2, and the way to
/// Developer): under a demo the Developer page chose, the corner's and Settings' Sign in and Sign out are held, while a
/// scripted run's mock keeps its own; under any demo This phone › Lock changes nothing, either way; and under any demo
/// the way to Developer, its switch and its picker are never held, so a demo can always be switched off. With no demo
/// nothing is held. Each row asserts a hold that stands before any that does not, so a table that holds nothing is red.
/// WI-W2e A (2026-11-14) — under any demo the corner's and Settings' Try again starts nothing.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("under a demo the corner, Settings and the lock reach nothing real, and Developer is always reachable")
struct DemoHoldTests {
  private let field = LaunchFixtures(demoField: true, account: nil)
  private let state = LaunchFixtures(demoField: false, account: "approval")

  @Test("under a demo the page chose, Sign in and Sign out are held; a scripted run's mock keeps its own")
  func accountActs() {
    let chosen = [field, state].map { $0.holds(.account, scripted: false) }
    let scripted = [field, state].map { $0.holds(.account, scripted: true) }
    let none = LaunchFixtures.off.holds(.account, scripted: false)
    #expect(chosen == [true, true])
    #expect(scripted == [false, false])
    #expect(none == false)
  }

  @Test("under any demo This phone › Lock changes nothing, either way; with none it does")
  func lock() {
    let held = [field, state].flatMap { fixtures in [false, true].map { fixtures.holds(.lock, scripted: $0) } }
    let none = LaunchFixtures.off.holds(.lock, scripted: false)
    #expect(held == [true, true, true, true])
    #expect(none == false)
  }

  /// WI-W2e A (James on the page The Way In, 2026-11-14 03:47:45Z): the corner's and Settings' Try again, under
  /// "Couldn’t connect.", starts your account's network, and no demo has one to start.
  @Test("under any demo Try again starts nothing, a scripted run's included; with none it is made")
  func tryAgain() {
    let held = [field, state].flatMap { fixtures in [false, true].map { fixtures.holds(.tryAgain, scripted: $0) } }
    let none = [false, true].map { LaunchFixtures.off.holds(.tryAgain, scripted: $0) }
    #expect(held == [true, true, true, true])
    #expect(none == [false, false])
  }

  @Test("under any demo the way to Developer, its switch and its picker are never held")
  func developerReachable() {
    let lockHeld = field.holds(.lock, scripted: false)
    #expect(lockHeld == true)
    let ways: [LaunchFixtures.HomeAct] = [.openSettings, .openDeveloper, .demoFieldSwitch, .accountPicker]
    let held = [field, state, LaunchFixtures.off].flatMap { fixtures in
      [false, true].flatMap { scripted in ways.map { fixtures.holds($0, scripted: scripted) } }
    }
    #expect(held == Array(repeating: false, count: 24))
  }
}
