import FieldTerminal

/// A named sequence of keystrokes on the keypad's Shortcuts page.
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
/// `^T` is the todo list in one agent and the transcript in another.
public struct ComboPack: Identifiable, Equatable, Sendable {
  /// The strip's two groups (PF-16): an agent's keys, or a tool's.
  public enum Kind: Equatable, Sendable {
    case agent
    case tool
  }

  public let id: String
  /// The pack's name on the strip.
  public let title: String
  public let kind: Kind
  public let combos: [Combo]
  /// What a key of the fixed row does in this program, where its word is not
  /// the common one (`ComboCatalog.fixedRow`). An empty word is a key the
  /// program gives no meaning of its own.
  let fixedWords: [ComboCatalog.FixedKey: String]

  init(
    id: String, title: String, kind: Kind, combos: [Combo],
    fixedWords: [ComboCatalog.FixedKey: String] = [:]
  ) {
    self.id = id
    self.title = title
    self.kind = kind
    self.combos = combos
    self.fixedWords = fixedWords
  }
}

/// The keys page's Shortcuts (PF-16, 2026-11-23; DESIGN.md §8 "The keys page's
/// Shortcuts are an agent's keys"): one fixed row of five keys that stands
/// under every profile, and a profile of fifteen keys for each of six agents
/// and three tools.
///
/// The agents' keys were read on 2026-11-22 from each agent's own pages:
/// Claude Code's interactive-mode and keybindings docs, Codex's keymap source
/// on `main` (it can run ahead of a shipped build), Gemini CLI's
/// keyboard-shortcuts reference, OpenCode's keybinds docs, GitHub's Copilot CLI
/// command reference and Pi's keybindings doc. A program moves its keys; a
/// profile here is re-read when it does.
///
/// "Record" — the design's entry that would capture a sequence off the rail
/// into a new key — is ABSENT rather than present and inert (D-i6): recording
/// wants a store, an editor and a name, which is a slice of its own.
public enum ComboCatalog {

  // MARK: - The fixed row

  /// The five keys that stand under every profile: the chords bound alike, or
  /// nearly, in every agent read. A key's face never changes; the word under
  /// it is the profile's where the program means something else by it.
  public enum FixedKey: String, CaseIterable, Sendable {
    case mode
    case interrupt
    case escapeTwice
    case newline
    case exit

    var face: String {
      switch self {
      case .mode: return "⇧Tab"
      case .interrupt: return "^C"
      case .escapeTwice: return "Esc Esc"
      case .newline: return "^J"
      case .exit: return "^D"
      }
    }

    /// What the key does in most programs.
    var word: String {
      switch self {
      case .mode: return "Mode"
      case .interrupt: return "Interrupt"
      case .escapeTwice: return "Rewind"
      case .newline: return "New line"
      case .exit: return "Exit"
      }
    }
  }

  /// The fixed row as `pack` words it: the same five keys in the same places.
  public static func fixedRow(for pack: ComboPack) -> [Combo] {
    FixedKey.allCases.map { key in
      combo("keypad.fixed", key.face, pack.fixedWords[key] ?? key.word)
    }
  }

  // MARK: - The agents

  public static let claude = ComboPack(
    id: "keypad.claude", title: "Claude", kind: .agent,
    combos: keys(
      "keypad.claude",
      [
        ("^O", "Transcript"), ("^T", "Todos"), ("^B", "Background"), ("⌥P", "Model"),
        ("⌥T", "Thinking"),
        ("^R", "History"), ("^S", "Stash"), ("^G", "Editor"), ("^V", "Image"), ("^L", "Redraw"),
        ("⌥O", "Fast mode"), ("^_", "Undo"), ("^U", "Clear line"), ("^W", "Del word"),
        ("^X ^K", "Stop all"),
      ]))

