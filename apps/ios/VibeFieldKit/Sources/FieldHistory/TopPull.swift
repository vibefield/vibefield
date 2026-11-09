import SwiftUI

/// MA-6d — a root list's overscroll past its top, handed to whoever holds the door above the tabs (DESIGN.md §8 "The
/// phone's Apps"). The depth is the list's own, the system's rubber band; only the root lists read it, so a pushed
/// screen keeps its own scroll.
public struct TopPull: Sendable {
  public var moved: @MainActor @Sendable (CGFloat) -> Void
  public var released: @MainActor @Sendable () -> Void

  public init(
    moved: @escaping @MainActor @Sendable (CGFloat) -> Void,
    released: @escaping @MainActor @Sendable () -> Void
  ) {
    self.moved = moved
    self.released = released
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
  /// On a root list's `ScrollView`: while the finger is on it, its overscroll goes to `\.topPull`.
  public func readsTopPull() -> some View {
    modifier(ReadsTopPull())
  }
}

private struct ReadsTopPull: ViewModifier {
  @Environment(\.topPull) private var pull
  @State private var interacting = false

  func body(content: Content) -> some View {
    content
      .onScrollGeometryChange(for: CGFloat.self) { geometry in
        max(0, -(geometry.contentOffset.y + geometry.contentInsets.top))
      } action: { _, over in
        if interacting { pull?.moved(over) }
      }
      .onScrollPhaseChange { _, phase in
        let now = phase == .interacting
        if interacting, !now { pull?.released() }
        interacting = now
      }
  }
}
