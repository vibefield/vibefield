import FieldDesign
import FieldProduct
import SwiftUI

// Item 419 — a project's folder, open over the shelf (DESIGN.md §8 "The phone's Apps", "A folder, open"): the Home
// Screen's folder at the shelf's measure. The square on its way, what rides it and what stands behind it are the
// rules of AppsMotion.swift; the views here read them and decide nothing. How it looks and feels on a device is
// owed to James: none of this has been seen on one.

extension AppsFolderMotion {
  /// The folder's one spring.
  static var spring: Animation { .spring(response: response, dampingFraction: damping) }

  /// What a folder opens and closes on: its spring, or under Reduce Motion the fade that stands in its place (M6).
  static func motion(reduced: Bool) -> Animation {
    reduced ? FieldMotion.plainEase(AppsGlassRow.reducedFade) : spring
  }

  /// The fade the tile's face and the panel's apps change places on: at once on the way out, and after `swapWaits`
  /// on the way back.
  static func swapFade(opening: Bool) -> Animation {
    FieldMotion.plainEase(swap).delay(opening ? 0 : swapWaits)
  }
}

/// A folder's face, closed: three icons at 62 and a cluster of the next four at 27, in a square. The tile on the shelf
/// wears it, and so does the open folder's square while it is near its tile.
struct AppsFolderFace: View {
  let folder: AppsShelf.Folder

  var body: some View {
    let big = folder.big
    VStack {
      HStack {
        slot(big, 0)
        Spacer(minLength: 0)
        slot(big, 1)
      }
      Spacer(minLength: 0)
      HStack {
        slot(big, 2)
        Spacer(minLength: 0)
        cluster
      }
    }
    .padding(AppsShelfChrome.folderInset)
    .aspectRatio(1, contentMode: .fit)
  }

  @ViewBuilder
  private func slot(_ apps: [IndexAppRow], _ index: Int) -> some View {
    if apps.indices.contains(index) {
      AppIconView(app: apps[index], side: AppsShelfChrome.folderBig)
    } else {
      Color.clear.frame(width: AppsShelfChrome.folderBig, height: AppsShelfChrome.folderBig)
    }
  }

  private var cluster: some View {
    let small = folder.small
    let gap = AppsShelfChrome.folderBig - 2 * AppsShelfChrome.folderSmall
    return VStack(spacing: gap) {
      HStack(spacing: gap) {
        smallSlot(small, 0)
        smallSlot(small, 1)
      }
      HStack(spacing: gap) {
        smallSlot(small, 2)
        smallSlot(small, 3)
      }
    }
    .frame(width: AppsShelfChrome.folderBig, height: AppsShelfChrome.folderBig)
  }

  @ViewBuilder
  private func smallSlot(_ apps: [IndexAppRow], _ index: Int) -> some View {
    if apps.indices.contains(index) {
      AppIconView(app: apps[index], side: AppsShelfChrome.folderSmall)
    } else {
      Color.clear.frame(width: AppsShelfChrome.folderSmall, height: AppsShelfChrome.folderSmall)
    }
  }
}

/// The folder's square on its way from its tile to the panel, in the shelf's own space: its place, its size and its
/// corners in step (`AppsFolderMotion.plate`). It is the fill, the edge the apps are cut at, and what takes a touch
/// inside the panel.
struct AppsFolderPlate: Shape {
  let tile: CGRect
  let panel: CGRect
  var progress: CGFloat

  var animatableData: CGFloat {
    get { progress }
    set { progress = newValue }
  }

  func path(in rect: CGRect) -> Path {
    let plate = AppsFolderMotion.plate(tile: tile, panel: panel, progress: progress)
    return RoundedRectangle(cornerRadius: plate.radius, style: .continuous).path(in: plate.rect)
  }
}

/// How a picture rides the square: laid out once for `whole` (the panel for the open folder's picture, the tile for
/// the closed one's) and drawn at the square's middle and width from there on (`AppsFolderMotion.carry`). The view it
/// is laid on fills the shelf, so its space is the shelf's.
struct AppsFolderCarry: GeometryEffect {
  let whole: CGRect
  let tile: CGRect
  let panel: CGRect
  var progress: CGFloat

  var animatableData: CGFloat {
    get { progress }
    set { progress = newValue }
  }

  func effectValue(size: CGSize) -> ProjectionTransform {
    let plate = AppsFolderMotion.plate(tile: tile, panel: panel, progress: progress)
    return ProjectionTransform(AppsFolderMotion.carry(whole, onto: plate.rect))
  }
}

