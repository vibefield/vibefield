import FieldProduct
import Foundation
import Testing

@testable import FieldHistory

// SP-7b's 7b-2b (D3 (A)) — the Swift projection, held to fieldd's own pairs: rosetta's
// `TimelineEntry` beside the `IndexTimelineRow` `index-timeline.ts` makes of it, the fixture
// byte-identical to fieldd's (`pnpm check:ios-fixtures`). A row the phone reads directly is the
// row it would have read through the door, or these go red. Below the pairs, what the pairs do
// not reach: the zod gates' edges, and the JavaScript string rules a Swift String does not share.

/// The first place two JSON values part, numbers compared as numbers: `5` and `5.0` are one
/// number on a wire whose writers differ, and the row's readers take either.
private func firstDifference(
  _ actual: JSONValue, _ expected: JSONValue, at path: String = "$"
) -> String? {
  switch (actual, expected) {
  case (.object(let left), .object(let right)):
    let keys = Set(left.keys).union(right.keys).sorted()
    for key in keys {
      let here = "\(path).\(key)"
      guard let a = left[key] else { return "\(here): absent from the row" }
      guard let b = right[key] else { return "\(here): not in the golden" }
      if let found = firstDifference(a, b, at: here) { return found }
    }
    return nil
  case (.array(let left), .array(let right)):
    guard left.count == right.count else {
      return "\(path): \(left.count) items, the golden has \(right.count)"
    }
    for index in left.indices {
      if let found = firstDifference(left[index], right[index], at: "\(path)[\(index)]") {
        return found
      }
    }
    return nil
  default:
    if let a = actual.doubleValue, let b = expected.doubleValue {
      return a == b ? nil : "\(path): \(a), the golden says \(b)"
    }
    return actual == expected ? nil : "\(path): \(actual), the golden says \(expected)"
  }
}

private func entry(
  _ over: [String: JSONValue] = [:], without: [String] = []
) -> JSONValue {
  var fields: [String: JSONValue] = [
    "timeline_id": .string("t1"),
    "session_id": .string("s1"),
    "ordinal": .int(1),
    "group": .object(["id": .string("g1"), "kind": .string("human_turn")]),
    "body": .object(["type": .string("user")]),
  ]
  for (key, value) in over { fields[key] = value }
  for key in without { fields[key] = nil }
  return .object(fields)
}

private func inline(_ text: String) -> JSONValue {
  .object(["type": .string("inline"), "text": .string(text)])
}

private func toolEntry(
  action: JSONValue, over: [String: JSONValue] = [:]
) -> JSONValue {
  var tool: [String: JSONValue] = [
    "native": .object(["name": .string("Bash")]),
    "status": .object(["value": .string("succeeded")]),
    "action": action,
  ]
  for (key, value) in over { tool[key] = value }
  return entry(["body": .object(["type": .string("tool_use"), "tool": .object(tool)])])
}

private func shell(_ command: String) -> JSONValue {
  .object(["type": .string("shell"), "command": inline(command)])
}

private let attachment: [String: JSONValue] = [
  "id": .string("a1"),
  "kind": .string("file"),
  "source": .object(["type": .string("asset")]),
]

@Suite struct HistoryProjectionTests {
  private func pairs() throws -> JSONValue { try Fixture.json("index-timeline-pairs.golden") }

  private func rowId(_ raw: JSONValue) -> String { raw["timeline_id"]?.stringValue ?? "" }

  // MARK: - The pairs

  @Test func theClipsAreThePairsOwn() throws {
    let document = try pairs()
    let textChars = document["limits"]?["textChars"]?.intValue
    let objectChars = document["limits"]?["objectChars"]?.intValue
    #expect(textChars == Int64(HistoryProjection.textChars))
    #expect(objectChars == Int64(HistoryProjection.objectChars))
  }

  @Test func everyEntryProjectsToItsRow() throws {
    let document = try pairs()
    let cases = document["cases"]?.arrayValue ?? []
    #expect(cases.count == 55)
    for item in cases {
      let name = item["name"]?.stringValue ?? "?"
      let raw = try #require(item["entry"], "\(name): no entry")
      let wanted = try #require(item["row"], "\(name): no row")
      let actual = try #require(HistoryProjection.rowJSON(entry: raw), "\(name): refused")
      let difference = firstDifference(actual, wanted)
      #expect(difference == nil, "\(name): \(difference ?? "")")
    }
  }

