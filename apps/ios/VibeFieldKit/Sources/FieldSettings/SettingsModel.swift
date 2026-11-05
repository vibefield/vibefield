import FieldDesign
import Foundation

/// Everything about Settings that is a decision rather than a layout: which
/// words each state says, and where. Kept out of the views so it is tested
/// without a simulator. Every word is DESIGN.md §9's, or the corner's.
public enum SettingsModel {

  /// A line of words, and whether it is one of the things only the person can
  /// fix (§2.5's orange, with the dot beside the words).
  public struct Line: Equatable, Sendable {
    public let text: String
    public let wantsTheUser: Bool

    public init(_ text: String, wantsTheUser: Bool = false) {
      self.text = text
      self.wantsTheUser = wantsTheUser
    }
  }

  // MARK: - The head

  /// Under the name at the head of Settings: the login while all is well, and
  /// the door's own words when the network asks for the person (TS-7). Signed
  /// out, nothing: Settings is never open signed out (WI-L1). RETIRED 2026-11-02
  /// (item 163): the signed-out head's note, which said "Mac".
  public static func headLines(_ account: SettingsAccount) -> (status: Line?, note: String?) {
    switch account.standing {
    case .signInAgain:
      return (
        Line("Sign in to Tailscale again", wantsTheUser: true),
        "This phone can’t reach your desktops until you do. Nothing here is lost."
      )
    case .waitingForApproval:
      return (
        Line("Waiting for approval", wantsTheUser: true),
        "You’re signed in. An admin of your Tailscale network approves new devices."
      )
    case .signedOut, .connected, .connecting, .couldNotConnect:
      return (nil, nil)
    }
  }

  // MARK: - Your desktops

  /// A desktop's line, under its name. Asleep is grey and never "offline"
  /// (§9); the home says the field comes through it.
  public static func desktopLine(
    _ desktop: SettingsDesktop, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current
  ) -> Line {
    switch desktop.reach {
    case .connected:
      return Line(desktop.isHome ? "Connected · your field comes through it" : "Connected")
    case .working(let word):
      return Line(sentence(word))
    case .wantsYou(let word, _):
      return Line(sentence(word), wantsTheUser: true)
    case .asleep(let lastHeard):
      guard let lastHeard else { return Line("Asleep") }
      return Line("Asleep · last heard \(heard(lastHeard, now: now, calendar: calendar, locale: locale))")
    }
  }

  // RETIRED 2026-11-02 (item 163): `noDesktopsFoot`, the foot under an empty list, which said "Mac". Settings is
  // open only signed in, and it lists every desktop WI-L2 counts as known, so its list is never empty.

