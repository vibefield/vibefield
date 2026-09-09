import GhostteaTerminal

/// One key on a terminal keyboard, named the way a rail key names itself.
///
/// This vocabulary exists so the input card can say "Escape" without learning
/// that Escape is HID usage `0x29` — the package law is that only
/// `FieldTerminal` names a Ghosttea type, and the card must be able to compose
/// a keystroke without importing one. The encoder below is the only place the
/// two vocabularies meet, and it is deliberately `internal`.
public enum TerminalKey: Hashable, Sendable {
  case escape
  case tab
  case enter
  case backspace
  case arrowUp
  case arrowDown
  case arrowLeft
  case arrowRight
  case home
  case end
  case pageUp
  case pageDown
  /// A literal character — the latch's product when a typed letter becomes a
  /// control byte instead of text.
  case character(Character)
  /// F1…F12. Out-of-range numbers encode to nothing rather than to a wrong key.
  case function(Int)
}

/// The modifiers a rail latch can apply. Deliberately three: `command` exists
/// in the kit's own set but has no meaning on a phone with no hardware
/// keyboard, and offering a latch for it would be a control that does nothing.
public struct TerminalModifiers: OptionSet, Hashable, Sendable {
  public let rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }

  public static let control = Self(rawValue: 1 << 0)
  public static let option = Self(rawValue: 1 << 1)
  public static let shift = Self(rawValue: 1 << 2)
}

/// A key plus the modifiers held with it — what one rail tap means.
public struct TerminalKeystroke: Hashable, Sendable {
  public var key: TerminalKey
  public var modifiers: TerminalModifiers

  public init(_ key: TerminalKey, modifiers: TerminalModifiers = []) {
    self.key = key
    self.modifiers = modifiers
  }

  /// `^C` and its family, spelled the way the chord fan will ask for them.
  public static func control(_ character: Character) -> Self {
    Self(.character(character), modifiers: .control)
  }

  /// ⇧Tab — the one shifted named key the rail's long-press offers (IOS-5b).
  public static let shiftTab = Self(.tab, modifiers: .shift)
}

extension TerminalKeystroke {
  /// Encode into the kit's hardware-key event, or `nil` when this layout has
  /// no key that produces the character.
  ///
  /// The named keys and the `|`/`~` punctuation rows are COPIED from the kit's
  /// own accessory table (`GhostteaAccessoryInput.swift`) rather than looked up
  /// again, so our rail and the row we switched off encode identically; the
  /// remaining US-layout punctuation is derived from the USB HID usage table.
  ///
  /// The kit's event initializer already decides which usages carry text
  /// (`GhostteaHIDKeyCode.acceptsText`), so a named key's `characters` are
  /// passed empty and dropped there rather than guessed at here.
  func ghostteaEvent() -> GhostteaHardwareKeyEvent? {
    let kitModifiers = modifiers.ghostteaModifiers
    switch key {
    case .escape: return Self.event(0x29, modifiers: kitModifiers)
    case .tab: return Self.event(0x2b, modifiers: kitModifiers)
    case .enter: return Self.event(0x28, modifiers: kitModifiers)
    case .backspace: return Self.event(0x2a, modifiers: kitModifiers)
    case .arrowRight: return Self.event(0x4f, modifiers: kitModifiers)
    case .arrowLeft: return Self.event(0x50, modifiers: kitModifiers)
    case .arrowDown: return Self.event(0x51, modifiers: kitModifiers)
    case .arrowUp: return Self.event(0x52, modifiers: kitModifiers)
    case .home: return Self.event(0x4a, modifiers: kitModifiers)
    case .end: return Self.event(0x4d, modifiers: kitModifiers)
    case .pageUp: return Self.event(0x4b, modifiers: kitModifiers)
    case .pageDown: return Self.event(0x4e, modifiers: kitModifiers)
    case .function(let number):
      guard (1...12).contains(number) else { return nil }
      return Self.event(UInt16(0x39 + number), modifiers: kitModifiers)
    case .character(let character):
      return Self.characterEvent(character, modifiers: kitModifiers)
    }
  }

