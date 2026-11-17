// RB-2e — the Developer page's Input card states lab (DESIGN.md §8 "The phone's Settings", amended 2026-11-12; §9
// "Developer"). The whole file is compiled only into TestFlight and development builds, as the page that opens it is,
// so the build submitted for App Review carries neither the lab nor its words.
#if DEBUG || VF_TESTFLIGHT
  import FieldInput

  /// One state of the lab: the input card where a long press, a held key or the microphone would otherwise leave it,
  /// named as §9 "Developer" names it (asked for 2026-11-12). Each is reached by the card's own public acts on a fresh
  /// model, so a state the lab shows is a state the card can be in, and a test holds every one without a view.
  enum InputCardLabState: CaseIterable {
    /// A long press on Ctrl: its chord fan.
    case fanOpen
    /// One tap on Ctrl: the next key carries Control.
    case controlArmed
    /// Two taps: Control stays until a third releases it.
    case controlLocked
    /// A long press on Esc: Meta rides the next key.
    case metaArmed
    /// The mic, with heard words in the draft.
    case listening
    /// The keypad in the system keyboard's place, on each of its three pages.
    case keypadNavigate
    case keypadShortcuts
    case keypadFn
    /// A paste long enough to be read before it goes in.
    case pasteToRead
    /// An agent waiting on a permission, answered from the card.
    case replyChips
    /// The keys go to the terminal rather than the draft.
    case typingIntoTerminal

    /// Its name on the lab's list, §9's word for word.
    var name: String {
      switch self {
      case .fanOpen: "A key’s fan, open"
      case .controlArmed: "Control, armed"
      case .controlLocked: "Control, locked"
      case .metaArmed: "Meta, armed"
      case .listening: "Listening"
      case .keypadNavigate: "The keypad, Navigate"
      case .keypadShortcuts: "The keypad, Shortcuts"
      case .keypadFn: "The keypad, Fn"
      case .pasteToRead: "A paste to read first"
      case .replyChips: "Reply chips"
      case .typingIntoTerminal: "Typing into terminal"
      }
    }

    /// Whether the mic wears its listening look while the state stands (`DictationSession.labListening`).
    var listens: Bool { false }

    /// The card's model, moved into the state: the lab's sink first, which takes nothing, then the state's own acts.
    @MainActor func seed(_ model: InputCardModel) {}

    /// What the lab does each second the state stands: a state that lasts three seconds by design is armed again.
    @MainActor func keep(_ model: InputCardModel) {}
  }
#endif
