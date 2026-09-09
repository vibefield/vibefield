import SwiftUI

/// What the card SAYS when it changes state, for a reader who cannot see the
/// fill that says it.
///
/// **Why announcements at all.** Every mode on this card is drawn as inversion
/// — armed CTRL, locked CTRL, META, the lit terminal key, the `⋯` key while
/// the keypad is up. A label change alone is not enough: VoiceOver reads a
/// button's label when focus lands on it, and the whole point of a sticky
/// modifier is that you arm it and then go somewhere else. Without an
/// announcement, arming Ctrl and typing `c` is a screen reader user finding
/// out what happened from the terminal's output, which is exactly the
/// difference between a keyboard and a guess.
///
/// The design asks for it by name (§4's rail: "Armed and locked are white
/// fills; VoiceOver announces both") and §10's acceptance list makes it a
/// tick: "VoiceOver announces Ctrl armed and locked."
///
/// **Why the strings live here and the posting lives in the views.** An
/// announcement is presentation — the same rule that keeps `InputHaptics` out
/// of `InputCardModel`, which is a pure state machine with no UIKit and no
/// SwiftUI in it. But the WORDS are a decision, and a decision that only
/// exists inside a `body` cannot be pinned; so the words are values here and
/// `InputAnnouncementTests` reads them back.
///
/// **The voice.** Sentence case and plain speech, because this is spoken
/// aloud: "Control armed", not "CTRL ARMED". The screen's own copy rule still
/// holds — the word "Live" is not here either, and the mode announces itself
/// as what is happening ("Typing into terminal") rather than as its name.
public enum InputAnnouncement {

  /// The sticky Ctrl moved. Three phases, three sentences.
  ///
  /// `off` is "released" rather than "off": the user tapped a third time and
  /// what they did was let go of something, which is a different fact from a
  /// control that was never armed.
  public static func latch(_ phase: LatchState.Phase) -> String {
    switch phase {
    case .armed: return "Control armed"
    case .locked: return "Control locked"
    case .off: return "Control released"
    }
  }

  /// Long-press ESC, and the keypad's ALT key. One keystroke, then gone — and
  /// the sentence says the window rather than just the state, because a burst
  /// that expires unheard is the one way this control lies.
  public static let metaArmed = "Meta armed for the next key"

  /// The `>_` toggle. What the strip says, said out loud — and "Drafting" for
  /// the way back, which is the one state on this card with no strip of its
  /// own to read.
  public static func mode(_ mode: InputCardModel.Mode) -> String {
    switch mode {
    case .live: return "Typing into terminal"
    case .draft: return "Drafting"
    }
  }

  /// The `⋯` toggle. The letters left or came back, which a screen reader
  /// otherwise learns only by exploring the keyboard again.
  public static func keypad(_ shown: Bool) -> String {
    shown ? "Terminal keys" : "System keyboard"
  }

  // MARK: - Speaking

  /// Say it, if anything is listening.
  ///
  /// `AccessibilityNotification.Announcement` is a no-op with VoiceOver off,
  /// so there is no guard here and no need for one — and the guard would be
  /// the wrong shape anyway: Voice Control and Switch Control read these too.
  @MainActor
  public static func post(_ text: String) {
    AccessibilityNotification.Announcement(text).post()
  }
}
