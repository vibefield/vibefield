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
  /// The names are the design page's (The Account Pill, 2026-09-23): the
  /// login, the domain and the desktops are the History records' invented
  /// corpus; 🦊 stands in for whatever face a desktop deals.
  enum AccountFixtures {
    static let argument = "-vf-demo-account"
    static let openArgument = "-vf-demo-account-open"
    static let login = "me@jamesyong42.com"
    static let domain = "tail3f2a8c.ts.net"
    static let fox = UserFace(emoji: "🦊", frame: .sticker)

    static func face(named name: String) -> FieldHomeModel.AccountFace? {
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
      default:
        return nil
      }
    }

    private static func ready(_ name: String) -> FieldDesktop {
      FieldDesktop(deviceId: "dev-1", name: name, platform: "darwin", state: .ready, feed: .door, userId: "01J8F2ZQ9K3M4N5P6Q7R8S9T0V")
    }

    private static func make(
      _ state: MeshModel.State, remembered: String? = nil, login: String? = nil, face: UserFace? = nil,
      desktops: [FieldDesktop] = [], asleep: [(String, String)] = [], foreign: Int = 0, hearing: Bool = false
    ) -> FieldHomeModel.AccountFace {
      FieldHomeModel.accountFace(
        meshState: state,
        rememberedLogin: remembered,
        login: login,
        domain: login == nil ? nil : domain,
        name: nil,
        face: face,
        desktops: desktops,
        asleep: asleep.map { .init(deviceId: $0.0, name: $0.1) },
        foreignDoors: foreign,
        isHearing: hearing)
    }
  }
#endif
