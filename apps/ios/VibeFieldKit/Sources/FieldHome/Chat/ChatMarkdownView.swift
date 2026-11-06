import FieldDesign
import FieldProduct
import SwiftUI

// IOS-12c (PC-L1; DESIGN.md §8 "The phone's Chat" → its words; the Mac's `.vf-chat-reply-text`, at touch pitch) — A
// SPARK'S WORDS, DRAWN: `ChatMarkdown.blocks`, never markup (EL7), 17 regular at 1.35 in primary ink. Paragraphs keep
// their line breaks, a heading is a bold paragraph, bold is 600; `code` is 15/500 mono on the fill (`ChatInk`); fenced
// code is the same mono at 1.45 on the fill, corners 10, padded 10 12, scrolling within itself; a list's marker stands
// in a column of 24; a quote is set in by 10 behind a 2-wide strong hairline, in secondary ink. Blocks stand 10 apart.

struct ChatMarkdownView: View {
  let blocks: [ChatMarkdownBlock]

  static let size: CGFloat = 17
  /// 17 at 1.35: SF's own line at 17 is about 20.3, so the lines gain 2.7.
  static let lineSpacing: CGFloat = 2.7
  static let blockGap: CGFloat = 10

  var body: some View {
    ChatMarkdownBlocks(blocks: blocks)
      .font(ChromeType.sans(Self.size))
      .foregroundStyle(ChromePalette.ink)
      .frame(maxWidth: .infinity, alignment: .leading)
      // the Mac's padded 4 at the top, so a lead's first line sits beside its face
      .padding(.top, 3)
  }

  /// One line's runs as a Text: bold and italic as the run says, `code` marked for `ChatInkRenderer`.
  static func text(_ runs: [ChatMarkdownRun], index: inout Int) -> Text {
    runs.reduce(Text(verbatim: "")) { inked, run in
      let part: Text
      switch run {
      case .text(let words):
        part = Text(verbatim: words)
      case .bold(let inner):
        part = text(inner, index: &index).fontWeight(.semibold)
      case .italic(let inner):
        part = text(inner, index: &index).italic()
      case .code(let words):
        index += 1
        part = ChatInk.marked(Text(verbatim: words).font(ChromeType.mono(15, .medium)), .code, index, room: 5)
      }
      return Text("\(inked)\(part)")
    }
  }

  /// A paragraph's or an item's lines, their breaks kept.
  static func text(lines: [ChatMarkdownLine]) -> Text {
    var index = 0
    return lines.enumerated().reduce(Text(verbatim: "")) { inked, line in
      let words = text(line.element, index: &index)
      return line.offset == 0 ? words : Text("\(inked)\(Text(verbatim: "\n"))\(words)")
    }
  }
}

/// The blocks, 10 apart; a quote holds blocks of its own.
private struct ChatMarkdownBlocks: View {
  let blocks: [ChatMarkdownBlock]

  var body: some View {
    VStack(alignment: .leading, spacing: ChatMarkdownView.blockGap) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
        self.block(block)
      }
    }
  }

  @ViewBuilder
  private func block(_ block: ChatMarkdownBlock) -> some View {
    switch block {
    case .paragraph(let lines, let strong):
      prose(ChatMarkdownView.text(lines: lines).fontWeight(strong ? .semibold : nil))
    case .code(let code):
      ScrollView(.horizontal, showsIndicators: false) {
        Text(verbatim: code)
          .font(ChromeType.mono(15))
          // 15 at 1.45: SF Mono's own line at 15 is about 17.9
          .lineSpacing(3.9)
          .fixedSize()
          .padding(.vertical, 10)
          .padding(.horizontal, 12)
      }
      .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(ChromePalette.fill))
    case .list(let ordered, let items):
      VStack(alignment: .leading, spacing: 4) {
        ForEach(Array(items.enumerated()), id: \.offset) { at, item in
          HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(verbatim: ordered ? "\(at + 1)." : "•")
              .monospacedDigit()
              .frame(width: 24, alignment: .leading)
            prose(ChatMarkdownView.text(lines: item))
          }
        }
      }
    case .quote(let inner):
      // a quote holds blocks: drawn through a type-erased view, since a view can't hold its own type
      AnyView(ChatMarkdownBlocks(blocks: inner))
        .foregroundStyle(ChromePalette.inkSecondary)
        .padding(.leading, 10)
        .overlay(alignment: .leading) {
          Rectangle().fill(ChromePalette.ruleStrong).frame(width: 2)
        }
    }
  }

  private func prose(_ text: Text) -> some View {
    text
      .lineSpacing(ChatMarkdownView.lineSpacing)
      .textRenderer(ChatInkRenderer())
      .fixedSize(horizontal: false, vertical: true)
  }
}
