import FieldProduct
import Foundation
import Testing

@testable import FieldHistory

/// Item 396 (James, 2026-11-13 23:38:00Z, session qa-01: "a good addition design should be added to both desktop and
/// mobile is that we should have a floating button on the side for user to quick jump to previous user message so user
/// can quick navigate, help me design and implement nicely"), and VF-PM's ruling of 2026-11-13 23:47Z as qa-01
/// relayed it, so the phone matches the desktop's room: a message of the person's own is a human prompt alone. A
/// setting command and a prompt a machine wrote are no target of the button, and do not make it show.
///
/// The room tells them in `lib/transcript/turns.ts` (`buildPrompt`, `looksLocalCommand`, `localSetting`). These rows
/// hold the same rule on the phone's row (`IndexTimelineRow`), which carries what the room reads: the row's kind,
/// its group's kind, its words, what is attached, and a notice's type.
@Suite("item 396 — the fold says which prompts are not a person's own message")
struct HistoryPromptKindTests {
  private func row(
    _ id: String, _ ordinal: Int, _ kind: String, _ more: [String: JSONValue] = [:], group: String? = nil
  ) throws -> IndexTimelineRow {
    var fields: [String: JSONValue] = [
      "timelineId": .string(id), "sessionId": .string("s1"), "ordinal": .int(Int64(ordinal)), "kind": .string(kind),
      "group": .object(["id": .string("g"), "kind": .string(group ?? (kind == "user" ? "human_turn" : "agent_cycle"))]),
    ]
    for (key, value) in more { fields[key] = value }
    return try IndexTimelineRow(json: .object(fields))
  }

  /// A prompt of these words.
  private func prompt(
    _ text: String, group: String? = nil, _ more: [String: JSONValue] = [:]
  ) throws -> IndexTimelineRow {
    var fields = more
    fields["text"] = .string(text)
    return try row("u1", 1, "user", fields, group: group)
  }

  /// The notice right after a prompt: a command's output, unless another type is named.
  private func answer(
    _ text: String, notice: String = "command_output", _ more: [String: JSONValue] = [:]
  ) throws -> IndexTimelineRow {
    var fields = more
    fields["notice"] = .string(notice)
    fields["text"] = .string(text)
    return try row("n1", 2, "notice", fields, group: "system_cycle")
  }

  private func kind(_ prompt: IndexTimelineRow, _ answer: IndexTimelineRow?) -> HistoryPromptKind? {
    FieldHistoryModel.promptKind(prompt, answer: answer)
  }

  private func document(_ rows: [IndexTimelineRow]) throws -> HistoryDocument {
    let header = try IndexSessionResult(json: try Fixture.json("index-session.valid")).session
    return FieldHistoryModel.document(
      header: header, rows: rows, desktop: "studio", agentLabel: "Claude", nextCursor: nil, watermark: nil,
      liveSince: nil, now: Date(timeIntervalSince1970: 1_759_100_000))
  }

  @Test("a person's prompt has no kind: it is the person's own")
  func aPersonsPrompt() throws {
    let words = try prompt("Fix the fade at the top")
    #expect(kind(words, nil) == nil)
    #expect(kind(words, try row("a1", 2, "agent", ["text": .string("Done.")])) == nil)
    #expect(kind(words, try answer("opus")) == nil, "a command's output after words that are no command")
  }

  @Test("a setting command that took is a setting: /model or /effort, and the bare value the session answered")
  func aSettingThatTook() throws {
    #expect(kind(try prompt("/model opus"), try answer("opus")) == .setting)
    #expect(kind(try prompt("/effort high"), try answer("high")) == .setting)
    #expect(kind(try prompt("  /MODEL  "), try answer(" claude-opus-5 \n")) == .setting)
  }

  @Test("a setting the session refused, or answered in the CLI's own sentence, is a person's message still")
  func aSettingThatDidNotTake() throws {
    let refused = [
      "Set model to opus", "Invalid model", "unknown model: opux", "Error: no such model", "failed",
      "Usage: /model <name>",
    ]
    for words in refused {
      let read = kind(try prompt("/model opux"), try answer(words))
      #expect(read == nil, "\(words)")
    }
    // a value that only begins like one of those words is a value
    #expect(kind(try prompt("/model settled"), try answer("settled-1")) == .setting)
    // an effort is one word, from a letter
    #expect(kind(try prompt("/effort max"), try answer("Invalid effort level")) == nil)
    #expect(kind(try prompt("/effort max"), try answer("5x")) == nil)
  }

