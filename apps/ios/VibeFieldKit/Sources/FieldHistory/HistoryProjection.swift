import FieldProduct
import Foundation

// SP-7b's 7b-2b (`SP-7b-plan.md` D3 (A)) — one timeline row, PROJECTED on the phone: rosetta's
// `TimelineEntry` into the door's `IndexTimelineRow`, the Swift port of fieldd's
// `src/index-timeline.ts`. A row the direct plane hands over reads the same as the row the door
// would have sent, and `HistoryProjectionTests` holds that against fieldd's own golden pairs.
//
// Deliberately over `FieldProduct.JSONValue` with no rosetta type in sight: the port is testable on
// the fixture's bytes alone, and the reader converts rosetta's JSON at its one seam.
//
// Two gates, as in TypeScript. The ENTRY's (the contracts' `IndexTimelineEntryRow`) refuses a row
// and is strict about identity; a body's members are read by type and never refuse anything, so a
// shape this build never heard of is a row of its kind with no words. Each reader below keeps zod's
// distinction: `.optional()` refuses a JSON null where `.nullish()` admits it.
//
// What never crosses, as at the door: an asset's bytes, its address on rosettad (`AssetRef.url` is
// not read — EL2, EL7), a citation's source, a tool's diagnostics beyond its summary, provenance.
public enum HistoryProjection {
  /// `INDEX_TIMELINE.TEXT_CHARS`, held by `pnpm check:ios-fixtures`: a row's words, UTF-16 units.
  public static let textChars = 2_000
  /// `INDEX_TIMELINE.OBJECT_CHARS`, held the same way: a tool line's object and failure.
  public static let objectChars = 200

  private typealias Fields = [String: JSONValue]

  /// A body's words, with the whole's size when only a preview travelled.
  private struct Words {
    let text: String
    var byteLen: JSONValue? = nil
  }

  /// A tool line's one object and its result in a few words.
  private struct Facts {
    var object: String? = nil
    var result: String? = nil
  }

  /// rosetta's `ToolStatus` values that did not complete the tool's work.
  private static let failedStatuses: Set<String> = [
    "failed", "denied", "timed_out", "cancelled", "interrupted",
  ]

  /// The five token buckets, on rosetta's wire and on the row.
  private static let usageBuckets: [(wire: String, row: String)] = [
    (wire: "input", row: "input"),
    (wire: "output", row: "output"),
    (wire: "cache_read", row: "cacheRead"),
    (wire: "cache_write", row: "cacheWrite"),
    (wire: "thinking", row: "thinking"),
  ]

  // MARK: - The row

  /// The row the reader fills; nil for an entry the gate refuses.
  static func row(entry: JSONValue) -> IndexTimelineRow? {
    guard let json = rowJSON(entry: entry) else { return nil }
    return try? IndexTimelineRow(json: json)
  }

  /// The row as the door would send it; nil for an entry the gate refuses.
  static func rowJSON(entry: JSONValue) -> JSONValue? {
    guard let fields = entry.objectValue, admitsEntry(fields) else { return nil }
    guard let body = fields["body"]?.objectValue, let kind = body["type"]?.stringValue else {
      return nil
    }

    var row: Fields = [:]
    row["timelineId"] = fields["timeline_id"]
    row["sessionId"] = fields["session_id"]
    row["ordinal"] = fields["ordinal"]
    row["kind"] = .string(kind)
    row["at"] = num(fields["at"])
    row["model"] = str(fields["model"]).map(JSONValue.string)
    row["effort"] = str(fields["effort"]).map(JSONValue.string)
    if let group = fields["group"]?.objectValue {
      var projected: Fields = [:]
      projected["id"] = group["id"]
      projected["kind"] = group["kind"]
      row["group"] = .object(projected)
    }
    if let response = fields["response"]?.objectValue { row["responseId"] = response["id"] }

    if let words = bodyText(body) {
      let clipped = clip(words.text, textChars)
      row["text"] = .string(clipped.text)
      if clipped.clipped { row["textClipped"] = .bool(true) }
      row["textByteLen"] = words.byteLen
    }
    if let attachments = bodyAttachments(body) { row["attachments"] = .array(attachments) }
    if kind == "tool_use" { row["tool"] = projectTool(body["tool"]) }
    if kind == "notice", let notice = body["notice"]?.objectValue {
      row["notice"] = str(notice["type"]).map(JSONValue.string)
    }
    if kind == "summary" { row["summaryPurpose"] = str(body["purpose"]).map(JSONValue.string) }
    row["usage"] = projectUsage(fields["usage"])
    if let cost = fields["cost"]?.objectValue, cost["status"]?.stringValue == "priced" {
      row["costMicroUsd"] = num(cost["micro_usd"])
    }
    return .object(row)
  }

