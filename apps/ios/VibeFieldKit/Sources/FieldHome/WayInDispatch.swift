import FieldMesh
import Foundation

// RB-2 (DESIGN.md §8 "The phone's Settings", amended 2026-11-12; decided 2026-11-12) — the way in's
// acts, out of the view so a test sees which real call each one makes. Under a demo, every act that would reach this
// phone's real account, its lock, the code reader or Safari is held, and nothing is called; the acts that only move
// between the way in's pages, and the lock's own Unlock, are made. Whether a demo stands is answered in one place: the
// `LaunchFixtures` value the home reads. WI-G3 A (asked for on the page The Way In, 2026-11-14): Use another
// account asks the corner's question first. The asking reaches nothing, so it is made under a demo; the question's
// Sign out reaches the account, so it is held.
extension FieldHomeModel {
  /// What one act came to.
  enum WayInOutcome: Equatable, Sendable {
    /// Its call was made.
    case made
    /// A demo stands and the act would have reached something real, so nothing was called.
    case heldUnderDemo
  }

  /// The home's real calls, handed in: one for each thing an act of the way in can do.
  @MainActor
  struct WayInCalls {
    /// Continue with Tailscale, Sign in again: the system's sign-in sheet.
    var signIn: () -> Void
    /// Scan the code on your computer: the code reader.
    var openReader: () -> Void
    /// A desktop's code, by the reader or by a link: the account to expect.
    var receive: (PhoneCode, PhoneCodeExpectation.Arrival) -> Void
    /// WI-G3 A (asked for on the page The Way In, 2026-11-14) — Use another account, on Can’t reach your
    /// computer. and on Sign in to Tailscale again.: the corner's own Sign out question, asked first. It moves nothing.
    var askSignOut: () -> Void
    /// The question's Sign out, after Use another account: the corner's own Sign out, the full sign-out.
    var signOut: () -> Void
    /// "Another account?"'s Sign in again.
    var switchAccount: () -> Void
    /// Keep this account, Start over: the code set aside.
    var keepAccount: () -> Void
    /// Open the admin console: Safari.
    var openURL: (URL) -> Void
    /// Lock with Face ID: the lock turned on, iOS asking first.
    var lockOn: () -> Void
    /// The curtain's Unlock: the lock stands over a demo as over your own field.
    var unlock: () -> Void
    /// How it works: a page of the tour, 0…3, or nil for the welcome.
    var showTour: (Int?) -> Void
    /// Not now: the hand-over, the lock left off.
    var notNow: () -> Void
    /// WI-L2 as amended 2026-11-13 — Try again, on Can’t reach your computer.: the account's node dials now, and the
    /// home looks again for a desktop to answer.
    var tryAgain: () -> Void
  }

  /// The way in's acts, each the home's own call, held under a demo where the call would reach something real.
  @MainActor
  struct WayInDispatch {
    let fixtures: LaunchFixtures
    let calls: WayInCalls

    init(fixtures: LaunchFixtures, calls: WayInCalls) {
      self.fixtures = fixtures
      self.calls = calls
    }

    /// Whether a demo stands: the home's own `LaunchFixtures`, never an answer of the dispatcher's.
    var underDemo: Bool { fixtures.demoStands }

    /// One act of the way in.
    func perform(_ act: WayInAct) -> WayInOutcome {
      if underDemo && Self.reachesOutside(act) { return .heldUnderDemo }
      make(act)
      return .made
    }

    /// A desktop's code arriving, by the reader or by a link.
    func receive(_ code: PhoneCode, arrival: PhoneCodeExpectation.Arrival) -> WayInOutcome {
      if underDemo { return .heldUnderDemo }
      calls.receive(code, arrival)
      return .made
    }

    /// WI-G3 A (2026-11-14) — the question's Sign out, after Use another account: the full sign-out. It reaches the
    /// account, so a demo holds it.
    func signOut() -> WayInOutcome {
      if underDemo { return .heldUnderDemo }
      calls.signOut()
      return .made
    }

    /// Whether an act's call reaches past the way in's own pages: the account (Try again: its node and its desktops),
    /// the lock, the reader or Safari. Use another account only asks (WI-G3 A): its question's Sign out, `signOut()`,
    /// is what reaches the account.
    static func reachesOutside(_ act: WayInAct) -> Bool {
      switch act {
      case .continueWithTailscale, .signInAgain, .scanCode, .switchAccount, .keepAccount, .startOver,
        .openAdminConsole, .lockOn, .tryAgain:
        return true
      case .seeHowItWorks, .tour, .welcome, .notNow, .unlock, .useAnotherAccount:
        return false
      }
    }

    private func make(_ act: WayInAct) {
      switch act {
      case .continueWithTailscale, .signInAgain:
        calls.signIn()
      case .scanCode:
        calls.openReader()
      case .seeHowItWorks:
        calls.showTour(0)
      case .tour(let page):
        calls.showTour(min(max(page, 0), 3))
      case .welcome:
        calls.showTour(nil)
      case .useAnotherAccount:
        calls.askSignOut()
      case .switchAccount:
        calls.switchAccount()
      case .keepAccount, .startOver:
        calls.keepAccount()
      case .openAdminConsole(let url):
        calls.openURL(url)
      case .lockOn:
        calls.lockOn()
      case .notNow:
        calls.notNow()
      case .unlock:
        calls.unlock()
      case .tryAgain:
        calls.tryAgain()
      }
    }
  }
}
