import SwiftUI

/// MA-6d — a root list tells whoever holds the door above the tabs whether it stands at its top (DESIGN.md §8 "The
/// phone's Apps"): there, a drag down is the door's. Only the root lists say it, so a pushed screen keeps its own
/// scroll. *(Corrected 2026-11-12, item 348: this handed the door the list's own overscroll, the system's rubber
/// band, as the pull's depth. The pull is the finger's travel on every tab now, so the list says only where it
/// stands.)*
public struct TopPull: Sendable {
  public var atTop: @MainActor @Sendable (Bool) -> Void

  public init(atTop: @escaping @MainActor @Sendable (Bool) -> Void) {
    self.atTop = atTop
  }
}

private struct TopPullKey: EnvironmentKey {
  static let defaultValue: TopPull? = nil
}

extension EnvironmentValues {
  public var topPull: TopPull? {
    get { self[TopPullKey.self] }
    set { self[TopPullKey.self] = newValue }
  }
}

extension View {
  /// On a root list's `ScrollView`: whether it stands at its top goes to `\.topPull`.
  public func readsTopPull() -> some View {
    modifier(ReadsTopPull())
  }
}

private struct ReadsTopPull: ViewModifier {
  @Environment(\.topPull) private var pull

  /// Within this of its top the list stands at it.
  private static let near: CGFloat = 1

  func body(content: Content) -> some View {
    content
      .onScrollGeometryChange(for: Bool.self) { geometry in
        geometry.contentOffset.y + geometry.contentInsets.top <= Self.near
      } action: { _, atTop in
        pull?.atTop(atTop)
      }
      // a list that leaves (an empty Chat stands its night in the list's place) leaves its page at its top
      .onDisappear { pull?.atTop(true) }
  }
}
