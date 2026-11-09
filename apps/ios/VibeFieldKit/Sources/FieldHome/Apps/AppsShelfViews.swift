import FieldDesign
import FieldProduct
import SwiftUI

// MA-6e — what the shelf draws (DESIGN.md §8 "The phone's Apps", MA-D9 A, D10 B, D11 A, D12 A): the shelf, its folders,
// the receded tab, the honest screen an app zooms to before MA-5, and its glass row at rest. How it looks and feels on a
// device is owed to James (P6); the row's fold on scroll waits for MA-5, which gives it a page to scroll.

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

/// One app on the shelf: its icon with §8's marks, its name under it, and the long press.
struct AppsTile: View {
  let app: IndexAppRow
  let side: CGFloat
  let away: Bool
  let unopened: Bool
  let zoom: Namespace.ID
  let onOpen: () -> Void
  let onAbout: () -> Void

  private static let nameGap: CGFloat = 5

  var body: some View {
    Button(action: onOpen) {
      VStack(spacing: Self.nameGap) {
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
    .buttonStyle(.plain)
    .contextMenu {
      Button("Open", action: onOpen)
      Button("About this app", action: onAbout)
    }
    .accessibilityLabel(app.title)
  }

  private var icon: some View {
    AppIconView(app: app, side: side)
      .overlay(alignment: .topTrailing) {
        if unopened { AppsUnopenedMark() }
      }
      .matchedTransitionSource(id: app.appKey, in: zoom)
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

/// A project's folder, closed: a square of the inset fill with three icons at 62 and a cluster of the next four at 27.
private struct AppsFolderTile: View {
  let folder: AppsShelf.Folder
  let onOpen: () -> Void

  private static let nameGap: CGFloat = 8

  var body: some View {
    Button(action: onOpen) {
      VStack(spacing: Self.nameGap) {
        tile
        Text(folder.name)
          .font(ChromeType.sans(AppsShelfChrome.folderName, .semibold))
          .foregroundStyle(ChromePalette.ink)  // ‹for James›: §8 asks whether a name may wear its project's ink
          .lineLimit(1)
      }
    }
    .buttonStyle(.plain)
    .accessibilityLabel(folder.name)
  }

  private var tile: some View {
    let big = folder.big
    return VStack {
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
    .background {
      RoundedRectangle(cornerRadius: AppsShelfChrome.folderRadius, style: .continuous)
        .fill(ChromePalette.fill)
    }
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

/// The shelf: App Library's grammar at the bar's measure, on paper.
struct AppsShelfView: View {
  let reading: AppsFeed.Reading
  let door: AppsDoorModel
  let here: String
  let zoom: Namespace.ID
  let safeTop: CGFloat
  let onOpen: (IndexAppRow) -> Void
  let onAbout: (IndexAppRow) -> Void

  @State private var words = ""

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
    ScrollView {
      VStack(alignment: .leading, spacing: Self.groupGap) {
        field
        let matched = AppsShelf.matching(words, in: reading.apps)
        if !words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          grid(matched, shelf: shelf)
        } else if reading.apps.isEmpty {
          emptyWords(shelf: shelf)
        } else {
          groups(shelf)
          foot(shelf)
        }
      }
      .padding(.horizontal, AppsShelfChrome.side)
      .padding(.top, safeTop + Self.headGap)
      .padding(.bottom, AppsShelfChrome.cardShowing + Self.groupGap)
    }
    .scrollIndicators(.hidden)
    .background(ChromePalette.paper.ignoresSafeArea())
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
    group("Recent", count: shelf.recent.count, shelf.recent, shelf: shelf)
    if !shelf.kept.isEmpty {
      group("Kept", count: shelf.kept.count, shelf.kept, shelf: shelf)
    }
    if !shelf.folders.isEmpty {
      VStack(alignment: .leading, spacing: Self.headGap) {
        head("Projects", count: shelf.folders.count)
        folders(shelf)
      }
    }
    if !shelf.noProject.isEmpty {
      group(AppsShelf.noProjectHead, count: shelf.noProject.count, shelf.noProject, shelf: shelf)
    }
  }

  private func group(_ name: String, count: Int, _ apps: [IndexAppRow], shelf: AppsShelf) -> some View {
    VStack(alignment: .leading, spacing: Self.headGap) {
      head(name, count: count)
      grid(apps, shelf: shelf)
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

  private func grid(_ apps: [IndexAppRow], shelf: AppsShelf) -> some View {
    LazyVGrid(columns: tileColumns, spacing: AppsShelfChrome.rowGap) {
      ForEach(apps) { app in
        AppsTile(
          app: app, side: AppsShelfChrome.icon, away: shelf.away.contains(app.appKey),
          unopened: door.cues.unopened.contains(app.foldKey), zoom: zoom,
          onOpen: { onOpen(app) }, onAbout: { onAbout(app) })
      }
    }
  }

  /// A folder opens in place: it takes the Projects group, and its head closes it.
  @ViewBuilder
  private func folders(_ shelf: AppsShelf) -> some View {
    if let open = shelf.folders.first(where: { $0.key == door.folder }) {
      VStack(alignment: .leading, spacing: Self.headGap) {
        Button {
          door.closeFolder()
        } label: {
          HStack(spacing: 6) {
            Image(systemName: "chevron.down")
              .accessibilityHidden(true)
            Text(open.name)
              .font(ChromeType.sans(AppsShelfChrome.folderName, .semibold))
          }
          .foregroundStyle(ChromePalette.ink)
        }
        .buttonStyle(.plain)
        grid(open.apps, shelf: shelf)
      }
    } else {
      LazyVGrid(columns: folderColumns, spacing: AppsShelfChrome.folderRowGap) {
        ForEach(shelf.folders) { folder in
          AppsFolderTile(folder: folder, onOpen: { door.openFolder(folder.key) })
        }
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

/// The tab receded to a card at the foot, 106 of it showing. Pushing it up, or tapping it, goes back.
struct AppsRecededCard: ViewModifier {
  let open: Bool
  let screen: CGFloat
  let onBack: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private static let grabberTop: CGFloat = 8
  /// How far up a push has to go.
  private static let back: CGFloat = 12

  func body(content: Content) -> some View {
    content
      .clipShape(
        UnevenRoundedRectangle(
          topLeadingRadius: open ? AppsShelfChrome.cardRadius : 0,
          topTrailingRadius: open ? AppsShelfChrome.cardRadius : 0,
          style: .continuous)
      )
      .allowsHitTesting(!open)
      .overlay(alignment: .top) {
        if open {
          Capsule()
            .fill(ChromePalette.ink.opacity(AppsShelfChrome.grabberOpacity))
            .frame(width: AppsShelfChrome.grabberWidth, height: AppsShelfChrome.grabberHeight)
            .padding(.top, Self.grabberTop)
            .accessibilityHidden(true)
        }
      }
      .overlay {
        if open {
          Color.clear
            .contentShape(Rectangle())
            .onTapGesture(perform: onBack)
            .gesture(
              DragGesture(minimumDistance: Self.back).onEnded { value in
                if value.translation.height <= -Self.back { onBack() }
              }
            )
            .accessibilityElement()
            .accessibilityLabel("Back")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(.default, onBack)
        }
      }
      .scaleEffect(open ? AppsShelfChrome.cardScale : 1, anchor: .top)
      .offset(y: open ? AppsShelfChrome.cardOffset(screen: screen) : 0)
      .animation(reduceMotion ? nil : AppBar.motion, value: open)
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
private struct AppsAboutSheet: View {
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
