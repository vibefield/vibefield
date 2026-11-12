import FieldDesign
import FieldProduct
import SwiftUI

// IOS-12c (PC-L1; DESIGN.md §8 "The phone's Chat" → its words; the Mac's `.vf-chat-reply-text`, at touch pitch) — A
// SPARK'S WORDS, DRAWN: `ChatMarkdown.blocks`, never markup (EL7), 17 regular at 1.35 in primary ink. Paragraphs keep
// their line breaks, a heading is a bold paragraph, bold is 600; `code` is 15/500 mono on the fill (`ChatInk`); fenced
// code is the same mono at 1.45 on the fill, corners 10, padded 10 12, scrolling within itself; a list's marker stands
// in a column of 24; a quote is set in by 10 behind a 2-wide strong hairline, in secondary ink. Blocks stand 10 apart.
//
// Item 362d — those figures are `ChatMarkdownMeasure.chat`, the default. The History tab's session document draws a
// recorded message's words with this view at its own measure (`HistoryWords`, DESIGN.md §8 "The phone's session
// document" → its words).

/// The figures a message's words are set in. Chat's are the default (`chat`); a surface that draws the same words at
/// another pitch names its own.
public struct ChatMarkdownMeasure: Sendable, Equatable {
  /// The words' size.
  public var size: CGFloat
  /// What a line of words gains over the face's own line.
  public var lineSpacing: CGFloat
  /// `code` in a line, and fenced code.
  public var codeSize: CGFloat
  /// What a line of fenced code gains over the face's own line.
  public var codeLineSpacing: CGFloat
  /// How far apart the blocks stand.
  public var blockGap: CGFloat
  /// The room above the first block.
  public var top: CGFloat
  /// The words stand on a filled panel (`fill`), where the code's own `fill` would be no boundary: a fence takes solid
  /// chrome ringed by the strong hairline, and `code` takes the mono and no ground (rosetta's room, `transcript.css`,
  /// `.tr-prompt .tr-code`: "a fill on a fill is no boundary at all").
  public var onPanel: Bool

  public init(
    size: CGFloat, lineSpacing: CGFloat, codeSize: CGFloat, codeLineSpacing: CGFloat, blockGap: CGFloat, top: CGFloat,
    onPanel: Bool
  ) {
    self.size = size
    self.lineSpacing = lineSpacing
    self.codeSize = codeSize
    self.codeLineSpacing = codeLineSpacing
    self.blockGap = blockGap
    self.top = top
    self.onPanel = onPanel
  }

  /// IOS-12c, the phone's Chat: 17 at 1.35 (SF's own line at 17 is about 20.3, so the lines gain 2.7); code 15, fenced
  /// at 1.45 (SF Mono's own line at 15 is about 17.9, so 3.9); blocks 10 apart; 3 above (the Mac's padded 4 at the
  /// top, so a lead's first line sits beside its face).
  public static let chat = ChatMarkdownMeasure(
    size: 17, lineSpacing: 2.7, codeSize: 15, codeLineSpacing: 3.9, blockGap: 10, top: 3, onPanel: false)
}

public struct ChatMarkdownView: View {
  let blocks: [ChatMarkdownBlock]
  let measure: ChatMarkdownMeasure

  public init(blocks: [ChatMarkdownBlock], measure: ChatMarkdownMeasure = .chat) {
    self.blocks = blocks
    self.measure = measure
  }

  public var body: some View {
    ChatMarkdownBlocks(blocks: blocks, measure: measure)
      .font(ChromeType.sans(measure.size))
      .foregroundStyle(ChromePalette.ink)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, measure.top)
  }

  /// One line's runs as a Text: bold and italic as the run says, `code` marked for `ChatInkRenderer` (on a panel, the
  /// mono alone).
  static func text(_ runs: [ChatMarkdownRun], index: inout Int, measure: ChatMarkdownMeasure) -> Text {
    runs.reduce(Text(verbatim: "")) { inked, run in
      let part: Text
      switch run {
      case .text(let words):
        part = Text(verbatim: words)
      case .bold(let inner):
        part = text(inner, index: &index, measure: measure).fontWeight(.semibold)
      case .italic(let inner):
        part = text(inner, index: &index, measure: measure).italic()
      case .code(let words):
        let code = Text(verbatim: words).font(ChromeType.mono(measure.codeSize, .medium))
        if measure.onPanel {
          part = code
        } else {
          index += 1
          part = ChatInk.marked(code, .code, index, room: 5)
        }
      }
      return Text("\(inked)\(part)")
    }
  }

  /// A paragraph's or an item's lines, their breaks kept.
  static func text(lines: [ChatMarkdownLine], measure: ChatMarkdownMeasure) -> Text {
    var index = 0
    return lines.enumerated().reduce(Text(verbatim: "")) { inked, line in
      let words = text(line.element, index: &index, measure: measure)
      return line.offset == 0 ? words : Text("\(inked)\(Text(verbatim: "\n"))\(words)")
    }
  }
}

/// The blocks, 10 apart; a quote holds blocks of its own.
private struct ChatMarkdownBlocks: View {
  let blocks: [ChatMarkdownBlock]
  let measure: ChatMarkdownMeasure

  var body: some View {
    VStack(alignment: .leading, spacing: measure.blockGap) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
        self.block(block)
      }
    }
  }

  @ViewBuilder
  private func block(_ block: ChatMarkdownBlock) -> some View {
    switch block {
    case .paragraph(let lines, let strong):
      prose(ChatMarkdownView.text(lines: lines, measure: measure).fontWeight(strong ? .semibold : nil))
    case .code(let code):
      ScrollView(.horizontal, showsIndicators: false) {
        Text(verbatim: code)
          .font(ChromeType.mono(measure.codeSize))
          .lineSpacing(measure.codeLineSpacing)
          .fixedSize()
          .padding(.vertical, 10)
          .padding(.horizontal, 12)
      }
      .background(
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .fill(measure.onPanel ? ChromePalette.menuSurface : ChromePalette.fill)
      )
      .overlay {
        if measure.onPanel {
          RoundedRectangle(cornerRadius: 10, style: .continuous)
            .strokeBorder(ChromePalette.ruleStrong, lineWidth: 1)
            .allowsHitTesting(false)
        }
      }
    case .list(let ordered, let items):
      VStack(alignment: .leading, spacing: 4) {
        ForEach(Array(items.enumerated()), id: \.offset) { at, item in
          HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(verbatim: ordered ? "\(at + 1)." : "•")
              .monospacedDigit()
              .frame(width: 24, alignment: .leading)
            prose(ChatMarkdownView.text(lines: item, measure: measure))
          }
        }
      }
    case .quote(let inner):
      // a quote holds blocks: drawn through a type-erased view, since a view can't hold its own type
      AnyView(ChatMarkdownBlocks(blocks: inner, measure: measure))
        .foregroundStyle(ChromePalette.inkSecondary)
        .padding(.leading, 10)
        .overlay(alignment: .leading) {
          Rectangle().fill(ChromePalette.ruleStrong).frame(width: 2)
        }
    }
  }

  private func prose(_ text: Text) -> some View {
    text
      .lineSpacing(measure.lineSpacing)
      .textRenderer(ChatInkRenderer())
      .fixedSize(horizontal: false, vertical: true)
  }
}
