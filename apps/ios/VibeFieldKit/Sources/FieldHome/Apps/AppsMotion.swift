import CoreGraphics
import Foundation

// Item 419 — how the phone's shelf moves, as values (DESIGN.md §8 "The phone's Apps": "A folder, open", "Under a
// finger", "The open app"): the Home Screen's folder and the system's app launch at the shelf's measure. Every number
// that decides a motion stands here, once, and the views read it; how each feels under a finger is James's, on his
// phone.

/// An icon under a finger.
enum AppsPress {
  /// How dark a pressed icon stands: black at this share over its squircle alone, as a Home Screen icon darkens.
  static let dim: Double = 0.4
  /// How long the dark takes to lift once the finger has gone. It arrives at once.
  static let lifts: Double = 0.25

  /// The dark over an icon.
  static func dim(pressed: Bool) -> Double { pressed ? dim : 0 }
}

extension AppIcon {
  /// What a long press lifts out of a tile `rect`: the icon alone, the squircle at the tile's top centre, never its
  /// name.
  static func lift(in rect: CGRect, side: CGFloat) -> CGRect {
    CGRect(x: rect.midX - side / 2, y: rect.minY, width: side, height: side)
  }
}

extension AppsShelfChrome {
  /// A tile's name stands this far under its icon.
  static let nameGap: CGFloat = 5
}

/// Where an app's icon stands on the shelf. One app stands in more than one place (in Recent and in its own group,
/// as App Library's do), and its screen zooms out of the one that was tapped.
enum AppsPlace: Hashable {
  case recent, kept, noProject, matched
  /// Inside the open folder of the project with this key.
  case folder(String)

  /// The place's name, in a key no screen zooms from.
  var tag: String {
    switch self {
    case .recent: "recent"
    case .kept: "kept"
    case .noProject: "no-project"
    case .matched: "matched"
    case .folder(let key): "folder:\(key)"
    }
  }
}

/// The icon the last open was asked from.
struct AppsZoomAsk: Equatable {
  let place: AppsPlace
  let appKey: String
}

/// Which icon an app's screen zooms out of, and back into.
enum AppsZoomSource {
  /// The key an app's icon carries at `place`. The screen zooms from the app's own key, so only the icon asked
  /// carries it, and every other standing of the same app carries a key no screen names. Two icons under one key
  /// leave the choice to the system, and a screen may leave one and come back into another.
  static func id(appKey: String, at place: AppsPlace, asked: AppsZoomAsk?) -> String {
    asked == AppsZoomAsk(place: place, appKey: appKey) ? appKey : "\(appKey)|\(place.tag)"
  }
}

/// A project's folder, open over the shelf: the Home Screen's folder at the shelf's measure.
enum AppsFolderMotion {
  // MARK: - The spring

  /// The one spring a folder opens and closes on: the bar's numbers (`AppBar.motion`), so DESIGN.md §6 gains no
  /// curve. They stand here so the folder can be tuned without moving the bar.
  static let response: Double = 0.42
  static let damping: Double = 0.84
  /// The tile's face and the panel's apps change places on a plain fade this long.
  static let swap: Double = 0.18
  /// On the way back the change waits this long, so the apps are most of the way home before the tile's face returns.
  static let swapWaits: Double = 0.1

  // MARK: - The panel

  /// Its grid: three across and three rows, nine to a page.
  static let across = 3
  static let rows = 3
  static var perPage: Int { across * rows }
  /// From the screen's sides.
  static let panelSide: CGFloat = 28
  /// Around its grid: at the top and the sides.
  static let panelInset: CGFloat = 22
  /// Its corners, which the tile's 28 grow to.
  static let panelRadius: CGFloat = 38
  /// The band at its foot, where the page dots stand.
  static let dotsBand: CGFloat = 30
  static let dot: CGFloat = 7
  static let dotGap: CGFloat = 9

  /// One app in the panel: its icon and its name's two lines under it. A fixed pitch, so every page's rows stand
  /// level.
  static var cellHeight: CGFloat {
    AppsShelfChrome.icon + AppsShelfChrome.nameGap + CGFloat(AppsShelfChrome.nameLines) * AppsShelfChrome.nameLine
  }

