import Foundation
import GhostteaAppearance

// Item 358 (red) — the names TerminalLookPreviewTests reads, with nothing decided yet: the shapes are the ones the
// preview's values will have, and every rule answers the neutral pair or nothing. The next commit writes the rules
// and the picture.

/// The preview's values.
enum TerminalLookPreviewModel {
  struct Run: Equatable {
    let text: String
    var fg: Int? = nil
    var bg: Int? = nil
    var bold = false
    var selected = false
    var cursor = false

    init(_ text: String, fg: Int? = nil, bg: Int? = nil, bold: Bool = false, selected: Bool = false, cursor: Bool = false) {
      self.text = text
      self.fg = fg
      self.bg = bg
      self.bold = bold
      self.selected = selected
      self.cursor = cursor
    }
  }

  static let sample: [[Run]] = []

  struct Inks: Equatable {
    let ground: [UInt8]
    let foreground: [UInt8]
    let cursor: [UInt8]
    let cursorText: [UInt8]
    let selection: [UInt8]
    let selectionForeground: [UInt8]
    let palette: [[UInt8]]

    func slot(_ index: Int) -> [UInt8] { foreground }
  }

  static let neutralGround: [UInt8] = [0x12, 0x12, 0x12]
  static let neutralText: [UInt8] = [0xBE, 0xBE, 0xBE]

  private static let nothing = Inks(
    ground: neutralGround, foreground: neutralText, cursor: neutralText, cursorText: neutralGround,
    selection: neutralText, selectionForeground: neutralGround, palette: [])

  static func inks(
    background: String, foreground: String, cursor: String, cursorText: String, selection: String,
    selectionForeground: String, palette: [String]
  ) -> Inks { nothing }

  static func inks(
    for appearance: TerminalAppearance, in catalog: [GhostteaColorTheme] = GhostteaThemeCatalog.themes
  ) -> Inks { nothing }

  static func colours(of run: Run, in inks: Inks) -> (ink: [UInt8], ground: [UInt8]?) { (inks.foreground, nil) }

  static func caption(_ appearance: TerminalAppearance) -> (theme: String, size: String, note: String) { ("", "", "") }

  static func spoken(_ appearance: TerminalAppearance) -> String { "" }
}
