import Foundation

#if DEBUG || VF_TESTFLIGHT
  import FieldSettings
#endif

/// RB-2 (DESIGN.md §8 "The phone's Settings", amended 2026-11-12) — the demo this open stands in, read once for the
/// whole launch: Demo field, an account state, or neither. The home and the way in's acts read the SAME value, so a
/// view cannot be under a demo while its acts think it is not. In the build submitted for App Review there is never a
/// demo, and its reader is not compiled.
struct LaunchFixtures: Equatable, Sendable {
  /// Demo field: a made-up field in place of yours (`-vf-mock` for a scripted run).
  var demoField: Bool
  /// An account state, by `AccountFixtures`' name (`-vf-demo-account=<state>`), or nil for your own.
  var account: String?

  /// No demo: your own account and your own field.
  static let off = LaunchFixtures(demoField: false, account: nil)

  /// Whether a demo stands: the one answer the home and the way in's acts both read.
  var demoStands: Bool { demoField || account != nil }

  #if DEBUG || VF_TESTFLIGHT
    /// The launch arguments first, so a scripted run is what it asks for and leaves the page's choices as they were;
    /// the page's own choices second (`DeveloperChoices`). An account state is let go in the same step that reads it,
    /// so it stands for one open, and an open that fails cannot keep the phone in it.
    static func read(arguments: [String], defaults: UserDefaults) -> LaunchFixtures {
      if let scripted = fromArguments(arguments) { return scripted }
      let chosen = DeveloperChoices.read(defaults)
      // D5 A: the state is let go in the read that takes it, so it stands for this open alone
      if chosen.account != nil { DeveloperChoices.setAccount(nil, in: defaults) }
      return LaunchFixtures(demoField: chosen.demoField, account: chosen.account.flatMap(known))
    }

    /// A scripted run's demo, by its launch arguments: `-vf-mock` (Demo field) and `-vf-demo-account=<state>`. Nil
    /// when they name none, so the page's choices are read instead.
    static func fromArguments(_ arguments: [String]) -> LaunchFixtures? {
      let prefix = accountArgument + "="
      let field = arguments.contains(mockArgument)
      let named = arguments.first(where: { $0.hasPrefix(prefix) }).map { String($0.dropFirst(prefix.count)) }
      guard field || named != nil else { return nil }
      return LaunchFixtures(demoField: field, account: named.flatMap(known))
    }

    /// The scripted runs' two arguments: the words `MockField.argument` and `AccountFixtures.argument` hold.
    static let mockArgument = "-vf-mock"
    static let accountArgument = "-vf-demo-account"

    /// A state's name as the picker offers it, or nil: a stale or unknown name never stands a demo with no state
    /// behind it. The picker's list and the fixtures' are one list (`LaunchFixturesTests.pickerParity`).
    private static func known(_ name: String) -> String? {
      DeveloperWords.accountStates.contains { $0.key == name } ? name : nil
    }
  #endif
}

#if DEBUG || VF_TESTFLIGHT
  extension LaunchFixtures {
    /// RB-2 — the home's acts outside the way in, and which of them a demo holds (VF-PM 21:59:10Z on PLAN-2c: Q1,
    /// Q2, and the way to Developer). The way in's own acts are `WayInDispatch`'s.
    enum HomeAct: CaseIterable, Sendable {
      /// The corner's and Settings' Sign in and Sign out.
      case account
      /// This phone › Lock: its switch, either way, and the time it asks again.
      case lock
      /// WI-W2e A (James on the page The Way In, 2026-11-14 03:47:45Z) — the corner's and Settings' Try again, under
      /// "Couldn’t connect.": it starts your account's network, and no demo has one to start, so any demo holds it, a
      /// scripted run's included (the mock has no failed start of its own), as the way in's Try again is held.
      case tryAgain
      /// The way to Developer and its two choices: the corner's Settings, This phone › Developer, the Demo field
      /// switch and the Account picker. Never held, so a demo can always be switched off.
      case openSettings, openDeveloper, demoFieldSwitch, accountPicker
    }

    /// Whether this open's demo holds an act. `scripted`: the demo is a scripted run's (its launch argument), whose
    /// mock keeps its own Sign in and Sign out: they move `MockAccount`'s standing and reach nothing real.
    func holds(_ act: HomeAct, scripted: Bool) -> Bool {
      guard demoStands else { return false }
      switch act {
      case .account:
        return !scripted
      case .lock:
        return true
      case .tryAgain:
        // RED — WI-W2e A: Try again is not held yet
        return false
      case .openSettings, .openDeveloper, .demoFieldSwitch, .accountPicker:
        return false
      }
    }
  }
#endif
