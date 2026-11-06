import Foundation

// SKELETON (M-c1's c2, red first): the types the rows read, and no reader — every text no blocks.
// IOS-12c (M-c1; PC-L1; DESIGN.md §8 "Chat's thread", its words) — A SPARK'S WORDS, READ, on the phone: field-app's
// `markdownBlocksOf` (`packages/field-app/src/chat/transcript-markdown.ts`), ported line for line and held to the
// golden it writes (`chat-markdown.golden.json`, ChatMarkdownGoldenTests). An agent's text is the adversary's (EL7), so
// it is never markup: it is read here into plain data — paragraphs and their line breaks, bold and italic, inline code,
// fenced code, lists and quotes, a heading as a bold paragraph — and the view draws every run as text. A link is its
// words, inert; nothing else is read as markup. Pure.
//
// The Mac's patterns are JavaScript's, read over UTF-16 as JavaScript reads a string. They are matched here by
// NSRegularExpression over the same UTF-16, with JavaScript's own classes spelled out where ICU's differ: `\s` (ICU's
// lacks U+000B and U+FEFF), `\w` and `\d` (ASCII in JavaScript, Unicode in ICU), `.` (ICU's also stops at U+0085) and
// `$` (`\z`: ICU's also matches before a final line terminator). `trim` is JavaScript's too.

/// A run of words in a line, with how it is drawn.
public indirect enum ChatMarkdownRun: Sendable, Equatable {
  case text(String)
  case bold([ChatMarkdownRun])
  case italic([ChatMarkdownRun])
  case code(String)
}

/// One line of a paragraph or a list item: its runs.
public typealias ChatMarkdownLine = [ChatMarkdownRun]

public indirect enum ChatMarkdownBlock: Sendable, Equatable {
  /// `strong`: a heading, drawn as a bold paragraph.
  case paragraph(lines: [ChatMarkdownLine], strong: Bool)
  case code(String)
  case list(ordered: Bool, items: [[ChatMarkdownLine]])
  case quote([ChatMarkdownBlock])
}

public enum ChatMarkdown {
  public static func blocks(_ text: String) -> [ChatMarkdownBlock] { [] }

  public static func inline(_ line: String) -> [ChatMarkdownRun] { [] }

  struct Pattern: @unchecked Sendable {
    let expression: NSRegularExpression?

    static let all: [Pattern] = []
  }
}