  // MARK: - The readers' primitives

  private static func str(_ value: JSONValue?) -> String? {
    guard let text = value?.stringValue, !text.isEmpty else { return nil }
    return text
  }

  /// A finite number, kept in the shape it was sent.
  private static func num(_ value: JSONValue?) -> JSONValue? {
    guard let value else { return nil }
    switch value {
    case .int: return value
    case .double(let number): return number.isFinite ? value : nil
    default: return nil
    }
  }

  private static func isString(_ value: JSONValue) -> Bool { value.stringValue != nil }

  private static func isNumber(_ value: JSONValue) -> Bool { num(value) != nil }

  private static func isNonEmptyString(_ value: JSONValue?) -> Bool { str(value) != nil }

  /// zod's `.nullish()`: absent, null, or admitted.
  private static func nullish(_ value: JSONValue?, _ admits: (JSONValue) -> Bool) -> Bool {
    guard let value, !value.isNull else { return true }
    return admits(value)
  }

  /// zod's `.optional()`: absent or admitted, so a JSON null refuses.
  private static func absentOr(_ value: JSONValue?, _ admits: (JSONValue) -> Bool) -> Bool {
    guard let value else { return true }
    return admits(value)
  }

  /// A whole number as an integer, as JavaScript would print it.
  private static func number(_ value: Double) -> JSONValue {
    let whole = value.rounded() == value && value.magnitude < 9.007_199_254_740_992e15
    return whole ? .int(Int64(value)) : .double(value)
  }

  /// A number as a template literal prints it: `2.0` is `2`.
  private static func numberText(_ value: JSONValue) -> String {
    if case .int(let whole) = value { return String(whole) }
    guard let decimal = value.doubleValue else { return "" }
    if case .int(let whole) = number(decimal) { return String(whole) }
    return String(decimal)
  }

  private static func count(_ value: JSONValue?, _ one: String, _ many: String) -> String? {
    guard let value else { return nil }
    let word = value.doubleValue == 1 ? one : many
    return "\(numberText(value)) \(word)"
  }

  /// A text cut at `max` UTF-16 units, never through a surrogate pair.
  static func clip(_ text: String, _ max: Int) -> (text: String, clipped: Bool) {
    guard text.utf16.count > max else { return (text, false) }
    var units = Array(text.utf16.prefix(max))
    if let last = units.last, UTF16.isLeadSurrogate(last) { units.removeLast() }
    return (String(decoding: units, as: UTF16.self), true)
  }

  /// The first line, trimmed as JavaScript trims: read by scalar, because a `Character` search
  /// misses the newline inside a CRLF grapheme.
  static func firstLine(_ text: String) -> String {
    let scalars = Array(text.unicodeScalars)
    var last = scalars.firstIndex { $0.value == 10 } ?? scalars.count
    var first = 0
    while first < last, isTrimmed(scalars[first]) { first += 1 }
    while last > first, isTrimmed(scalars[last - 1]) { last -= 1 }
    var kept = String.UnicodeScalarView()
    kept.append(contentsOf: scalars[first..<last])
    return String(kept)
  }

