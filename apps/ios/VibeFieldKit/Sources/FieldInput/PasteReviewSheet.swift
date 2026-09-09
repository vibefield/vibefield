import FieldDesign
import SwiftUI

/// A long paste, shown before it goes through.
///
/// Only the terminal path reaches here. A paste into the draft is already
/// visible — it is sitting in the field, editable, and nothing has left the
/// phone. A paste straight into a live shell is not: it lands in whatever is
/// running, and five lines of anything is long enough that the user may not
/// remember what they copied. So the threshold buys one look, and the look is
/// the whole sheet — this view offers no editing, because a paste the user
/// wants to change is a paste that belongs in the draft.
public struct PasteReviewSheet: View {
  private let text: String
  // --- IOS-5d: what SEND will do, so the sheet can say it.
  private let commit: PendingPaste.Commit
  // --- end IOS-5d
  private let onSend: () -> Void
  private let onCancel: () -> Void

  public init(
    text: String,
    // --- IOS-5d: defaulted, so IOS-5c's one call site is unchanged. The
    // paste chip's text never runs; a snippet's may.
    commit: PendingPaste.Commit = .paste,
    // --- end IOS-5d
    onSend: @escaping () -> Void,
    onCancel: @escaping () -> Void
  ) {
    self.text = text
    self.commit = commit
    self.onSend = onSend
    self.onCancel = onCancel
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // `textMuted` like the write-key sheet's eyebrow, for the same reason:
      // this sheet sits over the field, where a bright bubble behind the glass
      // leaves a faint eyebrow unreadable in light mode.
      Text(eyebrow)
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.18, of: 9))
        .foregroundStyle(FieldPalette.textMuted)

      Text(lineSummary)
        .font(FieldType.mono(12, .medium))
        .foregroundStyle(FieldPalette.textMain)
        .padding(.top, 6)

      Text(promise)
        .font(FieldType.mono(9))
        .foregroundStyle(FieldPalette.textMuted)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 10)

      preview
        .padding(.top, 16)

      acts
        .padding(.top, 16)

      Spacer(minLength: 0)
    }
    .padding(.horizontal, 22)
    .padding(.top, 26)
    .frame(maxWidth: .infinity, alignment: .leading)
    // No background: the sheet's liquid glass is the surface.
  }

  // --- IOS-5d ---------------------------------------------------------------
  /// The heading. A snippet that runs is a different question from a paste,
  /// and asking it under the same word would be the sheet agreeing to
  /// something it was not shown.
  private var eyebrow: String {
    commit == .run ? "RUN IN TERMINAL" : "PASTE INTO TERMINAL"
  }

  /// The one line under the count, and the only place on this card where a
  /// wrong sentence would cost something: SEND on a snippet marked "sends
  /// Enter" runs the block, and the sheet has to say so before the tap.
  private var promise: String {
    switch commit {
    case .paste, .type:
      return "it goes in as one block, and nothing runs until you press Enter"
    case .run:
      return "it goes in as one block AND RUNS — this snippet sends Enter"
    }
  }
  // --- end IOS-5d -------------------------------------------------------------

  private var lineSummary: String {
    let count = pasteLineCount(text)
    return count == 1 ? "1 line" : "\(count) lines"
  }

  /// The text, mono, scrolling vertically.
  ///
  /// Long lines WRAP rather than scrolling sideways. That is a display choice
  /// and the line above it is what keeps it honest — what is sent is one
  /// block, whatever this box had to do to show it on a phone. The two-axis
  /// version was tried first and was worse in a way worth recording: a
  /// horizontal scroll view proposes no width, so the text lost its leading
  /// alignment and sat centred in the box, which read as a layout bug.
  private var preview: some View {
    ScrollView(.vertical) {
      Text(text)
        .font(FieldType.mono(11))
        .foregroundStyle(FieldPalette.textMain)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
    }
    .frame(maxHeight: 220)
    .background(RoundedRectangle(cornerRadius: 6).fill(FieldPalette.panelBackground.opacity(0.45)))
    .overlay(
      RoundedRectangle(cornerRadius: 6).strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
  }

  private var acts: some View {
    HStack(spacing: 10) {
      Button(action: onSend) {
        Text("SEND")
          .font(FieldType.mono(11, .heavy))
          .tracking(FieldType.tracking(0.12, of: 11))
          .foregroundStyle(FieldPalette.panelBackground)
          .padding(.horizontal, 18)
          .padding(.vertical, 9)
          .background(RoundedRectangle(cornerRadius: 8).fill(FieldPalette.textMain))
      }
      .buttonStyle(.plain)

      Button(action: onCancel) {
        Text("CANCEL")
          .font(FieldType.mono(11, .heavy))
          .tracking(FieldType.tracking(0.12, of: 11))
          .foregroundStyle(FieldPalette.textMain)
          .padding(.horizontal, 18)
          .padding(.vertical, 9)
          .overlay(
            RoundedRectangle(cornerRadius: 8)
              .strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
      }
      .buttonStyle(.plain)
    }
  }
}
