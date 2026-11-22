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
  /// `blurring` (PF-5, 2026-11-21; DESIGN.md §8 "The card's glass is the
  /// field"): a card that is a terminal asks for the material itself, in the
  /// scheme its ground's lightness decides, at every height. The system's
  /// sheet glass is solid at full height, where such a card always stands, so
  /// a translucent terminal would show nothing through it. nil keeps the
  /// sheet's own glass.
  @ViewBuilder
  public func fieldGlassSheet(blurring scheme: ColorScheme? = nil) -> some View {
    if let scheme {
      presentationBackground {
        Rectangle().fill(.ultraThinMaterial).environment(\.colorScheme, scheme)
      }
    } else if #available(iOS 26.0, *) {
      self
    } else {
      presentationBackground(.ultraThinMaterial)
    }
  }
}