  /// ECMAScript's WhiteSpace and LineTerminator: NEL (U+0085) is deliberately not one.
  private static func isTrimmed(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.value {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A: return true
    case 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
    default: return false
    }
  }

  // MARK: - The entry's gate (the contracts' `IndexTimelineEntryRow`)

  private static func admitsEntry(_ entry: Fields) -> Bool {
    guard isNonEmptyString(entry["timeline_id"]), isNonEmptyString(entry["session_id"]) else {
      return false
    }
    guard num(entry["ordinal"]) != nil else { return false }
    guard let group = entry["group"]?.objectValue else { return false }
    guard group["id"]?.stringValue != nil, group["kind"]?.stringValue != nil else { return false }
    guard entry["body"]?["type"]?.stringValue != nil else { return false }
    guard nullish(entry["response"], admitsResponse) else { return false }
    guard nullish(entry["at"], isNumber) else { return false }
    guard nullish(entry["model"], isString), nullish(entry["effort"], isString) else {
      return false
    }
    guard nullish(entry["usage"], admitsUsage) else { return false }
    return nullish(entry["cost"], admitsCost)
  }

  private static func admitsResponse(_ value: JSONValue) -> Bool {
    value["id"]?.stringValue != nil
  }

  private static func admitsUsage(_ value: JSONValue) -> Bool {
    guard let usage = value.objectValue else { return false }
    return usageBuckets.allSatisfy { nullish(usage[$0.wire], isNumber) }
  }

  private static func admitsCost(_ value: JSONValue) -> Bool {
    guard let cost = value.objectValue, cost["status"]?.stringValue != nil else { return false }
    return absentOr(cost["micro_usd"], isNumber)
  }

  // MARK: - Words

  /// rosetta's `CanonicalText` as words: an `inline` text, or a `member`'s preview with the whole's
  /// size. A third form, or a member of the wrong type, is no text.
  private static func textOf(_ value: JSONValue?) -> Words? {
    guard let row = value?.objectValue, let type = row["type"]?.stringValue else { return nil }
    let text = row["text"]
    let preview = row["preview"]
    let byteLen = row["byte_len"]
    guard absentOr(text, isString), absentOr(preview, isString) else { return nil }
    guard absentOr(byteLen, isNumber) else { return nil }
    switch type {
    case "inline":
      return text?.stringValue.map { Words(text: $0) }
    case "member":
      return preview?.stringValue.map { Words(text: $0, byteLen: byteLen) }
    default:
      return nil
    }
  }

  /// A body's words by its kind. Nil when the kind carries none, as a tool row does.
  private static func bodyText(_ body: Fields) -> Words? {
    switch body["type"]?.stringValue ?? "" {
    case "user", "agent", "thinking", "summary":
      return textOf(body["text"])
    case "notice":
      guard let notice = body["notice"]?.objectValue else { return nil }
      return noticeText(notice)
    case "collaboration":
      guard let event = body["event"]?.objectValue else { return nil }
      if let summary = str(event["summary"]) { return Words(text: summary) }
      return textOf(event["body"])
    default:
      return nil
    }
  }

  private static func noticeText(_ notice: Fields) -> Words? {
    switch notice["type"]?.stringValue ?? "" {
    case "command_output":
      return textOf(notice["output"])
    case "runtime_error", "async_task":
      return str(notice["summary"]).map { Words(text: $0) }
    case "compaction":
      return str(notice["reason"]).map { Words(text: $0) }
    default:
      return nil
    }
  }

  private static func bodyAttachments(_ body: Fields) -> [JSONValue]? {
    switch body["type"]?.stringValue ?? "" {
    case "user", "agent":
      return projectAttachments(body["attachments"])
    case "collaboration":
      return projectAttachments(body["event"]?["attachments"])
    default:
      return nil
    }
  }