  @Test("a command with no answer beside it, or with something else after it, is a person's message still")
  func noAnswerBesideIt() throws {
    let command = try prompt("/model opus")
    #expect(kind(command, nil) == nil)
    #expect(kind(command, try row("a1", 2, "agent", ["text": .string("opus")])) == nil)
    #expect(kind(command, try answer("opus", notice: "model_changed")) == nil)
    // an answer the desktop cut is not the whole of what was said
    #expect(kind(command, try answer("opus", ["textByteLen": .int(4_096)])) == nil)
    #expect(kind(command, try answer("opus", ["textClipped": .bool(true)])) == nil)
  }

  @Test("a slash command that is no setting is a person's message still")
  func otherCommands() throws {
    #expect(kind(try prompt("/compact"), try answer("Compacted")) == nil)
    #expect(kind(try prompt("/clear"), try answer("cleared")) == nil)
  }

  @Test("words that only look like a setting are not one: two lines, something attached, a text the desktop cut")
  func notACommand() throws {
    #expect(kind(try prompt("/model opus\nand then fix the fade"), try answer("opus")) == nil)
    let shot: JSONValue = .object(["id": .string("i1"), "kind": .string("image"), "available": .bool(true)])
    #expect(kind(try prompt("/model opus", ["attachments": .array([shot])]), try answer("opus")) == nil)
    #expect(kind(try prompt("/model opus", ["textByteLen": .int(4_096)]), try answer("opus")) == nil)
  }

  @Test("what a parent agent sent the session it started is a machine's, whatever its words")
  func aMachinesPrompt() throws {
    #expect(kind(try prompt("Audit the fold and report", group: "parent_invocation"), nil) == .machine)
    #expect(kind(try prompt("/model opus", group: "parent_invocation"), try answer("opus")) == .machine)
  }

  @Test("only a parent agent's invocation is a machine's: every other group, and one not heard of, is a person's")
  func theGroupKinds() throws {
    #expect(kind(try prompt("go", group: "human_turn"), nil) == nil)
    #expect(kind(try prompt("go", group: "parent_invocation"), nil) == .machine)
    // the room draws a `user` row as a person's prompt whatever its group: `synthetic` is its fallback where the
    // source gave no boundary, and no group makes a row's words a machine's but a parent agent's invocation
    #expect(kind(try prompt("go", group: "synthetic"), nil) == nil)
    #expect(kind(try prompt("go", group: "system_cycle"), nil) == nil)
    #expect(kind(try prompt("go", group: "agent_cycle"), nil) == nil)
    // an open kind the phone has not heard of changes nothing (the tolerant reader)
    #expect(kind(try prompt("go", group: "reviewer_cycle"), nil) == nil)
  }

  @Test("a command with a file attached is a person's message still, as the room keeps it")
  func aFileAttached() throws {
    let notes: JSONValue = .object(["id": .string("d1"), "kind": .string("file"), "available": .bool(true)])
    #expect(kind(try prompt("/model opus", ["attachments": .array([notes])]), try answer("opus")) == nil)
  }

  @Test("a command whose answer is not yet read is a person's message until it is")
  func theNextRowNotYetRead() throws {
    // the command is the last row the phone holds
    let held = [
      try row("u1", 1, "user", ["text": .string("Fix the fade")]),
      try row("a1", 2, "agent", ["text": .string("Done.")]),
      try row("u2", 3, "user", ["text": .string("/model opus")]),
    ]
    #expect(try document(held).turns.map(\.promptKind) == [nil, nil])
    // its answer arrives
    let output = try row("n2", 4, "notice", ["notice": .string("command_output"), "text": .string("opus")])
    #expect(try document(held + [output]).turns.map(\.promptKind) == [nil, .setting])
  }

