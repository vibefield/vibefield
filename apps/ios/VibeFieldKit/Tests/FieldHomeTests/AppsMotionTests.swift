import CoreGraphics
import Testing

@testable import FieldHome

/// Item 419 (DESIGN.md §8 "The phone's Apps": "A folder, open", "Under a finger", "The open app") — the shelf moves as
/// the Home Screen does, held where a decision is a pure rule: where the panel stands, the square on its way from the
/// tile, what rides it, the pages, what is behind, the pinch, the drawing's own standing, the dark under a finger,
/// what a long press lifts, and which icon a screen zooms out of. How any of it feels under a finger is James's, on
/// his phone.
///
/// No key path, no `try` and no `mutating` call inside an #expect/#require argument: hoisted into a `let` first. No
/// side of a comparison is arithmetic on bare literals (read as Int, which a CGFloat never equals).
@Suite("item 419 — the shelf moves as the Home Screen does: the folder, the press, the zoom's source")
struct AppsMotionTests {
  /// The pages' bounds on an iPhone 17 Pro: its 874 points less the 62 and 34 of its safe area.
  private static let page = CGSize(width: 402, height: 778)
  /// The panel on that page, and a folder's tile in the Projects grid's first column.
  private static let panel = CGRect(x: 28, y: 185, width: 346, height: 353)
  private static let tile = CGRect(x: 21, y: 400, width: 173, height: 173)

  private static func near(_ a: CGFloat, _ b: CGFloat) -> Bool { abs(a - b) < 1e-9 }

  private static func near(_ a: CGPoint, _ b: CGPoint) -> Bool { near(a.x, b.x) && near(a.y, b.y) }

  /// A folder tapped at the tile and risen.
  private static func standing(_ key: String = "project-1") -> AppsFolderStand {
    var stand = AppsFolderStand()
    stand.place(key, tile: tile)
    stand.rise()
    return stand
  }

  // MARK: - The numbers

  @Test("the folder's numbers and the press's, as DESIGN.md §8 says them")
  func numbers() {
    #expect(AppsFolderMotion.response == 0.42 && AppsFolderMotion.damping == 0.84)
    #expect(AppsFolderMotion.swap == 0.18 && AppsFolderMotion.swapWaits == 0.1)
    #expect(AppsFolderMotion.across == 3 && AppsFolderMotion.rows == 3 && AppsFolderMotion.perPage == 9)
    #expect(AppsFolderMotion.panelSide == 28 && AppsFolderMotion.panelInset == 22)
    #expect(AppsFolderMotion.panelRadius == 38 && AppsFolderMotion.dotsBand == 30)
    #expect(AppsFolderMotion.dot == 7 && AppsFolderMotion.dotGap == 9)
    #expect(AppsFolderMotion.cellHeight == 91 && AppsFolderMotion.gridHeight == 301)
    #expect(AppsFolderMotion.panelHeight == 353)
    #expect(AppsFolderMotion.nameSize == 30 && AppsFolderMotion.nameLine == 36 && AppsFolderMotion.nameGap == 14)
    #expect(AppsFolderMotion.behindScale == 1.06 && AppsFolderMotion.behindBlur == 20)
    #expect(AppsFolderMotion.pinchSpan == 0.5 && AppsFolderMotion.pinchCloses == 0.25)
    #expect(AppsPress.dim == 0.4 && AppsPress.lifts == 0.25)
    #expect(AppsShelfChrome.nameGap == 5)
  }

  // MARK: - Under a finger

  @Test("under a finger an icon stands under black at 40%, and under none once the finger has gone")
  func press() {
    #expect(AppsPress.dim(pressed: true) == 0.4)
    #expect(AppsPress.dim(pressed: false) == 0)
  }

  @Test("a long press lifts the icon alone: its squircle at the tile's top centre, never its name")
  func lift() {
    let cell = CGRect(x: 10, y: 20, width: 90, height: 91)
    let lifted = AppIcon.lift(in: cell, side: 60)
    #expect(lifted == CGRect(x: 25, y: 20, width: 60, height: 60))
  }

  // MARK: - The zoom's source

