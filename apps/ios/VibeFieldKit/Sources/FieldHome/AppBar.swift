import FieldAgents
import FieldDesign
import FieldHistory
import SwiftUI

/// The phone's views and search (D-i10): Field, History and, since IOS-12b,
/// Chat (PC-D1 A), and search as a page of its own that the bar's circle opens.
enum AppTab: Hashable {
  case field
  case history
  case chat
  case search

  /// The capsule's tabs, in order: Chat stands third (PC-D1 A).
  static let capsule: [AppTab] = [.field, .history, .chat]

  /// The label under a tab's icon, and its accessible name.
  var title: String {
    switch self {
    case .field: "Field"
    case .history: "History"
    case .chat: "Chat"
    case .search: "Search"
    }
  }
}

/// The bar (IOS-9e): the account at the LEFT, the two tabs in a capsule at the
/// centre, search at the RIGHT — one 62 pt row of Liquid Glass, the page's
/// layout (The Account Pill, design A) at the system's own measure.
///
/// **Why it is ours and not `TabView`'s.** iOS 26's tab bar pins its capsule to
/// the leading edge the moment search is a tab, and it has no seat for a
/// control before the tabs — so IOS-9a's corner could only stand beside the
/// search circle, at a size of its own. James (2026-09-23): "why the account
/// circle is not in left corner, why their size not match, fix them". So the
/// bar is composed here from the system's glass (`GlassEffectContainer`,
/// `glassEffect`, `glassEffectID`) with every number taken off the system bar
/// in the simulator (iPhone 17, iOS 26.5, 3× pixels): the row 62 pt tall and
/// 21 pt from the side edges and the bottom; the capsule 188 wide, two 86 pt
/// tabs; the selected pill 94 × 54; icons 26 pt over 10 pt semibold labels;
/// the badge 20 pt at (+17, −8) from the icon's centre; the search glyph 22 pt.
/// Every one of them is pinned by `AppBarTests`.
///
/// **Three tabs (IOS-12b, PC-D1 A; DESIGN.md §8 "The phone's Chat").** Chat
/// joins the capsule and the capsule keeps the system's 188 and its 8 pt
/// inset: the three tabs share what the two 86s did, 57⅓ each, and the pill
/// is the tab plus the 8 the system's 94 had over its 86, so it still stands
/// 4 pt inside. The circles and every other number stay. Chat's glyph is
/// History's 22, and its mark is the count of the sparks that need you, else a
/// cyan dot of 10 while a thread is unread (`TabMark`).
enum AppBar {
  /// The row: the capsule's height, and both circles' diameter.
  static let height: CGFloat = 62
  /// From the screen's side edges.
  static let margin: CGFloat = 21
  /// The system's capsule, which three tabs now share.
  static let capsuleWidth: CGFloat = 188
  static let capsuleInset: CGFloat = 8
  /// 172 / 3 = 57⅓ (the system's two were 86).
  static let tabWidth: CGFloat = (capsuleWidth - capsuleInset * 2) / CGFloat(AppTab.capsule.count)
  /// The tab plus 8, the system pill's overhang (94 on 86).
  static let pillWidth: CGFloat = tabWidth + 8
  static let pillHeight: CGFloat = 54
  static let iconHeight: CGFloat = 28
  static let fieldGlyph: CGFloat = 26
  static let symbolSize: CGFloat = 22
  /// Chat's `tab-chat`, at History's size (VF-PM's Q1; DESIGN.md §8).
  static let chatGlyph: CGFloat = 22
  static let labelSize: CGFloat = 10
  static let badgeSize: CGFloat = 20
  static let badgeOffset = CGSize(width: 17, height: -8)
  /// Chat's unread dot: 10 pt of `--vf-cyan`, where the design page sets it off
  /// the glyph's centre.
  static let dotSize: CGFloat = 10
  static let dotOffset = CGSize(width: 13, height: -9)
  static let searchGlyph: CGFloat = 22
  /// Where two glass shapes begin to melt into one — under the 24 pt that
  /// separates the capsule from each circle, so at rest they stand apart.
  static let meltSpacing: CGFloat = 12
  /// The match stepper: above the bar, or inline between the circles when the
  /// bar is folded (the page's `.tacc` and `.tacc.inline`).
  static let stepperHeight: CGFloat = 48
  static let stepperGap: CGFloat = 10
  static let inlineGap: CGFloat = 10
  /// Search, with the keyboard up — the system's own search row, measured.
  static let fieldHeightTyping: CGFloat = 48
  static let marginTyping: CGFloat = 10
  static let gapAboveKeyboard: CGFloat = 8
  static let fieldGap: CGFloat = 8
  /// SE-2 (SE-D5 A; DESIGN.md §8 "The phone's search", tokens in the field) — a chosen filter stands after the field's
  /// magnifier as a token: 30 tall, corners 15 (half its height), padded 9 before its glyph and 4 after its ×; its
  /// glyph 13, 5 before its name; its × a 20 round holding `xmark` at 8. A second token stands 2 closer to the first.
  /// It pops in from 0.7 on the bar's spring (`motion`).
  static let tokenHeight: CGFloat = 30
  static let tokenLeading: CGFloat = 9
  static let tokenTrailing: CGFloat = 4
  static let tokenGlyph: CGFloat = 13
  static let tokenGap: CGFloat = 5
  static let tokenClose: CGFloat = 20
  static let tokenCloseGlyph: CGFloat = 8
  static let tokenOverlap: CGFloat = 2
  static let tokenPopFrom: CGFloat = 0.7

