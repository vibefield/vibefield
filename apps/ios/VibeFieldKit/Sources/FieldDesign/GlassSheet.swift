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
  ///
  /// At FULL height iOS 26 stands a sheet on an opaque backing of its own,
  /// whatever its background is, so nothing behind it shows (PF-7, 2026-11-21;
  /// DESIGN.md §8 "The card's glass is the field"). A sheet that wants the
  /// scene through its glass stands under full height instead. (A session's
  /// card did, at 98%, until PF-9, 2026-11-22; it is no sheet now, and stands
  /// in the phone's own panel: `TerminalPanel`, in FieldHome.)
  @ViewBuilder
  public func fieldGlassSheet() -> some View {
    if #available(iOS 26.0, *) {
      self
    } else {
      presentationBackground(.ultraThinMaterial)
    }
  }
}
