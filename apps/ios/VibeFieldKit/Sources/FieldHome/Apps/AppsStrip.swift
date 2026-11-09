import FieldDesign
import FieldProduct
import SwiftUI

// MA-6c — what MA-D7's two slots hold (DESIGN.md §8 "The phone's Apps", as amended by SE-D3): the strip above the switch
// before any word, and the group first in Everything once a word is typed. An icon is its fallback until 6e's previews.

/// The strip: **Apps**, the Recent row and **All apps**. Absent at zero apps (VF-PM's Q7).
struct AppsStripContent: Equatable {
  let head: String
  let all: String
  let recent: [IndexAppRow]
  /// The `appKey`s of apps whose desktop is away: listed and greyed.
  let away: Set<String>

  static func of(reading: AppsFeed.Reading, opened: [String], here: String) -> AppsStripContent? {
    guard !reading.apps.isEmpty else { return nil }
    let shelf = AppsShelf(
      reading: .init(apps: reading.apps, sources: reading.sources, clipped: reading.clipped),
      projects: reading.projects, opened: opened, here: here)
    return AppsStripContent(head: "Apps", all: "All apps", recent: shelf.recent, away: shelf.away)
  }
}

/// Everything's **Apps** group: the titles that hold the typed words.
struct AppsSearchGroup: Equatable {
  struct Row: Equatable, Identifiable {
    let app: IndexAppRow
    let desktop: String
    let away: Bool

    var id: String { app.appKey }
  }

  let head: String
  let rows: [Row]

  /// Absent with no matches, and while the door's answer is to other words than the ones typed.
  static func of(reading: AppsFeed.Reading, words: String, here: String) -> AppsSearchGroup? {
    guard !reading.matches.isEmpty, reading.matchWords == words else { return nil }
    let rows = reading.matches.map { app -> Row in
      let source = MadeAppFacts.source(of: app, in: reading.sources)
      return Row(app: app, desktop: MadeAppFacts.desktop(source, here: here), away: MadeAppFacts.away(source))
    }
    return AppsSearchGroup(head: "Apps", rows: rows)
  }
}

/// An app's icon: §2.9's fallback squircle, its project's ink and its title's initial. No glyph (§13).
struct AppIconView: View {
  let app: IndexAppRow
  let side: CGFloat

  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let paint = AppIcon.paint(ink: app.ink.map { Int($0) }, dark: scheme == .dark)
    RoundedRectangle(cornerRadius: AppIcon.corner(side: side), style: .continuous)
      .fill(Self.ground(paint.ground))
      .overlay {
        Text(MadeAppFacts.initial(title: app.title, filename: app.filename))
          .font(ChromeType.sans(AppIcon.initialSize(side: side), .semibold))
          .foregroundStyle(Self.letter(paint.letter))
      }
      .frame(width: side, height: side)
      .accessibilityHidden(true)
  }

  private static func ground(_ ground: AppIcon.Ground) -> Color {
    switch ground {
    case .ink(let ink): Color(red: ink.r, green: ink.g, blue: ink.b)
    case .darkTile: ChromePalette.appFallbackTile
    case .fill: ChromePalette.fill
    }
  }

  private static func letter(_ letter: AppIcon.Letter) -> Color {
    switch letter {
    case .white: .white
    case .ink(let ink): Color(red: ink.r, green: ink.g, blue: ink.b)
    case .primary: ChromePalette.ink
    }
  }
}

/// The strip above the switch: the page's section head over Recent's four across.
struct AppsStripView: View {
  let content: AppsStripContent
  let onOpen: (IndexAppRow) -> Void
  let onAll: () -> Void

  /// The page's `.more` and its grid's column gap.
  private static let allSize: CGFloat = 15
  private static let columnGap: CGFloat = 6
  /// The name's distance under its icon: the page's `.nm`.
  private static let nameGap: CGFloat = 5

  var body: some View {
    VStack(alignment: .leading, spacing: AppsShelfChrome.rowGap) {
      HStack(alignment: .firstTextBaseline) {
        Text(content.head)
          .font(ChromeType.sans(AppsShelfChrome.headSize, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .accessibilityAddTraits(.isHeader)
        Spacer(minLength: 0)
        Button(content.all, action: onAll)
          .font(ChromeType.sans(Self.allSize, .semibold))
          .foregroundStyle(ChromePalette.inkSecondary)
          .buttonStyle(.plain)
      }
      HStack(alignment: .top, spacing: Self.columnGap) {
        ForEach(content.recent) { app in
          tile(app)
        }
        ForEach(0..<max(0, AppsShelfChrome.across - content.recent.count), id: \.self) { _ in
          Color.clear.frame(maxWidth: .infinity, maxHeight: 0)
        }
      }
    }
    .padding(.horizontal, SearchSheet.headInset)
    .padding(.top, SearchSheet.headInset)
  }

  private func tile(_ app: IndexAppRow) -> some View {
    Button {
      onOpen(app)
    } label: {
      VStack(spacing: Self.nameGap) {
        AppIconView(app: app, side: AppsShelfChrome.icon)
          .opacity(content.away.contains(app.appKey) ? AppIcon.awayOpacity : 1)
        Text(app.title)
          .font(ChromeType.sans(AppsShelfChrome.nameSize, .semibold))
          .foregroundStyle(ChromePalette.inkSecondary)
          .multilineTextAlignment(.center)
          .lineLimit(AppsShelfChrome.nameLines)
      }
      .frame(maxWidth: .infinity)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(app.title)
  }
}

/// Everything's **Apps** group, first among its results, in the sheet's own rows.
struct AppsSearchGroupView: View {
  let group: AppsSearchGroup
  let terms: [String]
  let onOpen: (IndexAppRow) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: SearchSheet.rowGap) {
      Text(group.head)
        .font(ChromeType.sans(13, .semibold))
        .foregroundStyle(ChromePalette.inkSecondary)
        .padding(.leading, SearchSheet.rowLeading)
        .accessibilityAddTraits(.isHeader)
      ForEach(group.rows) { row in
        Button {
          onOpen(row.app)
        } label: {
          label(row)
        }
        .buttonStyle(.plain)
      }
    }
  }

  private func label(_ row: AppsSearchGroup.Row) -> some View {
    HStack(spacing: SearchSheet.rowParts) {
      AppIconView(app: row.app, side: SearchSheet.offerDisc)
        .opacity(row.away ? AppIcon.awayOpacity : 1)
      VStack(alignment: .leading, spacing: SearchSheet.rowStack) {
        Text(SearchSheet.marked(row.app.title, terms: terms, size: 16, weight: .semibold, ink: ChromePalette.ink))
          .lineLimit(1)
        Text(row.desktop)
          .font(ChromeType.sans(13))
          .foregroundStyle(ChromePalette.inkSecondary)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, SearchSheet.rowVertical)
    .padding(.leading, SearchSheet.rowLeading)
    .padding(.trailing, SearchSheet.rowTrailing)
    .contentShape(RoundedRectangle(cornerRadius: SearchSheet.rowRadius, style: .continuous))
  }
}
