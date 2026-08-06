/// FieldTerminal — the terminal leg (IOS-3).
///
/// Everything that knows Ghosttea's renderer exists lives in this module:
/// appearance → `GhostteaTerminalPresentationConfig`, the attachment
/// lifecycle over Truffle, and the Metal surface. FieldHome composes a
/// terminal; it never learns how one works.
public enum FieldTerminal {
  /// The module's own version marker, so a card can say what it is made of.
  public static let ghostteaVersion = "0.9.2"
}
