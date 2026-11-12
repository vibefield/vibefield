import FieldDesign
import FieldTerminal
import Foundation

/// What Settings is handed (IOS-10a): the account as the corner knows it, its
/// desktops, and the facts Network details names. FieldHome decides these from
/// the mesh, the link and the account's memory (`FieldHomeModel.settingsAccount`,
/// tested without a simulator); Settings draws what it is handed, as the corner
/// does, and asks nothing of the mesh itself.
public struct SettingsAccount: Equatable, Sendable {
  /// Where the account stands, in the phone's door's words (DESIGN.md §9).
  public enum Standing: Equatable, Sendable {
    /// No account on this phone: the head is the way in.
    case signedOut
    /// Signed in, and the network is up.
    case connected
    /// Signed in, and the phone is reaching the network again by itself.
    case connecting
    /// The network asks for the person again (TS-7's expired-or-removed page).
    case signInAgain
    /// Signed in; an admin of the network approves new devices.
    case waitingForApproval
    /// A start failed, in the mesh's own words.
    case couldNotConnect(String)
  }

  /// Whose word the face is (IOS-8c, IOS-8f).
  public enum FaceSource: Equatable, Sendable {
    /// No desktop has said who you are: the plain circle, never a face the
    /// phone would have to take back.
    case none
    /// Dealt from your account, until a desktop of yours says who you are.
    case dealt
    /// The home desktop's own answer (`user.me`), by the desktop's name.
    case home(String)
  }

  public var standing: Standing
  /// The name beside the face; the login stands in until a desktop names you.
  public var name: String
  public var login: String?
  public var face: UserFace?
  public var faceSource: FaceSource
  /// The face's tilt seed — the login, so it sits at the corner's angle.
  public var seed: String
  /// Network details: the tailnet's domain and this phone's machine name, as
  /// Tailscale names them (TS-L2: the words "tailnet" and "node" live here).
  public var tailnet: String?
  public var machineName: String?
  /// Where an admin approves this phone; nil where no page can be named.
  public var adminConsole: URL?
  /// The roster's order, the home first (DS-8), then those asleep by name.
  public var desktops: [SettingsDesktop]

  public init(
    standing: Standing, name: String, login: String?, face: UserFace?, faceSource: FaceSource,
    seed: String, tailnet: String?, machineName: String?, adminConsole: URL?, desktops: [SettingsDesktop]
  ) {
    self.standing = standing
    self.name = name
    self.login = login
    self.face = face
    self.faceSource = faceSource
    self.seed = seed
    self.tailnet = tailnet
    self.machineName = machineName
    self.adminConsole = adminConsole
    self.desktops = desktops
  }

  public var isSignedIn: Bool { standing != .signedOut }

  /// The login under the name — unless it is the name, standing in until a
  /// desktop names you; then it is said once.
  public var loginLine: String? {
    guard let login, login != name else { return nil }
    return login
  }
}

/// One of your desktops, as Settings shows it.
public struct SettingsDesktop: Identifiable, Equatable, Sendable {
  public enum Reach: Equatable, Sendable {
    case connected
    /// On its way, in the corner's word: "dialing", "reconnecting", "not
    /// serving", "no field yet".
    case working(String)
    /// One of the things only the person can fix, in the corner's word, and
    /// the desktop's own reason when it gave one.
    case wantsYou(String, reason: String?)
    /// Not listed now: the Mac is asleep, or VibeField isn't running on it.
    case asleep(lastHeard: Date?)
  }

