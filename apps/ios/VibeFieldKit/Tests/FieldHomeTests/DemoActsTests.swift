import FieldMesh
import FieldSettings
import Foundation
import Testing

@testable import FieldHome

/// RB-2 — the way in's acts under a demo (DESIGN.md §8 "The phone's Settings", amended 2026-11-12; VF-PM's ruling,
/// 2026-11-12 18:06:27Z): every act that would reach this phone's real account, its lock, the code reader or Safari is
/// held while a demo stands, and made when none does; the page moves and the curtain's Unlock are made either way; and
/// whether a demo stands is the home's own `LaunchFixtures` value. Each held row asserts the outcome first, so a
/// dispatcher that does nothing at all is red. RB-2c0 — a link that opens VibeField while a state is stored lands in
/// that open: the state stands for it and the link is held (James on the card j-rb2-d5-demo-ends, 2026-11-12
/// 21:44:36.025Z, A: "a state lasts one open"; VF-PM 21:59:10Z).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("under a demo the way in's acts reach nothing real; with none they do")
@MainActor
struct DemoActsTests {
  private typealias Act = FieldHomeModel.WayInAct
  private typealias Outcome = FieldHomeModel.WayInOutcome

  /// "Another account?" over made-up facts: a state whose page has a sign-in, a switch and a keep.
  private let demo = LaunchFixtures(demoField: false, account: "another")
  private let code = PhoneCode(login: "me@example.com", from: "Studio")
  private static let console = URL(string: "https://login.tailscale.com/admin/machines")!

  /// The calls the acts made, by name, in order.
  private final class Made {
    var calls: [String] = []
  }

  private func dispatch(_ fixtures: LaunchFixtures, _ made: Made) -> FieldHomeModel.WayInDispatch {
    FieldHomeModel.WayInDispatch(
      fixtures: fixtures,
      calls: FieldHomeModel.WayInCalls(
        signIn: { made.calls.append("signIn") },
        openReader: { made.calls.append("openReader") },
        receive: { _, arrival in made.calls.append("receive(\(arrival.rawValue))") },
        signOut: { made.calls.append("signOut") },
        switchAccount: { made.calls.append("switchAccount") },
        keepAccount: { made.calls.append("keepAccount") },
        openURL: { _ in made.calls.append("openURL") },
        lockOn: { made.calls.append("lockOn") },
        unlock: { made.calls.append("unlock") },
        showTour: { page in made.calls.append(page.map { "showTour(\($0))" } ?? "showTour(welcome)") },
        notNow: { made.calls.append("notNow") },
        tryAgain: { made.calls.append("tryAgain") }))
  }

  private func held(_ acts: [Act]) -> (outcomes: [Outcome], calls: [String]) {
    let made = Made()
    let d = dispatch(demo, made)
    let outcomes = acts.map { d.perform($0) }
    return (outcomes, made.calls)
  }

  /// A defaults domain of the row's own, and its removal when the row ends.
  private func store() throws -> (defaults: UserDefaults, done: () -> Void) {
    let name = "vibefield.tests.demo-acts.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    return (defaults, { defaults.removePersistentDomain(forName: name) })
  }

  @Test("Continue with Tailscale and Sign in again open no sign-in under a demo")
  func signInHeld() {
    let r = held([.continueWithTailscale, .signInAgain])
    #expect(r.outcomes == [.heldUnderDemo, .heldUnderDemo])
    #expect(r.calls == [])
  }

  @Test("Scan the code opens no reader under a demo")
  func readerHeld() {
    let r = held([.scanCode])
    #expect(r.outcomes == [.heldUnderDemo])
    #expect(r.calls == [])
  }

  @Test("a desktop's code, by the reader or by a link, sets no account to expect under a demo")
  func codeHeld() {
    let made = Made()
    let d = dispatch(demo, made)
    let outcomes = [d.receive(code, arrival: .scanned), d.receive(code, arrival: .link)]
    #expect(outcomes == [.heldUnderDemo, .heldUnderDemo])
    #expect(made.calls == [])
  }

