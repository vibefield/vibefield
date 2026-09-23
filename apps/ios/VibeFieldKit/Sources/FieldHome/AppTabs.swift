import FieldDesign
import FieldHistory
import SwiftUI

/// The phone's two views under one switch (D-i10, ruled A on 2026-09-13):
/// the system's tab bar — on iOS 26 the floating capsule of Liquid Glass with
/// the search role as its own circle at the right, minimizing to the selected
/// glyph on a scroll down; below 26 the classic bar, which H-D5 accepts as the
/// honest floor. The account corner (IOS-8) is the search circle's mirror at
/// the left, drawn by us in the same glass.
enum AppTab: Hashable {
  case field
  case history
  case search
}

enum AppTabs {
  /// Where the account corner stands, measured on the iPhone 17 simulator
  /// (iOS 26.5) rather than assumed from the page: the bar’s row is the 62 pt
  /// search circle's, centred 6 pt above the safe area's bottom line, with the
  /// circle 21 pt in from the trailing edge; the capsule of two tabs runs
  /// from the leading margin to x≈208, so the left is the tabs' and the face
  /// stands beside the search circle instead — 10 pt to its left.
  static let cornerLift: CGFloat = 6
  static let cornerInset: CGFloat = 93
}

/// The iOS 26 bar's behaviours, in one modifier so the `TabView` reads the
/// same on every OS: minimize on a scroll down, the search field opening on
/// the search tab's selection, and the match stepper riding the bar as its
/// bottom accessory while a landed search is on top.
struct TabBarChrome: ViewModifier {
  let router: HistoryRouter

  func body(content: Content) -> some View {
    if #available(iOS 26.1, *) {
      content
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewSearchActivation(.searchTabSelection)
        .tabViewBottomAccessory(isEnabled: router.stepperShowing) {
          HistoryStepperView(router: router)
        }
    } else if #available(iOS 26.0, *) {
      content
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewSearchActivation(.searchTabSelection)
    } else {
      content
    }
  }
}
