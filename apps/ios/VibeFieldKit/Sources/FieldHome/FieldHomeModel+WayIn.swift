import Foundation

// WI-1/WI-2 (DESIGN.md §9 "The way in", §8 "The phone's way in") — what the way in draws for each of its
// screens: where you are, the picture on the words line, the words, and the acts in their glass. Pure, so every
// word is tested without a simulator; `WayInView` only draws what this says.
extension FieldHomeModel {
  /// The way in's screens: a page the decision stands (`DoorPage`), and the steps the way in takes on its own —
  /// the tour, the found beat at its end, and the lock it offers last.
  enum WayInStep: Equatable {
    case page(DoorPage)
    /// How it works, 0…3.
    case tour(Int)
    /// The found beat: your face in the mark's place, the desktop the phone first reached (nil while none
    /// answers).
    case found(name: String?, desktop: String?)
  }

  /// What one screen of the way in draws.
  struct WayInScreen: Equatable {
    /// The top: where you are — the steps' three bars and the step's name, or the tour's four dots.
    enum Steps: Equatable {
      case step(Int)
      case dots(Int)
    }

    /// The centre: the splash's mark in its own place, or what takes its place.
    enum Picture: Equatable {
      case mark
      case face
      /// A drawing on the words line (WI-2).
      case art(Art)
    }

    enum Art: Equatable {
      /// No desktops yet: a computer drawn dashed, the one your computer fills.
      case computerWaiting
      /// The desktop that sent you here (its name on its screen).
      case desktop(String)
      case tour(Int)
    }

    /// The words, from the line down. A hold says one status line, smaller.
    struct Words: Equatable {
      var title: String
      var line: AttributedString?
      var note: String?
      var hold = false
    }

    /// The acts' glass holds three slots: the primary always in the first.
    enum Act: Equatable {
      case primary(String, WayInAct, glyph: String? = nil)
      case secondary(String, WayInAct, glyph: String? = nil)
      /// iOS's share sheet with VibeField's site, as a pill.
      case share(String, primary: Bool)
      case link(String, WayInAct)
      case note(String)
      /// Approval's row: this phone's name as Tailscale knows it, with Copy.
      case thisPhone(machine: String?)
      /// No desktops yet's row: "Your computer appears here".
      case computerWaiting
      /// Tailscale's mark beside its line, on the glass (its media kit keeps it off the field).
      case tailscale(String)
    }

    var steps: Steps?
    /// The tour's back, at the top's left.
    var back: WayInAct?
    var picture: Picture = .mark
    var words: Words
    var acts: [Act] = []
  }

  /// What an act does: the view hands it back, and the home does it.
  enum WayInAct: Equatable {
    case continueWithTailscale
    case scanCode
    case seeHowItWorks
    case tour(Int)
    case welcome
    case signInAgain
    case useAnotherAccount
    case switchAccount
    case keepAccount
    case startOver
    case openAdminConsole(URL)
  }

  /// VibeField's site, where How it works sends a newcomer and No desktops yet sends its link.
  static let vibeFieldSite = URL(string: "https://vibefield.dev")!

  /// The way in's words, held to DESIGN.md §9 "The way in" (the VibeField product bible 0.3 behind them).
  enum WayInWords {
    static let welcomeTitle = "Your agents, in your pocket."
    static let welcomeLine = "See what needs you and open your agents’ terminals, while VibeField runs on your computer."
    static let welcomeNote = "Use the same Tailscale account as VibeField on your computer."
    static let continueWithTailscale = "Continue with Tailscale"
    static let scanTheCode = "Scan the code on your computer"
    static let seeHowItWorks = "New to VibeField? See how it works"
    static func pick(_ login: String) -> String { "At Tailscale, pick \(login)." }
    /// Where you are, by name. Face ID's step comes with the lock it offers (WI-3): until then the way in has
    /// two steps, and never promises a third that does not come.
    static let steps = ["Sign in", "Your computer"]
    static let sendTheLink = "Send the link to my computer"
  }