  @Test func everyRowDecodesForTheReaderItFills() throws {
    let document = try pairs()
    let cases = document["cases"]?.arrayValue ?? []
    for item in cases {
      let name = item["name"]?.stringValue ?? "?"
      let raw = try #require(item["entry"], "\(name): no entry")
      let wanted = try #require(item["row"], "\(name): no row")
      let row = HistoryProjection.row(entry: raw)
      let expected = try IndexTimelineRow(json: wanted)
      #expect(row == expected, "\(name)")
    }
  }

  @Test func aStepReprojectsOnlyItsUpsertsAndLandsOnItsRows() throws {
    let document = try pairs()
    let steps = document["steps"]?.arrayValue ?? []
    #expect(steps.count == 4)
    var cache = HistoryProjectionCache<JSONValue, JSONValue>()
    var table: [String: JSONValue] = [:]
    for step in steps {
      let at = step["at"]?.stringValue ?? "?"
      let upserts = step["upserts"]?.arrayValue ?? []
      let wanted = step["rows"]?.arrayValue ?? []
      for raw in upserts { table[rowId(raw)] = raw }
      let held = table.values.sorted { rowId($0) < rowId($1) }
      let before = cache.projections
      let rows = cache.rows(of: held, id: rowId, project: HistoryProjection.rowJSON(entry:))
      #expect(cache.projections - before == upserts.count, "\(at): re-projected")
      #expect(rows.count == wanted.count, "\(at): rows")
      for (row, want) in zip(rows, wanted) {
        let difference = firstDifference(row, want)
        #expect(difference == nil, "\(at): \(difference ?? "")")
      }
    }
  }

  // MARK: - The cache

  @Test func anEntryGoneIsForgottenAndComesBackProjected() {
    var cache = HistoryProjectionCache<JSONValue, JSONValue>()
    let one = entry(["timeline_id": .string("a")])
    let two = entry(["timeline_id": .string("b")])
    let project = HistoryProjection.rowJSON(entry:)

    let both = cache.rows(of: [one, two], id: rowId, project: project)
    #expect(both.count == 2)
    #expect(cache.projections == 2)

    let left = cache.rows(of: [one], id: rowId, project: project)
    #expect(left.count == 1)
    #expect(cache.projections == 2)

    let again = cache.rows(of: [one, two], id: rowId, project: project)
    #expect(again.count == 2)
    #expect(cache.projections == 3)
  }

  @Test func aRefusedEntryDrawsNoRowAndIsNotAskedAgain() {
    var cache = HistoryProjectionCache<JSONValue, JSONValue>()
    let good = entry(["timeline_id": .string("a")])
    let refused = entry(["timeline_id": .string("b")], without: ["body"])
    let project = HistoryProjection.rowJSON(entry:)

    let first = cache.rows(of: [good, refused], id: rowId, project: project)
    #expect(first.count == 1)
    #expect(cache.projections == 2)

    let second = cache.rows(of: [good, refused], id: rowId, project: project)
    #expect(second.count == 1)
    #expect(cache.projections == 2)
  }

  // MARK: - The entry's gate (the contracts' `IndexTimelineEntryRow`)

  @Test func theGateRefusesWhatTheContractsReaderRefuses() {
    var refused: [(String, JSONValue)] = []
    refused.append(("not an object", JSONValue.array([])))
    refused.append(("no timeline_id", entry(without: ["timeline_id"])))
    refused.append(("an empty timeline_id", entry(["timeline_id": .string("")])))
    refused.append(("an empty session_id", entry(["session_id": .string("")])))
    refused.append(("a string ordinal", entry(["ordinal": .string("1")])))
    refused.append(("no group", entry(without: ["group"])))
    refused.append(("a group with no kind", entry(["group": .object(["id": .string("g")])])))
    refused.append(("a response with no id", entry(["response": .object([:])])))
    refused.append(("a string at", entry(["at": .string("now")])))
    refused.append(("a number model", entry(["model": .int(1)])))
    refused.append(("a number effort", entry(["effort": .int(1)])))
    refused.append(("no body", entry(without: ["body"])))
    refused.append(("a body with no type", entry(["body": .object([:])])))
    refused.append(("a usage that is an array", entry(["usage": .array([])])))
    refused.append(("a string bucket", entry(["usage": .object(["input": .string("1")])])))
    refused.append(("a cost with no status", entry(["cost": .object([:])])))
    let nullPrice: JSONValue = .object(["status": .string("priced"), "micro_usd": .null])
    refused.append(("a null micro_usd (`.optional()` refuses it)", entry(["cost": nullPrice])))
    for (name, raw) in refused {
      let row = HistoryProjection.rowJSON(entry: raw)
      #expect(row == nil, "\(name)")
    }
  }