  @Test("the room's test of a local command: one line, a slash, a name, and then nothing or a space")
  func aLocalCommand() {
    for words in ["/model", "/model opus", "  /effort   high  ", "/a:b.c-d x", "/Model2_x"] {
      #expect(FieldHistoryModel.isLocalCommand(words), "\(words)")
    }
    for words in ["", "model", "/", "/ model", "/1abc", "/usr/bin/env", "/model\nopus", "/model@x"] {
      #expect(FieldHistoryModel.isLocalCommand(words) == false, "\(words)")
    }
    #expect(FieldHistoryModel.isLocalCommand(nil) == false)
  }

  @Test("the room's test of a setting: /model or /effort, and one short line that is a value")
  func aSetting() {
    #expect(FieldHistoryModel.isSetting(command: "/model opus", output: "opus"))
    #expect(FieldHistoryModel.isSetting(command: "/effort", output: "x-high"))
    #expect(FieldHistoryModel.isSetting(command: "/compact", output: "opus") == false)
    #expect(FieldHistoryModel.isSetting(command: "/model opus", output: nil) == false)
    #expect(FieldHistoryModel.isSetting(command: "/model opus", output: "  \n") == false)
    #expect(FieldHistoryModel.isSetting(command: "/model opus", output: "opus\nfast") == false)
    // 96 units is the room's bound on a value
    #expect(FieldHistoryModel.isSetting(command: "/model", output: String(repeating: "a", count: 96)))
    #expect(FieldHistoryModel.isSetting(command: "/model", output: String(repeating: "a", count: 97)) == false)
  }

  @Test("the document carries each prompt's kind, and an assignment sent as a team message opens no turn")
  func theDocument() throws {
    let rows = [
      try row("u1", 1, "user", ["text": .string("Fix the fade")]),
      try row("a1", 2, "agent", ["text": .string("Done.")]),
      try row("u2", 3, "user", ["text": .string("/model opus")]),
      try row("n2", 4, "notice", ["notice": .string("command_output"), "text": .string("opus")], group: "system_cycle"),
      try row("u3", 5, "user", ["text": .string("Audit the rows")], group: "parent_invocation"),
      try row("c3", 6, "collaboration", ["text": .string("Take the tests")], group: "human_turn"),
      try row("a3", 7, "agent", ["text": .string("On it.")]),
    ]
    let turns = try document(rows).turns
    // the collaboration row is a line of the third turn's group, never a prompt
    #expect(turns.map(\.id) == ["u1", "u2", "u3"])
    #expect(turns.map(\.promptKind) == [nil, .setting, .machine])
    let prompts = HistoryRow.of(turns, desktop: "studio").filter { row in
      if case .prompt = row { return true }
      return false
    }
    #expect(prompts.count == 3)
  }

  @Test("an answer on the far side of a pill is not the command's: the two pair inside one sitting only")
  func acrossAPill() throws {
    let base: Int64 = 1_759_000_000_000
    func rows(answerAfterMs gap: Int64) throws -> [IndexTimelineRow] {
      [
        try row("u1", 1, "user", ["text": .string("/model opus"), "at": .int(base)]),
        try row(
          "n1", 2, "notice", ["notice": .string("command_output"), "text": .string("opus"), "at": .int(base + gap)],
          group: "system_cycle"),
      ]
    }
    let beside = try #require(try document(try rows(answerAfterMs: 1_000)).turns.first)
    #expect(beside.promptKind == .setting)
    // twenty minutes later the answer opens a sitting of its own
    let apart = try #require(try document(try rows(answerAfterMs: 20 * 60_000)).turns.first)
    #expect(apart.promptKind == nil)
  }

  @Test("a person's prompt is encoded as it was; a kept document decodes with no kind; a setting round-trips")
  func kept() throws {
    let own = HistoryTurn(
      id: "u1", at: "10:02:14", prompt: "go", promptAnchor: "u1", model: "", facts: "", segments: [])
    let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(own)) as? [String: Any])
    #expect(json["promptKind"] == nil)
    let setting = HistoryTurn(
      id: "u2", at: "10:02:20", prompt: "/model opus", promptAnchor: "u2", model: "", facts: "", segments: [],
      promptKind: .setting)
    var kept = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(setting)) as? [String: Any])
    #expect(kept["promptKind"] as? String == "setting")
    // as a build before this item kept it
    kept["promptKind"] = nil
    let read = try JSONDecoder().decode(HistoryTurn.self, from: JSONSerialization.data(withJSONObject: kept))
    #expect(read.promptKind == nil && read.prompt == setting.prompt)
    #expect(try JSONDecoder().decode(HistoryTurn.self, from: JSONEncoder().encode(setting)) == setting)
  }
}

