import SwiftUI
import UIKit

/// The phone's look (IOS-10a, Settings › Appearance): Light, Dark, or Auto —
/// the Mac's three words (FC-D5), one value for this phone. It is this
/// phone's own: no desktop reads it, and signing out keeps it.
///
/// It is applied to the WINDOW (`phoneAppearance(_:)`), not to a view, so the
/// field, History, every sheet, menu and alert follow it at once, and Auto is
/// the system's own answer rather than a copy of it.
public enum PhoneAppearance: String, CaseIterable, Identifiable, Sendable {
  case light
  case dark
  case auto

  /// Where it is kept: `@AppStorage(PhoneAppearance.storageKey)` in the views
  /// that read or write it, so the app and Settings agree as it changes.
  public static let storageKey = "vibefield.phone.appearance"

  public var id: String { rawValue }

  /// The Mac's words, word for word.
  public var word: String {
    switch self {
    case .light: "Light"
    case .dark: "Dark"
    case .auto: "Auto"
    }
  }

  public var interfaceStyle: UIUserInterfaceStyle {
    switch self {
    case .light: .light
    case .dark: .dark
    case .auto: .unspecified
    }
  }
}

extension View {
  /// Puts the phone's look on the window this view stands in. A change
  /// cross-fades the window, as the system's own Display settings do; the
  /// first application at launch does not.
  public func phoneAppearance(_ appearance: PhoneAppearance) -> some View {
    background(WindowLook(style: appearance.interfaceStyle).allowsHitTesting(false))
  }
}

private struct WindowLook: UIViewRepresentable {
  let style: UIUserInterfaceStyle

  func makeUIView(context: Context) -> WindowLookView {
    WindowLookView(style: style)
  }

  func updateUIView(_ view: WindowLookView, context: Context) {
    view.style = style
  }
}

private final class WindowLookView: UIView {
  var style: UIUserInterfaceStyle {
    didSet { if style != oldValue { apply(fading: true) } }
  }

  init(style: UIUserInterfaceStyle) {
    self.style = style
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    apply(fading: false)
  }

  private func apply(fading: Bool) {
    guard let window, window.overrideUserInterfaceStyle != style else { return }
    guard fading, !UIAccessibility.isReduceMotionEnabled else {
      window.overrideUserInterfaceStyle = style
      return
    }
    UIView.transition(with: window, duration: 0.3, options: [.transitionCrossDissolve, .allowUserInteraction]) {
      window.overrideUserInterfaceStyle = self.style
    }
  }
}