  @Test("Use another account signs nothing out under a demo")
  func signOutHeld() {
    let r = held([.useAnotherAccount])
    #expect(r.outcomes == [.heldUnderDemo])
    #expect(r.calls == [])
  }

  @Test("Another account?'s Sign in again, Keep this account and Start over move no account under a demo")
  func switchHeld() {
    let r = held([.switchAccount, .keepAccount, .startOver])
    #expect(r.outcomes == [.heldUnderDemo, .heldUnderDemo, .heldUnderDemo])
    #expect(r.calls == [])
  }

  @Test("Open the admin console opens no Safari under a demo")
  func safariHeld() {
    let r = held([.openAdminConsole(Self.console)])
    #expect(r.outcomes == [.heldUnderDemo])
    #expect(r.calls == [])
  }

  @Test("Lock with Face ID turns no lock on under a demo")
  func lockHeld() {
    let r = held([.lockOn])
    #expect(r.outcomes == [.heldUnderDemo])
    #expect(r.calls == [])
  }

  /// WI-L2 as amended 2026-11-13 — the gate's own act goes through the same dispatcher.
  @Test("Try again, on Can’t reach your computer., reaches no mesh and no desktop under a demo")
  func tryAgainHeld() {
    let r = held([.tryAgain])
    #expect(r.outcomes == [.heldUnderDemo])
    #expect(r.calls == [])
  }

  @Test("with no demo every one of those acts makes its real call, so the hold cannot swallow the real path")
  func realPath() {
    let made = Made()
    let d = dispatch(.off, made)
    let acts: [Act] = [
      .continueWithTailscale, .signInAgain, .scanCode, .useAnotherAccount, .switchAccount, .keepAccount, .startOver,
      .openAdminConsole(Self.console), .lockOn, .tryAgain,
    ]
    let outcomes = acts.map { d.perform($0) }
    let received = [d.receive(code, arrival: .scanned), d.receive(code, arrival: .link)]
    #expect(outcomes == Array(repeating: Outcome.made, count: 10))
    #expect(received == [.made, .made])
    #expect(
      made.calls == [
        "signIn", "signIn", "openReader", "signOut", "switchAccount", "keepAccount", "keepAccount", "openURL", "lockOn",
        "tryAgain", "receive(scanned)", "receive(link)",
      ])
  }

  @Test("under a demo the page moves and the curtain's Unlock are still made: the lock stands over a demo")
  func liveUnderDemo() {
    let made = Made()
    let d = dispatch(demo, made)
    let acts: [Act] = [.seeHowItWorks, .tour(2), .tour(9), .welcome, .notNow, .unlock]
    let outcomes = acts.map { d.perform($0) }
    #expect(outcomes == Array(repeating: Outcome.made, count: 6))
    #expect(made.calls == ["showTour(0)", "showTour(2)", "showTour(3)", "showTour(welcome)", "notNow", "unlock"])
  }

  @Test("whether a demo stands is the home's own LaunchFixtures value, answered in one place")
  func onePlace() {
    let values = [
      LaunchFixtures(demoField: false, account: "approval"), LaunchFixtures(demoField: true, account: nil), .off,
    ]
    let answers = values.map { dispatch($0, Made()).underDemo }
    let stands = values.map { $0.demoStands }
    #expect(answers == [true, true, false])
    #expect(answers == stands)
  }

  @Test("a link that opens VibeField under a stored state is held there, and the next open is your own")
  func linkUnderAStoredState() throws {
    let (d, done) = try store()
    defer { done() }
    d.set("another", forKey: DeveloperChoices.accountKey)
    let launch = LaunchFixtures.read(arguments: [], defaults: d)
    #expect(launch == LaunchFixtures(demoField: false, account: "another"))
    let made = Made()
    let arrived = dispatch(launch, made).receive(code, arrival: .link)
    #expect(arrived == .heldUnderDemo)
    #expect(made.calls == [])
    let next = LaunchFixtures.read(arguments: [], defaults: d)
    #expect(next == .off)
  }
}
