import FieldDesign
import FieldProduct
import SwiftUI

// MA-6e — what the shelf draws (DESIGN.md §8 "The phone's Apps", MA-D9 A, D10 B, D11 A, D12 A): the shelf, its folders,
// the receded tab, the honest screen an app zooms to before MA-5, and its glass row at rest. How it looks and feels on a
// device is owed (P6); the row's fold on scroll waits for MA-5, which gives it a page to scroll.

/// Where an icon finds its preview. Absent, an icon is its fallback.
struct AppsIconSource: Sendable {
  let previews: AppsPreviews
  let sources: [IndexAppsSource]
}

private struct AppsIconSourceKey: EnvironmentKey {
  static let defaultValue: AppsIconSource? = nil
}

extension EnvironmentValues {
  var appsIconSource: AppsIconSource? {
    get { self[AppsIconSourceKey.self] }
    set { self[AppsIconSourceKey.self] = newValue }
  }
}

private struct AppsPressedKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// Whether a finger is on the tile this view stands in (`AppsPressStyle`).
  var appsPressed: Bool {
    get { self[AppsPressedKey.self] }
    set { self[AppsPressedKey.self] = newValue }
  }
}

/// A tile under a finger (DESIGN.md §8 "The phone's Apps", "Under a finger"; item 419): the press reaches the tile's
/// icon, which darkens as a Home Screen icon does (`AppsPressDim`). Nothing scales, and the name does not change.
struct AppsPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .contentShape(Rectangle())
      .environment(\.appsPressed, configuration.isPressed)
  }
}

/// The dark over what a finger is on: there at once, lifting when the finger goes (`AppsPress`).
struct AppsPressDim<Outline: Shape>: View {
  let outline: Outline

  @Environment(\.appsPressed) private var pressed