  static var gridHeight: CGFloat { CGFloat(rows) * cellHeight + CGFloat(rows - 1) * AppsShelfChrome.rowGap }

  /// The same on every phone and for any number of apps, as the Home Screen's folder is one size.
  static var panelHeight: CGFloat { panelInset + gridHeight + dotsBand }

  // MARK: - Its name

  static let nameSize: CGFloat = 30
  /// The line the name stands in.
  static let nameLine: CGFloat = 36
  /// Between the name and the panel.
  static let nameGap: CGFloat = 14

  // MARK: - Behind it

  /// How large the shelf is drawn behind an open folder, about the folder's tile: over 1 it comes toward you, as the
  /// Home Screen dives into its folder; under 1 it would settle back.
  static let behindScale: CGFloat = 1.06
  static let behindBlur: CGFloat = 20

  // MARK: - The pinch

  /// The fingers at this share of their spread are the whole way back to the tile.
  static let pinchSpan: CGFloat = 0.5
  /// Let go this far back or more, the folder closes.
  static let pinchCloses: CGFloat = 0.25

  /// The shelf's own coordinate space, which a tile's place is read in. A plain value, so the Sendable closure that
  /// reads a tile's frame can name it.
  static let space = "apps.shelf"

  // MARK: - The rules

  /// How many pages a folder of `count` apps has: nine to a page, and an empty folder still one.
  static func pages(count: Int) -> Int { max(1, (count + perPage - 1) / perPage) }

  /// The apps on page `index`, in the folder's order. A page past the end holds none.
  static func page<App>(_ index: Int, of apps: [App]) -> [App] {
    let first = index * perPage
    guard index >= 0, first < apps.count else { return [] }
    return Array(apps[first..<min(first + perPage, apps.count)])
  }

  /// Where the panel stands on a shelf of `bounds` (the pages' bounds, the safe area's): `panelSide` from each side,
  /// and with its name centred in what the receded card leaves of the height. On a screen too short for both, the
  /// name keeps the top.
  static func panel(in bounds: CGSize) -> CGRect {
    let head = nameLine + nameGap
    let free = bounds.height - AppsShelfChrome.cardShowing
    let top = max(0, (free - head - panelHeight) / 2)
    return CGRect(
      x: panelSide, y: (top + head).rounded(), width: max(0, bounds.width - 2 * panelSide), height: panelHeight)
  }

  /// Where the folder's name stands: over the panel, `panelInset` in from its leading edge.
  static func name(over panel: CGRect) -> CGRect {
    CGRect(
      x: panel.minX + panelInset, y: panel.minY - nameGap - nameLine,
      width: max(0, panel.width - 2 * panelInset), height: nameLine)
  }

  /// Where the folder grows from: its tile's place. A tile that was never measured has none, and its folder grows
  /// out of the panel's own middle, at half its size.
  static func start(tile: CGRect, panel: CGRect) -> CGRect {
    guard tile.isEmpty else { return tile }
    return panel.insetBy(dx: panel.width / 4, dy: panel.height / 4)
  }

  /// The folder's square on its way.
  struct Plate: Equatable {
    var rect: CGRect
    var radius: CGFloat
  }

  /// The square at `progress`, 0 in its tile to 1 as the panel: its place, its size and its corners in step. The
  /// spring may carry `progress` a hair past either end, and the square goes with it, never to less than nothing.
  static func plate(tile: CGRect, panel: CGRect, progress: CGFloat) -> Plate {
    func step(_ from: CGFloat, _ to: CGFloat) -> CGFloat { from + (to - from) * progress }
    return Plate(
      rect: CGRect(
        x: step(tile.minX, panel.minX), y: step(tile.minY, panel.minY),
        width: max(0, step(tile.width, panel.width)), height: max(0, step(tile.height, panel.height))),
      radius: max(0, step(AppsShelfChrome.folderRadius, panelRadius)))
  }

