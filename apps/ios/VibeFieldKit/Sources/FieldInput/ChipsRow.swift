import FieldDesign
import SwiftUI

/// The contextual row above the card: what the agent is asking, and what the
/// pasteboard is offering.
///
/// It is the design's one row of context (§4's anatomy), and it is present only
/// when it has something to say — absent, never an empty strip.
///
/// **IOS-5v — the chips are glass pills.** They used to wear the waiting tier's
/// full-contrast inversion, which is how the godview language says "this needs
/// you". The canvas draws them as the card's own material at 36 pt with a 24 pt
/// number circle inside, and carries NO status hue at all. That is the right
/// answer here for a reason DESIGN.md §2.5 states: color in this app means one
/// thing each and is never decorative — and the row's mere PRESENCE is already
/// the signal, since it exists only while an agent is waiting. A row of orange
/// pills would say the same thing twice and leave nothing louder for the one
/// state that is genuinely wrong.
struct ChipsRow: View {
  let model: InputCardModel
  /// Absent on a card with no watcher — the demo fixture, and any host that
  /// has not asked for the paste chip.
  let pasteboard: PasteboardWatcher?

  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  // --- end IOS-5e -----------------------------------------------------------

  /// The chips row's own height (`.chip`, 36 pt). Shorter than a key: this row
  /// is context, and the design draws it smaller than the card it sits on.
  /// IOS-5e took the whole card up one step at accessibility sizes; this row
  /// goes with it (`InputCardMetrics.chipHeight`), and `height` is the base
  /// step, which is what `ClosedRow` and `PasteChip` measure against.
  static let height: CGFloat = 36
  /// `.chips` — the gap between two chips.
  private static let gap: CGFloat = 8
  /// `.chip .n` — the number's circle, and the label's own gap from it.
  private static let baseNumberSide: CGFloat = 24

  /// Whether the row has anything at all. The parent asks before rendering, so
  /// the absence is the row's own and not an empty container.
  static func isEmpty(model: InputCardModel, pasteboard: PasteboardWatcher?) -> Bool {
    model.chips.isEmpty && !(pasteboard?.hasNewContent ?? false)
  }

  private var chipHeight: CGFloat { InputCardMetrics.chipHeight(for: dynamicTypeSize) }
  private var labelSize: CGFloat { InputCardMetrics.chipLabelSize(for: dynamicTypeSize) }
  private var numberSide: CGFloat {
    dynamicTypeSize.isAccessibilitySize ? Self.baseNumberSide + 4 : Self.baseNumberSide
  }

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
    // make "Yes, don't ask" and "No" the same chip at a glance.
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
            // answer turns out to be Cancel on the review sheet. The
            // pasteboard still holds the text and the field's own edit menu
            // still offers Paste; what has been spent is the CHIP, which
            // exists to say "there is something new here" and has said it.
            pasteboard.markSeen()
          }
          // The hairline is ours, drawn OVER the control: its configuration
          // offers a fill and a corner style but no border, and without one the
          // pill has no edge against a pale sheet — witnessed in the simulator,
          // where the chip read as loose text rather than as a chip.
          .overlay(
            Capsule().strokeBorder(ChromePalette.cardHairline, lineWidth: 0.5)
          )
        }
      }
      // Half a hairline of room, so a chip's own edge is not clipped by the
      // scroll view it rides in.
      .padding(.vertical, 1)
    }
    .frame(height: rowHeight + 2)
    // A row that fits should not rubber-band; one that overflows still should.
    .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
    // --- IOS-5e: what this row IS, said before its chips are read.
    //
    // Four buttons labelled `1 Yes`, `2 Yes, don't ask`, `3 No`, `Esc` are
    // unreadable out of context — they are answers to a question that is on a
    // desktop's screen, not on this phone's. The container says whose question
    // it is. `.contain` because each chip still has to be tapped on its own.
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Replies for the waiting agent")
    // --- end IOS-5e
  }

  /// `.chip` — a 36 pt glass pill: the number in its own circle at the left, the
  /// answer beside it, 14 semibold.
  private func replyChip(_ chip: ReplyChip) -> some View {
    Button {
      model.tapChip(chip)
      // IOS-5e: light, the arm's own texture. The chip commits something — `1`
      // goes down the wire — but it leaves nothing behind for the user to
      // carry, and weight on this card is reserved for state that is still on.
      InputHaptics.chip()
    } label: {
      HStack(spacing: 8) {
        if let number = chip.number {
          Text(number)
            .font(
              ChromeType.mono(
                dynamicTypeSize.isAccessibilitySize
                  ? ChromeType.chipNumberSize + 2 : ChromeType.chipNumberSize, .bold)
            )
            .foregroundStyle(ChromePalette.ink)
            .frame(width: numberSide, height: numberSide)
            .background(Circle().fill(ChromePalette.chipNumberFill))
        }
        Text(chip.label)
          .font(ChromeType.sans(labelSize, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
      }
      // `.chip` padding `0 14 0 6`, and `.chip.plain`'s `0 14` when there is no
      // circle to inset against.
      .padding(.leading, chip.number == nil ? 14 : 6)
      .padding(.trailing, 14)
      .frame(height: chipHeight)
      .chromeGlass(radius: chipHeight / 2)
    }
    .buttonStyle(KeyPressStyle(radius: chipHeight / 2))
    .accessibilityLabel(chip.spokenLabel)
  }
}
