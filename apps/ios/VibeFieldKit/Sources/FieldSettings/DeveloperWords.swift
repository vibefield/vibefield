#if DEBUG || VF_TESTFLIGHT
  /// RB-2 — the Developer page's words, held to DESIGN.md §9 "Developer" (James on the board card
  /// j-rb2-developer-page, 2026-11-12 17:56:21.512Z, D1–D4; the states counted on the correction card
  /// j-rb2-d3-count, 21:44:43.337Z; how a demo ends on the card j-rb2-d5-demo-ends, 21:44:36.025Z, A). They say what
  /// a row does, never how it is built.
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

    // RB-2b (red): stubs, every word empty and both groups empty. RB-2c writes §9's words.
    public static let row = ""
    public static let demoGroup = ""
    public static let demoField = ""
    public static let demoFieldLine = ""
    public static let account = ""
    public static let accountLine = ""
    public static let yourOwn = ""
    public static let demoFoot = ""
    public static let yourAccountTitle = ""
    public static let theWayInTitle = ""
    public static let yourAccount: [AccountState] = []
    public static let theWayIn: [AccountState] = []
    public static let labsGroup = ""
    public static let swarmLab = ""
    public static let inputCardStates = ""
    public static let demoTag = ""
    public static let demoTagSpoken = ""
    public static let foot = ""

    /// Every state the picker offers, in its order: Your account, then The way in.
    public static var accountStates: [AccountState] { yourAccount + theWayIn }
  }
#endif
