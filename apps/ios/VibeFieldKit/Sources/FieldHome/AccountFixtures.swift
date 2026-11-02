#if DEBUG
  import FieldDesign
  import FieldMesh
  import FieldSettings
  import Foundation

  /// `-vf-demo-account=<state>` (IOS-8e, AP-D8): the corner's inputs, stamped,
  /// so a screenshot run can photograph every state in both themes with no
  /// tailnet and no desktop. The PIXELS come from the real decision —
  /// `FieldHomeModel.accountFace` over invented inputs — never from a second
  /// drawing of the corner; and nothing here claims a mesh answered: it
  /// cannot run in Release, and the real facts replace it the moment the
  /// argument is absent.
  ///
  /// TS-7, WI-1 — a state stamps the way in's page with the corner, from
  /// `FieldHomeModel.doorPage` over the SAME inputs, so a photograph never
  /// pairs a corner with a page the phone could not draw beside it. A state
  /// may stamp a step the way in takes on its own (the found beat, a page of
  /// How it works) over those inputs.
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
      /// IOS-10a — Settings over the same inputs.
      let settings: SettingsAccount
      /// WI-2 — a step the way in takes on its own, stamped over the state: the found beat over a phone
      /// already signed in, or a page of How it works over the welcome.
      var wayIn: FieldHomeModel.WayInStep? = nil
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
        // WI-2 — the found beat, held: your face in the mark's place, the desktop the phone first reached.
        var demo = make(.up, login: login, face: fox, desktops: [ready("studio")], hearing: true)
        demo.wayIn = .found(name: nil, desktop: "studio")
        return demo
      // WI-1 — the way in's two holds: signed in and joining the network, then looking for a desktop
      case "joining":
        return make(.starting, login: login)
      case "looking":
        return make(.up, login: login, listedYet: false)
      // WI-1 — How it works, its four pages over the welcome (WI-D1)
      case "tour-1", "tour-2", "tour-3", "tour-4":
        var demo = make(.off)
        demo.wayIn = .tour((Int(name.dropFirst(5)) ?? 1) - 1)
        return demo
      // TS-7b — a Mac's code: the welcome that knows the account to pick, and
      // "Another account?" for a code scanned in the app and for a link.
      case "expecting":
        return make(.off, expected: expectation(.scanned))
      // WI-2 — the desktop's code by its link on a phone with no account: the desktop that sent you
      case "from-code":
        return make(.off, expected: expectation(.link))
      case "another":
        return make(.up, login: otherLogin, face: fox, desktops: [ready("studio")], hearing: true, expected: expectation(.scanned))
      case "another-link":
        return make(.up, login: otherLogin, face: fox, desktops: [ready("studio")], hearing: true, expected: expectation(.link))
      default:
        return nil
      }
    }

    /// The account the page's "Another account?" finds signed in (A:723).
    static let otherLogin = "james@acme.dev"

    private static func expectation(_ arrival: PhoneCodeExpectation.Arrival) -> PhoneCodeExpectation {
      PhoneCodeExpectation(login: login, from: "Studio", arrival: arrival, at: Date(timeIntervalSince1970: 1_798_502_400))
    }

    private static func ready(_ name: String) -> FieldDesktop {
      FieldDesktop(deviceId: "dev-1", name: name, platform: "darwin", state: .ready, feed: .door, userId: "01J8F2ZQ9K3M4N5P6Q7R8S9T0V")
    }

    private static func make(
      _ state: MeshModel.State, remembered: String? = nil, login: String? = nil, face: UserFace? = nil,
      desktops: [FieldDesktop] = [], asleep: [(String, String)] = [], foreign: Int = 0, hearing: Bool = false,
      listedYet: Bool = true, expected: PhoneCodeExpectation? = nil
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
          hasListed: listedYet,
          listed: desktops.count,
          remembered: asleep.count,
          machineName: machine,
          adminConsole: FieldTruffleRuntime.machinesAdminURL(controlURL: nil),
          signInNote: nil,
          expected: expected),
        settings: FieldHomeModel.settingsAccount(
          meshState: state,
          rememberedLogin: remembered,
          login: login,
          domain: login == nil ? nil : domain,
          name: nil,
          face: face,
          seed: login ?? remembered ?? "",
          home: desktops.first?.deviceId,
          homeAnswered: face != nil && !desktops.isEmpty,
          desktops: desktops,
          asleep: asleep.map { .init(deviceId: $0.0, name: $0.1, platform: "darwin", lastSeen: heard) },
          isHearing: hearing,
          machineName: machine,
          adminConsole: FieldTruffleRuntime.machinesAdminURL(controlURL: nil)))
    }

    /// When a fixture's sleeping desktops were last heard: yesterday at 18:02,
    /// so a photograph's words never depend on the hour it was taken.
    static var heard: Date? {
      let calendar = Calendar.current
      guard let yesterday = calendar.date(byAdding: .day, value: -1, to: Date()) else { return nil }
      return calendar.date(bySettingHour: 18, minute: 2, second: 0, of: yesterday)
    }
  }
#endif
