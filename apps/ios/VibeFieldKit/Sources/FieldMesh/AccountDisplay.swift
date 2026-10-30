/// The account corner's vocabulary (IOS-8b) — the chrome family's voice this
/// time, because the corner is chrome: sentence case, words rather than
/// instrument readings, and the one colour §2.5 allows for "needs you".
///
/// `MeshDisplay` keeps the mesh's own facts (the account line, the status
/// sentence, which desktop wants the user); this adds what the corner's rows
/// say about them. Pinned by `AccountDisplayTests`.
public enum AccountDisplay {
  /// A desktop row's trailing word, and whether the row is one of the things
  /// only the person can fix.
  public struct DesktopWord: Equatable, Sendable {
    public let word: String?
    public let wantsTheUser: Bool

    public init(word: String?, wantsTheUser: Bool) {
      self.word = word
      self.wantsTheUser = wantsTheUser
    }

    /// The healthy answer: a desktop that is answering and feeding needs no
    /// word, because the bodies on the field already are the word.
    public static let quiet = DesktopWord(word: nil, wantsTheUser: false)
  }

  /// The word beside a desktop the link lists. The full sentence stays
  /// `MeshDisplay.linkLine`; this is what fits at the end of a 44 pt row.
  ///
  /// `isHearing` for the reason the retired IOS-4e link face took it: a
  /// desktop that answered and has sent no board is "there and saying
  /// nothing", and a corner that stayed silent over it would be the blank the
  /// corpus forbids wearing a healthy face.
  public static func desktopWord(_ desktop: FieldDesktop, isHearing: Bool) -> DesktopWord {
    switch desktop.state {
    case .ready:
      if desktop.fieldRefusal != nil { return DesktopWord(word: "field refused", wantsTheUser: true) }
      if desktop.feed == FieldFeedSource.none, !isHearing {
        return DesktopWord(word: "no field yet", wantsTheUser: false)
      }
      return .quiet
    case .noDoor: return DesktopWord(word: "not serving", wantsTheUser: false)
    case .connecting: return DesktopWord(word: "dialing", wantsTheUser: false)
    case .reconnecting: return DesktopWord(word: "reconnecting", wantsTheUser: false)
    case .failed: return DesktopWord(word: "refused", wantsTheUser: true)
    case .refusedDoor: return DesktopWord(word: "no door", wantsTheUser: true)
    }
  }

  /// The word beside a desktop this account has seen and the tailnet does not
  /// list right now (AP-D6): its node is off — the machine is asleep, or
  /// VibeField is not running on it. Not a state the link can report, so it is
  /// a memory's word.
  public static let asleep = "asleep"

  /// One faint sentence for the doors that refused this phone (UA-P-1d: a
  /// guest desktop is never drawn), only when there is one to count.
  public static func othersLine(count: Int) -> String? {
    switch count {
    case ..<1: return nil
    case 1: return "1 other account’s desktop on this tailnet — not yours, not shown."
    default: return "\(count) other accounts’ desktops on this tailnet — not yours, not shown."
    }
  }

  /// The orange words at the top of the menu — said where the act is, in
  /// sentences (I-5: state stays in words). `nil` is the ordinary case.
  ///
  /// TS-7 — in the link's words (DESIGN.md §9): "tailnet", "node" and "mesh"
  /// stay in Network details (TS-L2), and approval is approval.
  public static func notice(state: MeshModel.State) -> String? {
    switch state {
    case .needsLogin: return "Sign in to Tailscale again to reach your desktops."
    case .needsMachineAuth: return "An admin of your Tailscale network approves new devices."
    case .failed(let reason): return "Couldn’t connect — \(reason)."
    case .off, .starting, .up, .stopping, .reconnecting: return nil
    }
  }

  /// TS-7 — the menu's sign-in row: the act's own words on a first sign-in
  /// (DESIGN.md §9), the desktop's "Sign in again" for an account the tailnet
  /// asks for again (§9's expired pane).
  public static func signInWord(hasAccount: Bool) -> String {
    hasAccount ? "Sign in again" : "Continue with Tailscale"
  }

  /// What the line under the name says while the mesh is not up — lowercase
  /// facts, the corner's own voice. Up, the line is the account line instead.
  public static func connectionDetail(state: MeshModel.State) -> String? {
    switch state {
    case .off: return "not connected"
    case .starting: return "connecting…"
    case .needsLogin: return "sign in again"
    case .needsMachineAuth: return "waiting for approval"
    case .stopping: return "signing out"
    case .reconnecting: return "reconnecting…"
    case .failed: return "couldn’t connect"
    case .up: return nil
    }
  }
}
