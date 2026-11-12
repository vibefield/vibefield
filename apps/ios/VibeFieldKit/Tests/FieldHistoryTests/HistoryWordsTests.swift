import CoreGraphics
import FieldMarkdown
import FieldProduct
import Testing

@testable import FieldHistory

/// Item 362d (James, 2026-11-12 18:40:35Z, of the phone's History session view against the desktop's: "i think all
/// message type and views are different from desktop") — a recorded message's words are read as the phone's Chat
/// reads a spark's, and drawn at the document's own measure. Never markup (EL7): a link is its words.
///
/// These rows hold what the words are READ into and the figures they are set in. How they look is his to see.
@Suite("item 362d — a recorded message's words are read as Chat reads a spark's")
struct HistoryWordsTests {
  /// Every run's own characters, in order.
  private func characters(_ runs: [ChatMarkdownRun]) -> String {
    var out = ""
    for run in runs {
      switch run {
      case .text(let words): out += words
      case .code(let words): out += words
      case .bold(let inner): out += characters(inner)
      case .italic(let inner): out += characters(inner)
      }
    }
    return out
  }

  /// Whether any run under these is a kind other than plain text.
  private func onlyText(_ runs: [ChatMarkdownRun]) -> Bool {
    runs.allSatisfy { run in
      if case .text = run { return true }
      return false
    }
  }

  @Test("a reply's heading, list, fence and quote are read into blocks")
  func aReplysBlocks() {
    let text = "## Plan\n\n- one\n- two\n\n```swift\nlet a = 1\n```\n\n> said"
    #expect(
      HistoryWords.reading(text)
        == .blocks([
          .paragraph(lines: [[.text("Plan")]], strong: true),
          .list(ordered: false, items: [[[.text("one")]], [[.text("two")]]]),
          .code("let a = 1"),
          .quote([.paragraph(lines: [[.text("said")]], strong: false)]),
        ]))
  }

  @Test("bold, italic and code are runs of a line, and a word's own underscores are the word's")
  func aLinesRuns() {
    #expect(
      HistoryWords.reading("Run **all** of `pnpm verify`, *then* snake_case_name")
        == .blocks([
          .paragraph(
            lines: [
              [
                .text("Run "), .bold([.text("all")]), .text(" of "), .code("pnpm verify"), .text(", "),
                .italic([.text("then")]), .text(" snake_case_name"),
              ]
            ], strong: false)
        ]))
  }

  @Test("a link is its words: its address is in no run, an autolink is its own characters as text, nothing opens")
  func aLinkIsItsWords() throws {
    let written = "Open [the report](https://evil.example/x?token=1) or <https://ok.example/y> now"
    let reading = HistoryWords.reading(written)
    guard case .blocks(let blocks) = reading, case .paragraph(let lines, _)? = blocks.first else {
      Issue.record("the words were not read into a paragraph: \(reading)")
      return
    }
    let runs = try #require(lines.first)
    let said = characters(runs)
    #expect(said == "Open the report or https://ok.example/y now")
    #expect(said.contains("evil.example") == false, "a bracket link's address is in no run")
    #expect(onlyText(runs), "the autolink's address is a run of text, as its own characters")
    // no run kind can hold a destination: a run is text, bold, italic or code, and each carries words alone
    #expect(
      HistoryWords.reading("[x](javascript:alert(1))")
        == .blocks([.paragraph(lines: [[.text("x")]], strong: false)]))
  }

  @Test("words the door cut inside a fence are still code, to their end")
  func cutInsideAFence() {
    #expect(
      HistoryWords.reading("Here:\n```\nline one\nline tw")
        == .blocks([
          .paragraph(lines: [[.text("Here:")]], strong: false),
          .code("line one\nline tw"),
        ]))
  }

  @Test("a prompt keeps its line breaks")
  func aPromptsLines() {
    #expect(
      HistoryWords.reading("first line\nsecond line")
        == .blocks([.paragraph(lines: [[.text("first line")], [.text("second line")]], strong: false)]))
  }

  @Test("nothing but space is blank; words that read into no block stand as typed")
  func blankAndTyped() {
    #expect(HistoryWords.reading("") == .blank)
    #expect(HistoryWords.reading("  \n\t\n") == .blank)
    #expect(HistoryWords.reading("---") == .typed("---"))
  }

  @Test("the view's default measure is Chat's present numbers")
  func chatsMeasureDidNotMove() {
    let chat = ChatMarkdownMeasure.chat
    #expect(chat.size == 17)
    #expect(chat.lineSpacing == 2.7)
    #expect(chat.codeSize == 15)
    #expect(chat.codeLineSpacing == 3.9)
    #expect(chat.blockGap == 10)
    #expect(chat.top == 3)
    #expect(chat.onPanel == false)
  }

  @Test("the document's words are set at 15 with 4 of leading and code at 13; a prompt's stand on a panel")
  func theDocumentsMeasure() {
    let reply = HistoryWords.reply
    #expect(reply.size == 15)
    #expect(reply.lineSpacing == 4)
    #expect(reply.codeSize == 13)
    #expect(reply.codeLineSpacing == 3.4)
    #expect(reply.blockGap == 10)
    #expect(reply.top == 0)
    #expect(reply.onPanel == false)
    var onPanel = reply
    onPanel.onPanel = true
    #expect(HistoryWords.prompt == onPanel, "a prompt differs from a reply only by its panel")
  }
}