/// Item 396 — the button at the document's side goes to a person's own message alone: a prompt the fold marked as a
/// setting or a machine's is passed over, and does not make the button show.
@Suite("item 396 — the button passes a setting command and a machine's prompt")
struct HistoryOwnMessageTests {
  private func turn(_ id: String, prompt: String = "a prompt", kind: HistoryPromptKind? = nil) -> HistoryTurn {
    HistoryTurn(
      id: id, at: "12:00", prompt: prompt, model: "a model", facts: "3 tools",
      segments: [.prose(id: "a", at: "12:00", text: "words of \(id)", anchor: nil)], promptKind: kind)
  }

  private func before(
    _ turns: [HistoryTurn], _ standing: [String: HistoryRow.Standing], unread: Bool = false
  ) -> HistoryBefore {
    HistoryRow.before(HistoryRow.of(turns, desktop: "studio"), standing: standing, unread: unread)
  }

  @Test("a setting command above is passed: a press goes to the person's message before it")
  func aSettingIsPassed() {
    let turns = [turn("t1"), turn("t2", prompt: "/model opus", kind: .setting), turn("t3")]
    // reading the setting's own turn, its prompt cut by the top of the view
    #expect(before(turns, ["prompt/t2": .above, "head/t2": .below]) == .message("prompt-t1", near: false))
    // the next message under the head: the press before it passes the setting
    #expect(before(turns, ["segment/t2/a": .above, "gap/t3": .above, "prompt/t3": .below])
      == .message("prompt-t1", near: false))
  }

  @Test("a machine's prompt above is passed the same way")
  func aMachinesPromptIsPassed() {
    let turns = [turn("t1"), turn("t2", prompt: "Audit the rows", kind: .machine), turn("t3")]
    #expect(before(turns, ["prompt/t2": .above, "head/t2": .below]) == .message("prompt-t1", near: false))
  }

  @Test("several in a row are passed in one press, and a person's message among them is still gone to")
  func severalInARow() {
    let settings = [
      turn("t1"), turn("t2", prompt: "/model opus", kind: .setting),
      turn("t3", prompt: "/effort high", kind: .setting), turn("t4"),
    ]
    #expect(before(settings, ["gap/t4": .above, "prompt/t4": .below]) == .message("prompt-t1", near: false))
    let between = [
      turn("t1", prompt: "/model opus", kind: .setting), turn("t2"),
      turn("t3", prompt: "Audit the rows", kind: .machine),
    ]
    #expect(before(between, ["head/t3": .above, "segment/t3/a": .below]) == .message("prompt-t2", near: false))
  }

  @Test("the stack's own id is answered for a person's prompt alone: a setting's mark and a machine's name no row")
  func theMarkedRowPassesThem() {
    let rows = HistoryRow.of(
      [
        turn("t1"), turn("t2", prompt: "/model opus", kind: .setting),
        turn("t3", prompt: "Audit the rows", kind: .machine),
      ], desktop: "studio")
    #expect(HistoryRow.promptRow(marked: "prompt-t1", in: rows) == "prompt/t1")
    #expect(HistoryRow.promptRow(marked: "prompt-t2", in: rows) == nil)
    #expect(HistoryRow.promptRow(marked: "prompt-t3", in: rows) == nil)
  }

  @Test("with nothing above but a setting and a machine's prompt the button is gone, or goes to the top")
  func nothingOfThePersonsOwnAbove() {
    let turns = [
      turn("t1", prompt: "/model opus", kind: .setting), turn("t2", prompt: "Audit the rows", kind: .machine),
      turn("t3"),
    ]
    let standing: [String: HistoryRow.Standing] = ["segment/t2/a": .above, "gap/t3": .above, "prompt/t3": .below]
    #expect(before(turns, standing) == .nothing)
    #expect(before(turns, standing).shows == false)
    // rows above not yet read: it stays, and a press goes to the document's top
    #expect(before(turns, standing, unread: true) == .top)
  }
}