  @Test func theGateAdmitsEveryNullishMember() throws {
    let raw = entry([
      "response": .null, "at": .null, "model": .null, "effort": .null, "usage": .null,
      "cost": .null,
    ])
    let row = try #require(HistoryProjection.rowJSON(entry: raw))
    #expect(row["timelineId"]?.stringValue == "t1")
    #expect(row["sessionId"]?.stringValue == "s1")
    #expect(row["kind"]?.stringValue == "user")
    #expect(row["responseId"] == nil)
    #expect(row["at"] == nil)
    #expect(row["usage"] == nil)
    #expect(row["costMicroUsd"] == nil)
  }

  // MARK: - The member gates: `.optional()` refuses a null, `.nullish()` admits it

  @Test func aNullTextIsNoWordsAndTheRowStands() throws {
    let text: JSONValue = .object(["type": .string("inline"), "text": .null])
    let raw = entry(["body": .object(["type": .string("agent"), "text": text])])
    let row = try #require(HistoryProjection.rowJSON(entry: raw))
    #expect(row["kind"]?.stringValue == "agent")
    #expect(row["text"] == nil)
  }

  @Test func aNullReasonDropsTheAttachmentFromAUserRow() throws {
    var bad = attachment
    bad["source"] = .object(["type": .string("unavailable"), "reason": .null])
    let body: JSONValue = .object([
      "type": .string("user"),
      "attachments": .array([.object(bad), .object(attachment)]),
    ])
    let row = try #require(HistoryProjection.rowJSON(entry: entry(["body": body])))
    #expect(row["attachments"]?.arrayValue?.count == 1)
  }

  @Test func aToolsNullAttachmentsRefuseItsLine() throws {
    let raw = toolEntry(action: shell("ls"), over: ["attachments": .null])
    let row = try #require(HistoryProjection.rowJSON(entry: raw))
    #expect(row["kind"]?.stringValue == "tool_use")
    #expect(row["tool"] == nil)
  }

  @Test func oneUnreadableAttachmentRefusesAToolsWholeLine() throws {
    var bad = attachment
    bad["id"] = .string("")
    let raw = toolEntry(
      action: shell("ls"), over: ["attachments": .array([.object(attachment), .object(bad)])])
    let row = try #require(HistoryProjection.rowJSON(entry: raw))
    #expect(row["kind"]?.stringValue == "tool_use")
    #expect(row["tool"] == nil)
  }

  @Test func aFailureWithNoKindRefusesTheLine() throws {
    let raw = toolEntry(action: shell("ls"), over: ["failure": .object([:])])
    let row = try #require(HistoryProjection.rowJSON(entry: raw))
    #expect(row["kind"]?.stringValue == "tool_use")
    #expect(row["tool"] == nil)
  }

  @Test func aStringDurationRefusesTheLine() throws {
    let timing: JSONValue = .object(["duration_ms": .string("5")])
    let raw = toolEntry(action: shell("ls"), over: ["timing": timing])
    let row = try #require(HistoryProjection.rowJSON(entry: raw))
    #expect(row["kind"]?.stringValue == "tool_use")
    #expect(row["tool"] == nil)
  }

  // MARK: - JavaScript's string rules

  @Test func aFirstLineEndsAtTheNewlineInsideACarriageReturnPair() {
    #expect(HistoryProjection.firstLine("pnpm test\r\nsecond") == "pnpm test")
  }

  @Test func aFirstLineTrimsWhatJavaScriptTrimsAndNothingElse() {
    #expect(HistoryProjection.firstLine("\u{FEFF}\u{2003} a b \u{3000}\nc") == "a b")
    #expect(HistoryProjection.firstLine("\u{85}a\u{85}") == "\u{85}a\u{85}")
    #expect(HistoryProjection.firstLine("\nb") == "")
  }

