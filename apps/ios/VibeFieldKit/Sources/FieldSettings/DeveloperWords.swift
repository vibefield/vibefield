#if DEBUG || VF_TESTFLIGHT
  /// RB-2 — the Developer page's words, held to DESIGN.md §9 "Developer" (asked for 2026-11-12: D1–D4,
  /// the 23 states, and how a demo ends, A). They say what a row does, never how it is built.
  public enum DeveloperWords {
    /// One state the Account picker offers: `AccountFixtures`' name for it, and its name on screen.
    public struct AccountState: Equatable, Sendable {
      public let key: String
      public let name: String

      public init(_ key: String, _ name: String) {
        self.key = key
        self.name = name
      }
    }

    public static let row = "Developer"
    public static let demoGroup = "Demo"
    public static let demoField = "Demo field"
    public static let demoFieldLine =
      "A made-up field: studio and mini, their agents and History to read. No desktop needed."
    public static let account = "Account"
    public static let accountLine = "A state stands for one open; then your own account comes back."
    public static let yourOwn = "Your own"
    public static let demoFoot = "Changes take effect the next time VibeField opens."
    public static let yourAccountTitle = "Your account"
    public static let theWayInTitle = "The way in"
    /// The corner and the way in's pages over your account, each named as its page or the corner says it.
    public static let yourAccount: [AccountState] = [
      AccountState("signedin", "Signed in"),
      AccountState("asleep", "Your desktops asleep"),
      AccountState("attention", "Sign in to Tailscale again"),
      AccountState("noface", "Signed in, no face"),
      AccountState("guests", "Another account’s desktop nearby"),
      AccountState("refused", "A desktop refused this phone"),
      AccountState("firstrun", "Welcome"),
      AccountState("failed-first", "Welcome, a first sign-in failed"),
      AccountState("approval", "Waiting for approval"),
      AccountState("none", "No desktops yet"),
      AccountState("expecting", "Welcome, after a scanned code"),
      AccountState("another", "Another account? (a scanned code)"),
      AccountState("another-link", "Another account? (a link)"),
    ]
    /// The steps the way in takes on its own, over made-up facts.
    public static let theWayIn: [AccountState] = [
      AccountState("joining", "Joining your network"),
      AccountState("looking", "Looking for your computer"),
      AccountState("tour-1", "How it works, 1 of 4"),
      AccountState("tour-2", "How it works, 2 of 4"),
      AccountState("tour-3", "How it works, 3 of 4"),
      AccountState("tour-4", "How it works, 4 of 4"),
      AccountState("none-found", "Found your desktop"),
      AccountState("from-code", "Sent by a desktop’s code"),
      AccountState("lock-offer", "The lock offered (Face ID)"),
      AccountState("lock-offer-passcode", "The lock offered (passcode only)"),
    ]
    public static let labsGroup = "Labs"
    public static let swarmLab = "Swarm lab"
    public static let inputCardStates = "Input card states"
    public static let demoTag = "Demo"
    public static let demoTagSpoken = "Demo. What you see is made up."
    public static let foot =
      "For testing. TestFlight and development builds show this page; the build in the App Store does not."

    /// Every state the picker offers, in its order: Your account, then The way in.
    public static var accountStates: [AccountState] { yourAccount + theWayIn }
  }
#endif
