import FieldDesign
import SwiftUI

/// Item 350 (James, 2026-11-12) — a root tab's head: History's and Chat's titles stand in the band Field's Stories
/// row stands in, so the view circles, the two titles and Chat's ✦ share one top line. The home screen says where
/// that band is, from the screen's own edges; the pages draw their heads in it.
///
/// The measures are the screen's, never the system's safe area read inside the page. A root page stands in a
/// `NavigationStack`, whose insets UIKit reads from where the page is drawn; the card the tabs stand in (item 348) is
/// drawn lower and smaller as it is pulled, so a page laid out on the system's insets slides inside its card.
public struct RootHead: Equatable, Sendable {
  /// The band's top from the screen's top.
  public var top: CGFloat
  /// The band's height: a Stories circle's.
  public var height: CGFloat
  /// What the page's content clears at the screen's foot: the home indicator's inset and the bar.
  public var foot: CGFloat
  /// Items 387 and 389 — what stands over a PUSHED page's foot, above the safe area's line: the bar, and the slot
  /// above it when one stands (a session's act, a landed search's stepper). `foot` less the home indicator's
  /// inset. A pushed page keeps the system's bottom inset, and the home screen's own inset under the tab does
  /// not reach it, so it clears this itself (`HistoryFollow.clearance`).
  public var bar: CGFloat

  public init(top: CGFloat = 0, height: CGFloat = 44, foot: CGFloat = 0, bar: CGFloat = 0) {
    self.top = top
    self.height = height
    self.foot = foot
    self.bar = bar
  }

  /// The title's size, the system's large title.
  public static let titleSize: CGFloat = 34
  /// The title's left edge, the lists' own margin.
  public static let side: CGFloat = 20
}

private struct RootHeadKey: EnvironmentKey {
  static let defaultValue = RootHead()
}

extension EnvironmentValues {
  public var rootHead: RootHead {
    get { self[RootHeadKey.self] }
    set { self[RootHeadKey.self] = newValue }
  }
}

/// Item 390 (James, 2026-11-13) — a head's count in its bubble: how many the page under the head holds, beside its
/// title. The look is the one a project's page wore beside its name before any text ruled it (DESIGN.md §8 "The
/// roots' heads", A head's bubble): 12 medium and tabular in the secondary ink, on a `fill` capsule 22 tall. The
/// count is never cut: a long title gives way to it.
struct HeadCount: View {
  let words: String

  var body: some View {
    Text(words)
      .font(ChromeType.sans(12, .medium))
      .monospacedDigit()
      .foregroundStyle(ChromePalette.inkSecondary)
      .lineLimit(1)
      .fixedSize()
      .padding(.horizontal, 8)
      .frame(height: 22)
      .background(Capsule().fill(ChromePalette.fill))
  }
}

/// Item 390 — a head's words: its title and, beside it, the bubble that holds its count. The two are one heading
/// to VoiceOver, read as `spoken` says (`Projects, 79`). A head given no count is its title alone, as Chat's is.
///
/// Item 392 — a project's page wears it too, after its cap: its name and its sessions (`rosetta, 62 sessions`).
struct HeadTitle: View {
  let title: String
  var count: String? = nil
  /// What VoiceOver reads for the title and its bubble; nil reads the title.
  var spoken: String? = nil
  var ink: Color = ChromePalette.ink

  /// The bubble's distance from the title.
  static let gap: CGFloat = 10
  /// Item 392 — a title too long for its line is drawn smaller before it is cut, down to this share of its size:
  /// the 28 a project's name was. "Projects" and "Chat" never reach it.
  static let squeeze: CGFloat = 28 / RootHead.titleSize

  var body: some View {
    HStack(alignment: .center, spacing: Self.gap) {
      Text(title)
        .font(ChromeType.sans(RootHead.titleSize, .bold))
        .foregroundStyle(ink)
        .lineLimit(1)
        .minimumScaleFactor(Self.squeeze)
      if let count { HeadCount(words: count) }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(spoken ?? title)
    .accessibilityAddTraits(.isHeader)
  }
}

/// The head row itself: the title at the left, with its count in a bubble beside it where the page gives one (item
/// 390), and whatever the page stands at its right, centred in the band.
public struct RootHeadRow<Trailing: View>: View {
  private let title: String
  private let count: String?
  private let spoken: String?
  private let ink: Color
  private let trailing: Trailing

  @Environment(\.rootHead) private var head

  /// `count` is the words in the bubble beside the title, and `spoken` the line VoiceOver reads for the two; a head
  /// given neither is its title alone.
  public init(
    _ title: String, count: String? = nil, spoken: String? = nil, ink: Color = ChromePalette.ink,
    @ViewBuilder trailing: () -> Trailing
  ) {
    self.title = title
    self.count = count
    self.spoken = spoken
    self.ink = ink
    self.trailing = trailing()
  }

  public var body: some View {
    HStack(spacing: 0) {
      HeadTitle(title: title, count: count, spoken: spoken, ink: ink)
      Spacer(minLength: 0)
      trailing
    }
    .frame(height: head.height)
    .padding(.leading, RootHead.side)
    .padding(.top, head.top)
  }
}

extension View {
  /// On a root page: it stands from the screen's top to its foot under `head`, on the insets `\.rootHead` says.
  public func underRootHead<Head: View>(@ViewBuilder _ head: () -> Head) -> some View {
    modifier(UnderRootHead(head: head()))
  }
}

private struct UnderRootHead<Head: View>: ViewModifier {
  let head: Head

  @Environment(\.rootHead) private var measures

  func body(content: Content) -> some View {
    content
      .safeAreaInset(edge: .top, spacing: 0) { head }
      .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: measures.foot) }
      .ignoresSafeArea(.container, edges: [.top, .bottom])
  }
}

extension RootHeadRow where Trailing == EmptyView {
  public init(_ title: String, ink: Color = ChromePalette.ink) {
    self.init(title, ink: ink) { EmptyView() }
  }
}
