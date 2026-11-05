import FieldDesign
import FieldProduct
import FieldSettings
import FieldTerminal
import Foundation
import Testing

@testable import FieldHome
@testable import FieldMesh

/// IOS-10a — what Settings is handed, decided from the corner's own inputs:
/// where the account stands, its desktops in the roster's order with the
/// corner's words for each, whose word the face is, and Network details.
@Suite("Settings is handed the corner's account")
struct SettingsAccountTests {
  private let login = "me@jamesyong42.com"
  private let domain = "tail3f2a8c.ts.net"
  private let fox = UserFace(emoji: "🦊")
  private let heard = Date(timeIntervalSince1970: 1_798_502_400)

  private func desktop(
    id: String = "dev-1", name: String = "studio", state: FieldDesktop.State = .ready,
    feed: FieldFeedSource = .door, terminals: Bool? = true, fieldRefusal: String? = nil,
    board: AgentMeshDeviceState? = nil
  ) -> FieldDesktop {
    FieldDesktop(
      deviceId: id, name: name, platform: "darwin", state: state, feed: feed,
      publishesTerminalDoors: terminals, fieldRefusal: fieldRefusal, board: board)
  }

  private func settings(
    meshState: MeshModel.State, remembered: String? = nil, login: String? = nil, name: String? = nil,
    face: UserFace? = nil, home: String? = "dev-1", homeAnswered: Bool = false, desktops: [FieldDesktop] = [],
    asleep: [FieldHomeModel.AsleepDesktop] = [], isHearing: Bool = true
  ) -> SettingsAccount {
    FieldHomeModel.settingsAccount(
      meshState: meshState, rememberedLogin: remembered, login: login, domain: domain, name: name, face: face,
      seed: login ?? remembered ?? "", home: home, homeAnswered: homeAnswered, desktops: desktops,
      asleep: asleep, isHearing: isHearing, machineName: "iphone-17-pro",
      adminConsole: URL(string: "https://login.tailscale.com/admin/machines"))
  }

  @Test("where the account stands, for every state the mesh can be in")
  func standings() {
    let table: [(MeshModel.State, String?, SettingsAccount.Standing)] = [
      (.off, nil, .signedOut),
      (.starting, nil, .signedOut),
      (.needsLogin, nil, .signedOut),
      (.failed("no network"), nil, .signedOut),
      (.up, login, .connected),
      (.off, login, .connecting),
      (.starting, login, .connecting),
      (.reconnecting("the network went away"), login, .connecting),
      (.needsLogin, login, .signInAgain),
      (.needsMachineAuth, login, .waitingForApproval),
      (.failed("no network"), login, .couldNotConnect("no network")),
    ]
    for (state, account, standing) in table {
      #expect(FieldHomeModel.settingsStanding(meshState: state, account: account) == standing)
    }
  }