  public static let codex = ComboPack(
    id: "keypad.codex", title: "Codex", kind: .agent,
    combos: keys(
      "keypad.codex",
      [
        ("^T", "Transcript"), ("⌥.", "Effort +"), ("⌥,", "Effort −"), ("^O", "Copy last"),
        ("^/", "Side chat"),
        ("^R", "History"), ("^G", "Editor"), ("^V", "Image"), ("^L", "Clear"), ("⌥R", "Raw"),
        ("⌥↑", "Edit queue"), ("⌥Z", "Undo"), ("^U", "Clear line"), ("^W", "Del word"),
        ("^]", "Skip"),
      ]),
    fixedWords: [.escapeTwice: "Edit last"])

  public static let gemini = ComboPack(
    id: "keypad.gemini", title: "Gemini", kind: .agent,
    combos: keys(
      "keypad.gemini",
      [
        ("^Y", "YOLO"), ("^T", "Todos"), ("^O", "Expand"), ("^B", "Shells"),
        ("Tab Tab", "Details"),
        ("^R", "History"), ("^G", "Editor"), ("^V", "Image"), ("^L", "Clear"), ("⌥M", "Markdown"),
        ("^S", "Mouse"), ("⌥Z", "Undo"), ("^U", "Clear line"), ("^W", "Del word"),
        ("^K", "Kill shell"),
      ]))

  /// OpenCode's leader is `^X`, pressed and released, then a plain key.
  public static let opencode = ComboPack(
    id: "keypad.opencode", title: "OpenCode", kind: .agent,
    combos: keys(
      "keypad.opencode",
      [
        ("^P", "Commands"), ("^T", "Variant"), ("F2", "Model"), ("^X m", "Models"),
        ("^X a", "Agents"),
        ("^X n", "New"), ("^X l", "Sessions"), ("^X u", "Undo"), ("^X r", "Redo"),
        ("^X c", "Compact"),
        ("^X e", "Editor"), ("^X ↵", "Queue"), ("^B", "Background"), ("^O", "Recent"),
        ("^V", "Paste"),
      ]),
    fixedWords: [.mode: "Agent", .escapeTwice: "Interrupt"])

  /// Copilot does not bind `^J`: its new line is Option Return, on its page.
  public static let copilot = ComboPack(
    id: "keypad.copilot", title: "Copilot", kind: .agent,
    combos: keys(
      "keypad.copilot",
      [
        ("^T", "Reasoning"), ("^O", "Expand"), ("^E", "Expand all"), ("^F", "Search"),
        ("⌥↵", "New line"),
        ("^R", "History"), ("^G", "Editor"), ("^V", "Paste"), ("^L", "Clear"), ("^Q", "Queue"),
        ("^X b", "Background"), ("^X /", "Command"), ("^X o", "Open link"), ("^X h", "Sidebar"),
        ("^U", "Clear line"),
      ]),
    fixedWords: [.escapeTwice: "Interrupt", .newline: ""])

  public static let pi = ComboPack(
    id: "keypad.pi", title: "Pi", kind: .agent,
    combos: keys(
      "keypad.pi",
      [
        ("^L", "Model"), ("^P", "Next model"), ("^T", "Thinking"), ("^O", "Tools"),
        ("⌥↵", "Follow-up"),
        ("⌥↑", "Dequeue"), ("^G", "Editor"), ("^V", "Paste"), ("^X", "Copy last"), ("^-", "Undo"),
        ("^U", "Clear line"), ("^W", "Del word"), ("^A", "Line start"), ("^E", "Line end"),
        ("^K", "Kill right"),
      ]),
    fixedWords: [.mode: "Thinking", .escapeTwice: "Tree"])

  // MARK: - The tools

  /// What the fixed row's keys do at a shell's prompt, and in the two
  /// multiplexers that pass them to one.
  private static let toolWords: [FixedKey: String] = [
    .mode: "Back", .escapeTwice: "", .newline: "Enter",
  ]

