import Foundation

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
  /// A spark's text, as blocks (`markdownBlocksOf`).
  public static func blocks(_ text: String) -> [ChatMarkdownBlock] {
    let lines = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    return blocks(of: lines.components(separatedBy: "\n"))
  }

  /// One line's runs (`inlineOf`): `code` first (nothing inside it is read), then a link as its words, then bold and
  /// italic.
  public static func inline(_ line: String) -> [ChatMarkdownRun] {
    var runs: [ChatMarkdownRun] = []
    var rest = line as NSString
    while let tick = Pattern.tick.firstMatch(in: rest as String, range: NSRange(location: 0, length: rest.length)) {
      runs += emphasis(linksAsWords(rest.substring(to: tick.range.location)))
      runs.append(.code(rest.substring(with: tick.range(at: 1))))
      rest = rest.substring(from: NSMaxRange(tick.range)) as NSString
    }
    runs += emphasis(linksAsWords(rest as String))
    return merged(runs)
  }

  // MARK: - The blocks

  static func blocks(of lines: [String]) -> [ChatMarkdownBlock] {
    var blocks: [ChatMarkdownBlock] = []
    var at = 0
    while at < lines.count {
      let line = lines[at]
      if trim(line).isEmpty || Pattern.rule.test(line) {
        at += 1
        continue
      }
      if let fence = Pattern.fence.groups(line) {
        let marker = fence[1] ?? "```"
        var body: [String] = []
        at += 1
        while at < lines.count, !trimStart(lines[at]).hasPrefix(marker) {
          body.append(lines[at])
          at += 1
        }
        at += 1  // the closing fence, or the text's end
        blocks.append(.code(body.joined(separator: "\n")))
        continue
      }
      if Pattern.quote.test(line) {
        var body: [String] = []
        while at < lines.count, let quoted = Pattern.quote.groups(lines[at]) {
          body.append(quoted[1] ?? "")
          at += 1
        }
        blocks.append(.quote(Self.blocks(of: body)))
        continue
      }
      let bullet = Pattern.bullet.test(line)
      if bullet || Pattern.numbered.test(line) {
        let pattern = bullet ? Pattern.bullet : Pattern.numbered
        var items: [[ChatMarkdownLine]] = []
        while at < lines.count {
          if let item = pattern.groups(lines[at]) {
            items.append([inline(item[1] ?? "")])
          } else {
            // an indented line continues the item above it
            let next = lines[at]
            guard !items.isEmpty, Pattern.continued.test(next) else { break }
            items[items.count - 1].append(inline(trim(next)))
          }
          at += 1
        }
        blocks.append(.list(ordered: !bullet, items: items))
        continue
      }
      if let heading = Pattern.heading.groups(line) {
        blocks.append(.paragraph(lines: [inline(heading[1] ?? "")], strong: true))
        at += 1
        continue
      }
      var body: [ChatMarkdownLine] = []
      while at < lines.count {
        let next = lines[at]
        if trim(next).isEmpty || startsBlock(next) { break }
        body.append(inline(next))
        at += 1
      }
      blocks.append(.paragraph(lines: body, strong: false))
    }
    return blocks
  }

  static func startsBlock(_ line: String) -> Bool {
    Pattern.fence.test(line) || Pattern.quote.test(line) || Pattern.bullet.test(line) || Pattern.numbered.test(line)
      || Pattern.heading.test(line) || Pattern.rule.test(line)
  }

  // MARK: - The runs

  /// A link is drawn as its words, never as a link: `[words](url)` is "words", `<https://…>` its address as text.
  static func linksAsWords(_ text: String) -> String {
    let once = Pattern.link.replace(text, with: "$1")
    return Pattern.autolink.replace(once, with: "$1")
  }

  static func emphasis(_ text: String) -> [ChatMarkdownRun] {
    if text.isEmpty { return [] }
    let ns = text as NSString
    let whole = NSRange(location: 0, length: ns.length)
    if let strong = Pattern.strong.firstMatch(in: text, range: whole) {
      return emphasis(ns.substring(to: strong.range.location))
        + [.bold(emphasis(ns.substring(with: strong.range(at: 2))))]
        + emphasis(ns.substring(from: NSMaxRange(strong.range)))
    }
    // a lone `*` or `_` inside a word (snake_case, 2*3) is the word's own
    if let em = Pattern.em.firstMatch(in: text, range: whole) {
      let lead = em.range(at: 1)
      let start = em.range.location + (lead.location == NSNotFound ? 0 : lead.length)
      return emphasis(ns.substring(to: start))
        + [.italic(emphasis(ns.substring(with: em.range(at: 3))))]
        + emphasis(ns.substring(from: NSMaxRange(em.range)))
    }
    return [.text(text)]
  }

  /// Adjacent runs of text joined; an empty one dropped.
  static func merged(_ runs: [ChatMarkdownRun]) -> [ChatMarkdownRun] {
    var out: [ChatMarkdownRun] = []
    for run in runs {
      if case .text(let text) = run {
        if case .text(let last)? = out.last {
          out[out.count - 1] = .text(last + text)
        } else if !text.isEmpty {
          out.append(run)
        }
      } else {
        out.append(run)
      }
    }
    return out
  }

  // MARK: - JavaScript's strings

  /// JavaScript's WhiteSpace and LineTerminator, which `\s` and `trim` read.
  static let space: Set<UInt16> = [
    0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
    0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
  ]

  static func trim(_ text: String) -> String {
    let units = Array(text.utf16)
    guard let first = units.firstIndex(where: { !space.contains($0) }),
      let last = units.lastIndex(where: { !space.contains($0) })
    else { return "" }
    return String(decoding: units[first...last], as: UTF16.self)
  }

  static func trimStart(_ text: String) -> String {
    let units = Array(text.utf16)
    guard let first = units.firstIndex(where: { !space.contains($0) }) else { return "" }
    return String(decoding: units[first...], as: UTF16.self)
  }

  /// The Mac's patterns, in ICU's syntax with JavaScript's classes.
  struct Pattern: @unchecked Sendable {
    /// nil where the pattern does not compile: it then matches nothing, never a crash, and the rows say so
    /// (`ChatMarkdownGoldenTests`, every pattern compiles).
    let expression: NSRegularExpression?

    init(_ pattern: String) {
      expression = try? NSRegularExpression(pattern: pattern)
    }

    func firstMatch(in text: String, range: NSRange) -> NSTextCheckingResult? {
      expression?.firstMatch(in: text, range: range)
    }

    func test(_ text: String) -> Bool {
      firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil
    }

    /// The match's groups (0 the whole), each nil where it took no part; nil where it does not match.
    func groups(_ text: String) -> [String?]? {
      let ns = text as NSString
      guard let match = firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
      return (0..<match.numberOfRanges).map { index in
        let range = match.range(at: index)
        return range.location == NSNotFound ? nil : ns.substring(with: range)
      }
    }

    func replace(_ text: String, with template: String) -> String {
      expression?.stringByReplacingMatches(
        in: text, range: NSRange(location: 0, length: (text as NSString).length), withTemplate: template) ?? text
    }

    /// `\s`, `\S` and `.` as JavaScript reads them.
    static let s = #"[\t\n\x{0B}\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]"#
    static let notS =
      #"[^\t\n\x{0B}\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]"#
    static let dot = #"[^\n\r\x{2028}\x{2029}]"#

    /// `/^\s{0,3}(```|~~~)/u`
    static let fence = Pattern(#"^\#(s){0,3}(```|~~~)"#)
    /// `/^\s{0,3}[-*+]\s+(.*)$/u`
    static let bullet = Pattern(#"^\#(s){0,3}[-*+]\#(s)+(\#(dot)*)\z"#)
    /// `/^\s{0,3}\d{1,9}[.)]\s+(.*)$/u`
    static let numbered = Pattern(#"^\#(s){0,3}[0-9]{1,9}[.)]\#(s)+(\#(dot)*)\z"#)
    /// `/^\s{0,3}>\s?(.*)$/u`
    static let quote = Pattern(#"^\#(s){0,3}>\#(s)?(\#(dot)*)\z"#)
    /// `/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/u`
    static let heading = Pattern(#"^\#(s){0,3}#{1,6}\#(s)+(\#(dot)*?)\#(s)*#*\#(s)*\z"#)
    /// `/^\s{0,3}([-*_])(\s*\1){2,}\s*$/u`
    static let rule = Pattern(#"^\#(s){0,3}([-*_])(\#(s)*\1){2,}\#(s)*\z"#)
    /// `/^\s{2,}\S/u`: a list item's continued line
    static let continued = Pattern(#"^\#(s){2,}\#(notS)"#)
    /// `` /`([^`]+)`/u ``
    static let tick = Pattern(#"`([^`]+)`"#)
    /// `/!?\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/gu`
    static let link = Pattern(
      #"!?\[([^\]]*)\]\((?:[^()\#(bare)]|\([^()\#(bare)]*\))*(?:\#(s)+"[^"]*")?\)"#)
    /// `/<((?:https?|mailto):[^>\s]+)>/gu`
    static let autolink = Pattern(#"<((?:https?|mailto):[^>\#(bare)]+)>"#)
    /// `/(\*\*|__)(?=\S)([\s\S]*?\S)\1/u`
    static let strong = Pattern(#"(\*\*|__)(?=\#(notS))([\s\S]*?\#(notS))\1"#)
    /// `/(^|[^\w*])([*_])(?=\S)([\s\S]*?\S)\2(?![\w*])/u`
    static let em = Pattern(#"(^|[^A-Za-z0-9_*])([*_])(?=\#(notS))([\s\S]*?\#(notS))\2(?![A-Za-z0-9_*])"#)

    /// Every pattern, for the row that holds each compiles.
    static let all = [fence, bullet, numbered, quote, heading, rule, continued, tick, link, autolink, strong, em]

    /// `\s`'s members, bare, for use inside another class.
    static let bare = #"\t\n\x{0B}\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}"#
  }
}
