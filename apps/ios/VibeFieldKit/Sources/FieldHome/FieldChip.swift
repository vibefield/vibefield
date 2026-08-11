import FieldDesign
import SwiftUI

/// A quiet corner chip in the godview voice — the shape `MeshChip` established,
/// generalized for chrome that has no state to report.
///
/// It stays in the muted ramp on purpose: contrast is how this app says
/// "something needs you", and a door that is merely available needs nothing.
struct FieldChip: View {
  let label: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Text(label)
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.08, of: 9))
        .foregroundStyle(FieldPalette.textMuted)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
          RoundedRectangle(cornerRadius: 6).fill(FieldPalette.panelBackground.opacity(0.8))
        )
        .overlay(
          RoundedRectangle(cornerRadius: 6).strokeBorder(FieldPalette.panelBorder, lineWidth: 1)
        )
    }
    .buttonStyle(.plain)
  }
}
