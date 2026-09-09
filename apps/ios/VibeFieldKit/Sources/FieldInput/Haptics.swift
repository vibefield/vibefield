import UIKit

/// The card's taps, felt — the whole table in one place.
///
/// A sticky modifier is the one control on this rail whose whole state is a
/// fill: armed and locked look alike at arm's length, and a key that changed
/// what the NEXT key means has to be felt to be trusted. So each transition
/// gets its own texture, and nothing on this card shares one with a transition
/// it could be confused for.
///
/// **The table (IOS-5b's four, IOS-5e's three, and who else borrows them).**
///
/// | Act | Texture | Why it is that one |
/// |---|---|---|
/// | Ctrl armed | impact `.light` | something small opened, and it closes itself in 3 s |
/// | Ctrl locked | impact `.medium` | the heavier of the two, because it is the heavier promise |
/// | Ctrl released | impact `.soft` | a thing ending, blunt rather than sharp |
/// | a chord out of a fan | impact `.rigid` | a key that is not on the rail just fired; the sharpest texture here |
/// | a combo off the keypad | impact `.rigid` | it IS a chord, several of them — same act, same texture |
/// | Meta armed | impact `.light` | an arm, and the burst is the lighter promise of the two arms |
/// | dictation started | impact `.light` | a mode the next words land in just opened — the latch's own arm |
/// | dictation stopped | impact `.soft` | and closed — the latch's own release |
/// | a reply chip | impact `.light` | an answer left for the agent; light because it leaves nothing behind |
/// | keypad page change | `.selectionChanged` | the system's texture for moving through a set of choices |
/// | Send with text | notification `.success` | the draft LEFT — the one act here with a result to report |
/// | Send with an empty draft | nothing | that path is Enter, and a keystroke is not felt |
///
/// Two absences are deliberate. A plain rail key (ESC, TAB, an arrow) has no
/// haptic: it is a keystroke, the system keyboard does not buzz per letter,
/// and nine keys that each thumped would make the rail feel like a machine
/// being wound. And nothing here fires on a state the user did not cause — an
/// expiring latch is silent, because a buzz from a control nobody touched is
/// indistinguishable from a fault.
///
/// **Reduce Motion is deliberately not consulted here.** Haptics are not
/// motion; iOS has its own switch for them (Settings → Sounds & Haptics), the
/// generators honour it, and silencing feedback because someone asked for less
/// animation would take the card's one non-visual channel away from the reader
/// most likely to be leaning on it.
///
/// Called from the VIEW, never the model. The model is a pure state machine
/// tested with no device under it, and a generator firing inside `tapControl`
/// would be a UIKit dependency in the one type that deliberately has none.
@MainActor
public enum InputHaptics {

  /// Ctrl armed for one key. Also: the Meta burst, and dictation starting.
  public static func arm() { impact(.light) }

  /// Ctrl locked until released — the heavier of the two, because it is the
  /// heavier promise.
  public static func lock() { impact(.medium) }

  /// Ctrl released. Also: dictation stopping.
  public static func release() { impact(.soft) }

  /// A chord picked out of a long-press fan, or a combo off the keypad.
  public static func chord() { impact(.rigid) }

  // --- IOS-5e ---------------------------------------------------------------

  /// A reply chip answered the agent.
  ///
  /// The same texture as an arm rather than a heavier one: the chip commits
  /// something — `1` goes down the wire — but weight on this card is reserved
  /// for state the user is now CARRYING, and a chip leaves nothing behind.
  public static func chip() { impact(.light) }

  /// The keypad changed page.
  ///
  /// A selection generator rather than an impact, because that is exactly what
  /// this is: moving through a set of choices, the same gesture as a picker
  /// wheel, and the system has one texture for it that every thumb already
  /// knows.
  public static func page() {
    selection.selectionChanged()
    selection.prepare()
  }

  /// Send, with something in the draft.
  ///
  /// The one notification on the card. A success notification is the system's
  /// "that completed", which is the honest shape here: a sent draft has left
  /// the phone, where every other act on this card is a key going down. An
  /// empty draft gets nothing — that path is Enter, and Enter is a keystroke.
  public static func sent() {
    notification.notificationOccurred(.success)
    notification.prepare()
  }
  // --- end IOS-5e -----------------------------------------------------------

  /// One generator per texture, made on first use and kept.
  ///
  /// `prepare()` before each use is what buys the sub-frame latency: the Taptic
  /// engine idles otherwise, and a cold generator fires late enough that the
  /// tap and the feeling come apart.
  private static var generators: [UIImpactFeedbackGenerator.FeedbackStyle:
    UIImpactFeedbackGenerator] = [:]
  /// The two non-impact generators, kept for the same reason and prepared
  /// AFTER firing rather than before: both are used in runs (page, page, page),
  /// and the engine is warm for the next one that way.
  private static let selection = UISelectionFeedbackGenerator()
  private static let notification = UINotificationFeedbackGenerator()

  private static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
    let generator: UIImpactFeedbackGenerator
    if let existing = generators[style] {
      generator = existing
    } else {
      generator = UIImpactFeedbackGenerator(style: style)
      generators[style] = generator
    }
    generator.prepare()
    generator.impactOccurred()
  }
}
