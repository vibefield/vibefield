#if DEBUG
  import FieldDesign
  import FieldMesh

  /// `-vf-demo-account=<state>` (IOS-8e, AP-D8): the corner's inputs, stamped,
  /// so a screenshot run can photograph every state in both themes with no
  /// tailnet and no desktop. The PIXELS come from the real decision —
  /// `FieldHomeModel.accountFace` over invented inputs — never from a second
  /// drawing of the corner; and nothing here claims a mesh answered: it
  /// cannot run in Release, and the real facts replace it the moment the
  /// argument is absent.
  ///
  /// TS-7 — a state stamps the Field page's door with the corner, from
  /// `FieldHomeModel.doorPage` over the SAME inputs, so a photograph never
  /// pairs a corner with a page the phone could not draw beside it.
  ///
  /// The names are the design page's (The Account Pill, 2026-09-23; the
  /// phone's door, A:719-722): the login, the domain and the desktops are the
  /// History records' invented corpus; 🦊 stands in for whatever face a
  /// desktop deals.
  enum AccountFixtures {
    static let argument = "-vf-demo-account"
    static let openArgument = "-vf-demo-account-open"
    static let login = "me@jamesyong42.com"
    static let domain = "tail3f2a8c.ts.net"
    static let fox = UserFace(emoji: "🦊", frame: .sticker)
    /// The approval page's machine name: a phone's own, as Layer 3 spells it.
    static let machine = "iphone-17-pro"

    struct Demo {
      let face: FieldHomeModel.AccountFace
      let door: FieldHomeModel.DoorPage?
    }

    static func demo(named name: String) -> Demo? {
      switch name {
      case "signedin":
        return make(.up, login: login, face: fox, desktops: [ready("studio")], asleep: [("dev-2", "mini")], hearing: true)
      case "asleep":
        return make(.reconnecting("the network went away"), remembered: login, face: fox, asleep: [("dev-1", "studio"), ("dev-2", "mini")])
      case "attention":
        return make(.needsLogin, remembered: login, face: fox, asleep: [("dev-1", "studio"), ("dev-2", "mini")])
      case "noface":
        return make(.up, login: login, desktops: [ready("studio")], hearing: true)
      case "guests":
        return make(.up, login: login, face: fox, desktops: [ready("studio")], asleep: [("dev-2", "mini")], foreign: 1, hearing: true)
      case "refused":
        return make(
          .up, login: login, face: fox,
          desktops: [ready("studio"), FieldDesktop(deviceId: "dev-2", name: "mini", platform: "darwin", state: .failed("FORBIDDEN_SCOPE"), feed: .none)],
          hearing: true)
      case "firstrun":
        return make(.off)
      case "failed-first":
        return make(.failed("the network went away"))
      case "approval":
        return make(.needsMachineAuth, login: login)
      case "none":
        return make(.up, login: login)
      case "none-found":
        // The beat, held: the row filled by the first desktop to list.
        return make(.up, login: login, found: .init(name: "studio", platform: "darwin"))
      default:
        return nil
      }
    }

    private static func ready(_ name: String) -> FieldDesktop {
      FieldDesktop(deviceId: "dev-1", name: name, platform: "darwin", state: .ready, feed: .door, userId: "01J8F2ZQ9K3M4N5P6Q7R8S9T0V")
    }

    private static func make(
      _ state: MeshModel.State, remembered: String? = nil, login: String? = nil, face: UserFace? = nil,
      desktops: [FieldDesktop] = [], asleep: [(String, String)] = [], foreign: Int = 0, hearing: Bool = false,
      found: FieldHomeModel.FoundDesktop? = nil
    ) -> Demo {
      Demo(
        face: FieldHomeModel.accountFace(
          meshState: state,
          rememberedLogin: remembered,
          login: login,
          domain: login == nil ? nil : domain,
          name: nil,
          face: face,
          desktops: desktops,
          asleep: asleep.map { .init(deviceId: $0.0, name: $0.1, platform: "darwin") },
          foreignDoors: foreign,
          isHearing: hearing),
        door: FieldHomeModel.doorPage(
          fixtureOwnsTheField: false,
          meshState: state,
          rememberedLogin: remembered,
          login: login,
          isGated: login != nil,
          hasListed: true,
          listed: desktops.count,
          remembered: asleep.count,
          machineName: machine,
          adminConsole: FieldTruffleRuntime.machinesAdminURL(controlURL: nil),
          signInNote: nil,
          found: found))
    }
  }
#endif