  // MARK: - Attachments, as refs

  private static func admitsAttachment(_ value: JSONValue) -> Bool {
    guard let row = value.objectValue else { return false }
    guard isNonEmptyString(row["id"]), row["kind"]?.stringValue != nil else { return false }
    guard nullish(row["label"], isString), nullish(row["name"], isString) else { return false }
    guard nullish(row["media_type"], isString) else { return false }
    guard nullish(row["byte_len"], isNumber) else { return false }
    guard let source = row["source"]?.objectValue else { return false }
    guard source["type"]?.stringValue != nil else { return false }
    return absentOr(source["reason"], isString)
  }

  /// One attachment as a ref; nil for one the gate refuses, which the caller drops.
  private static func projectAttachment(_ value: JSONValue) -> JSONValue? {
    guard admitsAttachment(value), let row = value.objectValue else { return nil }
    let source = row["source"]?.objectValue
    let unavailable = source?["type"]?.stringValue == "unavailable"
    let name = str(row["name"]) ?? str(row["label"])
    var ref: Fields = [:]
    ref["id"] = row["id"]
    ref["kind"] = row["kind"]
    ref["name"] = name.map(JSONValue.string)
    ref["mediaType"] = str(row["media_type"]).map(JSONValue.string)
    ref["byteLen"] = num(row["byte_len"])
    ref["available"] = .bool(!unavailable)
    if unavailable { ref["reason"] = str(source?["reason"]).map(JSONValue.string) }
    return .object(ref)
  }

  /// Nil when the member is not an array or leaves no ref.
  private static func projectAttachments(_ value: JSONValue?) -> [JSONValue]? {
    guard let items = value?.arrayValue else { return nil }
    let refs = items.compactMap(projectAttachment)
    return refs.isEmpty ? nil : refs
  }

  // MARK: - A tool's line

  private static func admitsTool(_ tool: Fields) -> Bool {
    guard tool["native"]?["name"]?.stringValue != nil else { return false }
    guard tool["status"]?["value"]?.stringValue != nil else { return false }
    guard tool["action"]?["type"]?.stringValue != nil else { return false }
    guard nullish(tool["failure"], admitsFailure) else { return false }
    guard nullish(tool["timing"], admitsTiming) else { return false }
    return absentOr(tool["attachments"], admitsAttachments)
  }

  private static func admitsFailure(_ value: JSONValue) -> Bool {
    guard let failure = value.objectValue, failure["kind"]?.stringValue != nil else { return false }
    return nullish(failure["summary"], isString)
  }

  private static func admitsTiming(_ value: JSONValue) -> Bool {
    guard let timing = value.objectValue else { return false }
    guard nullish(timing["started_at"], isNumber) else { return false }
    guard nullish(timing["completed_at"], isNumber) else { return false }
    return nullish(timing["duration_ms"], isNumber)
  }

  /// A tool's array is strict where a body's is tolerant: one unreadable item refuses the line.
  private static func admitsAttachments(_ value: JSONValue) -> Bool {
    guard let items = value.arrayValue else { return false }
    return items.allSatisfy(admitsAttachment)
  }

  /// A tool interaction's facts; nil when the gate refuses it, and the row stays a `tool_use` row
  /// with no line to draw.
  private static func projectTool(_ value: JSONValue?) -> JSONValue? {
    guard let tool = value?.objectValue, admitsTool(tool) else { return nil }
    guard let action = tool["action"]?.objectValue else { return nil }
    let status = tool["status"]?["value"]?.stringValue ?? ""
    let failure = tool["failure"]?.objectValue
    let facts = actionFacts(action)

    var row: Fields = [:]
    row["name"] = tool["native"]?["name"]
    row["family"] = action["type"]
    row["status"] = .string(status)
    row["failed"] = .bool(failedStatuses.contains(status) || failure != nil)
    if let failure, let text = str(failure["summary"]) ?? str(failure["kind"]) {
      row["failure"] = .string(clip(text, objectChars).text)
    }
    if let object = facts.object {
      let clipped = clip(object, objectChars)
      row["object"] = .string(clipped.text)
      if clipped.clipped { row["objectClipped"] = .bool(true) }
    }
    row["result"] = facts.result.map(JSONValue.string)
    row["durationMs"] = durationMs(tool["timing"])
    if let refs = projectAttachments(tool["attachments"]) { row["attachments"] = .array(refs) }
    return .object(row)
  }