  var body: some View {
    outline
      .fill(Color.black.opacity(AppsPress.dim(pressed: pressed)))
      .animation(pressed ? nil : FieldMotion.plainEase(AppsPress.lifts), value: pressed)
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

/// What a long press lifts out of a tile: the icon alone, its squircle at the tile's top centre, never its name
/// (`AppIcon.lift`).
struct AppsIconLift: Shape {
  let side: CGFloat

  func path(in rect: CGRect) -> Path {
    RoundedRectangle(cornerRadius: AppIcon.corner(side: side), style: .continuous)
      .path(in: AppIcon.lift(in: rect, side: side))
  }
}

/// One app on the shelf: its icon with §8's marks, its name under it, and the long press.
struct AppsTile: View {
  let app: IndexAppRow
  let side: CGFloat
  let away: Bool
  let unopened: Bool
  let zoom: Namespace.ID
  /// The key its icon carries for the zoom: the app's own when this is the icon asked (`AppsZoomSource`).
  let source: String
  let onOpen: () -> Void
  /// Keep (true) or Stop keeping (false), through the home (MA-3h, K4).
  let onKeep: (Bool) -> Void
  let onAbout: () -> Void

  var body: some View {
    Button(action: onOpen) {
      VStack(spacing: AppsShelfChrome.nameGap) {
        icon
        Text(app.title)
          .font(ChromeType.sans(AppsShelfChrome.nameSize))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(AppsShelfChrome.nameLines)
          .multilineTextAlignment(.center)
      }
      .frame(maxWidth: .infinity, alignment: .top)
      .opacity(away ? AppIcon.awayOpacity : 1)
    }
    .buttonStyle(AppsPressStyle())
    // the system lifts the icon, as it lifts a Home Screen icon, and leaves the name where it is
    .contentShape(.contextMenuPreview, AppsIconLift(side: side))
    .contextMenu {
      ForEach(AppsTileAct.of(app), id: \.self) { act in
        Button(act.word) { perform(act) }
      }
    }
    .accessibilityLabel(app.title)
  }

  private func perform(_ act: AppsTileAct) {
    switch act {
    case .open: onOpen()
    case .keep: onKeep(true)
    case .stopKeeping: onKeep(false)
    case .about: onAbout()
    }
  }

  private var icon: some View {
    AppIconView(app: app, side: side)
      .overlay(alignment: .topTrailing) {
        if unopened { AppsUnopenedMark() }
      }
      .appsZoomSource(id: source, in: zoom, side: side)
  }
}

/// §8: an app you have not opened wears a 12 cyan dot, 3 outside the squircle, ringed 2 in the paper.
private struct AppsUnopenedMark: View {
  var body: some View {
    Circle()
      .fill(ChromePalette.info)
      .frame(width: AppIcon.dot, height: AppIcon.dot)
      .background {
        Circle()
          .fill(ChromePalette.paper)
          .frame(width: AppIcon.dot + 2 * AppIcon.dotRing, height: AppIcon.dot + 2 * AppIcon.dotRing)
      }
      .offset(x: AppIcon.dotOutside, y: -AppIcon.dotOutside)
      .accessibilityHidden(true)
  }
}

/// Where a folder's tile stands on the shelf, as it was last laid out. A box and not state: the shelf scrolls under
/// it, and nothing is drawn again for that. A tap reads it.
private final class AppsTilePlace {
  var frame: CGRect = .zero
}

/// A project's folder, closed: a square of the inset fill with three icons at 62 and a cluster of the next four at 27
/// (`AppsFolderFace`).
private struct AppsFolderTile: View {
  let folder: AppsShelf.Folder
  /// Its folder is drawn over the shelf: the tile has given it its place, and is not seen.
  let lifted: Bool
  /// Its folder is heading open: its name has gone to stand over the panel.
  let unnamed: Bool
  /// A tap, with the square's place on the shelf: where its folder grows from.
  let onOpen: (CGRect) -> Void

  @State private var place = AppsTilePlace()

  private static let nameGap: CGFloat = 8

  var body: some View {
    Button {
      onOpen(place.frame)
    } label: {
      VStack(spacing: Self.nameGap) {
        tile
          .opacity(lifted ? 0 : 1)
        Text(folder.name)
          .font(ChromeType.sans(AppsShelfChrome.folderName, .semibold))
          // Ruled 2026-11-12: the primary ink. Item 273.
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
          .opacity(unnamed ? 0 : 1)
      }
    }
    .buttonStyle(AppsPressStyle())
    .accessibilityLabel(folder.name)
  }

  private var tile: some View {
    let square = RoundedRectangle(cornerRadius: AppsShelfChrome.folderRadius, style: .continuous)
    return AppsFolderFace(folder: folder)
      // under a finger the square darkens as one, never icon by icon
      .environment(\.appsPressed, false)
      .background { square.fill(ChromePalette.fill) }
      .overlay { AppsPressDim(outline: square) }
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(AppsFolderMotion.space)) } action: {
        place.frame = $0
      }
  }
}

/// The shelf: App Library's grammar at the bar's measure, on paper.
struct AppsShelfView: View {
  let reading: AppsFeed.Reading
  let door: AppsDoorModel
  let here: String
  let zoom: Namespace.ID
  let onOpen: (IndexAppRow) -> Void
  /// Keeps an app or stops keeping it through the home; what to say when the home did not take it (MA-3h, K4).
  let onKeep: @MainActor (IndexAppRow, Bool) async -> String?
  let onAbout: (IndexAppRow) -> Void

  @State private var words = ""
  /// The icon the last open was asked from: the one its screen zooms out of, and back into.
  @State private var asked: AppsZoomAsk?
  /// The folder drawn over the shelf, and where it is heading (item 419). The door's model says which is open.
  @State private var stand = AppsFolderStand()
  /// The shelf's own size, the pages' bounds: what an open folder's panel is placed in.
  @State private var bounds: CGSize = .zero
  /// What the last keep the home did not take says, until the next keep.
  @State private var keepWords: String?
  @FocusState private var searching: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private static let groupGap: CGFloat = 28
  private static let headGap: CGFloat = 14
  private static let footSize: CGFloat = 13
  private static let lineSize: CGFloat = 15