  @Test func anEmptyCommandIsAnEmptyObjectNotNone() throws {
    let raw = toolEntry(action: shell("\nsecond"))
    let row = try #require(HistoryProjection.rowJSON(entry: raw))
    #expect(row["tool"]?["object"]?.stringValue == "")
  }

  @Test func aClipCountsUTF16AndNeverSplitsAPair() {
    let exact = HistoryProjection.clip("abc", 3)
    #expect(exact.text == "abc")
    #expect(exact.clipped == false)

    let split = HistoryProjection.clip("ab\u{1F600}cd", 3)
    #expect(split.text == "ab")
    #expect(split.clipped)

    let whole = HistoryProjection.clip("ab\u{1F600}cd", 4)
    #expect(whole.text == "ab\u{1F600}")
    #expect(whole.clipped)
  }

  @Test func aNumberReadsAsJavaScriptPrintsIt() throws {
    func result(_ action: JSONValue) throws -> String? {
      let row = try #require(HistoryProjection.rowJSON(entry: toolEntry(action: action)))
      return row["tool"]?["result"]?.stringValue
    }
    let one: JSONValue = .object(["type": .string("finding"), "total_count": .double(1.0)])
    let half: JSONValue = .object(["type": .string("finding"), "total_count": .double(1.5)])
    let exit: JSONValue = .object([
      "type": .string("shell"), "command": inline("x"),
      "outcome": .object(["exit_code": .double(2.0)]),
    ])
    let oneWord = try result(one)
    let halfWord = try result(half)
    let exitWord = try result(exit)
    #expect(oneWord == "1 finding")
    #expect(halfWord == "1.5 findings")
    #expect(exitWord == "exit 2")
  }

  @Test func aComputedDurationIsAWholeMillisecondCount() throws {
    let timing: JSONValue = .object(["started_at": .int(1_000), "completed_at": .double(3_500)])
    let raw = toolEntry(action: shell("ls"), over: ["timing": timing])
    let row = try #require(HistoryProjection.row(entry: raw))
    #expect(row.tool?.durationMs == 2_500)
  }
}

/// Item 362f (James, 2026-11-12 18:40:35Z: "i think all message type and views are different from desktop, needs
/// thorough audit") — beyond the row. Read straight from the desktop the phone holds the whole entry; the row it
/// projects stays the door's row (the pairs above), and what the entry says beyond it is kept beside it. These rows
/// hold the first such thing: the body's whole words, where the row's were cut.
@Suite("item 362f — what an entry carries beyond its row")
struct HistoryLineDetailTests {
  private func agent(_ text: JSONValue) -> JSONValue {
    entry(["body": .object(["type": .string("agent"), "text": text, "attachments": .array([])])])
  }

  /// About `units` UTF-16 units of words.
  private func long(_ units: Int) -> String { String(repeating: "word ", count: units / 5) }

  @Test("words within the door's bound leave nothing beyond the row")
  func shortWordsHaveNoDetail() throws {
    let raw = agent(inline("a short reply"))
    let row = try #require(HistoryProjection.row(entry: raw))
    #expect(HistoryProjection.detail(entry: raw, beside: row) == nil)
    #expect(HistoryProjection.projected(entry: raw) == HistoryProjected(row: row, detail: nil))
  }

  @Test("words the row cut are whole beyond it, and the row is still the door's")
  func cutWordsAreWholeBeyondTheRow() throws {
    let text = long(5_000)
    let raw = agent(inline(text))
    let row = try #require(HistoryProjection.row(entry: raw))
    #expect(row.textClipped)
    #expect(row.text?.utf16.count == HistoryProjection.textChars)
    let detail = try #require(HistoryProjection.detail(entry: raw, beside: row))
    #expect(detail.row == row)
    #expect(detail.whole?.text == text)
    #expect(detail.whole?.textClipped == false)
    #expect(detail.whole?.timelineId == row.timelineId)
    #expect(HistoryProjection.projected(entry: raw) == HistoryProjected(row: row, detail: detail))
  }

  @Test("a text that is a file on the desktop has no whole here: its row keeps its size")
  func aMemberTextHasNoWhole() throws {
    let member: JSONValue = .object([
      "type": .string("member"), "preview": .string(long(2_500)), "byte_len": .int(90_000),
    ])
    let raw = agent(member)
    let row = try #require(HistoryProjection.row(entry: raw))
    #expect(row.textClipped)
    #expect(row.textByteLen == 90_000)
    #expect(HistoryProjection.detail(entry: raw, beside: row) == nil)
  }