  public let id: String
  public let name: String
  /// The publishing daemon's `process.platform`; nil is "not said yet".
  public let platform: String?
  public let reach: Reach
  /// The desktop this phone reads its field through (DS-8).
  public let isHome: Bool
  /// Whether it serves its terminals to your devices (TM-5a); nil is "has
  /// not said", which is not a refusal.
  public let servesTerminals: Bool?
  /// PG-3e (design v2 §5.3) — whether this phone can read this desktop's agents through its home: `false` for a
  /// desktop the phone cannot read (its board incompatible, or its door refused the field); nil is "not said yet" —
  /// not hearing, or not on the home's board yet — which is not a refusal, the same posture as `servesTerminals`.
  public let watchable: Bool?
  /// IOS-10c — the agents the home's catalog offers, for the home's page alone; nil for every other desktop, and for
  /// the home before its catalog answers, so no page draws an empty section.
  public let agents: [SettingsAgent]?

  public init(
    id: String, name: String, platform: String?, reach: Reach, isHome: Bool, servesTerminals: Bool?,
    watchable: Bool? = nil, agents: [SettingsAgent]? = nil
  ) {
    self.id = id
    self.name = name
    self.platform = platform
    self.reach = reach
    self.isHome = isHome
    self.servesTerminals = servesTerminals
    self.watchable = watchable
    self.agents = agents
  }

  public var isAsleep: Bool {
    if case .asleep = reach { return true }
    return false
  }
}

/// Where Settings can stand. The card's `···` opens it at `.terminal`.
public enum SettingsRoute: Hashable, Sendable {
  case account
  case desktop(String)
  case appearance
  case terminal
  #if DEBUG || VF_TESTFLIGHT
    /// RB-1 — This phone › Notifications, dotted Not yet: drawn in TestFlight and development builds only
    /// (`SettingsBuild`), so the build submitted for App Review has no such route.
    case notifications
  #endif
  /// WI-3 — This phone › Lock.
  case lock
  case about
  case acknowledgements
  /// IOS-13a — one part's full licence texts, by the part's id (`AcknowledgementsDoc.Part.id`).
  case acknowledgement(String)
}

/// Where the sheet opens: its root, a page, and — past Terminal — one of the
/// Terminal page's own (`TerminalSettingsRoute`).
public struct SettingsOpening: Equatable, Sendable {
  public var routes: [SettingsRoute]
  public var terminalPage: TerminalSettingsRoute?

  public init(_ routes: [SettingsRoute] = [], terminalPage: TerminalSettingsRoute? = nil) {
    self.routes = routes
    self.terminalPage = terminalPage
  }

  public static let root = SettingsOpening()
  /// The corner's *you* (§8 "The Me menu": your name opens Account).
  public static let account = SettingsOpening([.account])
  /// The session card's `···`: the terminal's look, Settings one step back.
  public static let terminal = SettingsOpening([.terminal])
}

/// What Settings asks the host to do: the two acts that belong to the mesh.
public struct SettingsActions {
  public var signIn: () -> Void
  public var signOut: () -> Void

  public init(signIn: @escaping () -> Void, signOut: @escaping () -> Void) {
    self.signIn = signIn
    self.signOut = signOut
  }
}

/// IOS-10c — one agent on the home desktop's page (agents, a read-only glance: James on the page Settings in a
/// Pocket, 2026-11-11; VF-PM's (a), the home's page alone): the home catalog's name for it, its mark key, and the
/// profiles that hold a sign-in for it, in the home's order. Settings draws what it is handed and reads nothing.
public struct SettingsAgent: Identifiable, Equatable, Sendable {
  /// One profile's sign-in for the agent, as its personas last said it.
  public enum SignIn: Equatable, Sendable {
    case signedIn
    /// Its login pane is open.
    case signingIn
    case notSignedIn
    /// No persona of it has been verified yet.
    case notRead
  }

  /// A profile that holds a sign-in for the agent.
  public struct Profile: Equatable, Sendable {
    public let label: String
    public let signIn: SignIn

    public init(label: String, signIn: SignIn) {
      self.label = label
      self.signIn = signIn
    }
  }

  /// The catalog id, never compared to a literal (R23b).
  public let id: String
  public let name: String
  /// The catalog's mark key: what the home's drawing of agent marks is asked for (`SettingsAgentMark`).
  public let mark: String
  public let profiles: [Profile]