  private var shelf: AppsShelf {
    AppsShelf(
      reading: .init(apps: reading.apps, sources: reading.sources, clipped: reading.clipped),
      projects: reading.projects, opened: door.cues.opened, here: here)
  }

  private var tileColumns: [GridItem] {
    Array(repeating: GridItem(.flexible(), spacing: 0), count: AppsShelfChrome.across)
  }

  private var folderColumns: [GridItem] {
    Array(
      repeating: GridItem(.flexible(), spacing: AppsShelfChrome.folderColumnGap),
      count: AppsShelfChrome.foldersAcross)
  }

  var body: some View {
    let shelf = self.shelf
    let folder = shelf.folders.first { $0.key == stand.drawn }
    // a folder heading open has the screen: the shelf under it takes no touch until the folder is let go
    let held = folder != nil && stand.takesClose
    behind(list(shelf), held: held, drawn: folder != nil)
      .overlay { folderLayer(folder, shelf: shelf) }
      .onChange(of: door.folder, initial: true) { _, key in
        if let key {
          // opened by the model's word alone, with no tile's place: it grows out of the panel's own middle
          if !stand.hides(key) { stand.place(key, tile: .zero) }
        } else {
          folderLeaves()
        }
      }
      .onChange(of: folder?.key) { _, key in
        // its project left the shelf while its folder was drawn over it
        if key == nil, stand.drawn != nil {
          stand.gone()
          door.closeFolder()
        }
      }
  }

