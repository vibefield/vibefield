#if DEBUG
  import FieldDesign
  import FieldMesh
  import FieldProduct
  import FieldSettings
  import Foundation
  import Observation

  /// `-vf-mock` (IOS-9d): the whole phone over invented facts and no tailnet —
  /// an account that is signed in without a login, its desktops, the scripted
  /// fleet on the field, the History records' corpus under the other tab, and
  /// search over it. Every act in the corner works and changes the mock's own
  /// standing: Sign out empties it, Sign in fills it again (no login page —
  /// there is no tailnet to sign in to). There is no Connect or Disconnect: the
  /// phone stays on the mesh by itself while signed in (2026-10-18), so a lost
  /// mesh is the `reconnecting` standing, stamped by `-vf-mock-reconnecting`.
  ///
  /// The PIXELS come from the shipping decisions over these inputs
  /// (`FieldHomeModel.accountFace`, the History views), never from a second
  /// drawing; nothing here claims a mesh answered, it cannot run in Release,
  /// and the real facts replace it the moment the argument is absent.
  @MainActor
  @Observable
  final class MockAccount {
    static let argument = "-vf-mock"

    enum Standing: Equatable {
      /// The corner is the `Sign in` pill.
      case signedOut
      /// Signed in, the mesh up, studio answering and mini asleep.
      case up
      /// Signed in, the mesh lost and re-dialling: both desktops asleep.
      case reconnecting
      /// TS-7 — signed in, and an admin of the network approves new devices
      /// (`-vf-mock-approval`).
      case approval
    }

    var standing: Standing = .up

    static let login = AccountFixtures.login
    static let domain = AccountFixtures.domain
    static let name = "James"
    static let face = AccountFixtures.fox
    static let userId = "01J8F2ZQ9K3M4N5P6Q7R8S9T0V"

    private static let studio = FieldDesktop(
      deviceId: "dev-1", name: "studio", platform: "darwin", state: .ready, feed: .door, userId: userId)
    private static let mini = FieldHomeModel.AsleepDesktop(deviceId: "dev-2", name: "mini", platform: "darwin")
    private static let studioAsleep = FieldHomeModel.AsleepDesktop(deviceId: "dev-1", name: "studio", platform: "darwin")

    /// The corner's answer, through the real decision.
    var face: FieldHomeModel.AccountFace {
      switch standing {
      case .signedOut:
        return FieldHomeModel.accountFace(
          meshState: .off, rememberedLogin: nil, login: nil, domain: nil, name: nil, face: nil, desktops: [],
          asleep: [], foreignDoors: 0, isHearing: false)
      case .up:
        return FieldHomeModel.accountFace(
          meshState: .up, rememberedLogin: Self.login, login: Self.login, domain: Self.domain, name: Self.name,
          face: Self.face, desktops: [Self.studio], asleep: [Self.mini], foreignDoors: 0, isHearing: true)
      case .approval:
        return FieldHomeModel.accountFace(
          meshState: .needsMachineAuth, rememberedLogin: nil, login: Self.login, domain: Self.domain, name: Self.name,
          face: nil, desktops: [], asleep: [], foreignDoors: 0, isHearing: false)
      case .reconnecting:
        return FieldHomeModel.accountFace(
          meshState: .reconnecting("the network went away"), rememberedLogin: Self.login, login: nil, domain: nil, name: Self.name, face: Self.face,
          desktops: [], asleep: [Self.studioAsleep, Self.mini], foreignDoors: 0, isHearing: false)
      }
    }

    /// IOS-10a — Settings' account, through the real decision: studio the
    /// home and up, mini asleep since yesterday evening.
    var settings: SettingsAccount {
      let state: MeshModel.State =
        switch standing {
        case .signedOut: .off
        case .up: .up
        case .reconnecting: .reconnecting("the network went away")
        case .approval: .needsMachineAuth
        }
      let up = standing == .up
      let asleep: [FieldHomeModel.AsleepDesktop] =
        switch standing {
        case .up: [Self.miniHeard]
        case .reconnecting: [Self.studioHeard, Self.miniHeard]
        case .approval, .signedOut: []
        }
      return FieldHomeModel.settingsAccount(
        meshState: state,
        rememberedLogin: standing == .signedOut ? nil : Self.login,
        login: up || standing == .approval ? Self.login : nil,
        domain: up ? Self.domain : nil,
        name: standing == .signedOut ? nil : Self.name,
        face: standing == .approval || standing == .signedOut ? nil : Self.face,
        seed: Self.login,
        home: Self.studio.deviceId,
        homeAnswered: true,
        desktops: up ? [Self.studio] : [],
        asleep: asleep,
        isHearing: up,
        machineName: AccountFixtures.machine,
        adminConsole: FieldTruffleRuntime.machinesAdminURL(controlURL: nil))
    }

    private static let miniHeard = FieldHomeModel.AsleepDesktop(
      deviceId: "dev-2", name: "mini", platform: "darwin", lastSeen: AccountFixtures.heard)
    private static let studioHeard = FieldHomeModel.AsleepDesktop(
      deviceId: "dev-1", name: "studio", platform: "darwin", lastSeen: AccountFixtures.heard)

    /// The way in's page, through the real decision (WI-1): the welcome signed
    /// out, the approval page waiting, signed in (nil) otherwise.
    var door: FieldHomeModel.DoorPage? {
      let state: MeshModel.State =
        switch standing {
        case .signedOut: .off
        case .up: .up
        case .reconnecting: .reconnecting("the network went away")
        case .approval: .needsMachineAuth
        }
      return FieldHomeModel.doorPage(
        fixtureOwnsTheField: false, meshState: state, rememberedLogin: nil, login: login, isGated: true,
        hasListed: true, listed: standing == .up ? 1 : 0, remembered: standing == .signedOut ? 0 : 2,
        machineName: AccountFixtures.machine, adminConsole: FieldTruffleRuntime.machinesAdminURL(controlURL: nil),
        signInNote: nil)
    }

    /// TS-7 — whether the scripted fleet is the field: only while no door
    /// stands. A phone signed out, or waiting on an admin, reaches no desktop,
    /// so a fleet under its welcome photographs agents it cannot have.
    var fieldIsLive: Bool { door == nil }

    /// Whether History's desktop answers: the mock's studio is up exactly
    /// while the account is.
    var desktopIsUp: Bool { standing == .up }

    var login: String? { standing == .signedOut ? nil : Self.login }

    /// UM-4 — the meters' home: studio, while the account is signed in to it (up, or re-dialling it).
    var home: String? { standing == .up || standing == .reconnecting ? Self.studio.deviceId : nil }
    /// The home's name in the meters' words.
    var homeName: String { Self.studio.name }
    /// UM-4 — the home's door for the meters: the fixture door over the contracts' goldens (`-vf-mock-usage=` picks
    /// its usage state), only while studio answers. One door for the mock's life, so the feed is not re-attached.
    var metersDoor: MetersFixtureDoor? { standing == .up ? metersFixture : nil }
    private let metersFixture = MetersFixtureDoor.launched()

    func signIn() { standing = .up }

    func signOut() { standing = .signedOut }
  }

  extension MockAccount {
    /// The instant the witness is applied at: the view suites' (`HomeFixture.now`).
    private static let witnessNow = "2026-11-01T00:00:00.000Z"

    /// SE-2 — Live now's rows under `-vf-mock` (the scripted fleet has no rows to search): PG-3a's witness, the
    /// kit's mirror under `Fixtures/` (held byte for byte by `pnpm check:ios-fixtures`), applied as FieldLink
    /// applies it, and the window's drawn rows read back — Studio the home (seven rows), Loft a peer through it
    /// (three), Attic asleep (one, greyed). The shipping adapter (`PhoneSearchWorld`) reads them, never a copy.
    static func searchRows() -> [RemoteFieldRow] {
      guard
        let url = Bundle.module.url(
          forResource: "agent-remote-mesh-open.witness", withExtension: "json", subdirectory: "Fixtures"),
        let data = try? Data(contentsOf: url),
        let json = try? JSONValue.parse(data),
        let open = try? AgentRemoteMeshOpen(json: json)
      else { return [] }
      var copy = RemoteMeshCopy()
      _ = copy.open(open, now: witnessNow)
      _ = copy.publish()
      return copy.drawn()
    }

    /// SE-2 — the home's profiles under `-vf-mock`, the lens's one list (SE-P5b): the meters' fixture door's own
    /// answer (`agents-profile-sets.meters`: This Mac, Work, Side and a draft) through `MeterModel.hasCircle`, the
    /// list the meters' feed holds once it reads — so the lens, the hold's buds, the page's rows and the token's menu
    /// name the same profiles, and the draft stands on none (ruling 7). *(Until SE-P5b, 2026-11-06, the contracts'
    /// `agents-profile-sets.valid` through FieldWorkspace's fixture door: This Mac and Work, a second list.)*
    static func searchProfiles() -> [AgentProfileSet] {
      guard let answer = MetersFixtureDoor.fixture("agents-profile-sets.meters"),
        let result = try? AgentProfileSetsResult(json: answer)
      else { return [] }
      return result.sets.filter(MeterModel.hasCircle)
    }
  }
#endif
