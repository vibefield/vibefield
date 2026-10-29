#if DEBUG
  import FieldDesign
  import FieldMesh
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

    /// TS-7 — the Field page's door, through the real decision: the welcome
    /// signed out, the approval page waiting, the field otherwise.
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
        signInNote: nil, found: nil)
    }

    /// TS-7 — whether the scripted fleet is the field: only while no door
    /// stands. A phone signed out, or waiting on an admin, reaches no desktop,
    /// so a fleet under its welcome photographs agents it cannot have.
    var fieldIsLive: Bool { door == nil }

    /// Whether History's desktop answers: the mock's studio is up exactly
    /// while the account is.
    var desktopIsUp: Bool { standing == .up }

    var login: String? { standing == .signedOut ? nil : Self.login }

    func signIn() { standing = .up }

    func signOut() { standing = .signedOut }
  }
#endif
