import FieldDesign
import SwiftUI

/// Paste, replies, and the keyboard control float over the terminal in both
/// input states. Only InputCard reserves space for the composer and key rail;
/// these controls never change the terminal's grid when they appear or leave.
public struct InputOverlay: View {
  let model: InputCardModel
  let pasteboard: PasteboardWatcher?
  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  // --- end IOS-5e -----------------------------------------------------------

  public init(model: InputCardModel, pasteboard: PasteboardWatcher? = nil) {
    self.model = model
    self.pasteboard = pasteboard
  }

  /// F1's canvas: the chips 12 from the left edge and the key 16 from the
  /// right, 12 between them, raised above the home indicator's safe area.
  private static let gap: CGFloat = 12
  private static let leading: CGFloat = 12
  private static let trailing: CGFloat = 16
  private static let lift: CGFloat = 12
  private static let buttonGrowth: CGFloat = 8
  /// Breathing room between the held-seat message and the floating controls.
  private static let messageClearance: CGFloat = 18

  private var rowHeight: CGFloat { InputCardMetrics.rowHeight(for: dynamicTypeSize) }

  private var side: CGFloat {
    rowHeight + Self.buttonGrowth
  }

  /// The overlay's reading footprint, used only to center the held-seat
  /// message above the controls. It never changes the terminal's safe area.
  public static func footprint(for size: DynamicTypeSize) -> CGFloat {
    InputCardMetrics.rowHeight(for: size) + buttonGrowth + lift + messageClearance
  }

  public var body: some View {
    row
      .padding(.bottom, Self.lift)
      .frame(maxWidth: InputCardMetrics.maximumWidth + Self.leading + Self.trailing)
      .frame(maxWidth: .infinity)
      .animation(FieldMotion.ease(0.24), value: model.chips)
      .animation(FieldMotion.ease(0.24), value: pasteboard?.hasNewContent ?? false)
      .animation(FieldMotion.ease(0.24), value: model.keyboardOwner)
  }

  /// Only the controls take touches; the space between them remains terminal.
  private var row: some View {
    HStack(alignment: .bottom, spacing: Self.gap) {
      if !ChipsRow.isEmpty(model: model, pasteboard: pasteboard) {
        ChipsRow(model: model, pasteboard: pasteboard)
      }
      Spacer(minLength: 0)
      if model.keyboardOwner == .none {
        keyboardButton
      } else {
        dismissKeyboardButton
      }
    }
    .padding(.leading, Self.leading)
    .padding(.trailing, Self.trailing)
  }

  private var dismissKeyboardButton: some View {
    Button {
      model.dismissKeyboard()
    } label: {
      Image(systemName: "keyboard.chevron.compact.down")
        .font(.system(size: InputCardMetrics.glyphSize(for: dynamicTypeSize), weight: .medium))
        .foregroundStyle(ChromePalette.ink)
        .frame(width: rowHeight - 8, height: rowHeight - 8)
        .liquidGlassCircle(shadow: nil)
        .frame(width: rowHeight, height: rowHeight)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Hide the keyboard")
    .accessibilityIdentifier("terminal.hideKeyboard")
  }

  /// Quiet: getting the keyboard back is a door that is merely available, and
  /// the card's one prominent control is Send.
  private var keyboardButton: some View {
    Button {
      model.requestKeyboard()
    } label: {
      FieldGlyph(.keyboard, size: FieldGlyph.box(for: InputCardMetrics.glyphSize(for: dynamicTypeSize) + 2))
        .foregroundStyle(ChromePalette.ink)
        .frame(width: side, height: side)
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .liquidGlassCircle()
    .accessibilityLabel("Show the keyboard")
    .accessibilityIdentifier("terminal.showKeyboard")
  }
}