  /// One screen of the way in, for a step.
  static func wayInScreen(_ step: WayInStep) -> WayInScreen {
    let words = WayInWords.self
    switch step {
    case .page(.welcome(let failure, let expecting)):
      return WayInScreen(
        words: .init(
          title: words.welcomeTitle, line: AttributedString(words.welcomeLine),
          note: failure ?? expecting.map(words.pick) ?? words.welcomeNote),
        acts: [
          .primary(words.continueWithTailscale, .continueWithTailscale),
          .secondary(words.scanTheCode, .scanCode, glyph: "qrcode.viewfinder"),
          .link(words.seeHowItWorks, .seeHowItWorks),
        ])

    case .page(.fromCode(let desktop, let login)):
      var line = AttributedString("\(desktop) sent you here. It uses Tailscale as ")
      line += bold(login)
      line += AttributedString(", so sign in with that account.")
      return WayInScreen(
        picture: .art(.desktop(desktop)),
        words: .init(title: "Connect to \(desktop).", line: line),
        acts: [
          .primary(words.continueWithTailscale, .continueWithTailscale),
          .link("Not yours? Start over", .startOver),
        ])

    case .page(.approval(let machine, let console)):
      var acts: [WayInScreen.Act] = [.thisPhone(machine: machine)]
      if let console { acts.append(.secondary("Open the admin console", .openAdminConsole(console))) }
      return WayInScreen(
        steps: .step(1),
        words: .init(
          title: "Waiting for approval.",
          line: AttributedString("You’re signed in. An admin of your Tailscale network approves new devices.")),
        acts: acts)

    case .page(.signInAgain(let note)):
      return WayInScreen(
        picture: .face,
        words: .init(
          title: "Sign in to Tailscale again.",
          line: AttributedString("This phone can’t reach your desktops until you do. Nothing here is lost."),
          note: note),
        acts: [
          .primary("Sign in again", .signInAgain),
          .link("Use another account", .useAnotherAccount),
        ])

    case .page(.anotherAccount(let current, let expected, let from, let byLink)):
      // TS-7b (A:723): a code that came by a link may be anyone's, so Keep this account leads (EL7)
      let signIn = WayInScreen.Act.primary("Sign in again", .switchAccount)
      let keep = WayInScreen.Act.primary("Keep this account", .keepAccount)
      let acts: [WayInScreen.Act] =
        byLink
        ? [keep, .secondary("Sign in again", .switchAccount), .note(words.pick(expected))]
        : [signIn, .secondary("Keep this account", .keepAccount), .note(words.pick(expected))]
      return WayInScreen(
        steps: .step(1),
        words: .init(
          title: "Another account?",
          line: AttributedString(anotherAccountLine(current: current, expected: expected, from: from, byLink: byLink))),
        acts: acts)

    case .page(.joining(let login, let note)):
      return WayInScreen(
        steps: .step(1),
        words: .init(
          title: "Joining your network…", line: login.map { AttributedString("Signed in as \($0)") },
          note: note.map { "Couldn’t connect — \($0)." }, hold: true))

    case .page(.looking(let login)):
      return WayInScreen(
        steps: .step(2),
        words: .init(
          title: "Looking for your computer…",
          line: AttributedString("Open VibeField on your computer, signed in to Tailscale as \(login)."), hold: true))

    case .page(.noDesktops(let login)):
      return WayInScreen(
        steps: .step(2), picture: .art(.computerWaiting),
        words: .init(title: "No desktops yet.", line: noDesktopsLine(login: login)),
        acts: [.computerWaiting, .share(words.sendTheLink, primary: false)])

    case .found(let name, let desktop):
      return WayInScreen(
        steps: .step(2), picture: .face,
        words: .init(
          title: name.map { "Hi, \($0)." } ?? "Hi.", line: desktop.map { AttributedString("Connected to \($0).") },
          hold: true))

    case .tour(let page):
      return tourScreen(page)
    }
  }

  /// How it works, four pages (WI-2; WI-D1 A: optional, and again in Settings › About).
  private static func tourScreen(_ page: Int) -> WayInScreen {
    let page = min(max(page, 0), 3)
    let back: WayInAct = page == 0 ? .welcome : .tour(page - 1)
    let next = WayInScreen.Act.primary("Next", .tour(page + 1))
    switch page {
    case 0:
      return WayInScreen(
        steps: .dots(0), back: back, picture: .art(.tour(0)),
        words: .init(
          title: "Your agents run on your computer.",
          line: AttributedString(
            "VibeField is a control room for coding agents: Claude Code, Codex and others, each in its own terminal.")),
        acts: [next])
    case 1:
      return WayInScreen(
        steps: .dots(1), back: back, picture: .art(.tour(1)),
        words: .init(
          title: "Keep up when you step away.",
          line: AttributedString(
            "See which sessions need you, then open an agent’s own terminal and type into it.")),
        acts: [next])
    case 2:
      return WayInScreen(
        steps: .dots(2), back: back, picture: .art(.tour(2)),
        words: .init(
          title: "No VibeField account.",
          line: AttributedString(
            "Your phone reaches your computer over your own Tailscale network, encrypted end to end. VibeField runs no session relay.")),
        acts: [next, .tailscale("Connecting your devices requires a Tailscale account.")])
    default:
      var line = AttributedString("Get VibeField at ")
      line += bold("vibefield.dev")
      line += AttributedString(". When its setup connects your devices, it shows a code for this phone.")
      return WayInScreen(
        steps: .dots(3), back: back, picture: .art(.tour(3)),
        words: .init(
          title: "Start on your computer.", line: line,
          note: "Your agents run there, so keep it awake and connected while you’re away."),
        acts: [.share(WayInWords.sendTheLink, primary: true), .secondary("I already have VibeField", .welcome)])
    }
  }

  /// TS-7b (A:723) — both logins named; the desktop's name is drawn as plain text.
  static func anotherAccountLine(current: String, expected: String, from: String, byLink: Bool) -> String {
    let came = byLink ? "the link you opened" : "the code you scanned"
    return "This phone is signed in as \(current), but \(came) came from \(from), signed in as \(expected)."
  }

  /// "Connect your devices…" in the desktop menu's own weight, so the eye finds the words it will look for on
  /// the computer.
  static func noDesktopsLine(login: String) -> AttributedString {
    var line = AttributedString("Signed in as \(login). On your computer, open VibeField, click your face, then ")
    line += bold("Connect your devices…")
    line += AttributedString(" with this same account.")
    return line
  }

  private static func bold(_ words: String) -> AttributedString {
    var run = AttributedString(words)
    run.inlinePresentationIntent = .stronglyEmphasized
    return run
  }
}
