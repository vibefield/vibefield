import FieldDesign
import FieldMarkdown
import SwiftUI

// Item 362f (James, 2026-11-12 18:40:35Z, of the phone's History session view against the desktop's: "i think all
// message type and views are different from desktop, needs thorough audit") — A MESSAGE, WHOLE, ON A SHEET OF ITS
// OWN. The document draws a long prompt or reply to the room's bound (`HistoryWords.excerpt`) with `View full
// message` under it; this is where that goes: who said it and when, and all the words the document holds, at the
// document's measure. The room opens its file viewer for the same press (`MessagePreview.tsx`).
//
// The words are read once, when the sheet is made, and laid out a block at a time as it is read, so a message of
// many screens does not build them all at once. They are selectable. As everywhere in the document, a recorded
// text is the adversary's (EL7): a link is its words, and nothing on this sheet opens anything.
// DESIGN.md §8 "The phone's session document" → a long message.

/// The message a sheet was opened for.
struct HistoryWholeMessage: Identifiable, Equatable {
  let id: String
  /// The agent's name, or `You`.
  let who: String
  /// When it was said, as the document says it.
  let at: String
  let text: String
  /// `clipped · 14 KB on studio`, when the desktop cut the words the document holds; nil when they are whole.
  let cut: String?
}

struct HistoryMessageView: View {
  let message: HistoryWholeMessage
  private let reading: HistoryWords.Reading
  @Environment(\.dismiss) private var dismiss

  init(message: HistoryWholeMessage) {
    self.message = message
    reading = HistoryWords.reading(message.text)
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(verbatim: message.who)
          .font(ChromeType.sans(15, .semibold))
          .foregroundStyle(ChromePalette.ink)
          .lineLimit(1)
        Text(verbatim: message.at)
          .font(ChromeType.sans(12.5))
          .monospacedDigit()
          .foregroundStyle(ChromePalette.inkTertiary)
        Spacer(minLength: 8)
        Button("Done") { dismiss() }
          .font(ChromeType.sans(15, .medium))
          .foregroundStyle(ChromePalette.inkSecondary)
          .frame(minWidth: 44, minHeight: 44, alignment: .trailing)
      }
      .padding(.leading, 20)
      .padding(.trailing, 16)
      .padding(.top, 14)
      Rectangle()
        .fill(ChromePalette.cardHairline)
        .frame(height: 0.5)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: HistoryWords.reply.blockGap) {
          switch reading {
          case .blank:
            words("(no words)").foregroundStyle(ChromePalette.inkTertiary)
          case .typed(let typed):
            words(typed).foregroundStyle(ChromePalette.ink)
          case .blocks(let blocks):
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
              ChatMarkdownView(blocks: [block], measure: HistoryWords.reply)
            }
          }
          if let cut = message.cut {
            HistoryCutNote(words: cut)
              .padding(.top, 6)
          }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 32)
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
      }
    }
  }

  private func words(_ text: String) -> some View {
    Text(verbatim: text)
      .font(ChromeType.sans(HistoryWords.reply.size))
      .lineSpacing(HistoryWords.reply.lineSpacing)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// SP-6 — the honest-state line under words the desktop cut: `clipped · 14 KB on studio`, the record's voice,
/// never a body that reads as whole. One view: under the words in the document and at the foot of this sheet.
struct HistoryCutNote: View {
  let words: String

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "scissors")
        .font(.system(size: 10.5, weight: .medium))
      Text(words)
        .font(ChromeType.sans(11.5))
        .monospacedDigit()
        .lineLimit(1)
    }
    .foregroundStyle(ChromePalette.inkTertiary)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(words)
  }
}
