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