  @Test("only the icon asked carries the app's key: its other standings, and another app there, carry none")
  func source() {
    let key = "mini:app-1"
    let asked = AppsZoomAsk(place: .recent, appKey: key)
    let tapped = AppsZoomSource.id(appKey: key, at: .recent, asked: asked)
    #expect(tapped == key)
    let elsewhere = AppsZoomSource.id(appKey: key, at: .noProject, asked: asked)
    #expect(elsewhere != key, "the same app in its own group")
    let inFolder = AppsZoomSource.id(appKey: key, at: .folder("project-1"), asked: asked)
    #expect(inFolder != key, "the same app in its open folder")
    let other = AppsZoomSource.id(appKey: "mini:app-2", at: .recent, asked: asked)
    #expect(other != "mini:app-2", "another app in the place asked was not the one asked")
    let unasked = AppsZoomSource.id(appKey: key, at: .recent, asked: nil)
    #expect(unasked != key, "before any tap on the shelf no icon of it carries the key")
  }

  @Test("no two standings of an app share a key")
  func sourcesDiffer() {
    let key = "mini:app-1"
    let places: [AppsPlace] = [.recent, .kept, .noProject, .matched, .folder("a"), .folder("b")]
    let ids = places.map { AppsZoomSource.id(appKey: key, at: $0, asked: nil) }
    let distinct = Set(ids)
    #expect(distinct.count == places.count)
    #expect(distinct.contains(key) == false)
  }

  // MARK: - The pages

  @Test("nine to a page: none or nine apps are one page, ten are two, nineteen three")
  func pages() {
    #expect(AppsFolderMotion.pages(count: 0) == 1)
    #expect(AppsFolderMotion.pages(count: 1) == 1)
    #expect(AppsFolderMotion.pages(count: 9) == 1)
    #expect(AppsFolderMotion.pages(count: 10) == 2)
    #expect(AppsFolderMotion.pages(count: 18) == 2)
    #expect(AppsFolderMotion.pages(count: 19) == 3)
  }

  @Test("a page holds its nine in the folder's order, the last what is left, and one past the end none")
  func pageHolds() {
    let apps = Array(1...12)
    let first = AppsFolderMotion.page(0, of: apps)
    #expect(first == Array(1...9))
    let last = AppsFolderMotion.page(1, of: apps)
    #expect(last == [10, 11, 12])
    let past = AppsFolderMotion.page(2, of: apps)
    #expect(past.isEmpty)
    let before = AppsFolderMotion.page(-1, of: apps)
    #expect(before.isEmpty)
  }

  // MARK: - Where the panel stands

  @Test("on the page's 402 by 778 the panel stands 28 from the sides, 346 by 353, centred with its name over the card")
  func panelOnThePage() {
    let panel = AppsFolderMotion.panel(in: Self.page)
    #expect(panel == Self.panel)
    // what the card leaves is 672; the name's line and its gap are 50, so name and panel are 403 of it
    let over: CGFloat = 135
    let under: CGFloat = 134
    let name = AppsFolderMotion.name(over: panel)
    #expect(name.minY == over, "above the name")
    #expect(Self.page.height - AppsShelfChrome.cardShowing - panel.maxY == under, "between the panel and the card")
  }

  @Test("on every phone the panel is 28 from the sides and 353 tall, and stands with its name between top and card")
  func panelOnEveryPhone() {
    // the pages' bounds of an iPhone SE, an iPhone 16, a 17 Pro and a 17 Pro Max
    let phones = [
      CGSize(width: 375, height: 647), CGSize(width: 393, height: 759), Self.page, CGSize(width: 440, height: 860),
    ]
    for bounds in phones {
      let panel = AppsFolderMotion.panel(in: bounds)
      let name = AppsFolderMotion.name(over: panel)
      let wide: CGFloat = bounds.width - 56
      #expect(panel.minX == 28 && panel.width == wide, "\(bounds)")
      #expect(panel.height == 353, "\(bounds)")
      #expect(name.minY >= 0, "\(bounds)")
      #expect(panel.maxY <= bounds.height - AppsShelfChrome.cardShowing, "\(bounds)")
    }
  }

  @Test("its name stands 14 over the panel, 22 in from its leading edge, in a line of 36")
  func nameOverThePanel() {
    let name = AppsFolderMotion.name(over: Self.panel)
    #expect(name == CGRect(x: 50, y: 135, width: 302, height: 36))
  }

  // MARK: - The square on its way

  @Test("the square is its tile at 0 and the panel at 1, corners 28 to 38, and at a half halfway in all of them")
  func plate() {
    let closed = AppsFolderMotion.plate(tile: Self.tile, panel: Self.panel, progress: 0)
    #expect(closed == .init(rect: Self.tile, radius: 28))
    let open = AppsFolderMotion.plate(tile: Self.tile, panel: Self.panel, progress: 1)
    #expect(open == .init(rect: Self.panel, radius: 38))
    let half = AppsFolderMotion.plate(tile: Self.tile, panel: Self.panel, progress: 0.5)
    #expect(half == .init(rect: CGRect(x: 24.5, y: 292.5, width: 259.5, height: 263), radius: 33))
  }