  /// The shelf's own list.
  private func list(_ shelf: AppsShelf) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: Self.groupGap) {
        field
        if let keepWords {
          Text(keepWords)
            .font(ChromeType.sans(Self.footSize))
            .foregroundStyle(ChromePalette.inkSecondary)
        }
        let matched = AppsShelf.matching(words, in: reading.apps)
        if !words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          grid(matched, shelf: shelf, place: .matched)
        } else if reading.apps.isEmpty {
          emptyWords(shelf: shelf)
        } else {
          groups(shelf)
          foot(shelf)
        }
      }
      .padding(.horizontal, AppsShelfChrome.side)
      .padding(.top, AppsShelfChrome.topInset)
      .padding(.bottom, AppsShelfChrome.cardShowing + Self.groupGap)
    }
    .scrollIndicators(.hidden)
  }

  /// The list as it stands behind a folder (item 419): blurred, and drawn a little toward you about the folder's tile,
  /// on the folder's own spring. While a folder is drawn it does not scroll, so the tile keeps the place it gave. The
  /// paper is under it and does not move. The shelf's space and its size are named here, for the tiles and the panel.
  private func behind(_ list: some View, held: Bool, drawn: Bool) -> some View {
    let back = AppsFolderMotion.behind(progress: drawn ? stand.progress : 0)
    return list
      .scrollDisabled(drawn)
      .allowsHitTesting(!held)
      .accessibilityHidden(held)
      .blur(radius: back.blur)
      .modifier(
        AppsShelfBehind(
          scale: reduceMotion ? 1 : back.scale, about: CGPoint(x: stand.tile.midX, y: stand.tile.midY)
        ).ignoredByLayout()
      )
      .background(ChromePalette.paper.ignoresSafeArea())
      .coordinateSpace(name: AppsFolderMotion.space)
      .onGeometryChange(for: CGSize.self) { $0.size } action: { bounds = $0 }
  }

  /// The folder drawn over the shelf, mounted where its tile stands.
  @ViewBuilder
  private func folderLayer(_ folder: AppsShelf.Folder?, shelf: AppsShelf) -> some View {
    if let folder, bounds != .zero {
      AppsFolderLayer(
        folder: folder, stand: $stand, door: door, bounds: bounds, away: shelf.away, zoom: zoom, asked: asked,
        reduced: reduceMotion, onOpen: { open($0, at: .folder(folder.key)) },
        onKeep: { keep($0, kept: $1) }, onAbout: onAbout
      )
      .id(folder.key)
    }
  }

  /// A folder's tile was tapped: its folder is drawn where the tile stands, and the layer sends it open from there.
  /// A folder still on its way home is not placed again: it turns back open from where it is.
  private func openFolder(_ folder: AppsShelf.Folder, from tile: CGRect) {
    searching = false
    if stand.hides(folder.key) {
      withAnimation(AppsFolderMotion.motion(reduced: reduceMotion)) { stand.rise() }
    } else {
      stand.place(folder.key, tile: tile)
    }
    door.openFolder(folder.key)
  }

  /// The door let the folder go (a tap outside it, a pinch, the card): it goes back into its tile on its spring, and
  /// is drawn until it is there.
  private func folderLeaves() {
    guard stand.drawn != nil else { return }
    let ask = stand.asks
    withAnimation(AppsFolderMotion.motion(reduced: reduceMotion)) {
      stand.leave()
    } completion: {
      stand.settled(ask: ask)
    }
  }

  private var field: some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass")
        .foregroundStyle(ChromePalette.inkSecondary)
        .accessibilityHidden(true)
      TextField("Search apps", text: $words)
        .font(ChromeType.sans(Self.lineSize))
        .foregroundStyle(ChromePalette.ink)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .focused($searching)
    }
    .padding(.horizontal, 16)
    .frame(height: AppsShelfChrome.searchHeight)
    .liquidGlassCapsule(interactive: false)
  }

  @ViewBuilder
  private func groups(_ shelf: AppsShelf) -> some View {
    ForEach(shelf.readingLines, id: \.self) { line in
      Text(line)
        .font(ChromeType.sans(Self.footSize))
        .foregroundStyle(ChromePalette.inkSecondary)
    }
    group("Recent", count: shelf.recent.count, shelf.recent, shelf: shelf, place: .recent)
    if !shelf.kept.isEmpty {
      group("Kept", count: shelf.kept.count, shelf.kept, shelf: shelf, place: .kept)
    }
    if !shelf.folders.isEmpty {
      VStack(alignment: .leading, spacing: Self.headGap) {
        head("Projects", count: shelf.folders.count)
        folders(shelf)
      }
    }
    if !shelf.noProject.isEmpty {
      group(
        AppsShelf.noProjectHead, count: shelf.noProject.count, shelf.noProject, shelf: shelf, place: .noProject)
    }
  }

  private func group(
    _ name: String, count: Int, _ apps: [IndexAppRow], shelf: AppsShelf, place: AppsPlace
  ) -> some View {
    VStack(alignment: .leading, spacing: Self.headGap) {
      head(name, count: count)
      grid(apps, shelf: shelf, place: place)
    }
  }

  private func head(_ name: String, count: Int) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Text(name)
        .font(ChromeType.sans(AppsShelfChrome.headSize, .semibold))
        .foregroundStyle(ChromePalette.ink)
        .accessibilityAddTraits(.isHeader)
      Text("\(count)")
        .font(ChromeType.sans(AppsShelfChrome.headCount))
        .foregroundStyle(ChromePalette.inkTertiary)
    }
  }

  private func grid(_ apps: [IndexAppRow], shelf: AppsShelf, place: AppsPlace) -> some View {
    LazyVGrid(columns: tileColumns, spacing: AppsShelfChrome.rowGap) {
      ForEach(apps) { app in
        AppsTile(
          app: app, side: AppsShelfChrome.icon, away: shelf.away.contains(app.appKey),
          unopened: door.cues.unopened.contains(app.foldKey), zoom: zoom,
          source: AppsZoomSource.id(appKey: app.appKey, at: place, asked: asked),
          onOpen: { open(app, at: place) }, onKeep: { keep(app, kept: $0) },
          onAbout: { onAbout(app) })
      }
    }
  }

  /// An app is opened from the icon at `place`. That icon takes the app's key first, so the screen zooms out of it
  /// and comes back into it, and not into the same app's icon in another group.
  private func open(_ app: IndexAppRow, at place: AppsPlace) {
    asked = AppsZoomAsk(place: place, appKey: app.appKey)
    onOpen(app)
  }

  /// One mark, once; its words stand until the next keep.
  private func keep(_ app: IndexAppRow, kept: Bool) {
    keepWords = nil
    Task { keepWords = await onKeep(app, kept) }
  }

  /// The Projects group: each project's folder as a tile. An open folder is drawn over the shelf (`AppsFolderLayer`)
  /// and its tile gives it its place, so the group never changes under it. *(Until item 419 a folder opened in
  /// place: it took this group, and its head closed it.)* Under Reduce Motion nothing travels, so the tile stays.
  private func folders(_ shelf: AppsShelf) -> some View {
    LazyVGrid(columns: folderColumns, spacing: AppsShelfChrome.folderRowGap) {
      ForEach(shelf.folders) { folder in
        let drawn = !reduceMotion && stand.hides(folder.key)
        AppsFolderTile(
          folder: folder, lifted: drawn, unnamed: drawn && stand.open,
          onOpen: { openFolder(folder, from: $0) })
      }
    }
  }

  private func foot(_ shelf: AppsShelf) -> some View {
    VStack(spacing: 4) {
      Text(shelf.foot)
      if shelf.clipped { Text(AppsShelf.clippedLine) }
    }
    .font(ChromeType.sans(Self.footSize))
    .foregroundStyle(ChromePalette.inkTertiary)
    .multilineTextAlignment(.center)
    .frame(maxWidth: .infinity)
  }

  /// Never a blank: what the shelf says when it has no apps to stand.
  @ViewBuilder
  private func emptyWords(shelf: AppsShelf) -> some View {
    VStack(spacing: 6) {
      if let line = AppsShelf.emptyLine(phase: reading.phase, here: here) {
        Text(line)
      }
      ForEach(shelf.readingLines, id: \.self) { Text($0) }
    }
    .font(ChromeType.sans(Self.lineSize))
    .foregroundStyle(ChromePalette.inkSecondary)
    .multilineTextAlignment(.center)
    .frame(maxWidth: .infinity)
    .padding(.top, Self.groupGap)
  }
}

