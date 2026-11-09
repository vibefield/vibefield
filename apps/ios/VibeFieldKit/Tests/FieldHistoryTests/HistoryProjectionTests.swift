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
