/// What one of the card's responders does with the keyboard: the terminal's
/// Metal view, the composer field, or the keypad's hidden host.
///
/// One keyboard, and one call per change of its owner (the input audit's F,
/// 2026-10-17). The NEW owner takes it, and UIKit moves first responder from
/// the old one in a single keyboard transition; the old owner yields and makes
/// no call at all; and only when no one is to hold the keyboard does its holder
/// release it. Each responder used to act on its own "wanted" flag, so a
/// hand-off was two independent changes, and a resign that ran before the
/// become dropped the keyboard and raised it again — two resizes on every
/// `>_`, `⋯` and `abc`.
public enum ResponderRole: Equatable, Sendable {
  /// Become first responder: this view is the keyboard's owner.
  case take
  /// Another responder is the owner, and its take moves the keyboard.
  case yield
  /// No one holds the keyboard: resign, if holding it.
  case release
}