  @Test("signed in: the roster's order, the home first, then those asleep by name, each with the corner's word")
  func signedIn() {
    let account = settings(
      meshState: .up, login: login, name: "James", face: fox, homeAnswered: true,
      desktops: [desktop(), desktop(id: "dev-3", name: "box", state: .reconnecting)],
      asleep: [
        .init(deviceId: "dev-2", name: "mini", platform: "darwin", lastSeen: heard),
        // A desktop the link lists is never also asleep.
        .init(deviceId: "dev-1", name: "studio", platform: "darwin", lastSeen: heard),
      ])
    #expect(account.standing == .connected)
    #expect(account.name == "James")
    #expect(account.login == login)
    #expect(account.faceSource == .home("studio"))
    #expect(account.tailnet == domain)
    #expect(account.machineName == "iphone-17-pro")
    #expect(account.desktops.map(\.name) == ["studio", "box", "mini"])
    #expect(account.desktops[0] == SettingsDesktop(
      id: "dev-1", name: "studio", platform: "darwin", reach: .connected, isHome: true, servesTerminals: true))
    #expect(account.desktops[1].reach == .working("reconnecting"))
    #expect(!account.desktops[1].isHome)
    #expect(account.desktops[2].reach == .asleep(lastHeard: heard))
    #expect(account.desktops[2].servesTerminals == nil)
  }

  @Test("the face: none before any desktop speaks, dealt until the home answers, then the home's")
  func faceSource() {
    #expect(settings(meshState: .up, login: login).faceSource == .none)
    #expect(settings(meshState: .up, login: login, face: fox, desktops: [desktop()]).faceSource == .dealt)
    #expect(
      settings(meshState: .up, login: login, face: fox, homeAnswered: true, desktops: [desktop()]).faceSource
        == .home("studio"))
    // Away from the home, its name is the one this login remembers.
    #expect(
      settings(
        meshState: .reconnecting("gone"), remembered: login, face: fox, homeAnswered: true,
        asleep: [.init(deviceId: "dev-1", name: "studio", platform: "darwin")]
      ).faceSource == .home("studio"))
  }

  @Test("signed out: no desktops and no machine to name; the tailnet only while up")
  func signedOut() {
    let account = settings(meshState: .off, desktops: [desktop()])
    #expect(account.standing == .signedOut)
    #expect(account.desktops.isEmpty)
    #expect(account.machineName == nil)
    #expect(account.tailnet == nil)
    #expect(settings(meshState: .needsLogin, remembered: login).tailnet == nil)
  }

  @Test("the network asks again: the remembered desktops stay, asleep")
  func signInAgain() {
    let account = settings(
      meshState: .needsLogin, remembered: login, face: fox,
      asleep: [
        .init(deviceId: "dev-2", name: "mini", platform: "darwin"),
        .init(deviceId: "dev-1", name: "studio", platform: "darwin"),
      ])
    #expect(account.standing == .signInAgain)
    #expect(account.login == login)
    #expect(account.desktops.map(\.name) == ["mini", "studio"])
    let allAsleep = account.desktops.allSatisfy(\.isAsleep)
    #expect(allAsleep)
  }

  /// W2 (PG-3e, design v2 §5.3 with the v2 check's M2) — "Watch its agents" by the desktop's standing on the home's
  /// board: incompatible, or a refused field, is not watchable; asleep is (its kept board is drawn); a desktop the
  /// board does not list yet, and every desktop while the home is not hearing, is not said — save a refused field,
  /// which is read before the hearing (the review's [8]: the corner says it at the same moment).
  @Test("watching a desktop: its board decides, and not listed is not a refusal")
  func anIncompatibleBoardIsNotWatchable() {
    let desktops = [
      desktop(id: "dev-1", name: "studio", board: .incompatible),
      desktop(id: "dev-2", name: "loft", board: .asleep),
      desktop(id: "dev-3", name: "attic", board: nil),
      desktop(id: "dev-4", name: "mini", fieldRefusal: "the board ask is malformed", board: .live),
      desktop(id: "dev-5", name: "air", board: .live),
    ]
    let hearing = settings(meshState: .up, login: login, desktops: desktops, isHearing: true)
    let watchable = hearing.desktops.map { $0.watchable }
    #expect(watchable == [false, true, nil, false, true])
    let deaf = settings(meshState: .up, login: login, desktops: desktops, isHearing: false)
    let unsaid = deaf.desktops.map { $0.watchable }
    #expect(unsaid == [nil, nil, nil, false, nil])
  }

  /// W3 (PG-3e, the review's [8]; §5.3, J-E1 (iii) as James picked) — a sole old home: its door refused the remote cut
  /// (PRECONDITION_FAILED), so the phone hears no board at all, and its page reads "Watch its agents" unavailable,
  /// as its corner row reads "the field was refused".
  @Test("a sole old home is not watchable while the phone hears nothing")
  func aSoleOldHomeIsNotWatchable() {
    let studio = desktop(
      id: "dev-studio", name: "Studio", fieldRefusal: #"expected { projection?: "full" | "field" | "model" }"#,
      board: nil)
    let deaf = settings(meshState: .up, login: login, home: "dev-studio", desktops: [studio], isHearing: false)
    let watchable = deaf.desktops.map { $0.watchable }
    #expect(watchable == [false])
  }

  @Test("a desktop's reach is the corner's word, and its own reason when it gave one")
  func reach() {
    #expect(FieldHomeModel.reach(desktop(), isHearing: true) == .connected)
    #expect(FieldHomeModel.reach(desktop(state: .noDoor), isHearing: true) == .working("not serving"))
    #expect(FieldHomeModel.reach(desktop(state: .connecting), isHearing: true) == .working("dialing"))
    #expect(FieldHomeModel.reach(desktop(feed: .none), isHearing: false) == .working("no field yet"))
    #expect(
      FieldHomeModel.reach(desktop(state: .failed("FORBIDDEN_SCOPE")), isHearing: true)
        == .wantsYou("refused", reason: "FORBIDDEN_SCOPE"))
    #expect(
      FieldHomeModel.reach(desktop(state: .refusedDoor("no vouched address")), isHearing: true)
        == .wantsYou("no door", reason: "no vouched address"))
    #expect(
      FieldHomeModel.reach(desktop(fieldRefusal: "the field is not shared"), isHearing: true)
        == .wantsYou("field refused", reason: "the field is not shared"))
  }

  @Test("a photograph run opens any page, the Terminal page's own included; anything else is the root")
  func settingsOpening() {
    func opening(_ argument: String) -> SettingsOpening { FieldHomeModel.settingsOpening(argument: argument) }
    #expect(opening("-vf-open-settings") == .root)
    #expect(opening("-vf-open-settings=account") == .account)
    #expect(opening("-vf-open-settings=terminal") == .terminal)
    #expect(opening("-vf-open-settings=theme") == SettingsOpening([.terminal], terminalPage: .theme))
    #expect(opening("-vf-open-settings=effects") == SettingsOpening([.terminal], terminalPage: .effects))
    #expect(opening("-vf-open-settings=acknowledgements") == SettingsOpening([.about, .acknowledgements]))
    #expect(opening("-vf-open-settings=lock") == SettingsOpening([.lock]))
    #expect(opening("-vf-open-settings=desktop:dev-2") == SettingsOpening([.desktop("dev-2")]))
    #expect(opening("-vf-open-settings=desktop:") == .root)
    #expect(opening("-vf-open-settings=nowhere") == .root)
  }

  /// Filed 2026-10-31 from the simulator: waiting for approval, the menu drew
  /// its two hairlines with nothing between them.
  @Test("the menu's desktops section closes with a hairline only when it drew something")
  func menuHairlines() {
    func face(desktops: [FieldDesktop] = [], foreign: Int = 0, state: MeshModel.State = .up) -> FieldHomeModel.AccountFace {
      FieldHomeModel.accountFace(
        meshState: state, rememberedLogin: nil, login: login, domain: domain, name: nil, face: nil,
        desktops: desktops, asleep: [], foreignDoors: foreign, isHearing: true)
    }
    #expect(!face(state: .needsMachineAuth).drawsDesktopSection)
    #expect(!face().drawsDesktopSection)
    #expect(face(desktops: [desktop()]).drawsDesktopSection)
    #expect(face(foreign: 1).drawsDesktopSection)
  }

  /// The sign-out words say Appearance stays: the sweep names this phone's look
  /// by the key Appearance keeps it under, so the two cannot drift apart.
  @Test("signing out keeps this phone's look, by Appearance's own key")
  func signOutKeepsTheLook() {
    #expect(SignOutSweep.kept.contains(PhoneAppearance.storageKey))
    #expect(SettingsWords.signOutMessage(.iPhone).contains("Appearance"))
  }
}
