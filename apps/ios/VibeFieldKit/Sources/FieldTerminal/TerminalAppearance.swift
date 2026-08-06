import Foundation

/// The phone's terminal look, in our own vocabulary — a tiny local model the
/// presentation builder projects into upstream's renderer carrier.
///
/// This is D-i8 made concrete: we consume upstream's exported DATA (the theme
/// catalog, the shader options) and deliberately do NOT adopt the Ghostty
/// config-document machinery (raw-text drafts, diagnostics, import/export) —
/// 1 000+ lines serving an advanced-config story VibeField has not asked for.
/// If that story ever arrives, `GhostteaConfigurationModel` upstream is the
/// named escape hatch.
public struct TerminalAppearance: Sendable, Equatable, Codable {
  /// A `GhostteaThemeCatalog` theme name; `nil` means our default.
  public var themeName: String?
  /// 0...1. Composes with the card's glass, so the field can show through the
  /// terminal itself (§10.4).
  public var backgroundOpacity: Double
  /// `GhostteaShaderOption` ids (`ghosttea:*`). Unknown ids are dropped at
  /// projection time, not here — the stored value keeps what the user chose.
  public var shaderEffects: [String]
  public var shaderAnimation: Bool
  /// Points, matching upstream's bundled-font metrics (base 13). The one field
  /// whose change requires a new runtime (upstream's `requiresNewRuntime` is
  /// literally `fontSize != other.fontSize`).
  public var fontSize: Double

  /// Matte Black is the catalog's closest match to the godview instrument
  /// palette (DESIGN.md §2.7 — near-black ground, grey text ramp): pure
  /// greyscale chrome (#121212 ground, #bebebe text, a colorless #333333
  /// selection) while the 16 ANSI slots keep their semantic reds and ambers —
  /// status colors stay meaningful, never decorative, exactly the monochrome
  /// control room's rule.
  public static let `default` = TerminalAppearance(
    themeName: "Matte Black",
    backgroundOpacity: 1,
    shaderEffects: [],
    shaderAnimation: false,
    fontSize: 13
  )

  public init(
    themeName: String?,
    backgroundOpacity: Double,
    shaderEffects: [String],
    shaderAnimation: Bool,
    fontSize: Double
  ) {
    self.themeName = themeName
    self.backgroundOpacity = backgroundOpacity
    self.shaderEffects = shaderEffects
    self.shaderAnimation = shaderAnimation
    self.fontSize = fontSize
  }

  private enum CodingKeys: String, CodingKey {
    case themeName, backgroundOpacity, shaderEffects, shaderAnimation, fontSize
  }

  /// Tolerant reader for our own stored payloads: a field added later must not
  /// reset a user's theme when an older payload is read back.
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    themeName = try values.decodeIfPresent(String.self, forKey: .themeName)
    backgroundOpacity = try values.decodeIfPresent(Double.self, forKey: .backgroundOpacity) ?? 1
    shaderEffects = try values.decodeIfPresent([String].self, forKey: .shaderEffects) ?? []
    shaderAnimation = try values.decodeIfPresent(Bool.self, forKey: .shaderAnimation) ?? false
    fontSize = try values.decodeIfPresent(Double.self, forKey: .fontSize) ?? 13
  }
}

/// UserDefaults-backed persistence for the appearance (§10.4: theme name,
/// shader ids, opacity, font size). The mirror-write capability is NOT here —
/// it is a secret and lives in the Keychain (IOS-3c), never on disk.
public enum TerminalAppearanceStore {
  static let key = "fieldterminal.appearance.v1"

  /// Missing or corrupt data degrades to `.default` — an honest visual reset,
  /// never a crash and never a half-read payload.
  public static func load(from defaults: UserDefaults = .standard) -> TerminalAppearance {
    guard let data = defaults.data(forKey: key),
      let appearance = try? JSONDecoder().decode(TerminalAppearance.self, from: data)
    else { return .default }
    return appearance
  }

  public static func save(
    _ appearance: TerminalAppearance, to defaults: UserDefaults = .standard
  ) {
    guard let data = try? JSONEncoder().encode(appearance) else { return }
    defaults.set(data, forKey: key)
  }
}

/// `#rrggbb` → three bytes. The kit's own hex→bytes helper is private
/// (fileprivate in GhostteaAppearance), so FieldTerminal owns this parser —
/// §10.4's named consequence of building the presentation config directly.
///
/// Strict on purpose: `#` + exactly six hex digits is the catalog's only
/// format, and `UInt8(_:radix:)` alone would quietly bless `+`/`-` signs.
func parseHexColor(_ value: String) -> [UInt8]? {
  guard value.count == 7, value.hasPrefix("#") else { return nil }
  let hex = value.dropFirst()
  guard hex.allSatisfy(\.isHexDigit) else { return nil }
  let bytes = stride(from: 0, to: 6, by: 2).compactMap { offset -> UInt8? in
    let start = hex.index(hex.startIndex, offsetBy: offset)
    let end = hex.index(start, offsetBy: 2)
    return UInt8(hex[start..<end], radix: 16)
  }
  return bytes.count == 3 ? bytes : nil
}
