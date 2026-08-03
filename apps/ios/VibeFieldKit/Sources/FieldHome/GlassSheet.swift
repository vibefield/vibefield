import SwiftUI

extension View {
  /// The field's sheet material: liquid glass.
  ///
  /// Built against the iOS 26 SDK, partial-height sheets carry the system's
  /// Liquid Glass background by default — an explicit opaque
  /// `presentationBackground` would suppress it, so on iOS 26 this modifier
  /// deliberately sets nothing. Below 26 it falls back to ultra-thin
  /// material, which blurs the scene behind the sheet the classic way.
  /// Card internals stay translucent either way (DESIGN.md §5: chrome is
  /// glass); the monitor scene reads through, dimmed and refracted.
  @ViewBuilder
  public func fieldGlassSheet() -> some View {
    if #available(iOS 26.0, *) {
      self
    } else {
      presentationBackground(.ultraThinMaterial)
    }
  }
}
