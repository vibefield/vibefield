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
struct ClosedRow: View {
  let model: InputCardModel
  let pasteboard: PasteboardWatcher?
  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  // --- end IOS-5e -----------------------------------------------------------

  private static let gap: CGFloat = 6
  private static let cornerRadius: CGFloat = 6

  var body: some View {
    HStack(spacing: Self.gap) {
      if !ChipsRow.isEmpty(model: model, pasteboard: pasteboard) {
        ChipsRow(model: model, pasteboard: pasteboard)
      } else {
        Spacer(minLength: 0)
      }
      keyboardChip
    }
  }

  /// Quiet, in `FieldChip`'s ramp: getting the keyboard back is a door that is
  /// merely available, and contrast in this app means something needs you.
  private var keyboardChip: some View {
    Button {
      model.requestKeyboard()
    } label: {
      Text("KEYBOARD")
        .font(FieldType.mono(InputCardMetrics.labelSize(for: dynamicTypeSize), .heavy))
        .tracking(
          FieldType.tracking(0.08, of: InputCardMetrics.labelSize(for: dynamicTypeSize))
        )
        .foregroundStyle(FieldPalette.textMuted)
        .lineLimit(1)
        .padding(.horizontal, 10)
        // IOS-5e: the same step the chips beside it take, so the closed row
        // stays one row of one height.
        .frame(height: InputCardMetrics.chipHeight(for: dynamicTypeSize))
        .background(
          RoundedRectangle(cornerRadius: Self.cornerRadius)
            .fill(FieldPalette.panelBackground.opacity(0.8))
        )
        .overlay(
          RoundedRectangle(cornerRadius: Self.cornerRadius)
            .strokeBorder(FieldPalette.panelBorder, lineWidth: 1)
        )
    }
    .buttonStyle(KeyPressStyle())
    .fixedSize()
    .accessibilityLabel("Show the keyboard")
  }
}