/// The card's outline (DESIGN.md §8 "The phone's Apps"). The pages' bounds are the safe area, and the field draws
/// past them to the screen's edges (PG-4t). At rest the outline reaches `reach` past the bounds on every side and cuts
/// nothing. As a card it is the whole screen: from the screen's top, `top` above the bounds, its top corners rounded.
/// *(Corrected 2026-11-12, item 348: open, this cut the pages at their bounds, the safe area's top. The card is the
/// screen itself now, so its top is the screen's.)*
struct AppsCardShape: Shape {
  /// Past the bounds while whole: more than any safe-area inset (62 and 34 on an iPhone 17 Pro).
  static let reach: CGFloat = 200

  var radius: CGFloat
  /// The screen's top above the bounds: the safe area's top inset.
  let top: CGFloat
  /// Whole: nothing is cut.
  let whole: Bool

  init(card: AppsPull.Card, safeTop: CGFloat) {
    radius = card.radius
    top = max(0, safeTop)
    whole = card == .rest
  }

  var animatableData: CGFloat {
    get { radius }
    set { radius = newValue }
  }

  func path(in rect: CGRect) -> Path {
    let reach = Self.reach
    let reached =
      whole
      ? rect.insetBy(dx: -reach, dy: -reach)
      : CGRect(x: rect.minX, y: rect.minY - top, width: rect.width, height: rect.height + top + reach)
    return UnevenRoundedRectangle(topLeadingRadius: radius, topTrailingRadius: radius, style: .continuous)
      .path(in: reached)
  }
}

