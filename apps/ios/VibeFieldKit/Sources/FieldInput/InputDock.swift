import SwiftUI

/// The input as a session's card mounts it in its bottom safe-area inset: the
/// row of chips, switch and fold key (`InputOverlay`) over the card
/// (`InputCard`), with nothing between them.
///
/// One inset for both (PF-11, 2026-11-22). The row is a shelf while the
/// keyboard is up and keeps no room while it is down, and it is the same view
/// either way, so the terminal is resized once as the keyboard comes or goes:
/// by the card and the shelf together.
public struct InputDock: View {
  let model: InputCardModel
  let pasteboard: PasteboardWatcher?
  /// The scheme the terminal's ground asks of chrome drawn on it. The row
  /// stands on that ground; the card wears the app's own scheme.
  let rowScheme: ColorScheme

  public init(model: InputCardModel, pasteboard: PasteboardWatcher? = nil, rowScheme: ColorScheme) {
    self.model = model
    self.pasteboard = pasteboard
    self.rowScheme = rowScheme
  }

  public var body: some View {
    VStack(spacing: 0) {
      InputOverlay(model: model, pasteboard: pasteboard)
        .environment(\.colorScheme, rowScheme)
      InputCard(model: model)
    }
  }
}