  @Test("a spring past either end carries the square with it, and never to less than nothing")
  func plateFollowsTheSpring() {
    let past = AppsFolderMotion.plate(tile: Self.tile, panel: Self.panel, progress: 1.5)
    #expect(past.rect.width == 432.5 && past.radius == 43)
    let short = AppsFolderMotion.plate(tile: Self.tile, panel: Self.panel, progress: -0.5)
    #expect(short.rect.width == 86.5 && short.radius == 23)
    let far = AppsFolderMotion.plate(tile: Self.tile, panel: Self.panel, progress: -10)
    #expect(far.rect.width == 0 && far.rect.height == 0 && far.radius == 0)
  }

  @Test("a tile never measured has no place: its folder grows out of the panel's own middle, at half its size")
  func start() {
    let measured = AppsFolderMotion.start(tile: Self.tile, panel: Self.panel)
    #expect(measured == Self.tile)
    let unmeasured = AppsFolderMotion.start(tile: .zero, panel: Self.panel)
    #expect(unmeasured == CGRect(x: 114.5, y: 273.25, width: 173, height: 176.5))
  }

  // MARK: - What rides the square

  @Test("the open folder's picture rides the square: where it was laid out at 1, at the tile's middle and width at 0")
  func carryOpen() {
    let open = AppsFolderMotion.plate(tile: Self.tile, panel: Self.panel, progress: 1)
    let whole = AppsFolderMotion.carry(Self.panel, onto: open.rect)
    let corner = CGPoint(x: 28, y: 185).applying(whole)
    #expect(Self.near(corner, CGPoint(x: 28, y: 185)), "nothing moves once it is open")

    let closed = AppsFolderMotion.plate(tile: Self.tile, panel: Self.panel, progress: 0)
    let small = AppsFolderMotion.carry(Self.panel, onto: closed.rect)
    let middle = CGPoint(x: Self.panel.midX, y: Self.panel.midY).applying(small)
    #expect(Self.near(middle, CGPoint(x: Self.tile.midX, y: Self.tile.midY)), "the panel's middle is the tile's")
    let leading = CGPoint(x: Self.panel.minX, y: Self.panel.midY).applying(small)
    #expect(Self.near(leading.x, Self.tile.minX), "and its width the tile's")
    let trailing = CGPoint(x: Self.panel.maxX, y: Self.panel.midY).applying(small)
    #expect(Self.near(trailing.x, Self.tile.maxX))
  }

  @Test("the tile's face rides it the other way: where it stands at 0, at the panel's middle and width at 1")
  func carryClosed() {
    let closed = AppsFolderMotion.plate(tile: Self.tile, panel: Self.panel, progress: 0)
    let rest = AppsFolderMotion.carry(Self.tile, onto: closed.rect)
    let corner = CGPoint(x: 21, y: 400).applying(rest)
    #expect(Self.near(corner, CGPoint(x: 21, y: 400)), "nothing moves while it is in its tile")

    let open = AppsFolderMotion.plate(tile: Self.tile, panel: Self.panel, progress: 1)
    let large = AppsFolderMotion.carry(Self.tile, onto: open.rect)
    let middle = CGPoint(x: Self.tile.midX, y: Self.tile.midY).applying(large)
    #expect(Self.near(middle, CGPoint(x: Self.panel.midX, y: Self.panel.midY)), "the tile's middle is the panel's")
    let leading = CGPoint(x: Self.tile.minX, y: Self.tile.midY).applying(large)
    #expect(Self.near(leading.x, Self.panel.minX), "and its width the panel's")
  }

  // MARK: - Behind it

  @Test("behind an open folder the shelf is blurred to 20 under the whole scrim and 1.06 toward you; at rest, as it is")
  func behind() {
    let rest = AppsFolderMotion.behind(progress: 0)
    #expect(rest == .init(scale: 1, blur: 0, dim: 0))
    let open = AppsFolderMotion.behind(progress: 1)
    #expect(Self.near(open.scale, 1.06) && open.blur == 20 && open.dim == 1)
    let half = AppsFolderMotion.behind(progress: 0.5)
    #expect(Self.near(half.scale, 1.03) && half.blur == 10 && half.dim == 0.5)
    let past = AppsFolderMotion.behind(progress: 1.2)
    #expect(past == open, "a spring past the end blurs and dims no more")
    let short = AppsFolderMotion.behind(progress: -0.2)
    #expect(short == rest)
  }

