import Foundation
import GhostteaAppearance
import GhostteaCore

/// The hand-built fallback: Matte Black's chrome bytes, hardcoded so a theme
/// name the catalog no longer carries (or a malformed catalog entry) degrades
/// to the monochrome default instead of an invalid config. The catalog itself
/// preconditions on load upstream, so in practice this only covers a *name*
/// miss.
private enum FallbackColors {
  static let background: [UInt8] = [0x12, 0x12, 0x12]
  static let foreground: [UInt8] = [0xbe, 0xbe, 0xbe]
  static let cursor: [UInt8] = [0xea, 0xea, 0xea]
  static let cursorText: [UInt8] = [0x12, 0x12, 0x12]
  static let selectionBackground: [UInt8] = [0x33, 0x33, 0x33]
  static let selectionForeground: [UInt8] = [0xea, 0xea, 0xea]
}

/// Appearance → the renderer carrier, built DIRECTLY through the public
/// memberwise init (D-i8) — no config document in between.
///
/// Field-by-field policy, each line a finding:
/// - Palette entries are carried through as `GhostteaPaletteConfigEntry`,
///   never dropped — a theme without its 16 ANSI slots lies to every TUI.
/// - Shader ids are filtered to `GhostteaShaderOption.available` (4 real
///   ports; 31 upstream names are rights-unclear and unavailable) and deduped
///   preserving order, upstream's own validation rule.
/// - `postProcess` is always `.none`: the legacy better-CRT path rides the
///   shader list in 0.9.x (upstream maps it into `shaderEffects` itself).
/// - `fontFamilies` is empty: Apple shapes with bundled fonts; family values
///   are presentation metadata upstream does not load on this platform.
/// - Padding is Ghostty's default 2,2 (`GhostteaTerminalLayout`'s constants).
/// - `customShaderCount` is 0: no host-local shader paths exist on a phone.
/// - `revision` is a digest of the renderer VALUES, so it changes exactly when
///   the device presentation changes — document identity that never drags an
///   unrelated edit onto the Metal path.
public func presentationConfig(
  for appearance: TerminalAppearance
) -> GhostteaTerminalPresentationConfig {
  let theme = resolveTheme(named: appearance.themeName)

  let background = color(theme?.background, fallback: FallbackColors.background)
  let foreground = color(theme?.foreground, fallback: FallbackColors.foreground)
  let cursor = color(theme?.cursor, fallback: FallbackColors.cursor)
  let cursorText = color(theme?.cursorText, fallback: FallbackColors.cursorText)
  let selectionBackground = color(
    theme?.selection, fallback: FallbackColors.selectionBackground)
  let selectionForeground = color(
    theme?.selectionForeground, fallback: FallbackColors.selectionForeground)
  let palette = (theme?.palette ?? []).prefix(256).enumerated().compactMap {
    index, hex -> GhostteaPaletteConfigEntry? in
    parseHexColor(hex).map { GhostteaPaletteConfigEntry(index: UInt8(index), color: $0) }
  }

  let opacity = appearance.backgroundOpacity.isFinite
    ? Float(min(max(appearance.backgroundOpacity, 0), 1)) : 1
  let fontSize = appearance.fontSize.isFinite && appearance.fontSize > 0
    ? Float(appearance.fontSize) : 13

  var shaders: [String] = []
  for id in appearance.shaderEffects
  where GhostteaShaderOption.available.contains(where: { $0.id == id }) && !shaders.contains(id) {
    shaders.append(id)
  }

  let revision = presentationRevision(
    foreground: foreground, background: background, cursor: cursor, cursorText: cursorText,
    selectionBackground: selectionBackground, selectionForeground: selectionForeground,
    palette: palette, backgroundOpacity: opacity, fontSize: fontSize,
    shaderEffects: shaders, shaderAnimation: appearance.shaderAnimation)

  return GhostteaTerminalPresentationConfig(
    schemaVersion: 1,
    revision: revision,
    foreground: foreground,
    background: background,
    cursor: cursor,
    cursorText: cursorText,
    selectionBackground: selectionBackground,
    selectionForeground: selectionForeground,
    palette: palette,
    backgroundOpacity: opacity,
    backgroundOpacityCells: false,
    fontSize: fontSize,
    fontFamilies: [],
    paddingX: [2, 2],
    paddingY: [2, 2],
    postProcess: .none,
    shaderEffects: shaders,
    customShaderAnimation: appearance.shaderAnimation,
    customShaderCount: 0
  )
}

