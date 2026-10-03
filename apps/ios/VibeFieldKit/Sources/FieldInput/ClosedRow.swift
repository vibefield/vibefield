import FieldDesign
import SwiftUI

/// The card with the keyboard down (the design's `MainClosed`).
///
/// One row, not a folded copy of the open card: with no keyboard there is
/// nothing under the rail to type into, and 110 pt of keys hovering over a
/// terminal the user is trying to READ is the chrome winning an argument it
/// should not have started. What survives is the context — the agent's
/// question and the pasteboard's offer, which are exactly as true with the
/// keyboard down — and one way back.
///
/// The rail's keys are deliberately not here. They would work: a rail key is a
/// key event either way. But the design gives this state one row, and a row
/// that is half rail is a rail with keys missing rather than a different
/// state.
///
/// **IOS-5v.** The way back is the canvas's own: a 44 pt glass circle wearing a
/// keyboard glyph, where the godview card had a chip that said `KEYBOARD`. A
/// word is what you write when the picture would not be understood, and every
/// phone already knows this one.
struct ClosedRow: View {
  let model: InputCardModel
  let pasteboard: PasteboardWatcher?
  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  // --- end IOS-5e -----------------------------------------------------------

  /// `.row` gap 8 — the closed row is the chips row with one more thing on it.
  private static let gap: CGFloat = 8

  private var side: CGFloat { InputCardMetrics.rowHeight(for: dynamicTypeSize) }

  var body: some View {
    HStack(spacing: Self.gap) {
      if !ChipsRow.isEmpty(model: model, pasteboard: pasteboard) {
        ChipsRow(model: model, pasteboard: pasteboard)
      }
      Spacer(minLength: 0)
      keyboardButton
    }
  }

  /// Quiet: getting the keyboard back is a door that is merely available, and
  /// the card's one prominent control is Send.
  private var keyboardButton: some View {
    Button {
      model.requestKeyboard()
    } label: {
      FieldGlyph(.keyboard, size: FieldGlyph.box(for: InputCardMetrics.glyphSize(for: dynamicTypeSize)))
        .foregroundStyle(ChromePalette.ink)
        .frame(width: side, height: side)
        .chromeGlass(radius: side / 2)
    }
    .buttonStyle(KeyPressStyle(radius: side / 2))
    .accessibilityLabel("Show the keyboard")
  }
}
