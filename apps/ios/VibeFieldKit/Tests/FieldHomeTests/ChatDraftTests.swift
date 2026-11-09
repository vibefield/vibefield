import FieldProduct
import Foundation
import SwiftUI
import Testing

@testable import FieldHome

/// IOS-12f's M-f2 (PC-L1; plan-12f's Q8 A; VF-PM 2026-11-09 02:24:16Z, Q1 (a)) — the phone's draft is the Mac's: where an
/// @ opens the list, what a chip says, and what a send carries. Each golden is written by field-app's own model
/// (`packages/field-app/test/at-rows-goldens.test.ts`) and copied here byte for byte (`pnpm check:ios-fixtures`).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("IOS-12f's M-f2 — the phone's draft is the Mac's: the at-rows goldens")
struct ChatDraftGoldenTests {
  @Test("an @ opens the list at the start of a word, ending at the caret, and in no other place")
  func queries() throws {
    let golden = try ChatAtGoldenTests.golden("at-rows.draft.golden")
    let cases = try #require(golden["queries"]?.arrayValue)
    #expect(cases.count == 12)
    for each in cases {
      let before = each["before"]?.stringValue ?? ""
      let found = ChatDraft.queryBefore(before)
      let said = found.map { JSONValue.object(["at": .int(Int64($0.at)), "query": .string($0.query)]) } ?? .null
      #expect(said == each["found"], "\(before)")
    }
  }

  @Test("what a chip reads in the sentence")
  func chips() throws {
    let golden = try ChatAtGoldenTests.golden("at-rows.draft.golden")
    let cases = try #require(golden["chips"]?.arrayValue)
    #expect(cases.count == 6)
    for each in cases {
      let chip = try Self.chip(each["chip"])
      let label = ChatDraft.label(chip)
      #expect(.string(label) == each["label"])
    }
  }

  @Test("what a send carries: the words, each chip as its words, and the chips as spans of them")
  func messages() throws {
    let golden = try ChatAtGoldenTests.golden("at-rows.draft.golden")
    let cases = try #require(golden["messages"]?.arrayValue)
    #expect(cases.count == 14)
    for each in cases {
      let name = each["name"]?.stringValue ?? "?"
      let parts = try (each["parts"]?.arrayValue ?? []).map(Self.part)
      let message = ChatDraft.message(parts)
      let said = JSONValue.object([
        "text": .string(message.text),
        "chips": .array(
          message.chips.map {
            .object(["start": .int(Int64($0.start)), "length": .int(Int64($0.length)), "kind": .string($0.kind)])
          }),
      ])
      #expect(said == each["message"], "\(name)")
      let sendable = ChatDraft.sendable(parts, pending: each["pending"]?.stringValue)
      #expect(.bool(sendable) == each["sendable"], "\(name)")
    }
  }

  private static func part(_ value: JSONValue) throws -> ChatDraftPart {
    if value["kind"]?.stringValue == "text" { return .text(value["text"]?.stringValue ?? "") }
    return .chip(try chip(value["chip"]))
  }

  private static func chip(_ value: JSONValue?) throws -> ChatDraftChip {
    let chip = try #require(value)
    let id = chip["id"]?.stringValue ?? ""
    let agent = chip["agent"]?.stringValue ?? ""
    let label = chip["label"]?.stringValue ?? ""
    if chip["kind"]?.stringValue == "session" {
      return .session(
        ChatSessionChip(
          id: id, session: chip["session"]?.stringValue ?? "", agent: agent, label: label,
          handle: chip["handle"]?.stringValue ?? "", project: chip["project"]?.stringValue))
    }
    let model = chip["model"]?["words"]?.arrayValue.map { words in
      ChatChipModel(words: words.compactMap { $0.stringValue })
    }
    return .agent(
      ChatAgentChip(
        id: id, agent: agent, label: label,
        profile: ChatAtProfile(
          id: chip["profile"]?["id"]?.stringValue ?? "", name: chip["profile"]?["name"]?.stringValue ?? ""),
        named: chip["named"]?.boolValue ?? false, model: model))
  }
}

