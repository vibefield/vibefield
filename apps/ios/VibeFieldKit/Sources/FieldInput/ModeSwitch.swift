import FieldDesign
import SwiftUI

/// The input card's mode switch (PF-8, 2026-11-22; DESIGN.md §8 "The phone's
/// input card is one row in each of its two modes"): one capsule of two
/// halves, the message glyph and the prompt glyph, on the floating row beside
/// the fold key.
///
/// It shows both modes at all times, and the solid half is the one in force.
/// With the keyboard up the other half changes the mode. With it down the
/// switch is the two doors: it stands at the size the keyboard key had, and
/// either half raises the keyboard in its own mode.
///
/// The copy rule holds here too: the word "Live" never reaches the screen or
/// a screen reader. The halves say what a tap does.
struct ModeSwitch: View {
  let model: InputCardModel
  /// The keyboard is down, so each half is a door.
  let doors: Bool
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var rowHeight: CGFloat { InputCardMetrics.rowHeight(for: dynamicTypeSize) }
  /// A half's drawn size: 40 by 32 beside the fold key, 50 by 44 as a door.
  private var halfSize: CGSize { ModeSwitch.halfSize(rowHeight: rowHeight, doors: doors) }
  private var inset: CGFloat { ModeSwitch.inset(doors: doors) }
  /// The touch a half takes: the row's own 44 beside the fold key (the drawn
  /// half is shorter), and the whole door with the keyboard down.
  private var touchHeight: CGFloat { max(rowHeight, halfSize.height + inset * 2) }
  private var glyphSize: CGFloat { InputCardMetrics.glyphSize(for: dynamicTypeSize) + (doors ? 2 : 0) }

  static func halfSize(rowHeight: CGFloat, doors: Bool) -> CGSize {
    doors ? CGSize(width: rowHeight + 6, height: rowHeight) : CGSize(width: rowHeight - 4, height: rowHeight - 12)
  }

  static func inset(doors: Bool) -> CGFloat { doors ? 4 : 3 }

  /// The capsule's size: 88 by 38 beside the fold key, 110 by 52 as the doors.
  static func size(rowHeight: CGFloat, doors: Bool) -> CGSize {
    let half = halfSize(rowHeight: rowHeight, doors: doors)
    let inset = inset(doors: doors)
    return CGSize(width: half.width * 2 + gap + inset * 2, height: half.height + inset * 2)
  }

  static let gap: CGFloat = 2

  var body: some View {
    let size = ModeSwitch.size(rowHeight: rowHeight, doors: doors)
    return ZStack {
      // The glass is its own layer, at the capsule's size, so a half can take
      // a touch taller than the capsule it is drawn in.
      Color.clear
        .frame(width: size.width, height: size.height)
        .liquidGlassCapsule(interactive: false)
      HStack(spacing: ModeSwitch.gap) {
        half(.draft, glyph: .message, label: "Write a message", identifier: "terminal.mode.message")
        half(.live, glyph: .prompt, label: "Type into the terminal", identifier: "terminal.mode.terminal")
      }
    }
    .frame(height: touchHeight)
    .animation(reduceMotion ? nil : FieldMotion.ease(0.18), value: model.mode)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Typing mode")
  }

  private func half(
    _ mode: InputCardModel.Mode, glyph: FieldGlyphName, label: String, identifier: String
  ) -> some View {
    let inForce = model.mode == mode
    return Button {
      let changes = !inForce
      model.enter(mode)
      // Said after the change, so it names the mode now in force. A door that
      // only raises the keyboard changes no mode and says nothing.
      if changes { InputAnnouncement.post(InputAnnouncement.mode(model.mode)) }
    } label: {
      FieldGlyph(glyph, size: FieldGlyph.box(for: glyphSize))
        .foregroundStyle(inForce ? ChromePalette.keyOnInk : ChromePalette.inkSecondary)
        .frame(width: halfSize.width, height: halfSize.height)
        .background {
          Capsule().fill(inForce ? ChromePalette.keyOnFill : Color.clear)
        }
        .frame(height: touchHeight)
        .contentShape(Rectangle())
    }
    .buttonStyle(ChromePressStyle())
    .accessibilityLabel(label)
    .accessibilityAddTraits(inForce ? .isSelected : [])
    .accessibilityIdentifier(identifier)
  }
}
