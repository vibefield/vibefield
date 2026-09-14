import FieldDesign
import SwiftUI

/// A quiet corner chip in the godview voice — the shape `MeshChip` established,
/// generalized for the chrome beside it.
///
/// It stays in the muted ramp on purpose: contrast is how this app says
/// "something needs you", and a door that is merely available needs nothing.
/// `wantsAttention` is that rule's other half, and it is the SAME treatment
/// `MeshChip` wears for a sign-in — the chip inverts, and no hue is introduced
/// (DESIGN.md §1.1 scopes the instrument palette to this corner, and §2.5's
/// colours mean things a chip does not).
///
/// A chip with no `action` is a FACT rather than a control. D-i6 forbids the
/// dead affordance, and a chip that opened a sheet holding nothing about this
/// chip's own subject would be exactly that.
struct FieldChip: View {
  let label: String
  var wantsAttention: Bool = false
  var action: (() -> Void)?

  var body: some View {
    if let action {
      Button(action: action) { face }
        .buttonStyle(.plain)
    } else {
      face.allowsHitTesting(false)
    }
  }

  private var face: some View {
    Text(label)
      .font(FieldType.mono(9, .heavy))
      .tracking(FieldType.tracking(0.08, of: 9))
      .foregroundStyle(wantsAttention ? FieldPalette.panelBackground : FieldPalette.textMuted)
      .padding(.horizontal, 8)
      .padding(.vertical, 5)
      .background(
        RoundedRectangle(cornerRadius: 6)
          .fill(
            wantsAttention ? FieldPalette.textMain : FieldPalette.panelBackground.opacity(0.8))
      )
      .overlay(
        RoundedRectangle(cornerRadius: 6).strokeBorder(FieldPalette.panelBorder, lineWidth: 1)
      )
  }
}