  /// "today, 18:02", "yesterday, 18:02", or the day — when a sleeping desktop
  /// was last heard.
  public static func heard(_ date: Date, now: Date, calendar: Calendar, locale: Locale) -> String {
    var time = Date.FormatStyle(date: .omitted, time: .shortened)
    time.locale = locale
    time.calendar = calendar
    time.timeZone = calendar.timeZone
    if calendar.isDate(date, inSameDayAs: now) { return "today, \(date.formatted(time))" }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
      return "yesterday, \(date.formatted(time))"
    }
    var day = Date.FormatStyle().month(.abbreviated).day()
    day.locale = locale
    day.calendar = calendar
    day.timeZone = calendar.timeZone
    return date.formatted(day)
  }

  /// The corner's words are a menu's, lowercase; a row says them as a
  /// sentence.
  static func sentence(_ word: String) -> String {
    guard let first = word.first else { return word }
    return first.uppercased() + word.dropFirst()
  }

  // MARK: - A desktop's page

  /// What the phone can do with a desktop of yours while it answers — the same
  /// for every one, because each mints the phone what it mints every self
  /// principal (DS-D5) under the phone's one scope set (`TAILNET_SCOPES`) —
  /// and the one thing not built yet. Drawn only for a desktop that is
  /// connected: one that is refused or incompatible is not asked (DS-L9).
  public struct Ability: Equatable, Sendable {
    public let title: String
    public let detail: String?
    public let can: Bool
  }

  public static func abilities(_ desktop: SettingsDesktop) -> [Ability] {
    // Its agents' terminals — and, since PG-3e, its bare terminals, which are
    // bodies on the phone now that it reads the home's remote cut (PG-D5).
    // (Corrected 2026-11-02: this said a bare terminal was no body until PG-D5.)
    let terminals: Ability =
      desktop.servesTerminals == false
      ? Ability(
        title: "Open its agents’ terminals and type",
        detail: "\(desktop.name) doesn’t serve its terminals to your devices.", can: false)
      : Ability(title: "Open its agents’ terminals and type", detail: nil, can: true)
    return [
      // PG-3e (§5.3) — a desktop this phone cannot read says so (J-E1 (iii)'s
      // words, at the lean); not said is not a refusal.
      desktop.watchable == false
        ? Ability(
          title: "Watch its agents", detail: "\(desktop.name) runs a VibeField this phone can’t read.",
          can: false)
        : Ability(title: "Watch its agents", detail: nil, can: true),
      Ability(title: "Start agents in its folders", detail: nil, can: true),
      terminals,
      Ability(title: "Read and search its History", detail: nil, can: true),
      // Approving by typing into the pane works today (the welcome's "Approve
      // agents"); the verdict from the card is AR-6's, and not built.
      Ability(title: "Approve from the card", detail: nil, can: false),
    ]
  }

  /// "Terminals": served, or not, or not said (then not drawn).
  public static func terminalsValue(_ desktop: SettingsDesktop) -> String? {
    switch desktop.servesTerminals {
    case .some(true): "Served to your devices"
    case .some(false): "Not served"
    case .none: nil
    }
  }

  /// The words under a desktop that is not reachable now. What the phone
  /// already read stays (DS-L8: a sleeping desktop's rows stay; History keeps
  /// what was opened, and says so in its own words); only what needs the
  /// desktop itself waits — its terminals, and search, which runs on its index.
  public static func asleepFoot(_ desktop: SettingsDesktop, standing: SettingsAccount.Standing) -> String {
    standing == .signInAgain
      ? "What you already opened from it stays on this phone. Its terminals and search answer once you sign in to Tailscale again."
      : "Tailscale doesn’t list \(desktop.name) right now: it’s asleep, or VibeField isn’t running on it. What you already opened from it stays on this phone; its terminals and search answer when it wakes."
  }

  // MARK: - Account

  /// The Tailscale card's state word.
  public static func tailscaleState(_ standing: SettingsAccount.Standing) -> Line {
    switch standing {
    case .signedOut: Line("Not signed in")
    case .connected: Line("Connected")
    case .connecting: Line("Connecting…")
    case .signInAgain: Line("Sign in to Tailscale again", wantsTheUser: true)
    case .waitingForApproval: Line("Waiting for approval", wantsTheUser: true)
    case .couldNotConnect(let reason): Line("Couldn’t connect — \(reason).", wantsTheUser: true)
    }
  }

  public static func tailscaleFoot(_ standing: SettingsAccount.Standing) -> Line {
    switch standing {
    case .signInAgain:
      Line("This phone can’t reach your desktops until you do. Nothing here is lost.", wantsTheUser: true)
    case .waitingForApproval:
      Line("An admin of your Tailscale network approves new devices.")
    case .signedOut, .connected, .connecting, .couldNotConnect:
      Line("While you’re signed in, this phone stays connected by itself.")
    }
  }

  /// The face's row value — how it is framed, the desktop's own word for it
  /// (`FaceFrame`) — and the section's foot. Whose word the face is rides on
  /// the section's tag, so the row does not say it twice.
  public static func faceWords(_ source: SettingsAccount.FaceSource, face: UserFace?) -> (value: String, foot: String) {
    let frame: String =
      switch face?.frame {
      case .some(.sticker): "Sticker"
      case .some(.coin): "Coin"
      case .none: "None yet"
      }
    switch source {
    case .none:
      return (
        "None yet",
        "A desktop says who you are once this phone reaches one. Until then the corner is a plain circle, "
          + "never a face it would have to take back."
      )
    case .dealt:
      return (
        frame,
        "Dealt from your account, the way your computer deals it, until a desktop of yours says who you are."
      )
    case .home(let desktop):
      return (
        frame,
        "\(desktop) says who you are, and this phone wears the face and the name you chose there. "
          + "Change them on \(desktop), in Settings › Account; the phone takes them the next time it connects."
      )
    }
  }

  // MARK: - About

  /// `0.1 (4)` — the bundle's own version and build.
  public static func version(info: [String: Any]?) -> String {
    let short = info?["CFBundleShortVersionString"] as? String
    let build = info?["CFBundleVersion"] as? String
    switch (short, build) {
    case (let short?, let build?): return "\(short) (\(build))"
    case (let short?, nil): return short
    case (nil, let build?): return "(\(build))"
    case (nil, nil): return "—"
    }
  }

  /// The app icon's file, as the compiled Info.plist names it.
  ///
  /// It loads the LIGHT rendition in either look. Measured 2026-10-31 on the
  /// simulator: the compiled catalog keeps `AppIcon-Dark.png` as the
  /// `UIAppearanceDark` appearance of the `AppIcon` asset, and neither that
  /// name nor this one hands it to `UIImage(named:in:compatibleWith:)` with dark
  /// traits. Drawing the dark icon here needs its own image in the kit, which
  /// `icons:generate` would have to write.
  public static func iconName(info: [String: Any]?) -> String? {
    guard let icons = info?["CFBundleIcons"] as? [String: Any],
      let primary = icons["CFBundlePrimaryIcon"] as? [String: Any]
    else { return nil }
    if let files = primary["CFBundleIconFiles"] as? [String], let last = files.last { return last }
    return primary["CFBundleIconName"] as? String
  }

  /// IOS-13a — one of About's links: its words and where it goes (Safari, outside VibeField).
  public struct AboutLink: Equatable, Sendable, Identifiable {
    public let title: String
    public let url: URL
    public var id: String { title }
  }

  /// About's links (§8, amended 2026-11-05): the privacy policy and support, from the site's one pair.
  public static let aboutLinks: [AboutLink] = [
    AboutLink(title: SettingsWords.privacyPolicy, url: VibeFieldSite.privacy),
    AboutLink(title: SettingsWords.support, url: VibeFieldSite.support),
  ]

  /// About's foot, one foot: Tailscale's trademark line, then the non-affiliation line under it.
  public static let aboutFoot: [String] = [SettingsWords.trademark, SettingsWords.notAffiliated]

  /// One credit: what the phone is built with, what it is for, and its licence.
  public struct Credit: Equatable, Sendable, Identifiable {
    public let name: String
    public let role: String
    public let licence: String
    public var id: String { name }
  }

  /// What the phone draws and runs that others made, each under its licence.
  public static let credits: [Credit] = [
    Credit(name: "ghosttea", role: "The terminal", licence: "MIT"),
    Credit(name: "Ghostty", role: "ghosttea’s upstream, and the effects’ source", licence: "MIT"),
    Credit(name: "iTerm2-Color-Schemes", role: "The terminal themes, each its author’s", licence: "MIT"),
    Credit(name: "truffle", role: "The private network", licence: "MIT"),
    Credit(name: "Tailscale", role: "truffle’s network", licence: "BSD-3-Clause"),
    Credit(name: "WireGuard", role: "Tailscale’s tunnels", licence: "MIT"),
    Credit(name: "Lobe Icons", role: "The agents’ marks", licence: "MIT"),
    Credit(name: "Simple Icons", role: "The desktops’ OS marks", licence: "CC0 1.0"),
  ]
}
