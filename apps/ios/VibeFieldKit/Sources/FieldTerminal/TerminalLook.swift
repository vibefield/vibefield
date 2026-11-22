import Foundation
import GhostteaAppearance
import SwiftUI

extension TerminalLookMode {
  /// The mode of a place by its colour scheme: dark is the night's, anything
  /// else the day's.
  public init(_ scheme: ColorScheme) {
    self = scheme == .dark ? .dark : .light
  }
}

/// A theme's colours as this kit reads them: a catalog entry's, or the day's
/// own look, which no catalog carries. Each colour is `#rrggbb`, the catalog's
/// format, and is parsed where it is drawn (`parseHexColor`).
struct TerminalThemeColours: Equatable, Sendable {
  let name: String
  let background: String
  let foreground: String
  let cursor: String
  let cursorText: String
  let selection: String
  let selectionForeground: String
  let palette: [String]
}

extension TerminalThemeColours {
  init(_ theme: GhostteaColorTheme) {
    self.init(
      name: theme.name, background: theme.background, foreground: theme.foreground, cursor: theme.cursor,
      cursorText: theme.cursorText, selection: theme.selection,
      selectionForeground: theme.selectionForeground, palette: theme.palette)
  }
}

/// The look each mode wears while no theme is picked for it, and the one
/// place a mode's theme is resolved (PF-6, 2026-11-21; DESIGN.md §2.7 "The
/// terminal's own colours", on the phone).
enum TerminalLook {
  /// The night's own look, by its catalog name. Matte Black is the catalog's
  /// closest match to the godview instrument palette (DESIGN.md §2.7:
  /// near-black ground, grey text ramp): pure greyscale chrome (#121212
  /// ground, #bebebe text, a colourless #333333 selection) while the 16 ANSI
  /// slots keep their semantic reds and ambers, so status colours stay
  /// meaningful, never decorative.
  static let nightThemeName = "Matte Black"

  /// The day's own look: the desktop's, as Godview draws a pane by day. The
  /// ground and the sixteen are `godview/terminal-look.ts`'s `light`, held to
  /// it by a row (field-app's `godview-terminal-look.test.ts`); the ink is the
  /// reference's (ghosttea's Daylight). The reference's cursor and selection
  /// are translucent (`#1c599e` at 68%, `#2e73b8` at 30%) and this renderer
  /// takes solid colours, so each is its colour laid over the paper. A block
  /// cursor's text is the ground.
  static let day = TerminalThemeColours(
    name: "Daylight",
    background: "#f1f0ee",
    foreground: "#1e2227",
    cursor: "#6089b8",
    cursorText: "#f1f0ee",
    selection: "#b6cade",
    selectionForeground: "#1e2227",
    palette: [
      "#1e2227", "#a9524d", "#38793c", "#976004", "#306fac", "#8d589a", "#007879", "#676c73",
      "#51565c", "#ad3232", "#006f1a", "#865400", "#0061aa", "#8b3f9c", "#006a6b", "#81868d",
    ])

  /// The name of a mode's own look, as Settings says it.
  static func ownName(_ mode: TerminalLookMode) -> String {
    switch mode {
    case .light: day.name
    case .dark: nightThemeName
    }
  }

  /// The theme a mode wears: the one picked for it, else the mode's own. A
  /// picked name the catalog no longer carries wears the mode's own too. `nil`
  /// only by night, with a catalog that has lost Matte Black: the renderer's
  /// hand-built bytes stand in (`presentationConfig`).
  static func theme(
    for appearance: TerminalAppearance, mode: TerminalLookMode,
    in catalog: [GhostteaColorTheme] = GhostteaThemeCatalog.themes
  ) -> TerminalThemeColours? {
    if let picked = appearance.themeName(for: mode),
      let theme = catalog.first(where: { $0.name == picked })
    {
      return TerminalThemeColours(theme)
    }
    switch mode {
    case .light: return day
    case .dark: return catalog.first(where: { $0.name == nightThemeName }).map(TerminalThemeColours.init)
    }
  }
}
