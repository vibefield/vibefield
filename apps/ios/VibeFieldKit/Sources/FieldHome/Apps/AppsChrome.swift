import CoreGraphics
import FieldAgents

// MA-6b — the ink and the measures of the phone's Apps (DESIGN.md §2.9's one exception and §8 "The phone's Apps"; the
// record's measures stand where the page's differ). The colours are tokens' (`ChromePalette`); these are the numbers.

/// An app's icon: the crop of its preview, or the fallback squircle (MA-D10 (b)).
enum AppIcon {
  /// What the fallback squircle stands on.
  enum Ground: Equatable {
    case ink(SwarmColor)
    case darkTile
    case fill
  }

  /// What its initial is drawn in.
  enum Letter: Equatable {
    case white
    case ink(SwarmColor)
    case primary
  }

  struct Paint: Equatable {
    let ground: Ground
    let letter: Letter
  }

  /// §2.9: by day the project's ink behind a white letter, by night the dark tile with the letter in the ink, and an
  /// app with no project the theme's fill with its letter in the primary ink.
  static func paint(ink: Int?, dark: Bool) -> Paint {
    guard let ink else { return Paint(ground: .fill, letter: .primary) }
    if dark { return Paint(ground: .darkTile, letter: .ink(.projectInk(ink, .dark))) }
    return Paint(ground: .ink(.projectInk(ink, .light)), letter: .white)
  }

  /// iOS's continuous corner: 22.5% of the side.
  static func corner(side: CGFloat) -> CGFloat { side * 0.225 }

  /// The initial: 26 on a 60 squircle, that proportion at every size.
  static func initialSize(side: CGFloat) -> CGFloat { side * 26 / 60 }

  /// The square the squircle aspect-fills from: the image's full short side, centred.
  static func crop(width: CGFloat, height: CGFloat) -> CGRect {
    let short = min(width, height)
    return CGRect(x: (width - short) / 2, y: (height - short) / 2, width: short, height: short)
  }

  /// The preview's edge on a white shelf.
  static let hairline: CGFloat = 0.5
  /// A live app's or an unopened app's dot: its side, how far outside the squircle, its ring in the paper.
  static let dot: CGFloat = 12
  static let dotOutside: CGFloat = 3
  static let dotRing: CGFloat = 2
  /// The warm app's ring: its width, and how far out from the squircle.
  static let warmRing: CGFloat = 2
  static let warmGap: CGFloat = 2.5
  /// An asleep desktop's apps.
  static let awayOpacity: Double = 0.45
  /// An app that cannot open: its icon over its state's words.
  static let honestSide: CGFloat = 92
}

/// The shelf, at the bar's measure.
enum AppsShelfChrome {
  static let side: CGFloat = AppBar.margin
  static let searchHeight: CGFloat = 48
  static let across = 4
  static let icon: CGFloat = 60
  static let nameSize: CGFloat = 11
  static let nameLine: CGFloat = 13
  static let nameLines = 2
  static let rowGap: CGFloat = 14
  static let headSize: CGFloat = 20
  static let headCount: CGFloat = 13

  /// The tab, receded to a card at the foot.
  static let cardScale: CGFloat = 0.92
  static let cardShowing: CGFloat = 106
  static let cardRadius: CGFloat = 44
  static let grabberWidth: CGFloat = 40
  static let grabberHeight: CGFloat = 5
  static let grabberOpacity: Double = 0.3

  /// A project's folder.
  static let foldersAcross = 2
  static let folderRowGap: CGFloat = 16
  static let folderColumnGap: CGFloat = 14
  static let folderRadius: CGFloat = 28
  static let folderInset: CGFloat = 13
  static let folderBig: CGFloat = 62
  static let folderBigCount = 3
  static let folderSmall: CGFloat = 27
  static let folderSmallCount = 4
  static let folderName: CGFloat = 13
}

/// The open app's one glass row, Safari's iOS 26 grammar at the bar's measure.
enum AppsGlassRow {
  static let height: CGFloat = AppBar.height
  static let side: CGFloat = AppBar.margin
  static let circle: CGFloat = 62
  static let capsuleGap: CGFloat = 24
  static let capsuleIcon: CGFloat = 30
  static let nameSize: CGFloat = 15
  static let desktopSize: CGFloat = 12
  static let osMark: CGFloat = 11
  static let foldedHeight: CGFloat = 30
  static let foldedName: CGFloat = 13
  /// Reduce Motion's fade in the zoom's place (M6).
  static let reducedFade: Double = 0.14

  /// What the row's two circles and their gaps leave of the screen.
  static func capsuleWidth(screen: CGFloat) -> CGFloat {
    screen - 2 * (side + circle + capsuleGap)
  }
}