/// Named theme → catalog entry, degrading in one step to the default theme.
/// (`nil` name means "our default" by contract.)
private func resolveTheme(named name: String?) -> GhostteaColorTheme? {
  let wanted = name ?? TerminalAppearance.default.themeName
  if let wanted, let theme = GhostteaThemeCatalog.themes.first(where: { $0.name == wanted }) {
    return theme
  }
  guard let fallback = TerminalAppearance.default.themeName, fallback != wanted else { return nil }
  return GhostteaThemeCatalog.themes.first(where: { $0.name == fallback })
}

private func color(_ hex: String?, fallback: [UInt8]) -> [UInt8] {
  hex.flatMap(parseHexColor) ?? fallback
}

/// Deterministic across launches — `Hasher` is seeded per process, and a
/// revision that changes on relaunch would repaint an unchanged terminal.
private func presentationRevision(
  foreground: [UInt8], background: [UInt8], cursor: [UInt8], cursorText: [UInt8],
  selectionBackground: [UInt8], selectionForeground: [UInt8],
  palette: [GhostteaPaletteConfigEntry], backgroundOpacity: Float, fontSize: Float,
  shaderEffects: [String], shaderAnimation: Bool
) -> String {
  let canonical = [
    "fg:\(foreground)", "bg:\(background)", "cu:\(cursor)", "ct:\(cursorText)",
    "sb:\(selectionBackground)", "sf:\(selectionForeground)",
    "pa:" + palette.map { "\($0.index)=\($0.color)" }.joined(separator: ";"),
    "op:\(backgroundOpacity)", "fs:\(fontSize)",
    "sh:" + shaderEffects.joined(separator: ";"), "an:\(shaderAnimation)",
  ].joined(separator: "|")
  var hash: UInt64 = 0xcbf2_9ce4_8422_2325
  for byte in canonical.utf8 {
    hash = (hash ^ UInt64(byte)) &* 0x0000_0100_0000_01b3
  }
  return "vf1-" + String(hash, radix: 16)
}

extension GhostteaTerminalPresentationConfig {
  /// Upstream keeps this comparison fileprivate in its app target, so
  /// FieldTerminal owns a copy with the same law: revision is document
  /// identity, not a renderer value — ignoring it keeps unrelated config
  /// edits off the Metal and replica paths.
  func hasSameDevicePresentation(as other: Self) -> Bool {
    foreground == other.foreground
      && background == other.background
      && cursor == other.cursor
      && cursorText == other.cursorText
      && selectionBackground == other.selectionBackground
      && selectionForeground == other.selectionForeground
      && palette == other.palette
      && backgroundOpacity == other.backgroundOpacity
      && backgroundOpacityCells == other.backgroundOpacityCells
      && fontSize == other.fontSize
      && fontFamilies == other.fontFamilies
      && paddingX == other.paddingX
      && paddingY == other.paddingY
      && postProcess == other.postProcess
      && shaderEffects == other.shaderEffects
      && customShaderAnimation == other.customShaderAnimation
      && customShaderCount == other.customShaderCount
  }

  /// Only the resolved size changes native text metrics on Apple platforms —
  /// upstream's `requiresNewRuntime` is literally `fontSize != other.fontSize`,
  /// and everything else reconfigures live through the sink.
  func requiresNewRuntime(comparedTo other: Self) -> Bool {
    fontSize != other.fontSize
  }
}
