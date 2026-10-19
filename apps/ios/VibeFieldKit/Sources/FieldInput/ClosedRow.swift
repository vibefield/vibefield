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
///
/// **F1 (James, 2026-10-19 21:38Z) — it floats.** The row is no longer a band
/// under the terminal: the host lays it over the session card, and its keyboard
/// key and its reply chips stand over the grid's last rows, each on a local
/// clearing of the terminal's ground (DESIGN.md §8, "The phone's live card is
/// its terminal"). It holds no room, so the grid runs to the top of the home
/// indicator's safe area. It draws only while the keyboard is down; `InputCard`
/// draws the open card, which rides the bottom safe area as it always has.
public struct ClosedRow: View {
  let model: InputCardModel
  let pasteboard: PasteboardWatcher?
  /// The ground the row floats on — the terminal's, at its own opacity. Each
  /// control stands on a clearing of it, so the grid's text never runs into a
  /// chip's words.
  let clearing: Color
  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  // --- end IOS-5e -----------------------------------------------------------

  public init(model: InputCardModel, pasteboard: PasteboardWatcher?, clearing: Color) {
    self.model = model
    self.pasteboard = pasteboard
    self.clearing = clearing
  }

  /// F1's canvas: the chips 12 from the left edge and the key 16 from the
  /// right, 12 between them, the key's foot on the home indicator's safe area.
  private static let gap: CGFloat = 12
  private static let leading: CGFloat = 12
  private static let trailing: CGFloat = 16
  /// A clearing is the ground at 90% at its heart and clear at its edge: a
  /// circle 16 past the key all round, and an ellipse 14 past the chips' ends
  /// and 18 above and below them.
  private static let clearingStrength = 0.9
  private static let keyClearing: CGFloat = 16
  private static let chipsClearingX: CGFloat = 14
  private static let chipsClearingY: CGFloat = 18

  private var side: CGFloat { InputCardMetrics.rowHeight(for: dynamicTypeSize) }

  /// How much of the grid's foot the floating row stands over: its keys' row
  /// and the clearing above it, the chips' reach being the taller. What stands
  /// in the card's last rows (the seat readout's words) keeps above it
  /// (DESIGN.md §8).
  public static func footprint(for size: DynamicTypeSize) -> CGFloat {
    InputCardMetrics.rowHeight(for: size) + max(keyClearing, chipsClearingY)
  }

  public var body: some View {
    VStack(spacing: 0) {
      if model.keyboardOwner == .none {
        row
          .transition(.opacity)
      }
    }
    // --- IOS-5e: the card's widest, centred, as the open card's.
    .frame(maxWidth: InputCardMetrics.maximumWidth + Self.leading + Self.trailing)
    .frame(maxWidth: .infinity)
    .animation(FieldMotion.ease(0.24), value: model.chips)
    .animation(FieldMotion.ease(0.24), value: pasteboard?.hasNewContent ?? false)
    .animation(FieldMotion.ease(0.24), value: model.keyboardOwner)
  }

  /// `.row` — the chips row with one more thing on it. The air between them
  /// and the clearings take no touch, so a touch there reaches the terminal.
  private var row: some View {
    HStack(spacing: Self.gap) {
      if !ChipsRow.isEmpty(model: model, pasteboard: pasteboard) {
        ChipsRow(model: model, pasteboard: pasteboard)
          .background {
            EllipticalGradient(
              colors: [clearing.opacity(Self.clearingStrength), clearing.opacity(0)],
              center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5
            )
            .padding(.horizontal, -Self.chipsClearingX)
            .padding(.vertical, -Self.chipsClearingY)
            .allowsHitTesting(false)
          }
      }
      Spacer(minLength: 0)
      keyboardButton
        .background {
          RadialGradient(
            colors: [clearing.opacity(Self.clearingStrength), clearing.opacity(0)],
            center: .center, startRadius: 0, endRadius: side / 2 + Self.keyClearing
          )
          .frame(width: side + Self.keyClearing * 2, height: side + Self.keyClearing * 2)
          .allowsHitTesting(false)
        }
    }
    .padding(.leading, Self.leading)
    .padding(.trailing, Self.trailing)
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
