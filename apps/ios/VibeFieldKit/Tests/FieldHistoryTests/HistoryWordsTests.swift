import CoreGraphics
import FieldMarkdown
import FieldProduct
import Testing

@testable import FieldHistory

/// Item 362d (asked for 2026-11-12, of the phone's History session view against the desktop's: every message type
/// and view like the desktop's, where they all differed) — a recorded message's words are read as the phone's Chat
/// reads a spark's, and drawn at the document's own measure. Never markup (EL7): a link is its words.
///
/// These rows hold what the words are READ into and the figures they are set in. How they look is to be seen on
/// a device.
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

/// Item 362f (asked for 2026-11-12, of the phone's History session view against the desktop's: a thorough audit of
/// every message type and view, which differ from the desktop's) — a long message is drawn to the
/// room's bound, and the whole is one press away. The rule is the room's `messageExcerpt` (rosetta at the pin,
/// clients/room/src/components/transcript/message-preview.ts), ported as it is written.
///
/// Every text wanted below is what that function itself answers for the same input: each was computed by it on
/// 2026-11-12, and the port was run on the same inputs beside it. Texts are built here, so no fixture is added.
@Suite("item 362f — a long message is its opening, by the room's excerpt rule")
struct HistoryExcerptTests {
  private typealias Excerpt = HistoryWords.Excerpt

  private func times(_ piece: String, _ count: Int) -> String { String(repeating: piece, count: count) }

  /// `count` words with one space between: `word word … word`.
  private func words(_ count: Int) -> String { times("word ", count - 1) + "word" }

  @Test("a message within 2,400 characters and 32 lines is whole")
  func withinTheBoundIsWhole() {
    let short = "A reply.\n\nWith two paragraphs."
    #expect(HistoryWords.excerpt(short) == Excerpt(text: short, omitted: false))
    let edge = times("a", 2_400)
    #expect(HistoryWords.excerpt(edge) == Excerpt(text: edge, omitted: false))
    let lines = Array(repeating: "row", count: 32).joined(separator: "\n")
    #expect(HistoryWords.excerpt(lines) == Excerpt(text: lines, omitted: false))
    #expect(HistoryWords.excerpt("") == Excerpt(text: "", omitted: false))
  }

  @Test("past 2,400 characters with no break to cut at, it is the first 2,400")
  func cutAtTheBound() {
    #expect(HistoryWords.excerpt(times("a", 2_401)) == Excerpt(text: times("a", 2_400), omitted: true))
  }

  @Test("the cut moves back to the last whole word, at a space or a tab, and the space goes")
  func cutAtAWord() {
    #expect(HistoryWords.excerpt(times("word ", 600)) == Excerpt(text: words(480), omitted: true))
    #expect(
      HistoryWords.excerpt(times("word\t", 600)) == Excerpt(text: times("word\t", 479) + "word", omitted: true))
  }

  @Test("a paragraph break in the bound's last quarter is where it cuts, before a later line or word")
  func cutAtAParagraph() {
    let text = times("word ", 400) + "\n\n" + times("word ", 200)
    #expect(HistoryWords.excerpt(text) == Excerpt(text: words(400), omitted: true))
  }

  @Test("a paragraph break before the last quarter is passed over for a line break inside it")
  func cutAtALine() {
    let text = times("word ", 100) + "\n\n" + times("word ", 300) + "\n" + times("word ", 200)
    #expect(HistoryWords.excerpt(text) == Excerpt(text: times("word ", 100) + "\n\n" + words(300), omitted: true))
  }

  @Test("past 32 lines it stops at the line bound, then cuts back to the line before")
  func cutAtTheLineBound() {
    let rows = Array(repeating: "row", count: 40).joined(separator: "\n")
    let kept = Array(repeating: "row", count: 31).joined(separator: "\n")
    #expect(HistoryWords.excerpt(rows) == Excerpt(text: kept, omitted: true))
  }

  @Test("a character of two units is never cut through")
  func neverThroughACharacter() {
    let got = HistoryWords.excerpt("a" + times("😀", 1_300))
    #expect(got == Excerpt(text: "a" + times("😀", 1_199), omitted: true))
    #expect(got.text.utf16.count == 2_399)
  }

  @Test("it does not end on a heading whose body was left out")
  func noDanglingHeading() {
    let text = times("word ", 470) + "\n\n## The details\n\n" + times("y", 3_000)
    #expect(HistoryWords.excerpt(text) == Excerpt(text: words(470), omitted: true))
  }

  @Test("it does not end on an opening fence whose code was left out")
  func noDanglingFence() {
    let text = times("word ", 470) + "\n```swift\n" + times("y", 3_000)
    #expect(HistoryWords.excerpt(text) == Excerpt(text: words(470), omitted: true))
    let tildes = times("word ", 470) + "\n~~~\n" + times("y", 3_000)
    #expect(HistoryWords.excerpt(tildes) == Excerpt(text: words(470), omitted: true))
  }

  @Test("a heading that is all that fits stays")
  func aHeadingAloneStays() {
    let text = "# " + times("T", 1_900) + "\n\n" + times("z", 3_000)
    #expect(HistoryWords.excerpt(text) == Excerpt(text: "# " + times("T", 1_900), omitted: true))
  }

  @Test("the room's pattern, to the letter: a bare # line and the one line after it go together")
  func theBareHeadingLine() {
    let text = times("word ", 470) + "\n#\ntail words\n\n" + times("y", 3_000)
    #expect(HistoryWords.excerpt(text) == Excerpt(text: words(470), omitted: true))
  }

  @Test("four spaces in, or seven #, is no heading: the line stays")
  func notAHeading() {
    let indented = times("word ", 470) + "\n    # not a heading\n\n" + times("y", 3_000)
    #expect(
      HistoryWords.excerpt(indented)
        == Excerpt(text: times("word ", 470) + "\n    # not a heading", omitted: true))
    let seven = times("word ", 470) + "\n####### seven\n\n" + times("y", 3_000)
    #expect(HistoryWords.excerpt(seven) == Excerpt(text: times("word ", 470) + "\n####### seven", omitted: true))
  }

  @Test("a smaller allowance is honoured, a larger one is the room's 2,400, and none at all is no words")
  func theAllowance() {
    #expect(HistoryWords.excerpt(times("word ", 600), budget: 100) == Excerpt(text: words(20), omitted: true))
    #expect(HistoryWords.excerpt(times("word ", 600), budget: 5_000) == Excerpt(text: words(480), omitted: true))
    #expect(HistoryWords.excerpt("words", budget: -5) == Excerpt(text: "", omitted: true))
  }

  @Test("the bound is the room's: 2,400 characters and 32 lines")
  func theRoomsFigures() {
    #expect(HistoryWords.excerptCharacters == 2_400)
    #expect(HistoryWords.excerptLines == 32)
  }
}