  /// How far above the screen's bottom edge the row sits: where iOS 26 puts
  /// its own bar, 13 pt below the safe area's line on a phone with a home
  /// indicator (34 → 21), and 8 pt up from the edge on one without.
  static func bottomGap(homeInset: CGFloat) -> CGFloat {
    homeInset >= 21 ? homeInset - 13 : 8
  }

  /// The band the swarm keeps its bodies out of, from the screen's bottom edge.
  static func band(homeInset: CGFloat) -> CGFloat {
    bottomGap(homeInset: homeInset) + height + 10
  }

  /// What a page's scroll content must clear above the safe area's line so its
  /// last row can scroll out from under the bar (and the stepper above it).
  static func clearance(homeInset: CGFloat, stepper: Bool) -> CGFloat {
    let top = bottomGap(homeInset: homeInset) + height
    let base = max(0, top - homeInset) + 8
    return stepper ? base + stepperHeight + stepperGap : base
  }

  /// The three shapes at rest, for a row `width` wide.
  struct Frames: Equatable {
    var account: CGRect
    var capsule: CGRect
    var search: CGRect
  }

  static func frames(width: CGFloat) -> Frames {
    Frames(
      account: CGRect(x: margin, y: 0, width: height, height: height),
      capsule: CGRect(x: (width - capsuleWidth) / 2, y: 0, width: capsuleWidth, height: height),
      search: CGRect(x: width - margin - height, y: 0, width: height, height: height))
  }

  /// The bar's spring — the system's own, for a glass shape moving or morphing.
  static let motion: Animation = .spring(response: 0.42, dampingFraction: 0.84)
}

/// The mark a tab wears (§2.5, never decorative; PC-D5 A, one need, one
/// count): an orange count, Chat's cyan dot, or nothing. History wears none.
enum TabMark: Equatable {
  case none
  case count(Int)
  /// Chat's cyan dot: no spark needs you, and a thread is unread.
  case unread

  /// Field's: your own agents waiting on you.
  static func field(waiting: Int) -> TabMark { waiting > 0 ? .count(waiting) : .none }

  /// Chat's: the sparks that need you, theirs and their agents' asks, each
  /// spark once; with none, the cyan dot while a thread is unread.
  static func chat(needing: Int, unread: Bool) -> TabMark {
    needing > 0 ? .count(needing) : unread ? .unread : .none
  }

  /// Field's count: the bodies waiting on you whose run is no spark's. A
  /// spark's own run and an agent it started are counted on Chat, with their
  /// spark, never twice; their bodies still turn orange.
  static func fieldWaiting(_ bubbles: [FieldBubble]) -> Int {
    bubbles.filter { $0.status == .blocked && !$0.ofSpark }.count
  }
}

