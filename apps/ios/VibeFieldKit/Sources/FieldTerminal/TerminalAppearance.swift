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
  /// A `GhostteaThemeCatalog` theme name picked for the phone's light mode;
  /// `nil` is the day's own look (`TerminalLook.day`). PF-6 (2026-11-21;
  /// DESIGN.md §2.7 "The terminal's own colours", on the phone): a theme is
  /// picked for each mode, as the desktop keeps one for each of Godview's.
  public var lightThemeName: String?
  /// The same for the phone's dark mode; `nil` is the night's own look, the
  /// catalog's Matte Black. A record saved before PF-6 held one `themeName`,
  /// drawn in both modes: it is read as this one, and the day starts unpicked.
  public var darkThemeName: String?
  /// 0...1. Composes with the card's glass, so the field can show through the
  /// terminal itself (§10.4). Stored as `groundOpacity` since PF-5 (2026-11-21;
  /// DESIGN.md §8 "The card's glass is the field"): the default became the
  /// desktop's 82%, and every record saved before carried 100%, which nobody
  /// chose, so a record's old `backgroundOpacity` is left unread.
  public var backgroundOpacity: Double
  /// Whether a background a program paints takes the ground's opacity too, as
  /// the desktop's panes do (its `opacityCells`; DESIGN.md §8 "The glass is the
  /// desk"). On where nobody chose (PF-13, 2026-11-23): until then the phone
  /// drew such a background solid, a slab on a ground the field showed through.
  public var dimsProgramBackgrounds: Bool
  /// Points. How far the home behind a session's card is blurred, the picture
  /// the ground's opacity lets through (PF-13, 2026-11-23; DESIGN.md §8 "The
  /// card's glass is the field"). 0 leaves the home sharp. It is the host's to
  /// read: the terminal's renderer is never handed it.
  public var groundBlur: Double
  /// `GhostteaShaderOption` ids (`ghosttea:*`). Unknown ids are dropped at
  /// projection time, not here — the stored value keeps what the user chose.
  public var shaderEffects: [String]
  public var shaderAnimation: Bool
  /// Points, matching upstream's bundled-font metrics (base 13). The one field
  /// whose change requires a new runtime (upstream's `requiresNewRuntime` is
  /// literally `fontSize != other.fontSize`).
  public var fontSize: Double

  /// The ground's opacity nobody chose: the desktop's own default (its
  /// `DEFAULT_DECK_APPEARANCE.opacity`), so a terminal is the same glass on the
  /// phone as in Godview (PF-5; DESIGN.md §8 "The card's glass is the field").
  public static let defaultGroundOpacity = 0.82

  /// The blur nobody chose (PF-13). It was the desk's own 40 under Godview
  /// until then, which on a phone left nothing of the field to see.
  public static let defaultGroundBlur: Double = 24
  /// What the blur may be set to: sharp, up to the desk's 40.
  public static let groundBlurRange: ClosedRange<Double> = 0...40

  /// The blur the home is given: the stored value through its range, and the
  /// default where a record holds no number.
  public var clampedGroundBlur: Double {
    guard groundBlur.isFinite else { return Self.defaultGroundBlur }
    return min(max(groundBlur, Self.groundBlurRange.lowerBound), Self.groundBlurRange.upperBound)
  }

  /// No theme picked for either mode: each wears its own look (`TerminalLook`).
  public static let `default` = TerminalAppearance(
    lightThemeName: nil,
    darkThemeName: nil,
    backgroundOpacity: defaultGroundOpacity,
    dimsProgramBackgrounds: true,
    groundBlur: defaultGroundBlur,
    shaderEffects: [],
    shaderAnimation: false,
    fontSize: 13
  )

  public init(
    lightThemeName: String?,
    darkThemeName: String?,
    backgroundOpacity: Double,
    dimsProgramBackgrounds: Bool = true,
    groundBlur: Double = TerminalAppearance.defaultGroundBlur,
    shaderEffects: [String],
    shaderAnimation: Bool,
    fontSize: Double
  ) {
    self.lightThemeName = lightThemeName
    self.darkThemeName = darkThemeName
    self.backgroundOpacity = backgroundOpacity
    self.dimsProgramBackgrounds = dimsProgramBackgrounds
    self.groundBlur = groundBlur
    self.shaderEffects = shaderEffects
    self.shaderAnimation = shaderAnimation
    self.fontSize = fontSize
  }

  /// The theme picked for a mode, or `nil` where the mode wears its own look.
  public func themeName(for mode: TerminalLookMode) -> String? {
    switch mode {
    case .light: lightThemeName
    case .dark: darkThemeName
    }
  }

  /// Picks a theme for a mode; `nil` puts the mode back on its own look.
  public mutating func setThemeName(_ name: String?, for mode: TerminalLookMode) {
    switch mode {
    case .light: lightThemeName = name
    case .dark: darkThemeName = name
    }
  }

  private enum CodingKeys: String, CodingKey {
    case lightThemeName, darkThemeName, groundBlur, shaderEffects, shaderAnimation, fontSize
    /// PF-5: renamed with its default; a record's old `backgroundOpacity` is not read.
    case backgroundOpacity = "groundOpacity"
    /// PF-13: in the ground's family of names, beside its opacity and its blur.
    case dimsProgramBackgrounds = "groundOpacityCells"
  }

  /// What a record saved before PF-6 called its one theme. Read, never written.
  private enum RetiredKeys: String, CodingKey {
    case themeName
  }

  /// Tolerant reader for our own stored payloads: a field added later must not
  /// reset a user's theme when an older payload is read back.
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    lightThemeName = try values.decodeIfPresent(String.self, forKey: .lightThemeName)
    // PF-6: the one theme of an older record was drawn in both modes. It is
    // kept as the night's; the day is left unpicked, so it takes the day look.
    darkThemeName =
      try values.decodeIfPresent(String.self, forKey: .darkThemeName)
      ?? decoder.container(keyedBy: RetiredKeys.self).decodeIfPresent(String.self, forKey: .themeName)
    backgroundOpacity =
      try values.decodeIfPresent(Double.self, forKey: .backgroundOpacity)
      ?? Self.defaultGroundOpacity
    // PF-13: a record saved before these were settings takes their defaults.
    dimsProgramBackgrounds = try values.decodeIfPresent(Bool.self, forKey: .dimsProgramBackgrounds) ?? true
    groundBlur = try values.decodeIfPresent(Double.self, forKey: .groundBlur) ?? Self.defaultGroundBlur
    shaderEffects = try values.decodeIfPresent([String].self, forKey: .shaderEffects) ?? []
    shaderAnimation = try values.decodeIfPresent(Bool.self, forKey: .shaderAnimation) ?? false
    fontSize = try values.decodeIfPresent(Double.self, forKey: .fontSize) ?? 13
  }
}

/// Which of the phone's two modes a terminal is drawn for: the look of the
/// window it stands in (`PhoneAppearance`), as the place that draws it reads it.
///
/// PF-6 (2026-11-21; DESIGN.md §2.7 "The terminal's own colours", on the
/// phone): a terminal wears the look of the mode the phone is in, as a pane
/// wears the look of Godview's mode on the desktop.
public enum TerminalLookMode: String, CaseIterable, Hashable, Sendable {
  case light
  case dark
}

/// UserDefaults-backed persistence for the appearance (§10.4: theme name,
/// shader ids, opacity, font size). It carries no secret and never did: the
/// mirror-write capability this sentence used to exclude was deleted at TM-3
/// (2026-09-14), and nothing on this device holds a credential to keep out.
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