  /// The character rows of the US layout. A lowercase letter rides its own
  /// usage unshifted; an uppercase one rides the same usage WITH shift and the
  /// lowercase form as `charactersIgnoringModifiers`, which is exactly how the
  /// kit shapes a committed capital.
  private static func characterEvent(
    _ character: Character,
    modifiers: GhostteaInputModifiers
  ) -> GhostteaHardwareKeyEvent? {
    guard character.unicodeScalars.count == 1, let scalar = character.unicodeScalars.first else {
      return nil
    }
    let value = scalar.value
    let text = String(character)

    if value >= 97, value <= 122 {  // a…z
      return event(
        UInt16(0x04 + value - 97), characters: text, unshifted: text, modifiers: modifiers)
    }
    if value >= 65, value <= 90 {  // A…Z
      let lower = String(UnicodeScalar(value + 32)!)
      return event(
        UInt16(0x04 + value - 65), characters: text, unshifted: lower,
        modifiers: modifiers.union(.shift))
    }
    if value >= 49, value <= 57 {  // 1…9
      return event(
        UInt16(0x1e + value - 49), characters: text, unshifted: text, modifiers: modifiers)
    }
    if value == 48 {  // 0 sits at the end of the digit row, not its start
      return event(0x27, characters: text, unshifted: text, modifiers: modifiers)
    }
    if let unshifted = unshiftedPunctuation[character] {
      // A shifted symbol is the base key plus shift; the base character is what
      // the terminal needs as the unshifted codepoint.
      return event(
        unshifted.usage, characters: text, unshifted: String(unshifted.base),
        modifiers: modifiers.union(.shift))
    }
    if let usage = plainPunctuation[character] {
      return event(usage, characters: text, unshifted: text, modifiers: modifiers)
    }
    return nil
  }

  /// The unshifted punctuation of the US layout, by HID usage. `|` and `~` are
  /// the kit's own two entries; the rest complete the same rows.
  private static let plainPunctuation: [Character: UInt16] = [
    " ": 0x2c, "-": 0x2d, "=": 0x2e, "[": 0x2f, "]": 0x30, "\\": 0x31,
    ";": 0x33, "'": 0x34, "`": 0x35, ",": 0x36, ".": 0x37, "/": 0x38,
  ]

  /// The shifted half of the same rows: which key makes the symbol, and what
  /// that key says when shift is not held.
  private static let unshiftedPunctuation: [Character: (usage: UInt16, base: Character)] = [
    "!": (0x1e, "1"), "@": (0x1f, "2"), "#": (0x20, "3"), "$": (0x21, "4"),
    "%": (0x22, "5"), "^": (0x23, "6"), "&": (0x24, "7"), "*": (0x25, "8"),
    "(": (0x26, "9"), ")": (0x27, "0"),
    "_": (0x2d, "-"), "+": (0x2e, "="), "{": (0x2f, "["), "}": (0x30, "]"),
    "|": (0x31, "\\"), ":": (0x33, ";"), "\"": (0x34, "'"), "~": (0x35, "`"),
    "<": (0x36, ","), ">": (0x37, "."), "?": (0x38, "/"),
  ]

  /// Down only: a rail tap is a press, and the kit releases a held key on
  /// responder loss rather than on a matching up event from us.
  private static func event(
    _ usage: UInt16,
    characters: String = "",
    unshifted: String = "",
    modifiers: GhostteaInputModifiers
  ) -> GhostteaHardwareKeyEvent? {
    GhostteaHardwareKeyEvent(
      hidUsage: usage,
      characters: characters,
      charactersIgnoringModifiers: unshifted,
      modifiers: modifiers,
      action: .down)
  }
}

extension TerminalModifiers {
  /// Ours → the kit's. One direction only: nothing outside this module should
  /// be able to name `GhostteaInputModifiers`.
  var ghostteaModifiers: GhostteaInputModifiers {
    var result: GhostteaInputModifiers = []
    if contains(.control) { result.insert(.control) }
    if contains(.option) { result.insert(.option) }
    if contains(.shift) { result.insert(.shift) }
    return result
  }
}