/// The three tabs in one capsule: an icon over a 10 pt label each, the
/// selected one on a pill that slides between them, and each tab's mark —
/// Field's orange count of the agents waiting on you, Chat's of the sparks
/// that need you or its cyan dot (`TabMark`). The capsule's glass is its
/// container's (`liquidGlassCapsule` at the call site).
struct TabCapsule: View {
  @Binding var selection: AppTab
  let field: TabMark
  let chat: TabMark
  /// The pill's matched geometry — its own namespace, not the glass one.
  let pill: Namespace.ID

  var body: some View {
    HStack(spacing: 0) {
      item(.field, mark: field) {
        Image("tab-field", bundle: .module)
          .renderingMode(.template)
          .resizable()
          .scaledToFit()
          .frame(width: AppBar.fieldGlyph, height: AppBar.fieldGlyph)
      }
      item(.history, mark: .none) {
        Image(systemName: "clock.arrow.circlepath")
          .font(.system(size: AppBar.symbolSize, weight: .medium))
      }
      item(.chat, mark: chat) {
        Image("tab-chat", bundle: .module)
          .renderingMode(.template)
          .resizable()
          .scaledToFit()
          .frame(width: AppBar.chatGlyph, height: AppBar.chatGlyph)
      }
    }
    .padding(.horizontal, AppBar.capsuleInset)
    .frame(width: AppBar.capsuleWidth, height: AppBar.height)
    .accessibilityElement(children: .contain)
  }