/// Where the shelf is drawn behind an open folder: larger about the folder's tile. For drawing only
/// (`ignoredByLayout`), so a tile's place is read as it is laid out and never as it is drawn.
struct AppsShelfBehind: GeometryEffect {
  var scale: CGFloat
  /// The tile's middle, in the shelf's space.
  let about: CGPoint

  var animatableData: CGFloat {
    get { scale }
    set { scale = newValue }
  }

  func effectValue(size: CGSize) -> ProjectionTransform {
    let place = CGAffineTransform(translationX: about.x, y: about.y)
      .scaledBy(x: scale, y: scale)
      .translatedBy(x: -about.x, y: -about.y)
    return ProjectionTransform(place)
  }
}

/// A folder open over the shelf: the dim a tap closes, the square on its way, what rides it, and the name over it.
/// The shelf mounts it where the folder's tile stands and it sends itself open; the door's model lets it go, and the
/// shelf sends it home (`AppsShelfView`).
struct AppsFolderLayer: View {
  let folder: AppsShelf.Folder
  @Binding var stand: AppsFolderStand
  let door: AppsDoorModel
  /// The shelf's bounds, which are the layer's.
  let bounds: CGSize
  /// The `appKey`s of apps whose desktop is away.
  let away: Set<String>
  let zoom: Namespace.ID
  let asked: AppsZoomAsk?
  let reduced: Bool
  let onOpen: (IndexAppRow) -> Void
  let onAbout: (IndexAppRow) -> Void

  /// The page shown.
  @State private var page: Int? = 0

  /// A long name is drawn smaller, down to this share, before it is cut.
  private static let nameShrinks: CGFloat = 0.6

  private var columns: [GridItem] {
    Array(repeating: GridItem(.flexible(), spacing: 0), count: AppsFolderMotion.across)
  }

  var body: some View {
    let panel = AppsFolderMotion.panel(in: bounds)
    let tile = AppsFolderMotion.start(tile: stand.tile, panel: panel)
    // under Reduce Motion nothing travels: the folder stands as its panel, and the whole layer fades
    let progress = reduced ? 1 : stand.progress
    let open = stand.open
    ZStack {
      AppsFolderPlate(tile: tile, panel: panel, progress: progress)
        .fill(ChromePalette.fill)
        .contentShape(AppsFolderPlate(tile: tile, panel: panel, progress: progress))
        // a tap inside the panel, off an app, does nothing
        .onTapGesture {}
        .accessibilityHidden(true)
      if !reduced {
        face(tile: tile, panel: panel, progress: progress, open: open)
      }
      apps(tile: tile, panel: panel, progress: progress, open: open)
      name(tile: tile, panel: panel, progress: progress, open: open)
    }
    .frame(width: bounds.width, height: bounds.height)
    // behind them and out to the screen's edges, as the shelf's paper is
    .background { dim }
    .opacity(reduced && !open ? 0 : 1)
    .simultaneousGesture(pinch)
    .accessibilityElement(children: .contain)
    .accessibilityAddTraits(.isModal)
    .accessibilityAction(.escape) { close() }
    // mounted in its tile with nothing moving yet, it leaves on this turn; so does one placed again while mounted
    .onChange(of: stand.asks, initial: true) {
      withAnimation(AppsFolderMotion.motion(reduced: reduced)) { stand.rise() }
    }
  }

  /// The dim over the shelf. A tap on it, anywhere outside the panel, closes the folder.
  private var dim: some View {
    ChromePalette.searchScrim
      .opacity(AppsFolderMotion.behind(progress: stand.progress).dim)
      .ignoresSafeArea()
      .contentShape(Rectangle())
      .onTapGesture { close() }
      // a folder already on its way home is left to arrive, and the shelf under it takes the touch
      .allowsHitTesting(stand.takesClose)
      .accessibilityElement()
      .accessibilityLabel("Close")
      .accessibilityAddTraits(.isButton)
      .accessibilityAction(.default) { close() }
  }

  /// The tile's face on the growing square. It gives way to the apps as the square leaves its tile.
  private func face(tile: CGRect, panel: CGRect, progress: CGFloat, open: Bool) -> some View {
    AppsFolderFace(folder: folder)
      .opacity(open ? 0 : 1)
      // the fade is this picture's alone; the travel under it stays on the folder's spring
      .animation(AppsFolderMotion.swapFade(opening: open), value: open)
      .frame(width: tile.width, height: tile.height)
      .position(x: tile.midX, y: tile.midY)
      .modifier(AppsFolderCarry(whole: tile, tile: tile, panel: panel, progress: progress))
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }

  /// The open folder's apps: laid out for the panel, riding the square, cut at its edge.
  private func apps(tile: CGRect, panel: CGRect, progress: CGFloat, open: Bool) -> some View {
    pages
      .opacity(reduced || open ? 1 : 0)
      .animation(reduced ? nil : AppsFolderMotion.swapFade(opening: open), value: open)
      .frame(width: panel.width, height: panel.height, alignment: .top)
      .position(x: panel.midX, y: panel.midY)
      .modifier(AppsFolderCarry(whole: panel, tile: tile, panel: panel, progress: progress))
      .clipShape(AppsFolderPlate(tile: tile, panel: panel, progress: progress))
      .allowsHitTesting(stand.takesClose)
  }

  /// The folder's name over the panel. It rides the square with the apps, and comes and goes on the spring.
  private func name(tile: CGRect, panel: CGRect, progress: CGFloat, open: Bool) -> some View {
    let place = AppsFolderMotion.name(over: panel)
    return Text(folder.name)
      .font(ChromeType.sans(AppsFolderMotion.nameSize, .semibold))
      .foregroundStyle(ChromePalette.ink)
      .lineLimit(1)
      .minimumScaleFactor(Self.nameShrinks)
      .frame(width: place.width, height: place.height, alignment: .bottomLeading)
      .opacity(reduced || open ? 1 : 0)
      .position(x: place.midX, y: place.midY)
      .modifier(AppsFolderCarry(whole: panel, tile: tile, panel: panel, progress: progress))
      .allowsHitTesting(false)
      .accessibilityAddTraits(.isHeader)
  }

  /// The panel's apps, nine to a page, over the dots' band. A swipe across lands on a page (the system's paging).
  private var pages: some View {
    let count = AppsFolderMotion.pages(count: folder.apps.count)
    return VStack(spacing: 0) {
      ScrollView(.horizontal) {
        LazyHStack(spacing: 0) {
          ForEach(0..<count, id: \.self) { index in
            grid(AppsFolderMotion.page(index, of: folder.apps))
              .padding(.horizontal, AppsFolderMotion.panelInset)
              .containerRelativeFrame([.horizontal, .vertical], alignment: .top)
          }
        }
        .scrollTargetLayout()
      }
      .scrollTargetBehavior(.paging)
      .scrollPosition(id: $page)
      .scrollIndicators(.hidden)
      // a folder of one page does not move sideways
      .scrollDisabled(count < 2)
      .frame(height: AppsFolderMotion.gridHeight)
      .padding(.top, AppsFolderMotion.panelInset)
      dots(count)
        .frame(height: AppsFolderMotion.dotsBand)
    }
  }

  /// One page: its apps as they stand on the shelf, three across, on the panel's fixed pitch.
  private func grid(_ apps: [IndexAppRow]) -> some View {
    LazyVGrid(columns: columns, spacing: AppsShelfChrome.rowGap) {
      ForEach(apps) { app in
        AppsTile(
          app: app, side: AppsShelfChrome.icon, away: away.contains(app.appKey),
          unopened: door.cues.unopened.contains(app.foldKey), zoom: zoom,
          source: AppsZoomSource.id(appKey: app.appKey, at: .folder(folder.key), asked: asked),
          onOpen: { onOpen(app) }, onAbout: { onAbout(app) }
        )
        .frame(height: AppsFolderMotion.cellHeight, alignment: .top)
      }
    }
  }

  /// The page dots: the page shown in the primary ink, the others in the faint. One page has none.
  private func dots(_ count: Int) -> some View {
    HStack(spacing: AppsFolderMotion.dotGap) {
      ForEach(0..<count, id: \.self) { index in
        Circle()
          .fill(index == (page ?? 0) ? ChromePalette.ink : ChromePalette.inkFaint)
          .frame(width: AppsFolderMotion.dot, height: AppsFolderMotion.dot)
      }
    }
    .opacity(count > 1 ? 1 : 0)
    .accessibilityHidden(true)
  }

  /// A pinch in takes the folder back toward its tile by the fingers. Let go, it closes from where they left it, or
  /// springs whole again.
  private var pinch: some Gesture {
    MagnifyGesture()
      .onChanged { value in stand.pinch(value.magnification) }
      .onEnded { _ in
        let closes = withAnimation(AppsFolderMotion.motion(reduced: reduced)) { stand.letGo() }
        if closes { close() }
      }
  }

  /// The door lets the folder go. The shelf sees that and sends it home on its spring.
  private func close() {
    guard stand.takesClose else { return }
    door.closeFolder()
  }
}