  /// How a picture laid out for `whole` is drawn on `plate`: about the plate's middle, at the plate's width. The
  /// open folder's picture (its apps, its name) is laid out for the panel and the tile's face for the tile; each
  /// rides the square, drawn smaller or larger and never laid out again.
  static func carry(_ whole: CGRect, onto plate: CGRect) -> CGAffineTransform {
    let scale = whole.width > 0 ? plate.width / whole.width : 1
    return CGAffineTransform(translationX: plate.midX, y: plate.midY)
      .scaledBy(x: scale, y: scale)
      .translatedBy(x: -whole.midX, y: -whole.midY)
  }

  /// What stands behind an open folder.
  struct Behind: Equatable {
    /// About the tile's middle.
    var scale: CGFloat
    var blur: CGFloat
    /// The scrim's share, 0 to 1.
    var dim: Double
  }

  /// The shelf behind a folder at `progress`. A spring past either end changes nothing here.
  static func behind(progress: CGFloat) -> Behind {
    let share = min(1, max(0, progress))
    return Behind(scale: 1 + (behindScale - 1) * share, blur: behindBlur * share, dim: Double(share))
  }

  /// How far back toward its tile a pinch has taken the open folder, 0 to 1: the fingers at `pinchSpan` of their
  /// spread are the whole way. Spreading them takes it nowhere.
  static func pull(magnification: CGFloat) -> CGFloat {
    min(1, max(0, (1 - magnification) / pinchSpan))
  }

  /// Whether a pinch let go at `pull` closes the folder.
  static func closes(pull: CGFloat) -> Bool { pull >= pinchCloses }
}

/// The folder the shelf draws over itself, and where it is heading. The door's model says which folder is open
/// (`AppsDoorModel.folder`); this is the drawing's own standing, which outlasts the model's word by one spring: a
/// folder let go stays drawn until it is back in its tile.
struct AppsFolderStand: Equatable {
  /// The folder drawn over the shelf.
  private(set) var drawn: String?
  /// Its tile's place on the shelf when it was tapped: where it grows from, and where it goes back to.
  private(set) var tile: CGRect = .zero
  /// Whether it is heading open. Drawn and not open, it has not left its tile yet, or is on its way back.
  private(set) var open = false
  /// How far a pinch has taken it back toward its tile, 0 to 1.
  private(set) var pull: CGFloat = 0
  /// How many tiles have been tapped: what tells a spring's late end from the folder that stands now.
  private(set) var asks = 0

  /// 0 in its tile, 1 open.
  var progress: CGFloat { open ? 1 - pull : 0 }

  /// Whether a tap outside the panel, a pinch or the card closes it: only a folder heading open. One already on its
  /// way back is left to arrive, and with none drawn there is nothing to close.
  var takesClose: Bool { drawn != nil && open }

  /// Whether `key`'s tile has given its place to the folder drawn over it.
  func hides(_ key: String) -> Bool { drawn == key }

  /// A tile was tapped: its folder is drawn where the tile stands, before it moves.
  mutating func place(_ key: String, tile: CGRect) {
    drawn = key
    self.tile = tile
    open = false
    pull = 0
    asks += 1
  }

  /// It heads open, from wherever it is.
  mutating func rise() {
    guard drawn != nil else { return }
    open = true
    pull = 0
  }

  /// A pinch moves it by the fingers.
  mutating func pinch(_ magnification: CGFloat) {
    guard takesClose else { return }
    pull = AppsFolderMotion.pull(magnification: magnification)
  }

  /// The fingers let go. True when the folder closes, from where the fingers left it; short of that it is whole
  /// again.
  mutating func letGo() -> Bool {
    guard takesClose else { return false }
    if AppsFolderMotion.closes(pull: pull) { return true }
    pull = 0
    return false
  }

  /// It heads back into its tile, from wherever it is.
  mutating func leave() {
    open = false
    pull = 0
  }

  /// The spring that took the folder of tap `ask` home has ended. A tile tapped since is another folder's, and it
  /// stays; so does a folder turned back open before it was home.
  mutating func settled(ask: Int) {
    guard ask == asks, !open else { return }
    drawn = nil
    tile = .zero
  }

  /// Its project left the shelf: nothing is drawn.
  mutating func gone() {
    drawn = nil
    tile = .zero
    open = false
    pull = 0
  }
}