  @Test("an inline text past the phone's own ceiling keeps the row's cut; one at the ceiling is whole")
  func theCeilingHolds() throws {
    let past = agent(inline(long(HistoryProjection.wholeChars + 5)))
    let pastRow = try #require(HistoryProjection.row(entry: past))
    #expect(HistoryProjection.detail(entry: past, beside: pastRow) == nil)
    let edge = agent(inline(String(repeating: "a", count: HistoryProjection.wholeChars)))
    let edgeRow = try #require(HistoryProjection.row(entry: edge))
    let whole = HistoryProjection.detail(entry: edge, beside: edgeRow)?.whole
    #expect(whole?.text?.utf16.count == HistoryProjection.wholeChars)
  }

  @Test("a detail speaks only for the row it was made beside")
  func aDetailSpeaksForItsOwnRow() throws {
    let text = long(5_000)
    let raw = agent(inline(text))
    let row = try #require(HistoryProjection.row(entry: raw))
    let detail = try #require(HistoryProjection.detail(entry: raw, beside: row))
    let details = [row.timelineId: detail]
    #expect(HistoryLineDetail.applied([row], details).first?.text == text)
    // the door sends another row under the same id: the detail is silent, and is not kept
    let other = try #require(HistoryProjection.row(entry: agent(inline("rewritten"))))
    #expect(other.timelineId == row.timelineId)
    #expect(HistoryLineDetail.applied([other], details) == [other])
    #expect(HistoryLineDetail.live(details, over: [other.timelineId: other]).isEmpty)
    #expect(HistoryLineDetail.live(details, over: [row.timelineId: row]).count == 1)
  }

  @Test("the phone's ceiling is rosetta's inline bound, 32 KiB")
  func theCeiling() {
    #expect(HistoryProjection.wholeChars == 32_768)
  }
}

/// Item 362f (James, 2026-11-12 18:40:35Z: "i think all message type and views are different from desktop, needs
/// thorough audit") — what a tool line opens to. In the room a command opens to its folder and its source, a
/// change to its diff, a read and a search to their paths. The door's row carries none of that; the entry does.
/// These rows hold what the phone keeps of it beside the row, by the room's own rules and figures (rosetta at the
/// pin 811e554c6: lib/transcript/families.ts, components/transcript/detail-parts.tsx,
/// components/file-viewer/diff/parse.ts), and what it never keeps: a failure's diagnostic (item 371).
@Suite("item 362f — what a tool line opens to")
struct HistoryToolDetailTests {
  private func file(_ path: String) -> JSONValue {
    .object(["type": .string("file"), "path": .string(path), "resolved": .bool(true)])
  }

  private func folder(_ path: String) -> JSONValue {
    .object(["type": .string("directory"), "path": .string(path), "resolved": .bool(true)])
  }

  private func action(_ type: String, _ more: [String: JSONValue]) -> JSONValue {
    var fields = more
    fields["type"] = .string(type)
    return .object(fields)
  }

  private func failing(_ action: JSONValue, _ failure: [String: JSONValue]) -> JSONValue {
    toolEntry(action: action, over: ["status": .object(["value": .string("failed")]), "failure": .object(failure)])
  }

  private func opened(_ raw: JSONValue) throws -> HistoryToolDetail? {
    let row = try #require(HistoryProjection.row(entry: raw))
    return HistoryProjection.toolDetail(entry: raw, beside: row)
  }

  private func kinds(_ lines: [HistoryToolDetail.DiffLine]) -> [HistoryToolDetail.DiffLine.Kind] { lines.map(\.kind) }

  // MARK: A command

  @Test("a command opens to its folder and its source")
  func aCommand() throws {
    let raw = toolEntry(action: action("shell", ["command": inline("ls -la"), "cwd": folder("/work/app")]))
    let detail = try #require(try opened(raw))
    #expect(detail.command == "ls -la")
    #expect(detail.folder == "/work/app")
    #expect(detail.files.isEmpty && detail.paths.isEmpty && detail.failure == nil)
  }

  @Test("code opens to its source, and has no folder when the record names none")
  func code() throws {
    let raw = toolEntry(action: action("code_execute", ["code": inline("print(1)"), "language": .string("python")]))
    let detail = try #require(try opened(raw))
    #expect(detail.command == "print(1)")
    #expect(detail.folder == nil)
  }

