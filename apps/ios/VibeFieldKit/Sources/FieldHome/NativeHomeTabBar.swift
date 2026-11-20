import FieldDesign
import SwiftUI
import UIKit

/// A standalone tab bar lets UIKit handle the glass lens while HomeScreen
/// keeps the account and search actions on either side.
@available(iOS 26.0, *)
struct NativeHomeTabBar: UIViewRepresentable {
  @Binding var selection: AppTab
  let field: TabMark
  let chat: TabMark

  final class Host: UIView {
    let bar = UITabBar()

    override func layoutSubviews() {
      super.layoutSubviews()
      // UIKit reserves space beside and below its glass. Give the bar its
      // fitting height while keeping the host's hit area on the visible glass.
      var frame = bounds.insetBy(dx: -AppBar.margin, dy: 0)
      frame.size.height = bar.sizeThatFits(frame.size).height
      bar.frame = frame
    }
  }

  final class Coordinator: NSObject, UITabBarDelegate {
    var selection: Binding<AppTab>

    init(selection: Binding<AppTab>) { self.selection = selection }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
      selection.wrappedValue = AppTab.capsule[item.tag]
    }
  }

  func makeCoordinator() -> Coordinator { Coordinator(selection: $selection) }

  func makeUIView(context: Context) -> Host {
    let host = Host()
    // This slot is 188 pt wide even on iPad. Stack the labels under the
    // icons so the regular-width inline layout cannot truncate them.
    host.bar.traitOverrides.horizontalSizeClass = .compact
    host.bar.items = AppTab.capsule.enumerated().map { index, tab in
      let image: UIImage? = switch tab {
      case .field: UIImage(named: "tab-field", in: .module, compatibleWith: nil)
      case .history: UIImage(systemName: "clock.arrow.circlepath")
      case .chat: UIImage(named: "tab-chat", in: .module, compatibleWith: nil)
      }
      return UITabBarItem(title: tab.title, image: image, tag: index)
    }
    host.bar.tintColor = .systemBlue
    host.bar.delegate = context.coordinator
    host.addSubview(host.bar)
    return host
  }

  func updateUIView(_ host: Host, context: Context) {
    context.coordinator.selection = $selection
    let bar = host.bar
    for (tab, item) in zip(AppTab.capsule, bar.items ?? []) {
      if tab == selection, bar.selectedItem !== item {
        bar.selectedItem = item
      }
      switch tab {
      case .field: updateBadge(field, on: tab, item: item)
      case .chat: updateBadge(chat, on: tab, item: item)
      case .history: break
      }
    }
  }

  private func updateBadge(_ mark: TabMark, on tab: AppTab, item: UITabBarItem) {
    let value: String? = switch mark {
    case .none: nil
    case .unread: ""
    case .count(let count): String(count)
    }
    guard item.badgeValue != value else { return }
    item.badgeColor = UIColor(mark == .unread ? ChromePalette.info : ChromePalette.attention)
    item.badgeValue = value
    item.accessibilityValue = mark.accessibilityValue(on: tab)
  }
}