  /// The stated duration, or the span between two stamps that run forward.
  private static func durationMs(_ value: JSONValue?) -> JSONValue? {
    guard let timing = value?.objectValue else { return nil }
    if let stated = num(timing["duration_ms"]) { return stated }
    guard let started = num(timing["started_at"])?.doubleValue else { return nil }
    guard let completed = num(timing["completed_at"])?.doubleValue else { return nil }
    return completed >= started ? number(completed - started) : nil
  }

  /// rosetta's `ResourceRef` as a label: the path, the URL, the id.
  private static func resourceLabel(_ value: JSONValue?) -> String? {
    guard let ref = value?.objectValue else { return nil }
    switch ref["type"]?.stringValue ?? "" {
    case "file", "directory": return str(ref["path"])
    case "url": return str(ref["url"])
    case "session", "task", "process": return str(ref["id"])
    case "asset": return str(ref["asset"]?["media_type"]) ?? "asset"
    default: return nil
    }
  }

  /// The object and the result by the action's family. An unknown family carries neither.
  private static func actionFacts(_ action: Fields) -> Facts {
    let family = action["type"]?.stringValue ?? ""
    let outcome = action["outcome"]?.objectValue
    switch family {
    case "shell", "code_execute":
      return runFacts(action[family == "shell" ? "command" : "code"], outcome)
    case "file_read":
      return fileReadFacts(action)
    case "file_list":
      let result = count(num(outcome?["entry_count"]), "entry", "entries")
      return Facts(object: resourceLabel(action["directory"]), result: result)
    case "file_search", "code_lookup", "web_search", "tool_discovery":
      return Facts(object: str(action["query"]), result: searchTotal(family, action, outcome))
    case "file_change":
      return fileChangeFacts(action)
    case "web_fetch", "web_navigate":
      let object = resourceLabel(action["url"]) ?? str(action["pattern"])
      return Facts(object: object, result: num(outcome?["http_status"]).map(numberText))
    case "external":
      return externalFacts(action)
    case "process":
      return Facts(object: str(action["process_id"]), result: str(outcome?["state"]))
    case "finding":
      return Facts(result: count(num(action["total_count"]), "finding", "findings"))
    case "orchestration":
      return Facts(result: count(num(action["executed_child_count"]), "child", "children"))
    default:
      return namedFacts(family, action)
    }
  }

  /// The families whose object is a name or a sentence.
  private static func namedFacts(_ family: String, _ action: Fields) -> Facts {
    switch family {
    case "delegate", "workflow", "schedule":
      let object = str(action["name"]) ?? textOf(action["objective"])?.text ?? str(action["reason"])
      return Facts(object: object.map(firstLine))
    case "task":
      let object = str(action["subject"]) ?? textOf(action["description"])?.text
      return Facts(object: object.map(firstLine), result: str(action["status"]))
    case "plan", "artifact", "skill":
      return Facts(object: str(action["title"]) ?? str(action["name"]))
    case "question":
      let prompt = textOf(action["questions"]?.arrayValue?.first?["prompt"])?.text
      return Facts(object: prompt.map(firstLine))
    case "notification":
      let summary = textOf(action["summary"])?.text
      return Facts(object: summary.map(firstLine))
    case "mode":
      return Facts(object: str(action["mode"]))
    default:
      return Facts()
    }
  }