  // MARK: - The pinch

  @Test("a pinch to half the fingers' spread is the whole way back, a quarter of the way closes, spreading is nothing")
  func pinch() {
    #expect(AppsFolderMotion.pull(magnification: 1) == 0)
    #expect(AppsFolderMotion.pull(magnification: 1.4) == 0, "spreading takes it nowhere")
    #expect(AppsFolderMotion.pull(magnification: 0.75) == 0.5)
    #expect(AppsFolderMotion.pull(magnification: 0.5) == 1)
    #expect(AppsFolderMotion.pull(magnification: 0.2) == 1, "never past its tile")
    #expect(AppsFolderMotion.closes(pull: 0.25))
    #expect(AppsFolderMotion.closes(pull: 0.24) == false)
    let atSevenEighths = AppsFolderMotion.pull(magnification: 0.875)
    #expect(AppsFolderMotion.closes(pull: atSevenEighths), "the fingers an eighth closer")
  }

  // MARK: - The drawing's own standing

  @Test("a tile tapped: its folder is drawn at the tile before it moves, and the tile gives it its place")
  func placed() {
    var stand = AppsFolderStand()
    stand.place("project-1", tile: Self.tile)
    #expect(stand.drawn == "project-1")
    #expect(stand.tile == Self.tile)
    #expect(stand.progress == 0, "it has not left its tile")
    #expect(stand.hides("project-1"))
    #expect(stand.hides("project-2") == false)
    #expect(stand.takesClose == false, "there is nothing to close yet")
  }

  @Test("risen, it stands open and a close can take it")
  func risen() {
    let stand = Self.standing()
    #expect(stand.open)
    #expect(stand.progress == 1)
    #expect(stand.takesClose)
  }

  @Test("a pinch takes it back by the fingers: let go short of a quarter it is whole again, past it it closes")
  func pinched() {
    var stand = Self.standing()
    stand.pinch(0.9)
    #expect(Self.near(stand.progress, 0.8))
    let closedShort = stand.letGo()
    #expect(closedShort == false)
    #expect(stand.progress == 1, "whole again")

    stand.pinch(0.75)
    #expect(stand.progress == 0.5)
    let closed = stand.letGo()
    #expect(closed)
    #expect(stand.progress == 0.5, "it goes home from where the fingers left it")
    stand.leave()
    #expect(stand.progress == 0)
  }

  @Test("let go, it stays drawn until its spring is home, and then it is drawn no more")
  func leaves() {
    var stand = Self.standing()
    let ask = stand.asks
    stand.leave()
    #expect(stand.drawn == "project-1", "drawn all the way back")
    #expect(stand.hides("project-1"))
    #expect(stand.progress == 0)
    #expect(stand.takesClose == false, "one already leaving is left to arrive")
    stand.settled(ask: ask)
    #expect(stand.drawn == nil)
    #expect(stand.hides("project-1") == false, "the tile has its place again")
    #expect(stand.tile == .zero)
  }

  @Test("turned mid-flight: risen again before its spring is home, the spring's late end takes nothing down")
  func turned() {
    var stand = Self.standing()
    let ask = stand.asks
    stand.leave()
    stand.rise()
    stand.settled(ask: ask)
    #expect(stand.drawn == "project-1")
    #expect(stand.progress == 1)
  }

  @Test("a tile tapped while another folder is on its way home: the late end of that spring leaves the new one drawn")
  func lateEnd() {
    var stand = Self.standing("project-1")
    let first = stand.asks
    stand.leave()
    let other = CGRect(x: 208, y: 400, width: 173, height: 173)
    stand.place("project-2", tile: other)
    #expect(stand.asks != first)
    stand.settled(ask: first)
    #expect(stand.drawn == "project-2", "it has not risen yet, and it stays")
    #expect(stand.tile == other)
    stand.rise()
    #expect(stand.progress == 1)
  }

  @Test("with none drawn there is nothing to pinch or close; a folder whose project left the shelf is drawn no more")
  func nothingDrawn() {
    var empty = AppsFolderStand()
    empty.rise()
    empty.pinch(0.5)
    let closed = empty.letGo()
    #expect(closed == false)
    #expect(empty.drawn == nil && empty.open == false && empty.progress == 0)

    var stand = Self.standing()
    #expect(stand.drawn == "project-1")
    stand.gone()
    #expect(stand.drawn == nil && stand.open == false && stand.progress == 0)
    #expect(stand.tile == .zero)
  }
}
