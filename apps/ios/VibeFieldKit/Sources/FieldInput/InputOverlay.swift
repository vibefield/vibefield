import FieldDesign
import SwiftUI

/// The row of paste, replies, the mode switch and the fold key, over the input
/// card.
///
/// **With the keyboard up it is a shelf** (PF-11, 2026-11-22; DESIGN.md §8
/// "The phone's input card is one row in each of its two modes"): it keeps one
/// row's height between the grid and the card, so the grid ends above it and
/// nothing covers a program's last lines while a person types. Until then it
/// floated there, over the two lines a prompt and a program's footer stand on.
/// **With the keyboard down it floats** over the grid's last rows and keeps no
/// room, as before: it is a frame of no height, and the row stands up out of
/// it.
///
/// One view for both, mounted once above the card (`InputDock`), so the row is
/// the same view as the keyboard comes and goes.
///
/// The mode switch stands at the row's right in both states (PF-8,
/// 2026-11-22): beside the fold key with the keyboard up, and alone, as the
/// two doors, with it down, where one keyboard key stood.
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
  /// PF-11 — shelved, the row sits this far over the card: with the 3pt the
  /// switch's capsule stands inside its 44pt row, the controls are 5 over it.
  static let shelfGap: CGFloat = 2
  private static let buttonGrowth: CGFloat = 8
  /// Breathing room between the held-seat message and the floating controls.
  private static let messageClearance: CGFloat = 18

  private var rowHeight: CGFloat { InputCardMetrics.rowHeight(for: dynamicTypeSize) }

  /// The floating row's reading footprint, at its tallest (the doors, which
  /// stand `buttonGrowth` over a row). It is used only to center the held-seat
  /// message above the controls, and never changes the terminal's safe area.
  /// (A held seat folds the keyboard, so the row it clears is the floating one.)
  public static func footprint(for size: DynamicTypeSize) -> CGFloat {
    InputCardMetrics.rowHeight(for: size) + buttonGrowth + lift + messageClearance
  }

  /// PF-11 — whether the row is a shelf: while anything holds the keyboard.
  static func shelved(_ owner: InputCardModel.KeyboardOwner) -> Bool { owner != .none }

  /// PF-11 — the room the row keeps between the grid and the card: one row's
  /// height as a shelf, and none floating.
  static func reserved(shelved: Bool, rowHeight: CGFloat) -> CGFloat { shelved ? rowHeight : 0 }

  public var body: some View {
    let shelved = Self.shelved(model.keyboardOwner)
    row
      .padding(.bottom, shelved ? Self.shelfGap : Self.lift)
      // The frame is the room kept. Floating it is none, and the row stands up
      // out of it over the grid; shelved it is the row's own height, and the
      // gap under the row lifts the row's top that much past it, where only
      // its touch area reaches.
      .frame(height: Self.reserved(shelved: shelved, rowHeight: rowHeight), alignment: .bottom)
      .frame(maxWidth: InputCardMetrics.maximumWidth + Self.leading + Self.trailing)
      .frame(maxWidth: .infinity)
      .animation(FieldMotion.ease(0.24), value: model.chips)
      .animation(FieldMotion.ease(0.24), value: pasteboard?.hasNewContent ?? false)
      .animation(FieldMotion.ease(0.24), value: model.keyboardOwner)
  }

  /// Only the controls take touches; floating, the space between them remains
  /// terminal.
  private var row: some View {
    HStack(alignment: .bottom, spacing: Self.gap) {
      if !ChipsRow.isEmpty(model: model, pasteboard: pasteboard) {
        ChipsRow(model: model, pasteboard: pasteboard)
      }
      Spacer(minLength: 0)
      ModeSwitch(model: model, doors: model.keyboardOwner == .none)
      if model.keyboardOwner != .none {
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
}
