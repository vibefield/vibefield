import SwiftUI

/// The chrome family's voice: SF, at prose sizes, in sentence case.
///
/// **Why this exists beside `FieldType` rather than replacing it.** DESIGN.md
/// §1 names three surface families and §1.1 scopes the godview instrument
/// palette to the control room — "the deliberate control-room exception". The
/// swarm field and the terminal deck are that exception and keep `FieldType`'s
/// monospace; everything else in this app is the CHROME family, which §3 says
/// is `-apple-system` for everything and monospace for data only. The input
/// card is chrome, so it speaks this.
///
/// Every size here is transcribed from the KeyboardLab design canvas, whose
/// artboards are DESIGN.md's instance for this surface. The canvas's CSS class
/// is named on each entry so a value can be checked against its source rather
/// than argued about.
public enum ChromeType {

  /// The system face. `rounded` is the canvas's `ui-rounded`, which it uses for
  /// key faces and nothing else — a key cap is a physical object and SF Rounded
  /// is how iOS draws one.
  public static func sans(
    _ size: CGFloat, _ weight: Font.Weight = .regular, rounded: Bool = false
  ) -> Font {
    .system(size: size, weight: weight, design: rounded ? .rounded : .default)
  }

  /// Monospace, and only for what §3 calls data: command text, a key's NAME in
  /// a fan or a combo, the number in a reply chip. Never a label.
  public static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    .system(size: size, weight: weight, design: .monospaced)
  }

  /// CSS `em` tracking against a point size, in points — the same helper
  /// `FieldType` carries, because letter-spacing is expressed the same way in
  /// both stylesheets.
  public static func tracking(_ em: CGFloat, of size: CGFloat) -> CGFloat { em * size }

  // MARK: - The canvas's own steps
  //
  // Named so a view can cite the artboard rather than restate a number. The
  // sizes that move with the reader's text size live in `InputCardMetrics`;
  // these are the base steps those functions start from.

  /// `.field` — 17/22 regular. The draft, and the composer's placeholder.
  public static let fieldSize: CGFloat = 17
  public static let fieldLineHeight: CGFloat = 22
  /// `.key` — 13 semibold rounded, letter-spacing 0.1 pt.
  public static let keyLabelSize: CGFloat = 13
  public static let keyTracking: CGFloat = 0.1
  /// `.key.nav` — the arrow glyphs, one step up from a word.
  public static let keyGlyphSize: CGFloat = 15
  /// `.chip` — 14 semibold; `.chip .n` is mono 12 bold in its circle.
  public static let chipLabelSize: CGFloat = 14
  public static let chipNumberSize: CGFloat = 12
  /// `.strip` — 15 semibold, and its right-hand hint 12 medium.
  public static let stripSize: CGFloat = 15
  public static let hintSize: CGFloat = 12
  /// `.seg div` — 13 semibold.
  public static let segmentSize: CGFloat = 13
  /// `.mi` — 17 regular with 18 pt symbols.
  public static let menuItemSize: CGFloat = 17
  public static let menuGlyphSize: CGFloat = 18
  /// `.pk` — mono 14 semibold over a 9 medium subtitle.
  public static let fanLabelSize: CGFloat = 14
  public static let fanSubtitleSize: CGFloat = 9
  /// `.kb.keypad .key` — 15, and 13 on a special key.
  public static let keypadKeySize: CGFloat = 15
  public static let keypadSpecialSize: CGFloat = 13
  /// `.ck` — a combo: mono 14 semibold over a 10 medium subtitle.
  public static let comboSubtitleSize: CGFloat = 10
  /// `.srow` — a sheet row: mono 14 semibold command, 13 regular summary.
  public static let rowCommandSize: CGFloat = 14
  public static let rowSummarySize: CGFloat = 13
  /// DESIGN.md §3's eyebrow: 11 medium uppercase, `tracking-wider`, 60%.
  /// Sheets only — the card itself has no eyebrows, per §9's sentence case.
  public static let eyebrowSize: CGFloat = 11
  public static let eyebrowTracking: CGFloat = 0.06
  /// A sheet's title and its body (§3's Title and Body rows).
  public static let sheetTitleSize: CGFloat = 17
  public static let sheetBodySize: CGFloat = 14
}