  @Test("the room's preview: a first line within 42 is whole; a longer one is its first 39 and three dots")
  func thePreviewBound() {
    let at = String(repeating: "a", count: 42)
    let past = String(repeating: "a", count: 43)
    #expect(HistoryProjection.commandPreview(at, sourceTruncated: false) == at)
    #expect(HistoryProjection.commandPreview(past, sourceTruncated: false) == String(repeating: "a", count: 39) + "...")
  }

  @Test("the preview is the first line that is not blank, and says there is more when there is")
  func thePreviewOfManyLines() {
    #expect(HistoryProjection.commandPreview("\n  \n  echo hi\nsecond", sourceTruncated: false) == "  echo hi...")
    #expect(HistoryProjection.commandPreview("a\r\nb", sourceTruncated: false) == "a...")
    #expect(HistoryProjection.commandPreview("ls", sourceTruncated: true) == "ls...")
    #expect(HistoryProjection.commandPreview(" \n\t", sourceTruncated: false) == nil)
  }

  @Test("the preview counts code points, as the room does")
  func thePreviewCountsCodePoints() {
    let faces = String(repeating: "\u{1F600}", count: 43)
    let kept = String(repeating: "\u{1F600}", count: 39) + "..."
    #expect(HistoryProjection.commandPreview(faces, sourceTruncated: false) == kept)
  }

  // MARK: A diff

  @Test("a hunk's lines carry their sign and their number in the new file, or the old for a line taken out")
  func aPositionedHunk() {
    let diff = "--- a/x.ts\n+++ b/x.ts\n@@ -10,3 +10,4 @@ fn walk()\n ctx\n-old\n+new\n+more\n ctx2"
    let read = HistoryProjection.diffLines(diff)
    #expect(kinds(read.lines) == [.context, .del, .add, .add, .context])
    #expect(read.lines.map(\.number) == [10, 11, 11, 12, 13])
    #expect(read.lines.map(\.text) == ["ctx", "old", "new", "more", "ctx2"])
    #expect(read.more == 0)
  }

  @Test("a bare hunk gives no place, so its lines have no number")
  func aBareHunk() {
    let read = HistoryProjection.diffLines("@@\n+a\n-b")
    #expect(kinds(read.lines) == [.add, .del])
    #expect(read.lines.map(\.number) == [nil, nil])
  }

  @Test("a backslash line is a note, drawn as context with no number; an empty line is context")
  func notesAndEmptyLines() {
    let note = HistoryProjection.diffLines("@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b")
    #expect(kinds(note.lines) == [.del, .context, .add])
    #expect(note.lines.map(\.text) == ["a", "No newline at end of file", "b"])
    #expect(note.lines.map(\.number) == [1, nil, 1])
    let empty = HistoryProjection.diffLines("@@ -1,3 +1,3 @@\n a\n\n b")
    #expect(empty.lines.map(\.text) == ["a", "", "b"])
    #expect(empty.lines.map(\.number) == [1, 2, 3])
  }

  @Test("anything else ends the hunk, and lines outside a hunk are neither drawn nor counted")
  func theHunkEnds() {
    let diff = "@@ -1 +1 @@\n+a\ndiff --git a/y b/y\n+not counted\n@@ -5 +5 @@\n+b"
    let read = HistoryProjection.diffLines(diff)
    #expect(read.lines.map(\.text) == ["a", "b"])
    #expect(read.lines.map(\.number) == [1, 5])
  }

  @Test("twelve lines are drawn, and the rest are counted")
  func theLineCap() {
    let diff = "@@ -1,0 +1,15 @@\n" + (1...15).map { "+line \($0)" }.joined(separator: "\n")
    let read = HistoryProjection.diffLines(diff)
    #expect(read.lines.count == 12)
    #expect(read.lines.last?.text == "line 12")
    #expect(read.more == 3)
  }

  @Test("text in which no hunk is read is drawn as it stands; a blank diff has no lines")
  func noHunks() {
    let words = HistoryProjection.diffLines("just words\nand more")
    #expect(kinds(words.lines) == [.context, .context])
    #expect(words.lines.map(\.text) == ["just words", "and more"])
    #expect(words.lines.map(\.number) == [nil, nil])
    let long = HistoryProjection.diffLines((1...14).map { "row \($0)" }.joined(separator: "\n"))
    #expect(long.lines.count == 12 && long.more == 2)
    let blank = HistoryProjection.diffLines(" \n\t\n")
    #expect(blank.lines.isEmpty && blank.more == 0)
  }