  private static func runFacts(_ source: JSONValue?, _ outcome: Fields?) -> Facts {
    var facts = Facts()
    if let words = textOf(source) { facts.object = firstLine(words.text) }
    if let exit = num(outcome?["exit_code"]) {
      facts.result = "exit \(numberText(exit))"
    } else {
      facts.result = str(outcome?["signal"])
    }
    return facts
  }

  private static func fileReadFacts(_ action: Fields) -> Facts {
    let targets = action["targets"]?.arrayValue ?? []
    var facts = Facts()
    facts.object = resourceLabel(targets.first?["resource"])
    if targets.count > 1 { facts.result = "\(targets.count) files" }
    return facts
  }

  private static func searchTotal(
    _ family: String, _ action: Fields, _ outcome: Fields?
  ) -> String? {
    switch family {
    case "file_search": return count(num(outcome?["match_count"]), "match", "matches")
    case "code_lookup": return count(num(outcome?["total_count"]), "location", "locations")
    case "web_search": return count(num(outcome?["total_count"]), "source", "sources")
    default: return count(num(action["total_count"]), "tool", "tools")
    }
  }

  private static func fileChangeFacts(_ action: Fields) -> Facts {
    let changes = action["changes"]?.arrayValue ?? []
    var facts = Facts()
    facts.object = resourceLabel(changes.first?["path"])
    if changes.count > 1 {
      facts.result = "\(changes.count) files"
      return facts
    }
    var added = 0.0
    var removed = 0.0
    var counted = false
    for change in changes {
      let lineAdds = num(change["lines_added"])?.doubleValue
      let lineCuts = num(change["lines_removed"])?.doubleValue
      if lineAdds != nil || lineCuts != nil { counted = true }
      added += lineAdds ?? 0
      removed += lineCuts ?? 0
    }
    guard counted else { return facts }
    var parts: [String] = []
    if added > 0 { parts.append("+\(numberText(number(added)))") }
    if removed > 0 { parts.append("\u{2212}\(numberText(number(removed)))") }
    if !parts.isEmpty { facts.result = parts.joined(separator: " ") }
    return facts
  }

  private static func externalFacts(_ action: Fields) -> Facts {
    guard let operation = str(action["operation"]) else { return Facts() }
    guard let subject = str(action["subject"]) else { return Facts(object: operation) }
    return Facts(object: "\(operation) \(subject)")
  }

  private static func projectUsage(_ value: JSONValue?) -> JSONValue? {
    guard let usage = value?.objectValue else { return nil }
    var row: Fields = [:]
    for bucket in usageBuckets { row[bucket.row] = num(usage[bucket.wire]) }
    return row.isEmpty ? nil : JSONValue.object(row)
  }
}

/// D-2c (a): an entry's row is made once and made again only when the entry changed. rosetta's
/// client hands over the whole visible list on every change and a `TimelineEntry` has no revision,
/// so the cache keeps each entry beside its row and compares. A refused entry keeps its refusal.
struct HistoryProjectionCache<Entry: Equatable, Row> {
  private struct Held {
    let entry: Entry
    let row: Row?
  }

  private var held: [String: Held] = [:]

  /// How many times an entry has been projected: what the tests hold D-2c (a) by.
  private(set) var projections = 0

  init() {}

  /// The rows of `entries`, in their order. An id absent from `entries` is forgotten.
  mutating func rows(
    of entries: [Entry], id: (Entry) -> String, project: (Entry) -> Row?
  ) -> [Row] {
    var next: [String: Held] = [:]
    next.reserveCapacity(entries.count)
    var rows: [Row] = []
    rows.reserveCapacity(entries.count)
    for entry in entries {
      let key = id(entry)
      let row: Row?
      if let known = held[key], known.entry == entry {
        row = known.row
      } else {
        row = project(entry)
        projections += 1
      }
      next[key] = Held(entry: entry, row: row)
      if let row { rows.append(row) }
    }
    held = next
    return rows
  }
}