/// Where the card is drawn: smaller about the screen's top centre, and lower. For drawing only (`ignoredByLayout`):
/// the pages keep the screen's own safe area and their own layout while the card moves, so the card and what is in it
/// are one picture. A transform the layout reads (`offset`, `scaleEffect`) moves the pages out of the status bar's
/// inset and lays them out again inside the card, at every step of the finger (item 348's screenshot, 2026-11-12).
struct AppsCardPlace: GeometryEffect {
  var scale: CGFloat
  var offset: CGFloat
  let top: CGFloat

  var animatableData: AnimatablePair<CGFloat, CGFloat> {
    get { AnimatablePair(scale, offset) }
    set {
      scale = newValue.first
      offset = newValue.second
    }
  }

  func effectValue(size: CGSize) -> ProjectionTransform {
    let place = CGAffineTransform(translationX: size.width / 2, y: offset - top)
      .scaledBy(x: scale, y: scale)
      .translatedBy(x: -size.width / 2, y: top)
    return ProjectionTransform(place)
  }
}

extension AppsShelfChrome {
  /// The card's lift off the shelf, cast up and about it: `0 -6px 64px`, black at 30% by day and 60% by night.
  static let cardShadow = ChromeShadow(color: cardShade(day: 0.30, night: 0.60), radius: 32, y: -6)
  /// Its contact with the shelf, close about its edge: `0 -1px 10px`, black at 16% by day and 45% by night.
  static let cardContact = ChromeShadow(color: cardShade(day: 0.16, night: 0.45), radius: 5, y: -1)
  /// Its edge, a hairline in the ink at 10%, so a white page reads as a card on the white shelf.
  static let cardEdgeOpacity: Double = 0.10
  static let cardEdge: CGFloat = 1
  /// Under the grabber's ink, the paper at 55%: the grabber shows on a dark page (Chat's night) as on a light one.
  static let grabberUnder: Double = 0.55

  private static func cardShade(day: CGFloat, night: CGFloat) -> Color {
    Color(UIColor { traits in UIColor(white: 0, alpha: traits.userInterfaceStyle == .dark ? night : day) })
  }
}

/// The one card the three tabs and their bar stand in (item 348). At rest it is the whole screen. Pulled, it follows
/// the finger down while it shrinks and rounds toward the card at the foot, under its shadow. Open, it is that card,
/// 106 of it showing: pushing it up, or tapping it, goes back (with a folder open on the shelf, it closes the folder
/// first: item 419). It reads the door's model in its own body, so a pull redraws the card and not the home screen.
struct AppsCard: ViewModifier {
  let door: AppsDoorModel
  /// The pages' height, the safe area's.
  let bounds: CGFloat
  let safeTop: CGFloat
  let onBack: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private static let grabberTop: CGFloat = 8
  /// How far up a push has to go.
  private static let back: CGFloat = 12