  @Test("a header that ends in a return is no header, as the room's own pattern reads it")
  func aReturnAfterTheHeader() {
    let read = HistoryProjection.diffLines("@@ -1 +1 @@\r\n+a\r\n")
    #expect(kinds(read.lines) == [.context, .context, .context], "no hunk is read, so the text stands as it is")
    #expect(read.lines.first?.text == "@@ -1 +1 @@\r")
  }

  @Test("a line of a diff is cut at the door's bound for a line")
  func aLongLine() {
    let read = HistoryProjection.diffLines("@@ -1 +1 @@\n+" + String(repeating: "x", count: 500))
    #expect(read.lines.first?.text.utf16.count == HistoryProjection.objectChars)
  }

  // MARK: A change

  @Test("a change opens to its first four files, each its path and its diff's lines, and counts the rest")
  func aChange() throws {
    let changes: [JSONValue] = (1...5).map { index in
      .object(["path": file("src/f\(index).ts"), "diff": inline("@@ -1 +1 @@\n-a\n+b")])
    }
    let detail = try #require(try opened(toolEntry(action: action("file_change", ["changes": .array(changes)]))))
    #expect(detail.files.map(\.path) == ["src/f1.ts", "src/f2.ts", "src/f3.ts", "src/f4.ts"])
    #expect(detail.moreFiles == 1)
    #expect(kinds(detail.files[0].lines) == [.del, .add])
  }

  @Test("a change with no diff says so: its file has no lines")
  func aChangeWithNoDiff() throws {
    let change: JSONValue = .object(["path": file("src/x.ts"), "lines_added": .int(3)])
    let detail = try #require(try opened(toolEntry(action: action("file_change", ["changes": .array([change])]))))
    #expect(detail.files == [HistoryToolDetail.File(path: "src/x.ts", lines: [], more: 0)])
    #expect(detail.moreFiles == 0)
  }

  // MARK: A read and a search

  @Test("a range is the room's: L1–180, p3–4, and its start alone for a range of one or with no count")
  func aRange() {
    func range(_ unit: String, _ start: Int64, _ count: JSONValue) -> JSONValue {
      .object(["unit": .string(unit), "start": .int(start), "count": count])
    }
    #expect(HistoryProjection.rangeText(range("line", 1, .int(180))) == "L1\u{2013}180")
    #expect(HistoryProjection.rangeText(range("page", 3, .int(2))) == "p3\u{2013}4")
    #expect(HistoryProjection.rangeText(range("line", 5, .null)) == "L5")
    #expect(HistoryProjection.rangeText(range("line", 5, .int(1))) == "L5")
    #expect(HistoryProjection.rangeText(nil) == nil)
  }

  @Test("a read of one file with no range opens to nothing; with a range, or with more files, it lists them")
  func aRead() throws {
    func target(_ path: String, range: JSONValue = .null) -> JSONValue {
      .object(["resource": file(path), "range": range, "media_kind": .null])
    }
    func read(_ targets: [JSONValue]) -> JSONValue {
      toolEntry(action: action("file_read", ["targets": .array(targets)]))
    }
    #expect(try opened(read([target("a.ts")])) == nil)
    let lines: JSONValue = .object(["unit": .string("line"), "start": .int(1), "count": .int(40)])
    let ranged = try #require(try opened(read([target("a.ts", range: lines)])))
    #expect(ranged.paths == [HistoryToolDetail.Path(path: "a.ts", range: "L1\u{2013}40")])
    let two = try #require(try opened(read([target("a.ts"), target("b.ts")])))
    #expect(two.paths.map(\.path) == ["a.ts", "b.ts"])
    let many = try #require(try opened(read((1...30).map { target("f\($0).ts") })))
    #expect(many.paths.count == 24 && many.morePaths == 6)
  }