  public init(id: String, name: String, mark: String, profiles: [Profile]) {
    self.id = id
    self.name = name
    self.mark = mark
    self.profiles = profiles
  }
}

/// Words said in more than one place, written once.
public enum SettingsWords {
  /// IOS-10c — the home desktop's Agents section: its head and foot (the foot ‹draft› for James).
  public static let agentsHead = "Agents"
  public static let agentsFoot = "Sign in and manage agents on this desktop."

  /// The sign-out confirmation, wherever Sign out is asked for (the corner's
  /// menu and Settings › Account).
  public static func signOutTitle(login: String?) -> String {
    "Sign out of \(login ?? "this account")?"
  }

  /// What a sign-out removes and keeps, in the person's words: the project
  /// colours go with the account (the project ledger), and so does the History
  /// this phone read from your desktops (AP-D4's History half, item 130, the
  /// merge `6130153f8`: `HistoryDesktops.signedOut` beside `SignOutSweep`);
  /// Appearance — this phone's look — and the terminal's look stay.
  public static func signOutMessage(_ device: DeviceWord) -> String {
    "\(device.This) forgets your Tailscale sign-in, your desktops and the History it read from them, your face "
      + "and your project colours. Appearance, the terminal’s look, snippets and clipboard history stay."
  }

  /// IOS-13a (Q1) — the views' words that name the device, lifted here so every one is said by substitution and
  /// tested without a simulator.
  /// Appearance's foot.
  public static func lookFoot(_ device: DeviceWord) -> String {
    "Settings, History, the field and every sheet follow it. It’s \(device.this)’s own; your desktops keep theirs."
  }
  /// Network details' Copy, to a screen reader (and approval's, on the way in).
  public static func copyName(_ device: DeviceWord) -> String { "Copy \(device.this)’s name" }
  /// Network details' foot.
  public static func networkFoot(_ device: DeviceWord) -> String {
    "Named as Tailscale names them, so you can find \(device.this) on Tailscale’s own page."
  }
  /// The short list's foot, on Acknowledgements.
  public static func builtWith(_ device: DeviceWord) -> String {
    "VibeField on \(device.this) is built with these, among others, each under its own licence."
  }
  /// A desktop's page: the head over what the device can do with it, and its foot.
  public static func fromThis(_ device: DeviceWord) -> String { "From \(device.this) you can" }
  public static func sameThings(_ device: DeviceWord) -> String {
    "Your desktops give \(device.this) the same things, because it is you. Another account’s "
      + "desktop gives it nothing, and isn’t shown."
  }
  /// A desktop page whose desktop has left the list.
  public static func notOnThis(_ device: DeviceWord) -> String { "Not on \(device.this) now" }

  /// TS-7 (DESIGN.md §13): the phone wears Tailscale's mark on its sign-in and
  /// in Settings › Account, so About says this.
  public static let trademark = "Tailscale is a registered trademark of Tailscale Inc."

  /// IOS-13a (DESIGN.md §9 "The phone's legal words") — About's two links, in Apple's own words (App Store
  /// Connect's "Privacy Policy" and "Support"), and the line under Tailscale's, word for word from the 0.9 launch's
  /// plan (the store listing carries the same line).
  public static let privacyPolicy = "Privacy Policy"
  public static let support = "Support"
  /// IOS-13a — the acknowledgements' honest lines (§9 "The phone's legal words"): none in the build, one this build
  /// cannot read, and a text a part names that the file does not carry.
  public static let acknowledgementsAbsent = "Acknowledgements aren’t in this build."
  public static func acknowledgementsUnreadable(_ reason: String) -> String {
    "This build’s acknowledgements can’t be read: \(reason)."
  }
  public static func textMissing(_ id: String) -> String { "This text isn’t in the build: \(id)." }
  public static let notAffiliated =
    "VibeField names agents such as Claude Code and Codex to tell sessions apart. "
    + "It isn’t affiliated with or endorsed by Anthropic or OpenAI."
}