  func body(content: Content) -> some View {
    let open = door.shelfOpen
    let card = AppsPull.Card.standing(
      open: open, peeking: door.peeking, drag: door.drag, bounds: bounds, safeTop: safeTop)
    let shape = AppsCardShape(card: card, safeTop: safeTop)
    let lift = AppsShelfChrome.cardShadow
    let contact = AppsShelfChrome.cardContact
    content
      // at rest it cuts nothing: the field stays full-bleed under the status bar and the home indicator
      .clipShape(shape)
      .background {
        if card.shade > 0 {
          // the pages' own ground, so the field's dissolve under the Stories row shows what it shows at rest
          shape
            .fill(FieldPalette.panelBackground)
            .shadow(color: contact.color, radius: contact.radius, y: contact.y)
            .shadow(color: lift.color, radius: lift.radius, y: lift.y)
            .opacity(card.shade)
        }
      }
      .overlay {
        if card.shade > 0 {
          shape
            .stroke(ChromePalette.ink.opacity(AppsShelfChrome.cardEdgeOpacity), lineWidth: AppsShelfChrome.cardEdge)
            .opacity(card.shade)
            .allowsHitTesting(false)
        }
      }
      .overlay { folderDim(shape, shade: card.shade) }
      .allowsHitTesting(!open)
      .overlay(alignment: .top) {
        if card.shade > 0 {
          Capsule()
            .fill(ChromePalette.ink.opacity(AppsShelfChrome.grabberOpacity))
            .background(Capsule().fill(ChromePalette.paper.opacity(AppsShelfChrome.grabberUnder)))
            .frame(width: AppsShelfChrome.grabberWidth, height: AppsShelfChrome.grabberHeight)
            // from the card's top, which is the screen's
            .offset(y: Self.grabberTop - max(0, safeTop))
            .opacity(card.shade)
            .accessibilityHidden(true)
        }
      }
      .modifier(AppsCardPlace(scale: card.scale, offset: card.offset, top: max(0, safeTop)).ignoredByLayout())
      // the card is drawn at the foot and laid out where it was, so what takes its touches stands here, at the foot
      .overlay(alignment: .bottom) {
        if open {
          Color.clear
            .frame(height: AppsShelfChrome.cardShowing)
            .contentShape(Rectangle())
            .ignoresSafeArea(.container, edges: .bottom)
            .onTapGesture { goBack() }
            .gesture(
              DragGesture(minimumDistance: Self.back).onEnded { value in
                if value.translation.height <= -Self.back { goBack() }
              }
            )
            .accessibilityElement()
            .accessibilityLabel("Back")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(.default) { goBack() }
        }
      }
      .animation(reduceMotion ? nil : AppBar.motion, value: open)
      .animation(reduceMotion ? nil : AppBar.motion, value: door.peeking)
  }

  /// A push up or a tap on the card. With a folder open on the shelf it closes the folder first, as the Home gesture
  /// does on the Home Screen, and the next one goes back to the tab (item 419).
  private func goBack() {
    if door.folder == nil { onBack() } else { door.closeFolder() }
  }

  /// Behind an open folder the card takes the shelf's dim (item 419), on the folder's spring, and no blur: its pages
  /// are live.
  @ViewBuilder
  private func folderDim(_ shape: AppsCardShape, shade: Double) -> some View {
    if shade > 0 {
      let folder = door.folder != nil
      shape
        .fill(ChromePalette.searchScrim)
        .opacity(folder ? shade : 0)
        .animation(AppsFolderMotion.motion(reduced: reduceMotion), value: folder)
        .allowsHitTesting(false)
    }
  }
}

/// What an app zooms to before MA-5: its icon at 92 over its state's words, its one act, and the glass row at rest.
struct AppsAppScreen: View {
  let app: IndexAppRow
  let honest: AppsHonest
  let about: AppsAbout
  let desktop: String
  let onClose: () -> Void

  @Environment(\.openURL) private var openURL
  @State private var showsAbout = false

  private static let titleSize: CGFloat = 20
  private static let detailSize: CGFloat = 15
  private static let actSize: CGFloat = 16
  private static let gap: CGFloat = 14

