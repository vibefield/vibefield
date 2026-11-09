import CoreGraphics
import FieldAgents

// MA-6b — the ink and the measures of the phone's Apps (DESIGN.md §2.9's one exception and §8 "The phone's Apps"; the
// record's measures stand where the page's differ). RED: every number below is zero and every paint is wrong.

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

  static func paint(ink: Int?, dark: Bool) -> Paint { Paint(ground: .darkTile, letter: .white) }

  /// iOS's continuous corner: 22.5% of the side.
  static func corner(side: CGFloat) -> CGFloat { 0 }

  /// The initial: 26 on a 60 squircle, that proportion at every size.
  static func initialSize(side: CGFloat) -> CGFloat { 0 }

  /// The square the squircle aspect-fills from: the image's full short side, centred.
  static func crop(width: CGFloat, height: CGFloat) -> CGRect { .zero }

  /// The preview's edge on a white shelf.
  static let hairline: CGFloat = 0
  /// A live app's or an unopened app's dot: its side, how far outside the squircle, its ring in the paper.
  static let dot: CGFloat = 0
  static let dotOutside: CGFloat = 0
  static let dotRing: CGFloat = 0
  /// The warm app's ring: its width, and how far out from the squircle.
  static let warmRing: CGFloat = 0
  static let warmGap: CGFloat = 0
  /// An asleep desktop's apps.
  static let awayOpacity: Double = 0
  /// An app that cannot open: its icon over its state's words.
  static let honestSide: CGFloat = 0
}

/// The shelf, at the bar's measure.
enum AppsShelfChrome {
  static let side: CGFloat = 0
  static let searchHeight: CGFloat = 0
  static let across = 0
  static let icon: CGFloat = 0
  static let nameSize: CGFloat = 0
  static let nameLine: CGFloat = 0
  static let nameLines = 0
  static let rowGap: CGFloat = 0
  static let headSize: CGFloat = 0
  static let headCount: CGFloat = 0

  /// The tab, receded to a card at the foot.
  static let cardScale: CGFloat = 0
  static let cardShowing: CGFloat = 0
  static let cardRadius: CGFloat = 0
  static let grabberWidth: CGFloat = 0
  static let grabberHeight: CGFloat = 0
  static let grabberOpacity: Double = 0

  /// A project's folder.
  static let foldersAcross = 0
  static let folderRowGap: CGFloat = 0
  static let folderColumnGap: CGFloat = 0
  static let folderRadius: CGFloat = 0
  static let folderInset: CGFloat = 0
  static let folderBig: CGFloat = 0
  static let folderBigCount = 0
  static let folderSmall: CGFloat = 0
  static let folderSmallCount = 0
  static let folderName: CGFloat = 0
}

/// The open app's one glass row, Safari's iOS 26 grammar at the bar's measure.
enum AppsGlassRow {
  static let height: CGFloat = 0
  static let side: CGFloat = 0
  static let circle: CGFloat = 0
  static let capsuleGap: CGFloat = 0
  static let capsuleIcon: CGFloat = 0
  static let nameSize: CGFloat = 0
  static let desktopSize: CGFloat = 0
  static let osMark: CGFloat = 0
  static let foldedHeight: CGFloat = 0
  static let foldedName: CGFloat = 0
  /// Reduce Motion's fade in the zoom's place (M6).
  static let reducedFade: Double = 0

  static func capsuleWidth(screen: CGFloat) -> CGFloat { 0 }
}
