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

  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  // --- end IOS-5e -----------------------------------------------------------

  /// The chips row's own height. Shorter than a key (44 pt): this row is
  /// context, and the design draws it smaller than the card it sits on. IOS-5e
  /// took the whole card up one step at accessibility sizes; this row goes with
  /// it (`InputCardMetrics.chipHeight`), and `height` is the base step, which
  /// is what `ClosedRow` and `PasteChip` measure themselves against.
  static let height: CGFloat = 32
  private static let gap: CGFloat = 6
  private static let cornerRadius: CGFloat = 6

  /// Whether the row has anything at all. The parent asks before rendering, so
  /// the absence is the row's own and not an empty container.
  static func isEmpty(model: InputCardModel, pasteboard: PasteboardWatcher?) -> Bool {
    model.chips.isEmpty && !(pasteboard?.hasNewContent ?? false)
  }

  private var chipHeight: CGFloat { InputCardMetrics.chipHeight(for: dynamicTypeSize) }
  private var labelSize: CGFloat { InputCardMetrics.labelSize(for: dynamicTypeSize) }

  /// The chip height for the reader's text size. When the system paste control
  /// is on the row its own intrinsic height wins, because a protected system
  /// control that is squashed stops drawing itself and falls back to a bare
  /// fill — and that control reads the text size on its own, so at
  /// accessibility sizes it is the taller of the two and the row follows it.
  private var rowHeight: CGFloat {
    (pasteboard?.hasNewContent ?? false) ? max(chipHeight, PasteChip.height) : chipHeight
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
    // --- IOS-5e: what this row IS, said before its chips are read.
    //
    // Four buttons labelled `1 YES`, `2 YES, DON'T ASK`, `3 NO`, `ESC` are
    // unreadable out of context — they are answers to a question that is on a
    // desktop's screen, not on this phone's. The container says whose question
    // it is. `.contain` because each chip still has to be tapped on its own.
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Replies for the waiting agent")
    // --- end IOS-5e
  }

  private func replyChip(_ chip: ReplyChip) -> some View {
    Button {
      model.tapChip(chip)
      // IOS-5e: light, the arm's own texture. The chip commits something — `1`
      // goes down the wire — but it leaves nothing behind for the user to
      // carry, and weight on this card is reserved for state that is still on.
      InputHaptics.chip()
    } label: {
      Text(chip.label)
        .font(FieldType.mono(labelSize, .heavy))
        .tracking(FieldType.tracking(0.08, of: labelSize))
        .foregroundStyle(FieldPalette.waitingText)
        .lineLimit(1)
        .padding(.horizontal, 10)
        .frame(height: chipHeight)
        .background(
          RoundedRectangle(cornerRadius: Self.cornerRadius).fill(FieldPalette.waitingBackground)
        )
    }
    .buttonStyle(KeyPressStyle())
    .accessibilityLabel(chip.label)
  }
}