  /// The line editor every shell shares. It took the place of Common, and of
  /// Emacs, whose eight keys were readline's and are among these (PF-16).
  public static let shell = ComboPack(
    id: "keypad.shell", title: "Shell", kind: .tool,
    combos: keys(
      "keypad.shell",
      [
        ("^A", "Line start"), ("^E", "Line end"), ("^W", "Del word"), ("^U", "Del left"),
        ("^K", "Del right"),
        ("^R", "History"), ("^L", "Clear"), ("^Y", "Yank"), ("⌥B", "Word back"),
        ("⌥F", "Word fwd"),
        ("⌥D", "Del fwd"), ("⌥⌫", "Del back"), ("^P", "Previous"), ("^N", "Next"),
        ("^X ^E", "Editor"),
      ]),
    fixedWords: toolWords)

  /// Store the user's actual prefix, rather than sending the default to a
  /// differently configured tmux session. Prefix and command remain separate.
  public static func tmux(prefix: Character) -> ComboPack {
    ComboPack(
      id: "keypad.tmux", title: "tmux", kind: .tool,
      combos: prefixed(
        "keypad.tmux", prefix: prefix,
        [
          ("c", "New window"), ("n", "Next"), ("p", "Previous"), ("w", "Windows"), (",", "Rename"),
          ("%", "Split side"), ("\"", "Split down"), ("o", "Next pane"), ("z", "Zoom"),
          ("x", "Kill pane"),
          ("[", "Copy mode"), ("d", "Detach"), ("s", "Sessions"), (";", "Last pane"), ("?", "Keys"),
        ]),
      fixedWords: toolWords)
  }

  /// screen, for the desktops that still run it. Its prefix is `^A`.
  public static let screen = ComboPack(
    id: "keypad.screen", title: "screen", kind: .tool,
    combos: prefixed(
      "keypad.screen", prefix: "a",
      [
        ("c", "New"), ("n", "Next"), ("p", "Previous"), ("\"", "Windows"), ("A", "Rename"),
        ("S", "Split"), ("|", "Split side"), ("Tab", "Next area"), ("X", "Close area"),
        ("k", "Kill"),
        ("[", "Copy mode"), ("d", "Detach"), ("a", "Send ⌃A"), ("Q", "One area"), ("?", "Keys"),
      ]),
    fixedWords: toolWords)

  // RETIRED 2026-11-23 (PF-16): `common`, `emacs`, `readline`, the default-prefix
  // `tmux`, the three-key `screen` and the `packs` list. Common's and Emacs's
  // keys are Shell's; a phone that had either chosen lands on Shell (`profile`).

  // MARK: - The profiles

  /// The strip's order: the agents, then the tools.
  ///
  /// These are terminal-key profiles, never agent identities. Keep their
  /// persisted IDs in a separate namespace and let the picker read this data.
  /// Nothing here knows an agent's id: the profile a card's agent takes is the
  /// agent catalog's to name (`chosen`, PF-17), where until 2026-11-23 the
  /// rule was that the picker must not infer one from the session's provider.
  public static func profiles(tmuxPrefix: Character) -> [ComboPack] {
    [claude, codex, gemini, opencode, copilot, pi, shell, tmux(prefix: tmuxPrefix), screen]
  }

  /// The profile where nobody chose: the one that belongs to no agent.
  public static let fallback = shell

  /// The first keypad build stored unqualified profile IDs, and Common and
  /// Emacs were profiles until PF-16. Resolve them here without changing the
  /// user's choice or maintaining a second program table.
  public static func profile(id: String, tmuxPrefix: Character) -> ComboPack {
    let all = profiles(tmuxPrefix: tmuxPrefix)
    if let found = all.first(where: { $0.id == id || $0.id == "keypad.\(id)" }) { return found }
    return fallback
  }