  private func item<Icon: View>(_ tab: AppTab, mark: TabMark, @ViewBuilder icon: () -> Icon) -> some View {
    let selected = selection == tab
    return Button {
      selection = tab
    } label: {
      VStack(spacing: 1) {
        icon()
          .frame(height: AppBar.iconHeight)
          .overlay {
            switch mark {
            case .count(let count): TabBadge(count: count).offset(AppBar.badgeOffset)
            case .unread: UnreadDot().offset(AppBar.dotOffset)
            case .none: EmptyView()
            }
          }
        Text(tab.title)
          .font(.system(size: AppBar.labelSize, weight: .semibold))
          .lineLimit(1)
      }
      .foregroundStyle(ChromePalette.ink)
      .frame(width: AppBar.tabWidth, height: AppBar.pillHeight)
      .background {
        if selected {
          Capsule()
            .fill(ChromePalette.tabPill)
            .frame(width: AppBar.pillWidth, height: AppBar.pillHeight)
            .matchedGeometryEffect(id: "pill", in: pill)
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(tab.title)
    .accessibilityValue(Self.spoken(mark, on: tab))
    .accessibilityAddTraits(selected ? [.isSelected] : [])
  }

  /// A mark is a picture, so it is said: Field's agents are waiting, Chat's
  /// sparks need you, and the dot says a thread is unread (the Mac's cell's
  /// words, DESIGN.md §8).
  private static func spoken(_ mark: TabMark, on tab: AppTab) -> String {
    switch mark {
    case .count(let count): tab == .chat ? "\(count) need you" : "\(count) waiting"
    case .unread: "a thread is unread"
    case .none: ""
    }
  }
}

/// The count on a tab: the system badge's measure, in §2.5's orange.
private struct TabBadge: View {
  let count: Int

  var body: some View {
    Text("\(count)")
      .font(.system(size: 13, weight: .regular))
      .monospacedDigit()
      .foregroundStyle(.white)
      .padding(.horizontal, count > 9 ? 5 : 0)
      .frame(minWidth: AppBar.badgeSize, minHeight: AppBar.badgeSize)
      .background(Capsule().fill(ChromePalette.attention))
      .fixedSize()
      .accessibilityHidden(true)
  }
}

/// Chat's unread dot: 10 pt of `--vf-cyan` (§2.5's info), worn only while no
/// spark needs you.
private struct UnreadDot: View {
  var body: some View {
    Circle()
      .fill(ChromePalette.info)
      .frame(width: AppBar.dotSize, height: AppBar.dotSize)
      .accessibilityHidden(true)
  }
}

/// Search in the bar: the field the search circle morphs into (the same
/// `glassID`), and the circle that closes it. At the bar's height with the
/// keyboard down; the system's typing row (48 pt, 10 pt from the edges, 8 pt
/// above the keys) with it up.
///
/// SE-2 (SE-D5 A; DESIGN.md §8 "The phone's search") — the chosen filters
/// stand after the magnifier as tokens, each removed by its × (the software
/// keyboard reports no Backspace on an empty field), popping in from 0.7 on the
/// bar's spring; the placeholder is **Search**, and none once two stand.
struct SearchBarRow: View {
  @Binding var query: String
  var focus: FocusState<Bool>.Binding
  let typing: Bool
  let glass: Namespace.ID
  let tokens: [PhoneSearch.Token]
  let onRemove: (PhoneSearch.Filter) -> Void
  let onClose: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let size = typing ? AppBar.fieldHeightTyping : AppBar.height
    HStack(spacing: AppBar.fieldGap) {
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass")
          .font(.system(size: 17, weight: .medium))
          .foregroundStyle(ChromePalette.inkTertiary)
        ForEach(Array(tokens.enumerated()), id: \.element.id) { index, token in
          FieldToken(token: token) { onRemove(token.filter) }
            .padding(.leading, index > 0 ? -AppBar.tokenOverlap : 0)
            .transition(reduceMotion ? .opacity : .scale(scale: AppBar.tokenPopFrom).combined(with: .opacity))
        }
        TextField(PhoneSearch.placeholder(tokens: tokens.count) ?? "", text: $query)
          .accessibilityLabel("Search")
          .font(.system(size: 17))
          .foregroundStyle(ChromePalette.ink)
          .focused(focus)
          .submitLabel(.search)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .onSubmit { focus.wrappedValue = false }
        if !query.isEmpty {
          Button {
            query = ""
          } label: {
            Image(systemName: "xmark.circle.fill")
              .font(.system(size: 17))
              .foregroundStyle(ChromePalette.placeholder)
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Clear search")
        }
      }
      .animation(reduceMotion ? FieldMotion.plainEase(SearchSheet.reducedFade) : AppBar.motion, value: tokens)
      .padding(.leading, 18)
      .padding(.trailing, 14)
      .frame(maxWidth: .infinity)
      .frame(height: size)
      .contentShape(Capsule())
      .onTapGesture { focus.wrappedValue = true }
      .liquidGlassCapsule(interactive: false)
      .glassID("search", in: glass)

      Button(action: onClose) {
        Image(systemName: "xmark")
          .font(.system(size: 17, weight: .semibold))
          .foregroundStyle(ChromePalette.ink)
          .frame(width: size, height: size)
          .contentShape(Circle())
      }
      .buttonStyle(.plain)
      .liquidGlassCircle()
      .glassID("close", in: glass)
      .accessibilityLabel("Close search")
    }
  }
}

/// A token in the search field (SE-D5 A): 30 tall, corners 15, on the ink at
/// 9%, padded 9 before its glyph and 4 after its ×; the glyph 13, 5 before its
/// name at 14/600; its × a 20 round holding `xmark` at 8 in the tertiary ink
/// (§13), which removes it.
struct FieldToken: View {
  let token: PhoneSearch.Token
  let onRemove: () -> Void

  var body: some View {
    HStack(spacing: AppBar.tokenGap) {
      SearchLeadGlyph(lead: token.lead, size: AppBar.tokenGlyph)
      Text(token.label)
        .font(ChromeType.sans(14, .semibold))
        .lineLimit(1)
      Button(action: onRemove) {
        Image(systemName: "xmark")
          .font(.system(size: AppBar.tokenCloseGlyph, weight: .semibold))
          .foregroundStyle(ChromePalette.inkTertiary)
          .frame(width: AppBar.tokenClose, height: AppBar.tokenClose)
          .contentShape(Circle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Remove \(token.label)")
    }
    .foregroundStyle(ChromePalette.ink)
    .padding(.leading, AppBar.tokenLeading)
    .padding(.trailing, AppBar.tokenTrailing)
    .frame(height: AppBar.tokenHeight)
    .background(Capsule().fill(ChromePalette.searchToken))
    .fixedSize()
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Filter: \(token.label)")
  }
}

extension View {
  /// A page under the bar: drawn and touchable only while it is the one
  /// standing — all three stay alive, so a History stack or a search keeps
  /// its place across a switch, the way a `TabView`'s tabs do.
  func page(visible: Bool) -> some View {
    opacity(visible ? 1 : 0)
      .allowsHitTesting(visible)
      .accessibilityHidden(!visible)
  }
}
