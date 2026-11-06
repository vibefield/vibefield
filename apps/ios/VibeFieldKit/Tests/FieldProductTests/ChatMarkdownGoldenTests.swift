import Foundation
import Testing

@testable import FieldProduct

/// IOS-12c (M-c1; PC-L1; EL7) — a spark's words are read on the phone as the Mac reads them.
/// `chat-markdown.golden.json` is written by field-app's own `markdownBlocksOf`
/// (`packages/field-app/test/chat-flow-goldens.test.ts`) and copied here byte for byte: 25 texts, each with its blocks. The phone's `ChatMarkdown` must read each the same, the Mac's
/// quirks included (`***both***` is bold "*both" then "*"), and a link is its words, never an address to open.
@Suite("IOS-12c — a spark's words, read as the Mac reads them: the markdown golden")
struct ChatMarkdownGoldenTests {
  @Test("every pattern the reader matches with compiles")
  func patterns() {
    #expect(ChatMarkdown.Pattern.all.count == 12)
    #expect(ChatMarkdown.Pattern.all.allSatisfy { $0.expression != nil })
  }

  @Test("each text's blocks are the Mac's")
  func blocks() throws {
    let golden = try ChatFlowGoldenTests.golden("chat-markdown.golden")
    let texts = try #require(golden["texts"]?.arrayValue)
    #expect(texts.count == 25)
    for entry in texts {
      let text = try #require(entry["text"]?.stringValue)
      let said = JSONValue.array(ChatMarkdown.blocks(text).map(Self.json))
      #expect(said == entry["blocks"], "\(text.debugDescription): the phone reads \(said)")
    }
  }

  @Test("a link is its words, inert: its target is never drawn, and an autolink's address is plain text")
  func links() {
    let blocks = ChatMarkdown.blocks("Open [the report](https://evil.example/x?token=1) or <https://ok.example/y> now")
    #expect(blocks == [.paragraph(lines: [[.text("Open the report or https://ok.example/y now")]], strong: false)])
  }

  // MARK: - The blocks as the Mac's JSON

  static func json(_ block: ChatMarkdownBlock) -> JSONValue {
    switch block {
    case .paragraph(let lines, let strong):
      var fields: [String: JSONValue] = ["kind": .string("paragraph"), "lines": .array(lines.map(json))]
      if strong { fields["strong"] = .bool(true) }
      return .object(fields)
    case .code(let text):
      return .object(["kind": .string("code"), "text": .string(text)])
    case .list(let ordered, let items):
      return .object([
        "kind": .string("list"), "ordered": .bool(ordered), "items": .array(items.map { .array($0.map(json)) }),
      ])
    case .quote(let blocks):
      return .object(["kind": .string("quote"), "blocks": .array(blocks.map(json))])
    }
  }

  static func json(_ line: ChatMarkdownLine) -> JSONValue {
    .array(line.map(json))
  }

  static func json(_ run: ChatMarkdownRun) -> JSONValue {
    switch run {
    case .text(let text): .object(["kind": .string("text"), "text": .string(text)])
    case .bold(let runs): .object(["kind": .string("bold"), "runs": .array(runs.map(json))])
    case .italic(let runs): .object(["kind": .string("italic"), "runs": .array(runs.map(json))])
    case .code(let text): .object(["kind": .string("code"), "text": .string(text)])
    }
  }
}
