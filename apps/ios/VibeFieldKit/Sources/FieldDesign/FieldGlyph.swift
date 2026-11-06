import SwiftUI

/// The chrome's glyph set (DESIGN.md §13) on the phone: template images
/// generated from `tooling/glyphs` — the same drawings the desktop draws, so
/// the two apps share one geometry. A glyph is `currentColor` and nothing
/// else; the host tints it with `foregroundStyle`, as it would text.
public enum FieldGlyphName: String, CaseIterable, Sendable {
  case keyboard
  case mic
  /// `>_` — the rail's terminal key and a peer's bare shell.
  case prompt
  case plus
  case `return`
  /// Drawn pointing up; turn it for the cursor keys.
  case arrow
  case ellipsis
  case backspace
  case scanText = "scantext"
  case snippets
  case clipboard
  /// PJ-7 — the Session Glyphs (DESIGN.md §13): `terminal`'s window with its
  /// verb — a plus for New agent, play for Resume, the arrow coming in through
  /// the opened wall for Jump to.
  case start
  case resume
  case jump
  /// IOS-10a — Settings' rows (DESIGN.md §13, the rail's own drawings): a tick
  /// for what the phone can do, Appearance's sun, Terminal's window, About's
  /// package, a page that opens outside the app, and the credits' document.
  case check
  case sun
  case terminal
  case package
  case outward
  case document
  /// WI-3 — Settings › This phone › Lock: the desk's shut padlock, `tape` (DESIGN.md §13; ICE's `lock` is drawn by
  /// it too).
  case lock = "tape"
  /// IOS-12c — the phone's thread (DESIGN.md §8 "The phone's Chat", §13's drawings): a turn's tools (`code`),
  /// VibeField's notify (`message`) and a crew's start (`agents`); the earlier conversations' `chevron`; and the
  /// hello's three starters (`agents`, `panes`, `duplicate`).
  case code
  case message
  case agents
  case chevron
  case panes
  case duplicate

  var assetName: String { "glyph-\(rawValue)" }
}

public struct FieldGlyph: View {
  public let name: FieldGlyphName
  public let size: CGFloat
  /// Degrees clockwise.
  public let turn: Double

  public init(_ name: FieldGlyphName, size: CGFloat, turn: Double = 0) {
    self.name = name
    self.size = size
    self.turn = turn
  }

  public var body: some View {
    Image(name.assetName, bundle: .module)
      .renderingMode(.template)
      .resizable()
      .scaledToFit()
      .frame(width: size, height: size)
      .rotationEffect(.degrees(turn))
  }

  /// The box that reads at the size an SF Symbol read at `pointSize`: a
  /// symbol's optical size sits about a quarter over its point size, and the
  /// drawing's live area sits a quarter inside its box.
  public static func box(for pointSize: CGFloat) -> CGFloat {
    (pointSize * 1.25).rounded()
  }
}
