import SwiftUI

/// SE-2 (SE-D3 A; DESIGN.md §8 "The phone's search") — the sheet's measure. SE-2c (red): every number is zero, and
/// the sheet itself is not drawn yet.
enum SearchSheet {
  /// From each side of the screen.
  static let side: CGFloat = 0
  /// Its foot above the search field's top.
  static let gapAboveField: CGFloat = 0
  /// It is never higher than this from the screen's top.
  static let topLimit: CGFloat = 0
  static let radius: CGFloat = 0
  /// It rises from the middle of its foot: this far up, from this scale, over `rise` on the island curve.
  static let riseOffset: CGFloat = 0
  static let riseScale: CGFloat = 0
  static let rise: Double = 0
  /// The scrim's fade, and every fade Reduce Motion puts in a rise's or a pop's place (M6).
  static let scrimFade: Double = 0
  static let reducedFade: Double = 0
  /// The switch: 14 in from the sheet's sides and top, 6 above the chips; its track padded 2, corners 10; each half
  /// 30 tall, corners 8, at 13.5.
  static let headInset: CGFloat = 0
  static let headBelow: CGFloat = 0
  static let switchPadding: CGFloat = 0
  static let switchRadius: CGFloat = 0
  static let switchItemHeight: CGFloat = 0
  static let switchItemRadius: CGFloat = 0
  static let switchText: CGFloat = 0
  /// The chips' row: padded 2 14 8, its last 28 fading out; a chip 32 tall, corners 16, padded 0 12 0 10, its parts
  /// 6 apart, its glyph 13, the waiting dot 6; a 1 × 18 hairline between groups.
  static let chipsTop: CGFloat = 0
  static let chipsSide: CGFloat = 0
  static let chipsBottom: CGFloat = 0
  static let chipsFade: CGFloat = 0
  static let chipHeight: CGFloat = 0
  static let chipLeading: CGFloat = 0
  static let chipTrailing: CGFloat = 0
  static let chipGap: CGFloat = 0
  static let chipGlyph: CGFloat = 0
  static let waitingDot: CGFloat = 0
  static let groupRule = CGSize.zero
  /// The list: padded 4 6, its rows 1 apart, each with corners 18, padded 11 14 11 16, 10 between its parts.
  static let listVertical: CGFloat = 0
  static let listSide: CGFloat = 0
  static let rowGap: CGFloat = 0
  static let rowRadius: CGFloat = 0
  static let rowVertical: CGFloat = 0
  static let rowLeading: CGFloat = 0
  static let rowTrailing: CGFloat = 0
  static let rowParts: CGFloat = 0
  static let stateDot: CGFloat = 0
  /// The offer: a 32 round holding the glyph at 16, and a Filter capsule 30 tall.
  static let offerDisc: CGFloat = 0
  static let offerGlyph: CGFloat = 0
  static let filterHeight: CGFloat = 0
  /// The foot, over a hairline: padded 9 20 14.
  static let footTop: CGFloat = 0
  static let footSide: CGFloat = 0
  static let footBottom: CGFloat = 0

  /// The tallest the sheet may stand, its foot `gapAboveField` above a search field whose top is `fieldTop` from the
  /// screen's top. SE-2c (red): none.
  static func maxHeight(fieldTop: CGFloat) -> CGFloat { 0 }
}
