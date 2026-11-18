import SwiftUI

/// MA-6d — a root list tells whoever holds the door above the tabs whether it gives the pull (DESIGN.md §8 "The
/// phone's Apps"): resting at its top when the finger comes down, a drag down is the door's (`TopStand`). Only the root lists say it, so a pushed screen keeps its own
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

/// What a root list tells the door, from where it stands and how it moves (item 348, asked for 2026-11-12: a list
/// still scrolling never starts the pull down; only one scrolled all the way to its top
/// does). The list gives the pull only to a finger that came down while it rested at its top. A list
/// still moving, or caught in flight, keeps the touch, even where its flight has reached the top.
struct TopStand: Equatable {
  /// Where the list stands now.
  private var atTop = true
  /// Whether the touch that is down, or the next one, is the door's to take.
  private(set) var gives = true

  /// The list moved, by a finger or on its own.
  mutating func place(atTop: Bool, resting: Bool) {
    self.atTop = atTop
    if resting { gives = atTop }
  }

  /// A finger came down, on a list at rest or on one in flight.
  mutating func touched(inFlight: Bool) {
    if inFlight { gives = false }
  }

  /// The finger let go and the list runs on, or it moves by itself.
  mutating func flies() {
    gives = false
  }

  /// The list came to rest.
  mutating func rests() {
    gives = atTop
  }
}

private struct ReadsTopPull: ViewModifier {
  @Environment(\.topPull) private var pull
  @State private var stand = TopStand()
  @State private var resting = true

  /// Within this of its top the list stands at it.
  private static let near: CGFloat = 1

  func body(content: Content) -> some View {
    content
      .onScrollGeometryChange(for: Bool.self) { geometry in
        geometry.contentOffset.y + geometry.contentInsets.top <= Self.near
      } action: { _, atTop in
        stand.place(atTop: atTop, resting: resting)
        tell()
      }
      .onScrollPhaseChange { old, new in
        if new == .idle {
          stand.rests()
        } else if new == .tracking || new == .interacting {
          stand.touched(inFlight: old == .decelerating || old == .animating)
        } else {
          stand.flies()
        }
        resting = new == .idle
        tell()
      }
      // back from under a pushed screen, it says where it stands again
      .onAppear { tell() }
      // a list that leaves (an empty Chat stands its night in the list's place) leaves its page at its top
      .onDisappear { pull?.atTop(true) }
  }

  private func tell() {
    pull?.atTop(stand.gives)
  }
}
