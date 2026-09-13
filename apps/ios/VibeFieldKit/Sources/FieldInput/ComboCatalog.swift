import FieldTerminal

/// A named sequence of keystrokes — the keypad's third page.
///
/// A combo is a SCRIPT, not a chord: `^B c` is two presses (`control("b")`,
/// then a plain `c`), and the terminal on the far end reads them exactly as it
/// would read two taps on the rail. That is why the strokes are a list rather
/// than one keystroke with more modifiers on it — tmux's prefix is a key you
/// press and release, and `^B^C` means something else entirely.
public struct Combo: Identifiable, Equatable, Sendable {
  public let id: String
  /// The key's face, spaced the way the manuals spell it: `^B c`.
  public let label: String
  /// One or two words saying what it does, in the fan's own register.
  public let subtitle: String
  /// What VoiceOver reads instead of "caret B c".
  public let accessibilityLabel: String
  /// The presses, in order.
  public let strokes: [TerminalKeystroke]

  init(id: String, label: String, subtitle: String, spoken: String, strokes: [TerminalKeystroke]) {
    self.id = id
    self.label = label
    self.subtitle = subtitle
    self.accessibilityLabel = subtitle.isEmpty ? spoken : "\(spoken), \(subtitle)"
    self.strokes = strokes
  }
}

/// One program's worth of combos.
///
/// Grouped by the thing that owns the keys rather than by what they do,
/// because that is how a user remembers them: the prefix belongs to tmux, and
/// `^A` means something different once screen is the program in front of you.
public struct ComboPack: Identifiable, Equatable, Sendable {
  public let id: String
  /// The pack's heading on the page.
  public let title: String
  public let combos: [Combo]
}

/// The four packs the design names (§4, "Where combos happen").
///
/// "Record" — the design's fourth entry, which would capture a sequence off
/// the rail into a new key — is ABSENT rather than present and inert (D-i6):
/// recording wants a store, an editor and a name, which is a slice of its own.
public enum ComboCatalog {

  /// Emacs' own motion keys, which are also readline's defaults and therefore
  /// the ones that work in a bare shell.
  public static let emacs = ComboPack(
    id: "emacs",
    title: "Emacs",
    combos: [
      control("emacs", "a", "line start"),
      control("emacs", "e", "line end"),
      control("emacs", "k", "kill to end"),
      control("emacs", "y", "yank"),
      control("emacs", "f", "forward"),
      control("emacs", "b", "back"),
      control("emacs", "n", "next"),
      control("emacs", "p", "previous"),
    ])

  /// tmux, whose every key is the prefix and then a plain one. The prefix is
  /// the default `^B`; a user who has rebound it reads these as the shape
  /// rather than the binding.
  public static let tmux = ComboPack(
    id: "tmux",
    title: "Tmux",
    combos: [
      prefixed("tmux", prefix: "b", then: "c", subtitle: "new window"),
      prefixed("tmux", prefix: "b", then: "n", subtitle: "next"),
      prefixed("tmux", prefix: "b", then: "p", subtitle: "previous"),
      prefixed("tmux", prefix: "b", then: "d", subtitle: "detach"),
      prefixed("tmux", prefix: "b", then: "[", subtitle: "copy mode"),
      prefixed("tmux", prefix: "b", then: "%", subtitle: "split"),
    ])

  /// The line editor every shell shares.
  public static let readline = ComboPack(
    id: "readline",
    title: "Readline",
    combos: [
      control("readline", "r", "search"),
      control("readline", "l", "clear"),
      control("readline", "u", "kill line"),
      control("readline", "w", "kill word"),
      control("readline", "c", "interrupt"),
      control("readline", "d", "eof"),
    ])

  /// screen, for the desktops that still run it.
  public static let screen = ComboPack(
    id: "screen",
    title: "Screen",
    combos: [
      prefixed("screen", prefix: "a", then: "c", subtitle: "new"),
      prefixed("screen", prefix: "a", then: "n", subtitle: "next"),
      prefixed("screen", prefix: "a", then: "d", subtitle: "detach"),
    ])

  /// The page's order, which is also the order of how often a phone reaches
  /// for them: editing first, then the multiplexer.
  public static let packs: [ComboPack] = [emacs, tmux, readline, screen]

  /// A one-press combo: a single control chord, named.
  private static func control(_ pack: String, _ character: Character, _ subtitle: String) -> Combo {
    let upper = String(character).uppercased()
    return Combo(
      id: "\(pack).\(character)",
      label: "^\(upper)",
      subtitle: subtitle,
      spoken: "Control \(upper)",
      strokes: [.control(character)])
  }

  /// A two-press combo: a prefix chord, then a plain key.
  private static func prefixed(
    _ pack: String, prefix: Character, then key: Character, subtitle: String
  ) -> Combo {
    let upper = String(prefix).uppercased()
    return Combo(
      id: "\(pack).\(prefix).\(key)",
      label: "^\(upper) \(key)",
      subtitle: subtitle,
      spoken: "Control \(upper) then \(key)",
      strokes: [.control(prefix), TerminalKeystroke(.character(key))])
  }
}
