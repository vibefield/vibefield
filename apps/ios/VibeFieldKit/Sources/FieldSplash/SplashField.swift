import SwiftUI

/// WI-3 — the splash's own surface, alone: the field and its mark, with no gate (DESIGN.md §8 "The phone's way in",
/// as built 2026-11-04). The lock's curtain stands on it, so the lock is the splash (WI-L5): it draws the launch
/// picture until its field is up, as a launch does, and the app switcher's picture is that launch picture.
///
/// `active` is the scene's, handed in: the curtain stands in a window of its own, so it says when the app has gone to
/// the background, where the surface stops drawing (a GPU frame from the background is refused).
public struct SplashField: View {
  private let active: Bool
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  public init(active: Bool) {
    self.active = active
  }

  public var body: some View {
    SplashCanvas(
      look: SplashLook.for(colorScheme), motion: !reduceMotion, active: active,
      fadeIn: reduceMotion ? SplashTiming.fadeIn / 2 : SplashTiming.fadeIn,
      onFirstFrame: { _ in }, onFailure: { _ in }
    )
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }
}
