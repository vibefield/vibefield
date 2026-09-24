import FieldDesign
import FieldHistory
import SwiftUI

/// The phone's two views and search (D-i10): Field, History, and search as a
/// page of its own that the bar's circle opens.
enum AppTab: Hashable {
  case field
  case history
  case search
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
enum AppBar {
  /// The row: the capsule's height, and both circles' diameter.
  static let height: CGFloat = 62
  /// From the screen's side edges.
  static let margin: CGFloat = 21
  static let tabWidth: CGFloat = 86
  static let capsuleInset: CGFloat = 8
  static let capsuleWidth: CGFloat = capsuleInset * 2 + tabWidth * 2
  static let pillWidth: CGFloat = 94
  static let pillHeight: CGFloat = 54
  static let iconHeight: CGFloat = 28
  static let fieldGlyph: CGFloat = 26
  static let symbolSize: CGFloat = 22
  static let labelSize: CGFloat = 10
  static let badgeSize: CGFloat = 20
  static let badgeOffset = CGSize(width: 17, height: -8)
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

/// The two tabs in one capsule: an icon over a 10 pt label each, the selected
/// one on a pill that slides between them, and the Field tab's orange count
/// (§2.5 — the agents waiting on the person, never decorative). The capsule's
/// glass is its container's (`liquidGlassCapsule` at the call site).
struct TabCapsule: View {
  @Binding var selection: AppTab
  let waiting: Int
  /// The pill's matched geometry — its own namespace, not the glass one.
  let pill: Namespace.ID

  var body: some View {
    HStack(spacing: 0) {
      item(.field, title: "Field") {
        Image("tab-field", bundle: .module)
          .renderingMode(.template)
          .resizable()
          .scaledToFit()
          .frame(width: AppBar.fieldGlyph, height: AppBar.fieldGlyph)
      }
      item(.history, title: "History") {
        Image(systemName: "clock.arrow.circlepath")
          .font(.system(size: AppBar.symbolSize, weight: .medium))
      }
    }
    .padding(.horizontal, AppBar.capsuleInset)
    .frame(width: AppBar.capsuleWidth, height: AppBar.height)
    .accessibilityElement(children: .contain)
  }

  private func item<Icon: View>(_ tab: AppTab, title: String, @ViewBuilder icon: () -> Icon) -> some View {
    let selected = selection == tab
    let count = tab == .field ? waiting : 0
    return Button {
      selection = tab
    } label: {
      VStack(spacing: 1) {
        icon()
          .frame(height: AppBar.iconHeight)
          .overlay {
            if count > 0 {
              TabBadge(count: count).offset(AppBar.badgeOffset)
            }
          }
        Text(title)
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
    .accessibilityLabel(title)
    .accessibilityValue(count > 0 ? "\(count) waiting" : "")
    .accessibilityAddTraits(selected ? [.isSelected] : [])
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

/// Search in the bar: the field the search circle morphs into (the same
/// `glassID`), and the circle that closes it. At the bar's height with the
/// keyboard down; the system's typing row (48 pt, 10 pt from the edges, 8 pt
/// above the keys) with it up.
struct SearchBarRow: View {
  @Binding var query: String
  var focus: FocusState<Bool>.Binding
  let typing: Bool
  let glass: Namespace.ID
  let onClose: () -> Void

  var body: some View {
    let size = typing ? AppBar.fieldHeightTyping : AppBar.height
    HStack(spacing: AppBar.fieldGap) {
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass")
          .font(.system(size: 17, weight: .medium))
          .foregroundStyle(ChromePalette.inkTertiary)
        TextField("Search sessions", text: $query)
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
