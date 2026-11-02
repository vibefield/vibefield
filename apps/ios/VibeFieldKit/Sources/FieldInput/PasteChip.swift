import FieldDesign
import SwiftUI
import UIKit

/// A native glass paste action matching the floating keyboard control.
/// Read the clipboard only after the person taps. iOS owns paste permission;
/// if access is declined or the clipboard has changed, leave the offer alone.
/// UIPasteControl and SwiftUI PasteButton force a solid fill on iOS, so they
/// cannot draw the requested glass material without altering system internals.
struct PasteChip: View {
  let onText: (String) -> Void
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  static func height(for size: DynamicTypeSize) -> CGFloat {
    InputCardMetrics.rowHeight(for: size)
  }

  private var height: CGFloat { Self.height(for: dynamicTypeSize) }

  var body: some View {
    Button {
      guard let text = UIPasteboard.general.string, !text.isEmpty else { return }
      onText(text)
    } label: {
      Label("Paste", systemImage: "doc.on.clipboard")
        .font(.system(size: InputCardMetrics.glyphSize(for: dynamicTypeSize), weight: .medium))
        .foregroundStyle(ChromePalette.ink)
        .padding(.horizontal, 14)
        .frame(height: height - 8)
        .liquidGlassCapsule(shadow: nil)
        .frame(minHeight: height)
        .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("terminal.paste")
  }
}
