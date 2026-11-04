import SwiftUI

// PG-4t — THE PHONE'S MONITOR SKIN (DESIGN.md §8 "The monitor view owns its drawing", §2.7): the colours of
// puppeteer-view-sdk's `MONITOR_SKIN` a view draws with, resolved for the phone's look and carried to every view on
// `GodviewStageInput.skin`. No `#if`: Release compiles it.
//
// THE SLOT (PG-4t's C2/C3): the type the stage's input carries. Its nine colours, their table and their pins are the
// next pair's.

/// The skin, resolved for one look.
struct GodviewSkin: Equatable, Sendable {
  /// The look it is resolved for (HS's `colorScheme`, which follows the phone's Appearance through the window).
  let scheme: ColorScheme

  init(scheme: ColorScheme) {
    self.scheme = scheme
  }
}