/// Item 380 (asked for 2026-11-13, of the first build that reads a desktop directly: a long message is capped in
/// the short view as on the desktop, with the same gradient fade at the cap's foot, where it had
/// neither) — the room bounds a message by height as well as by length: a window of 21.7 em whose words fade
/// under `View full message` (rosetta at the pin, clients/room/src/styles/message-preview.css). These rows hold the
/// window's height, whether more is left to read, and the fade's stops. How it looks is to be seen on a device.
@Suite("item 380 — a long message stands in the room's window, and fades")
struct HistoryWindowTests {
  private typealias Window = HistoryWords.Window
  private typealias Stop = HistoryWords.FadeStop

  /// The document's size, and the bound at it.
  private let size: CGFloat = 15
  private var bound: CGFloat { HistoryWords.windowEms * size }

  @Test("the figures are the room's: 21.7 em, a floor of 5 em, clear from 32 above the foot, a band of 44")
  func theRoomsFigures() {
    #expect(HistoryWords.windowEms == 21.7)
    #expect(HistoryWords.windowFloorEms == 5)
    #expect(HistoryWords.fadeClearance == 32)
    #expect(HistoryWords.openBand == 44)
  }

  @Test("words within the bound stand as tall as they are, with nothing more to read")
  func withinTheBound() {
    #expect(HistoryWords.window(natural: 120, omitted: false, size: size) == Window(height: 120, more: false))
    #expect(HistoryWords.window(natural: 0, omitted: false, size: size) == Window(height: 0, more: false))
  }

  @Test("words taller than the bound stand at the bound, and there is more to read though no word was left out")
  func tallerThanTheBound() {
    #expect(HistoryWords.window(natural: 900, omitted: false, size: size) == Window(height: bound, more: true))
  }

  @Test("the bound is 325.5 pt at the document's 15 and 282.1 pt at a member's 13")
  func theBoundAtTwoSizes() {
    #expect(abs(HistoryWords.window(natural: 5_000, omitted: false, size: 15).height - 325.5) < 0.001)
    #expect(abs(HistoryWords.window(natural: 5_000, omitted: false, size: 13).height - 282.1) < 0.001)
  }

  @Test("a point over the bound still fits, as in the room; more than a point does not")
  func aPointOver() {
    let fits = HistoryWords.window(natural: bound + 1, omitted: false, size: size)
    #expect(fits == Window(height: bound, more: false))
    let over = HistoryWords.window(natural: bound + 1.5, omitted: false, size: size)
    #expect(over == Window(height: bound, more: true))
  }

  @Test("words the excerpt cut stand in a window of 5 em at least; words it left whole have no floor")
  func theFloor() {
    #expect(HistoryWords.window(natural: 40, omitted: true, size: size) == Window(height: 75, more: true))
    #expect(HistoryWords.window(natural: 200, omitted: true, size: size) == Window(height: 200, more: true))
    #expect(HistoryWords.window(natural: 40, omitted: false, size: size) == Window(height: 40, more: false))
  }

  @Test("words the excerpt cut that are also taller than the bound stand at the bound")
  func cutAndTall() {
    #expect(HistoryWords.window(natural: 900, omitted: true, size: size) == Window(height: bound, more: true))
  }

  @Test("the fade is the room's ramp: whole down to 35%, 136 of 255 at 60%, clear from 32 above the foot")
  func theFade() {
    #expect(
      HistoryWords.fade(height: 325.5) == [
        Stop(shows: 1, at: 0.35), Stop(shows: 136.0 / 255.0, at: 0.6), Stop(shows: 0, at: (325.5 - 32) / 325.5),
      ])
  }

  @Test("in a window too short for the ramp the clear stop stands at the stop before it, as CSS places it")
  func theFadeInAShortWindow() {
    #expect(
      HistoryWords.fade(height: 75) == [
        Stop(shows: 1, at: 0.35), Stop(shows: 136.0 / 255.0, at: 0.6), Stop(shows: 0, at: 0.6),
      ])
  }

  @Test("a window of no height has no ramp: its one stop is whole")
  func noHeight() {
    #expect(HistoryWords.fade(height: 0) == [Stop(shows: 1, at: 0)])
  }
}
