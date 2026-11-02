import SwiftUI

// WI-1 (DESIGN.md §8 "The phone's way in") — what the content under the splash asks of it. FieldSplash names no
// other kit target, so the asking is in its own terms: hold the field up (and bring it back if it has gone), and
// what stands on the field while it holds. The way in is the one asker today; the lock (WI-3) is the next.

/// Whether the content asks the splash to stand. Any asker holds it.
struct SplashHoldKey: PreferenceKey {
  static let defaultValue = false

  static func reduce(value: inout Bool, nextValue: () -> Bool) {
    value = value || nextValue()
  }
}

/// What stands on the splash's field while it holds: the first asker's.
struct SplashOverlayKey: PreferenceKey {
  static var defaultValue: SplashOverlay? { nil }

  static func reduce(value: inout SplashOverlay?, nextValue: () -> SplashOverlay?) {
    if value == nil { value = nextValue() }
  }
}

/// A view carried up to the gate, which draws it over its field.
struct SplashOverlay {
  let view: AnyView
}

extension View {
  /// WI-1 — holds the splash over this content while `hold` is true: its field stays up, and comes back over the
  /// content if it had gone. Releasing it lets the splash leave by its own exit once the content is steady.
  public func splashHolds(_ hold: Bool) -> some View {
    preference(key: SplashHoldKey.self, value: hold)
  }

  /// WI-1 — what stands on the splash's field while it holds (the way in's three places).
  public func splashOverlay<Overlay: View>(@ViewBuilder _ overlay: () -> Overlay) -> some View {
    preference(key: SplashOverlayKey.self, value: SplashOverlay(view: AnyView(overlay())))
  }
}
