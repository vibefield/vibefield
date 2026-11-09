import FieldDesign
import FieldProduct
import SwiftUI

// MA-6d — what the door draws (DESIGN.md §8 "The phone's Apps"): the Recent icons pouring out of the island, the capsule
// that drops from it, and search's dot. Each reads the door's model in its own body, so a pull redraws these and not
// the home screen. How a real pull feels on a device is owed to James (P6).

/// The page follows the pull on Field, and stands aside for the first peek. History's and Chat's lists follow by their
/// own overscroll, so those pages do not move here.
struct AppsPullFollow: ViewModifier {
  let door: AppsDoorModel
  let onField: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func body(content: Content) -> some View {
    content
      .offset(y: door.peeking ? AppsPeek.offset : onField ? AppsPull.offset(door.drag) : 0)
      .animation(reduceMotion ? nil : AppBar.motion, value: door.peeking)
  }
}

/// The four Recent icons, out of the island and toward their row, and the line under them.
struct AppsPourLayer: View {
  let door: AppsDoorModel
  let recent: [IndexAppRow]
  let safeTop: CGFloat

  /// The island's middle on the page's frame: y 11, 37 tall.
  private static let islandMiddle = GodviewStories.islandFoot - 37 / 2
  /// How small an icon leaves the island.
  private static let leaves: CGFloat = 0.35
  private static let lineGap: CGFloat = 8
  private static let lineSize: CGFloat = 13
  private static let fade = Animation.easeInOut(duration: 0.2)

  var body: some View {
    let progress = door.peeking ? 1 : min(1, door.drag / AppsPull.commit)
    let words = door.peeking ? AppsPeek.words : AppsPull.words(door.drag)
    let top = GodviewStories.top(safeTop: safeTop)
    let middle = top + AppsPull.pourIcon / 2
    VStack(spacing: Self.lineGap) {
      ZStack {
        ForEach(Array(recent.prefix(AppsShelfChrome.across).enumerated()), id: \.element.id) { index, app in
          AppIconView(app: app, side: AppsPull.pourIcon)
            .scaleEffect(Self.leaves + (1 - Self.leaves) * progress)
            .offset(
              x: AppsPull.pourX(index: index, count: min(recent.count, AppsShelfChrome.across)) * progress,
              y: (Self.islandMiddle - middle) * (1 - progress))
        }
      }
      .frame(height: AppsPull.pourIcon)
      if let words {
        Text(words)
          .font(ChromeType.sans(Self.lineSize, .semibold))
          .foregroundStyle(ChromePalette.inkSecondary)
      }
    }
    .opacity(progress)
    .animation(Self.fade, value: door.peeking)
    .padding(.top, top)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .ignoresSafeArea(.container, edges: .top)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

/// A new app: **New app** over its name, its icon at 40.
struct AppsDropView: View {
  let drop: AppsDrop
  /// nil for a burst, which counts and has no one icon.
  let app: IndexAppRow?
  let zoom: Namespace.ID
  let onOpen: () -> Void
  let onAway: () -> Void

  /// The icon's inset, concentric with the capsule's end.
  private static let inset = (AppsDrop.height - AppsDrop.icon) / 2
  private static let gap: CGFloat = 12
  private static let headSize: CGFloat = 12
  private static let nameSize: CGFloat = 15
  /// How far up a swipe has to go to send it away.
  private static let away: CGFloat = 12

  var body: some View {
    Button(action: onOpen) {
      HStack(spacing: Self.gap) {
        if let app {
          AppIconView(app: app, side: AppsDrop.icon)
            .matchedTransitionSource(id: app.appKey, in: zoom)
        }
        VStack(alignment: .leading, spacing: 1) {
          Text(drop.head)
            .font(ChromeType.sans(Self.headSize, .semibold))
            .foregroundStyle(ChromePalette.inkSecondary)
          if let name = drop.name {
            Text(name)
              .font(ChromeType.sans(Self.nameSize, .semibold))
              .foregroundStyle(ChromePalette.ink)
              .lineLimit(1)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, Self.inset)
      .frame(width: AppsDrop.width, height: AppsDrop.height)
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .liquidGlassCapsule()
    .simultaneousGesture(
      DragGesture(minimumDistance: Self.away).onEnded { value in
        if value.translation.height <= -Self.away { onAway() }
      }
    )
    .accessibilityElement(children: .combine)
  }

  /// Out of the island on §6's island curve and back into it; under reduced motion it appears in place.
  static func transition(reduced: Bool) -> AnyTransition {
    if reduced { return .opacity.animation(.easeInOut(duration: 0.2)) }
    let shape = AnyTransition.scale(scale: 0.5, anchor: .top).combined(with: .opacity)
    return .asymmetric(
      insertion: shape.animation(FieldMotion.island(AppsDrop.falls)),
      removal: shape.animation(FieldMotion.island(AppsDrop.rises)))
  }
}

/// Search's dot: 10 of `--vf-cyan`, its top right 12 in from the circle's.
struct AppsDotMark: View {
  var body: some View {
    Circle()
      .fill(ChromePalette.info)
      .frame(width: AppBar.dotSize, height: AppBar.dotSize)
      .padding(.top, AppsDot.inset)
      .padding(.trailing, AppsDot.inset)
      .accessibilityHidden(true)
  }
}

extension View {
  /// The dot's ring, 2 in the bar's glass: the ring is a hole cut in what the circle holds, so the glass itself shows.
  func appsDotRing(_ standing: Bool) -> some View {
    mask {
      if standing {
        ZStack(alignment: .topTrailing) {
          Rectangle()
          Circle()
            .frame(width: AppBar.dotSize + 2 * AppsDot.ring, height: AppBar.dotSize + 2 * AppsDot.ring)
            .padding(.top, AppsDot.inset - AppsDot.ring)
            .padding(.trailing, AppsDot.inset - AppsDot.ring)
            .blendMode(.destinationOut)
        }
        .compositingGroup()
      } else {
        Rectangle()
      }
    }
  }
}