  /// The profile the Shortcuts page shows (PF-17; DESIGN.md §8 "The keys page
  /// opens on its card's agent"): the one a hand chose while this card is
  /// open, else the one the card's agent takes by the agent catalog, else the
  /// one last chosen by hand.
  ///
  /// The catalog's word is an open string from a desktop that may be a build
  /// ahead: a profile this build does not have is passed over, never resolved
  /// to the fallback, so it cannot take the hand's choice away.
  public static func chosen(
    picked: String?, session: String?, stored: String, tmuxPrefix: Character
  ) -> ComboPack {
    let all = profiles(tmuxPrefix: tmuxPrefix)
    if let picked, let pack = all.first(where: { $0.id == picked }) { return pack }
    if let session, let pack = all.first(where: { $0.id == session }) { return pack }
    return profile(id: stored, tmuxPrefix: tmuxPrefix)
  }

  // MARK: - Reading a face

  /// One profile's keys, from their faces and words.
  private static func keys(_ pack: String, _ rows: [(String, String)]) -> [Combo] {
    rows.map { combo(pack, $0.0, $0.1) }
  }

  /// One multiplexer's keys: the prefix chord, then each plain key.
  private static func prefixed(
    _ pack: String, prefix: Character, _ rows: [(String, String)]
  ) -> [Combo] {
    let chord = "^\(String(prefix).uppercased())"
    return rows.map { combo(pack, "\(chord) \($0.0)", $0.1) }
  }

  /// A combo from its face. The face is the manuals' spelling, presses apart
  /// by a space, and it is the one place a key is written: the strokes and the
  /// spoken name are both read from it, so a key cannot say one chord and send
  /// another.
  static func combo(_ pack: String, _ face: String, _ subtitle: String) -> Combo {
    let presses = face.split(separator: " ").map { press(String($0)) }
    return Combo(
      id: "\(pack).\(face)",
      label: face,
      subtitle: subtitle,
      spoken: presses.map(\.spoken).joined(separator: " then "),
      strokes: presses.compactMap(\.stroke))
  }

  /// One press of a face: `^B`, `⌥P`, `⇧Tab`, `Esc`, `F2`, `↵`, or a plain
  /// character. A press this cannot read has no stroke, which the catalog's
  /// tests refuse.
  private static func press(_ token: String) -> (stroke: TerminalKeystroke?, spoken: String) {
    if let named = named(token) { return (TerminalKeystroke(named.key), named.spoken) }
    if token == "⇧Tab" { return (.shiftTab, "Shift Tab") }
    if token.hasPrefix("^"), token.count == 2, let character = token.last {
      return (
        .control(Character(String(character).lowercased())),
        "Control \(String(character).uppercased())"
      )
    }
    if token.hasPrefix("⌥"), token.count >= 2 {
      let rest = String(token.dropFirst())
      if let named = named(rest) {
        return (TerminalKeystroke(named.key, modifiers: .option), "Option \(named.spoken)")
      }
      if rest.count == 1, let character = rest.first {
        return (
          TerminalKeystroke(.character(Character(String(character).lowercased())), modifiers: .option),
          "Option \(String(character).uppercased())"
        )
      }
      return (nil, token)
    }
    if token.count == 1, let character = token.first {
      return (TerminalKeystroke(.character(character)), token)
    }
    return (nil, token)
  }

  /// The keys a face names by a word or a mark.
  private static func named(_ token: String) -> (key: TerminalKey, spoken: String)? {
    switch token {
    case "Esc": return (.escape, "Escape")
    case "Tab": return (.tab, "Tab")
    case "↵": return (.enter, "Return")
    case "⌫": return (.backspace, "Delete")
    case "↑": return (.arrowUp, "Up")
    case "↓": return (.arrowDown, "Down")
    case "←": return (.arrowLeft, "Left")
    case "→": return (.arrowRight, "Right")
    default:
      if token.hasPrefix("F"), let number = Int(token.dropFirst()), (1...12).contains(number) {
        return (.function(number), token)
      }
      return nil
    }
  }
}
