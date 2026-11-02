import FieldDesign
import FieldMesh
import FieldProduct
import FieldSettings
import Foundation

extension FieldHomeModel {

  // MARK: - IOS-10a: what Settings is handed

  /// Settings' account, decided from the same inputs as the corner
  /// (`accountFace`) plus what only Settings says: the home, the face's
  /// source, each desktop's terminals and when a sleeping one was last heard,
  /// and Network details. The desktops' words are the corner's
  /// (`AccountDisplay.desktopWord`), so the two never disagree.
  static func settingsAccount(
    meshState: MeshModel.State,
    rememberedLogin: String?,
    login: String?,
    domain: String?,
    name: String?,
    face: UserFace?,
    seed: String,
    home: String?,
    homeAnswered: Bool,
    desktops: [FieldDesktop],
    asleep: [AsleepDesktop],
    isHearing: Bool,
    machineName: String?,
    adminConsole: URL?
  ) -> SettingsAccount {
    let live = (login?.isEmpty ?? true) ? nil : login
    let remembered = (rememberedLogin?.isEmpty ?? true) ? nil : rememberedLogin
    let account = live ?? remembered
    let standing = settingsStanding(meshState: meshState, account: account)

    var rows: [SettingsDesktop] = desktops.map { desktop in
      SettingsDesktop(
        id: desktop.deviceId, name: desktop.name, platform: desktop.platform,
        reach: reach(desktop, isHearing: isHearing), isHome: desktop.deviceId == home,
        servesTerminals: desktop.publishesTerminalDoors,
        watchable: watchable(desktop, isHearing: isHearing))
    }
    let listed = Set(desktops.map(\.deviceId))
    rows += asleep
      .filter { !listed.contains($0.deviceId) }
      .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
      .map {
        SettingsDesktop(
          id: $0.deviceId, name: $0.name, platform: $0.platform, reach: .asleep(lastHeard: $0.lastSeen),
          isHome: false, servesTerminals: nil)
      }

    // The home's name: the listed home, or the one this login last homed to.
    let homeName =
      desktops.first { $0.deviceId == home }?.name
      ?? asleep.first { $0.deviceId == home }?.name
    let faceSource: SettingsAccount.FaceSource =
      if face == nil { .none } else if homeAnswered, let homeName { .home(homeName) } else { .dealt }

    return SettingsAccount(
      standing: standing,
      name: name ?? account ?? "",
      login: account,
      face: face,
      faceSource: faceSource,
      seed: seed,
      tailnet: meshState == .up ? domain : nil,
      machineName: standing == .signedOut ? nil : machineName,
      adminConsole: adminConsole,
      desktops: standing == .signedOut ? [] : rows)
  }

  /// Where the account stands, in the door's words. With no account the head
  /// is the way in — unless the network already holds the phone for approval,
  /// which only a signed-in phone can be.
  static func settingsStanding(meshState: MeshModel.State, account: String?) -> SettingsAccount.Standing {
    switch meshState {
    case .needsMachineAuth: return .waitingForApproval
    case .up: return .connected
    case .needsLogin: return account == nil ? .signedOut : .signInAgain
    case .failed(let reason): return account == nil ? .signedOut : .couldNotConnect(reason)
    case .off, .starting, .stopping, .reconnecting: return account == nil ? .signedOut : .connecting
    }
  }

  /// PG-3e (design v2 §5.3, with the v2 check's M2) — whether "Watch its agents" is available: `false` for a desktop
  /// whose door refused the field, hearing or not (the review's [8]: a sole old home refuses, so the phone hears
  /// nothing, and J-E1 (iii) says its page reads unavailable while its corner row says "the field was refused"); not
  /// while the home is not hearing otherwise (nil, not said); `false` for a standing of `incompatible` on the home's
  /// board; nil while the board does not list it (not on the board YET is not a refusal: the mock and the demo
  /// accounts list none); `true` otherwise, asleep included (its kept board is drawn).
  static func watchable(_ desktop: FieldDesktop, isHearing: Bool) -> Bool? {
    if desktop.fieldRefusal != nil { return false }
    guard isHearing else { return nil }
    if desktop.board == .incompatible { return false }
    return desktop.board == nil ? nil : true
  }

  /// A listed desktop's reach, from the corner's word for it.
  static func reach(_ desktop: FieldDesktop, isHearing: Bool) -> SettingsDesktop.Reach {
    let word = AccountDisplay.desktopWord(desktop, isHearing: isHearing)
    guard let text = word.word else { return .connected }
    guard word.wantsTheUser else { return .working(text) }
    let reason: String? =
      switch desktop.state {
      case .failed(let reason), .refusedDoor(let reason): reason
      case .ready: desktop.fieldRefusal
      case .noDoor, .connecting, .reconnecting: nil
      }
    return .wantsYou(text, reason: reason)
  }
}

extension FieldHomeModel {
  /// `-vf-open-settings[=<page>]` → where Settings opens: `account`,
  /// `desktop:<id>`, `appearance`, `terminal`, `theme` and `effects` (Terminal
  /// one step back), `about`, `acknowledgements` (About one step back);
  /// anything else is the root.
  static func settingsOpening(argument: String) -> SettingsOpening {
    let value = String(argument.drop(while: { $0 != "=" }).dropFirst())
    switch value {
    case "account": return .account
    case "appearance": return SettingsOpening([.appearance])
    case "terminal": return .terminal
    case "theme": return SettingsOpening([.terminal], terminalPage: .theme)
    case "effects": return SettingsOpening([.terminal], terminalPage: .effects)
    case "about": return SettingsOpening([.about])
    case "acknowledgements": return SettingsOpening([.about, .acknowledgements])
    default:
      let prefix = "desktop:"
      guard value.hasPrefix(prefix), value.count > prefix.count else { return .root }
      return SettingsOpening([.desktop(String(value.dropFirst(prefix.count)))])
    }
  }
}
