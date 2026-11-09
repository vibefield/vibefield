import CoreGraphics
import FieldAgents
import Testing

@testable import FieldHome

/// MA-6b — the phone's Apps at DESIGN.md's numbers (§2.9's one exception, §8 "The phone's Apps"; where the page and the
/// record differ, the record's stand). `ChromePalette.appFallbackTile` is held to tokens.css by `pnpm check:ios-fixtures`.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("MA-6b — the ink and the measures of the phone's Apps")
struct AppsChromeTests {
  private static func near(_ a: CGFloat, _ b: CGFloat) -> Bool { abs(a - b) < 0.001 }

  @Test("by day a project's squircle is its ink behind a white letter")
  func dayPaint() {
    let paint = AppIcon.paint(ink: 3, dark: false)
    #expect(paint == .init(ground: .ink(.projectInk(3, .light)), letter: .white))
  }

  @Test("by night it is the dark tile, the letter in the night's ink")
  func nightPaint() {
    let paint = AppIcon.paint(ink: 3, dark: true)
    #expect(paint == .init(ground: .darkTile, letter: .ink(.projectInk(3, .dark))))
  }

  @Test("an app with no project takes the theme's fill and the primary ink, in both themes")
  func noProjectPaint() {
    let want = AppIcon.Paint(ground: .fill, letter: .primary)
    #expect(AppIcon.paint(ink: nil, dark: false) == want)
    #expect(AppIcon.paint(ink: nil, dark: true) == want)
  }

  @Test("the corner is 22.5% of the side, and the initial 26 on 60 at every size")
  func proportions() {
    #expect(Self.near(AppIcon.corner(side: 60), 13.5))
    #expect(Self.near(AppIcon.corner(side: 100), 22.5))
    #expect(Self.near(AppIcon.initialSize(side: 60), 26))
    #expect(Self.near(AppIcon.initialSize(side: 120), 52))
  }

  @Test("the crop is the desktop's capture's full height and its middle 400")
  func crop() {
    #expect(AppIcon.crop(width: 640, height: 400) == CGRect(x: 120, y: 0, width: 400, height: 400))
    #expect(AppIcon.crop(width: 400, height: 640) == CGRect(x: 0, y: 120, width: 400, height: 400))
    #expect(AppIcon.crop(width: 300, height: 300) == CGRect(x: 0, y: 0, width: 300, height: 300))
  }

  @Test("the icon's marks: its hairline, its dot, the warm ring, asleep, the honest side")
  func iconMarks() {
    #expect(AppIcon.hairline == 0.5)
    #expect(AppIcon.dot == 12 && AppIcon.dotOutside == 3 && AppIcon.dotRing == 2)
    #expect(AppIcon.warmRing == 2 && AppIcon.warmGap == 2.5)
    #expect(AppIcon.awayOpacity == 0.45)
    #expect(AppIcon.honestSide == 92)
  }

  @Test("the shelf stands at the bar's measure, and the tab recedes to its card")
  func shelf() {
    #expect(AppsShelfChrome.side == AppBar.margin)
    #expect(AppsShelfChrome.searchHeight == 48)
    #expect(AppsShelfChrome.across == 4 && AppsShelfChrome.icon == 60)
    #expect(AppsShelfChrome.nameSize == 11 && AppsShelfChrome.nameLine == 13 && AppsShelfChrome.nameLines == 2)
    #expect(AppsShelfChrome.rowGap == 14)
    #expect(AppsShelfChrome.headSize == 20 && AppsShelfChrome.headCount == 13)
    #expect(AppsShelfChrome.cardScale == 0.92 && AppsShelfChrome.cardShowing == 106)
    #expect(AppsShelfChrome.cardRadius == 44)
    #expect(AppsShelfChrome.grabberWidth == 40 && AppsShelfChrome.grabberHeight == 5)
    #expect(AppsShelfChrome.grabberOpacity == 0.3)
  }

  @Test("a folder: two across, three big icons and a cluster of four, its name under it")
  func folder() {
    #expect(AppsShelfChrome.foldersAcross == 2)
    #expect(AppsShelfChrome.folderRowGap == 16 && AppsShelfChrome.folderColumnGap == 14)
    #expect(AppsShelfChrome.folderRadius == 28 && AppsShelfChrome.folderInset == 13)
    #expect(AppsShelfChrome.folderBig == 62 && AppsShelfChrome.folderBigCount == 3)
    #expect(AppsShelfChrome.folderSmall == 27 && AppsShelfChrome.folderSmallCount == 4)
    #expect(AppsShelfChrome.folderName == 13)
  }

  @Test("the open app's row is the bar's, its capsule the bar's 188 on the page's 402, and the zoom fades at 140ms")
  func glassRow() {
    #expect(AppsGlassRow.height == AppBar.height && AppsGlassRow.side == AppBar.margin)
    #expect(AppsGlassRow.circle == 62 && AppsGlassRow.capsuleGap == 24)
    #expect(AppsGlassRow.capsuleWidth(screen: 402) == 188)
    #expect(AppsGlassRow.capsuleIcon == 30 && AppsGlassRow.nameSize == 15)
    #expect(AppsGlassRow.desktopSize == 12 && AppsGlassRow.osMark == 11)
    #expect(AppsGlassRow.foldedHeight == 30 && AppsGlassRow.foldedName == 13)
    #expect(AppsGlassRow.reducedFade == 0.14)
  }
}
