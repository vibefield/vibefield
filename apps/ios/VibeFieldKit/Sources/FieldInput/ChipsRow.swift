import FieldDesign
import SwiftUI

/// The contextual row above the card: what the agent is asking, and what the
/// pasteboard is offering.
///
/// It is the design's one row of context (§4's anatomy), and it is present
/// only when it has something to say — absent, never an empty strip. The two
/// kinds of chip on it are deliberately different weights: a reply chip wears
/// the WAITING tier's full-contrast inversion, the same ink the bubble that
/// raised this card is wearing, because they are the same fact; the paste chip
/// is a quiet chip, because a pasteboard with something in it is an offer and
/// not a demand.
struct ChipsRow: View {
  let model: InputCardModel
  /// Absent on a card with no watcher — the demo fixture, and any host that
  /// has not asked for the paste chip.
  let pasteboard: PasteboardWatcher?

  /// The chips row's own height. Shorter than a key (44 pt): this row is
  /// context, and the design draws it smaller than the card it sits on.
  static let height: CGFloat = 32
  private static let gap: CGFloat = 6
  private static let cornerRadius: CGFloat = 6

  /// Whether the row has anything at all. The parent asks before rendering, so
  /// the absence is the row's own and not an empty container.
  static func isEmpty(model: InputCardModel, pasteboard: PasteboardWatcher?) -> Bool {
    model.chips.isEmpty && !(pasteboard?.hasNewContent ?? false)
  }

  /// 32 pt for the chips we draw. When the system paste control is on the row
  /// its own intrinsic height wins, because a protected system control that is
  /// squashed stops drawing itself and falls back to a bare fill.
  private var rowHeight: CGFloat {
    (pasteboard?.hasNewContent ?? false) ? max(Self.height, PasteChip.height) : Self.height
  }

  var body: some View {
    // Horizontal scrolling because four Claude chips plus a paste chip do not
    // fit a phone's width, and the alternative — truncating the labels — would
    // make "2 YES, DON'T ASK" and "3 NO" the same chip at a glance.
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: Self.gap) {
        ForEach(model.chips) { chip in
          replyChip(chip)
        }
        if let pasteboard, pasteboard.hasNewContent {
          // Rightmost, and last in reading order: the agent's question is what
          // the row is for when there is one.
          PasteChip { text in
            model.acceptPaste(text)
            // The offer has been answered, so the chip retires — even when the
            // answer turns out to be CANCEL on the review sheet. The
            // pasteboard still holds the text and the field's own edit menu
            // still offers Paste; what has been spent is the CHIP, which
            // exists to say "there is something new here" and has said it.
            pasteboard.markSeen()
          }
          // The hairline is ours, drawn OVER the control: its configuration
          // offers a fill and a radius but no border, and in light mode its
          // `panelBackground` fill is the same white as the sheet under it —
          // witnessed in the simulator, where the chip read as loose text
          // rather than as a chip until this line existed.
          .overlay(
            RoundedRectangle(cornerRadius: Self.cornerRadius)
              .strokeBorder(FieldPalette.panelBorder, lineWidth: 1)
          )
        }
      }
    }
    .frame(height: rowHeight)
    // A row that fits should not rubber-band; one that overflows still should.
    .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
  }

  private func replyChip(_ chip: ReplyChip) -> some View {
    Button {
      model.tapChip(chip)
    } label: {
      Text(chip.label)
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.08, of: 9))
        .foregroundStyle(FieldPalette.waitingText)
        .lineLimit(1)
        .padding(.horizontal, 10)
        .frame(height: Self.height)
        .background(
          RoundedRectangle(cornerRadius: Self.cornerRadius).fill(FieldPalette.waitingBackground)
        )
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(chip.label)
  }
}