  @Test("a search opens to the paths it found, and counts the rest by the index's own total")
  func aSearch() throws {
    func search(_ outcome: [String: JSONValue]) -> JSONValue {
      toolEntry(action: action("file_search", ["query": .string("TODO"), "outcome": .object(outcome)]))
    }
    let paths: JSONValue = .array([file("a.ts"), file("b.ts")])
    let found = try #require(
      try opened(search(["match_count": .int(40), "paths": paths, "total_paths": .int(40)])))
    #expect(found.paths.map(\.path) == ["a.ts", "b.ts"])
    #expect(found.morePaths == 38)
    #expect(try opened(search(["match_count": .int(0), "paths": .array([])])) == nil)
  }

  // MARK: A line that failed

  @Test("a failed line adds its summary under its family's detail")
  func aFailedCommand() throws {
    let summary = "make: *** No rule to make target"
    let raw = failing(shell("make"), ["kind": .string("unknown"), "summary": .string(summary)])
    let detail = try #require(try opened(raw))
    #expect(detail.command == "make")
    #expect(detail.failure == summary)
  }

  @Test("with no family detail a failed line opens only when its summary says more than its line")
  func aFailureAlone() throws {
    let list = action("file_list", ["directory": folder("/work/app")])
    #expect(try opened(failing(list, ["kind": .string("unknown"), "summary": .string("permission denied")])) == nil)
    let two = try #require(try opened(failing(list, ["kind": .string("unknown"), "summary": .string("first\nsecond")])))
    #expect(two.failure == "first\nsecond")
    let long = String(repeating: "word ", count: 20)
    let past = try #require(try opened(failing(list, ["kind": .string("unknown"), "summary": .string(long)])))
    #expect(past.failure == String(long.dropLast()), "the summary whole, less the space at its end")
  }

  @Test("a failure that is a kind is the line's to say: it opens nothing")
  func aKindOpensNothing() throws {
    let list = action("file_list", ["directory": folder("/work/app")])
    #expect(try opened(failing(list, ["kind": .string("not_found")])) == nil)
    let command = try #require(try opened(failing(shell("make"), ["kind": .string("unknown")])))
    #expect(command.failure == nil)
  }

  @Test("a failure's diagnostic is never kept (item 371): the summary the row carries, or nothing")
  func neverTheDiagnostic() throws {
    let raw = failing(shell("make"), ["kind": .string("unknown"), "diagnostic": .string("raw error text\nline two")])
    let detail = try #require(try opened(raw))
    #expect(detail.failure == nil)
    #expect(detail.command == "make")
  }

  // MARK: Beside the row, and out of the document

  @Test("the detail rides beside the row: a tool entry's projection carries it, and a reply's does not")
  func besideTheRow() throws {
    let raw = toolEntry(action: action("shell", ["command": inline("ls"), "cwd": folder("/work/app")]))
    let projected = try #require(HistoryProjection.projected(entry: raw))
    #expect(projected.detail?.row == projected.row)
    #expect(projected.detail?.whole == nil)
    #expect(projected.detail?.tool?.folder == "/work/app")
    let reply = entry(["body": .object(["type": .string("agent"), "text": inline("done"), "attachments": .array([])])])
    #expect(HistoryProjection.projected(entry: reply)?.detail == nil)
  }

  /// VF-PM's row (2026-11-12 23:27:01Z): "a document rebuilt with details present encodes to the same bytes as one
  /// without". The document is written to the cache at every rebuild; a tool detail must never ride in that write.
  @Test("a document folded with a tool detail present encodes to the same bytes as one folded without")
  func theDocumentDoesNotCarryIt() throws {
    let raw = toolEntry(action: action("shell", ["command": inline("ls"), "cwd": folder("/work/marker-362f")]))
    let projected = try #require(HistoryProjection.projected(entry: raw))
    let detail = try #require(projected.detail)
    #expect(detail.tool?.folder == "/work/marker-362f")
    let header = try IndexSessionResult(json: try Fixture.json("index-session.valid")).session
    func bytes(_ rows: [IndexTimelineRow]) throws -> Data {
      let document = FieldHistoryModel.document(
        header: header, rows: rows, desktop: "studio", agentLabel: "Claude", nextCursor: nil, watermark: nil,
        liveSince: nil, now: Date(timeIntervalSince1970: 1_790_000_000))
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      return try encoder.encode(document)
    }
    let with = try bytes(HistoryLineDetail.applied([projected.row], [projected.row.timelineId: detail]))
    let without = try bytes([projected.row])
    #expect(with == without)
    #expect(!String(decoding: with, as: UTF8.self).contains("marker-362f"))
    let id = projected.row.timelineId
    #expect(HistoryLineDetail.opened([id: detail]) == [id: try #require(detail.tool)])
  }
}