  var body: some View {
    ZStack(alignment: .bottom) {
      ChromePalette.paper.ignoresSafeArea()
      state
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, AppsGlassRow.side)
      row
        .padding(.horizontal, AppsGlassRow.side)
        .padding(.bottom, AppsGlassRow.side)
    }
    .ignoresSafeArea(.container, edges: .bottom)
    .sheet(isPresented: $showsAbout) {
      AppsAboutSheet(about: about)
        .presentationDetents([.medium])
    }
  }

  private var state: some View {
    VStack(spacing: Self.gap) {
      AppIconView(app: app, side: AppIcon.honestSide)
      Text(honest.title)
        .font(ChromeType.sans(Self.titleSize, .semibold))
        .foregroundStyle(ChromePalette.ink)
        .multilineTextAlignment(.center)
      if let detail = honest.detail {
        Text(detail)
          .font(ChromeType.sans(Self.detailSize))
          .foregroundStyle(ChromePalette.inkSecondary)
          .multilineTextAlignment(.center)
      }
      if let act = honest.act {
        Button(act.word) { open(act) }
          .font(ChromeType.sans(Self.actSize, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .buttonStyle(.plain)
      }
    }
  }

  private var row: some View {
    HStack(spacing: AppsGlassRow.capsuleGap) {
      Button(action: onClose) {
        Image(systemName: "xmark")
          .foregroundStyle(ChromePalette.ink)
          .frame(width: AppsGlassRow.circle, height: AppsGlassRow.circle)
      }
      .buttonStyle(.plain)
      .liquidGlassCircle()
      .accessibilityLabel("Close")

      capsule

      Menu {
        Button("About this app") { showsAbout = true }
        if let act = honest.act {
          Button(act.word) { open(act) }
        }
      } label: {
        Image(systemName: "ellipsis")
          .foregroundStyle(ChromePalette.ink)
          .frame(width: AppsGlassRow.circle, height: AppsGlassRow.circle)
      }
      .liquidGlassCircle()
      .accessibilityLabel("More")
    }
    .frame(height: AppsGlassRow.height)
  }

  private var capsule: some View {
    HStack(spacing: 8) {
      AppIconView(app: app, side: AppsGlassRow.capsuleIcon)
      VStack(alignment: .leading, spacing: 1) {
        Text(app.title)
          .font(ChromeType.sans(AppsGlassRow.nameSize, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
        HStack(spacing: 4) {
          // The row carries no platform yet: "a plain screen, never a guess" (DeviceMark).
          DeviceMark(os: .unknown, size: AppsGlassRow.osMark)
          Text(desktop)
            .font(ChromeType.sans(AppsGlassRow.desktopSize))
            .lineLimit(1)
        }
        .foregroundStyle(ChromePalette.inkTertiary)
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 12)
    .frame(maxWidth: .infinity)
    .frame(height: AppsGlassRow.height)
    .liquidGlassCapsule(interactive: false)
  }

  private func open(_ act: AppsHonest.Act) {
    guard let url = URL(string: act.url) else { return }
    openURL(url)
  }
}

/// About this app (§9). Its link to the session in History arrives with MA-5's open.
struct AppsAboutSheet: View {
  let about: AppsAbout

  private static let titleSize: CGFloat = 20
  private static let lineSize: CGFloat = 15

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(about.title)
        .font(ChromeType.sans(Self.titleSize, .semibold))
        .foregroundStyle(ChromePalette.ink)
      Group {
        if let madeBy = about.madeBy { Text(madeBy) }
        if let project = about.project { Text(project) }
        Text(about.desktop)
        Text(Date(timeIntervalSince1970: TimeInterval(about.at) / 1000), format: .dateTime.day().month().year())
        if let noPreview = about.noPreview { Text(noPreview) }
      }
      .font(ChromeType.sans(Self.lineSize))
      .foregroundStyle(ChromePalette.inkSecondary)
      Spacer(minLength: 0)
    }
    .padding(AppsGlassRow.side)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(ChromePalette.paper.ignoresSafeArea())
  }
}

extension View {
  /// The icon an app's screen zooms out of, and back into (item 419): the squircle itself, at its own corner, so the
  /// screen leaves and returns in the icon's shape and not as a square over it. Every source of the zoom is named
  /// here, in one place.
  func appsZoomSource(id: String, in zoom: Namespace.ID, side: CGFloat) -> some View {
    matchedTransitionSource(id: id, in: zoom) { source in
      source.clipShape(RoundedRectangle(cornerRadius: AppIcon.corner(side: side), style: .continuous))
    }
  }

  /// The app's screen zooms out of the row's icon; under Reduce Motion the system's own presentation stands (M6's fade
  /// is the cover's own, and `AppsGlassRow.reducedFade` is its measure).
  @ViewBuilder
  func appsZoomDestination(sourceID: String, in zoom: Namespace.ID, reduced: Bool) -> some View {
    if reduced {
      self
    } else {
      navigationTransition(.zoom(sourceID: sourceID, in: zoom))
    }
  }
}