/// IOS-12f's M-f2 — the draft edited as the Mac's is (`composer-draft.ts`: `spliceDraft`, `draftOffset`,
/// `draftAfterSend`), one rule read twice.
@Suite("IOS-12f's M-f2 — the draft edited as the Mac's is")
struct ChatDraftEditingTests {
  static let chip = ChatDraftChip.session(
    ChatSessionChip(
      id: "session:run-1", session: "run-1", agent: "agent-a", label: "Agent A", handle: "vibe-field", project: nil))
  static let other = ChatDraftChip.session(
    ChatSessionChip(
      id: "session:run-2", session: "run-2", agent: "agent-a", label: "Agent A", handle: "rosetta", project: nil))

  @Test("a chip is set where the text was, with a space after it unless one follows")
  func splice() {
    let parts: [ChatDraftPart] = [.text("ask @ve")]
    let spliced = ChatDraft.splice(parts, index: 0, start: 4, end: 7, chip: Self.chip)
    #expect(spliced == [ChatDraftPart.text("ask "), .chip(Self.chip), .text(" ")])
    let spaced: [ChatDraftPart] = [.text("ask @ve now")]
    let kept = ChatDraft.splice(spaced, index: 0, start: 4, end: 7, chip: Self.chip)
    #expect(kept == [ChatDraftPart.text("ask "), .chip(Self.chip), .text(" now")])
    let taken = ChatDraft.splice(spaced, index: 0, start: 4, end: 7)
    #expect(taken == [ChatDraftPart.text("ask  now")])
  }

  @Test("the caret counts a chip as one; the @ is read in the run the caret stands in")
  func places() {
    let parts: [ChatDraftPart] = [.text("a "), .chip(Self.chip), .text(" @co")]
    #expect(ChatDraft.length(parts) == 7)
    let found = ChatDraft.place(parts, caret: 7)
    #expect(found == ChatAtPlace(index: 2, at: 1, query: "co", offset: 4))
    let before = ChatDraft.place(parts, caret: 2)
    #expect(before == nil)
    let none = ChatDraft.place(parts, caret: nil)
    #expect(none == nil)
    let chip = ChatDraft.chip(parts, at: 2)
    #expect(chip?.index == 1)
    let word = ChatDraft.chip(parts, at: 1)
    #expect(word?.index == nil)
  }

  @Test("after a send, what was typed since stays and a draft changed within what was sent stays whole")
  func afterSend() {
    let sent: [ChatDraftPart] = [.text("ask "), .chip(Self.chip)]
    let typed: [ChatDraftPart] = [.text("ask "), .chip(Self.chip), .text("  more")]
    #expect(ChatDraft.after(sent: sent, now: typed) == [ChatDraftPart.text("more")])
    #expect(ChatDraft.after(sent: sent, now: sent).isEmpty)
    let changed: [ChatDraftPart] = [.text("ask "), .chip(Self.other)]
    #expect(ChatDraft.after(sent: sent, now: changed) == changed)
    #expect(ChatDraft.after(sent: [], now: typed) == typed)
  }
}

/// The field draws the parts and reads them back, each chip one character (Q1 (a)).
@Suite("IOS-12f's M-f2 — the field draws the parts and reads them back")
@MainActor
struct ChatDraftFieldTests {
  @Test("parts drawn and read back are the same parts, a chip one character")
  func roundTrip() {
    let parts: [ChatDraftPart] = [.text("Ask "), .chip(ChatDraftEditingTests.chip), .text(" now")]
    let text = ChatDraftField.attributed(parts, look: ChatDraftLook(scheme: .light, scale: 2, width: 300))
    #expect(text.length == ChatDraft.length(parts))
    let back = ChatDraftField.parts(of: text)
    #expect(back == parts)
  }

  @Test("a stray object mark is no part")
  func stray() {
    let back = ChatDraftField.parts(of: NSAttributedString(string: "a\u{FFFC}b"))
    #expect(back == [ChatDraftPart.text("ab")])
  }
}
