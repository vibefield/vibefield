import FieldProduct
import Foundation
import Testing

@testable import FieldHistory

// ITEM 109 (VF-PM's (a), N = 6, 2026-11-05) — a tail reset past the rows held. A tailnet caller's tail answers a
// snapshot of the session's newest `INDEX_TAILNET_LIMITS.MAX_ROWS` (100) rows, and a `.snapshot` RESETS the copy.
// The reader kept every held row below the reset's oldest, and its older cursor points below the first page it
// read, so when more than 100 rows arrived after the newest row held (an app switch through a busy session), the
// rows between were in no page a cursor reaches: a silent hole in the middle of the transcript.

/// A session of `total` agent rows, ordinals `0..<total`. `index.timeline` pages it backward from the head as
/// rosetta does (newest page first, oldest first within it; the cursor names the next page's top), and the tail's
/// open answers its newest `tailRows`, cut as a tailnet caller's snapshot is.
@MainActor
private final class SessionDoor: HistoryDoor {
  var total: Int
  let tailRows = 100
  /// every `index.timeline`'s cursor, in order (nil: the head)
  var pages: [String?] = []
  var closed = false

  init(total: Int) { self.total = total }

  static func row(_ ordinal: Int) -> JSONValue {
    .object([
      "timelineId": .string("r\(ordinal)"), "sessionId": .string("s1"), "ordinal": .int(Int64(ordinal)),
      "kind": .string("agent"), "at": .int(Int64(3_600_000 + ordinal * 1_000)),
      "group": .object(["id": .string("cycle-\(ordinal)"), "kind": .string("agent_cycle")]),
      "text": .string("row \(ordinal)"),
    ])
  }

  func call(_ method: String, params: JSONValue?) async throws -> JSONValue {
    switch method {
    case "index.status": return try Fixture.json("index-status.valid")
    case "index.session": return try Fixture.json("index-session.valid")
    case "index.timeline":
      let cursor = params?["cursor"]?.stringValue
      pages.append(cursor)
      let limit = Int(params?["limit"]?.intValue ?? Int64(HistoryReads.pageRows))
      let top = cursor.flatMap { Int($0.dropFirst("before:".count)) } ?? total
      let start = max(0, top - limit)
      return .object([
        "sessionId": .string("s1"), "entries": .array((start..<top).map(Self.row)),
        "nextCursor": start > 0 ? .string("before:\(start)") : .null, "clipped": .bool(false),
        "watermark": .string("w1"),
      ])
    default: throw FieldProductError(kind: "NOT_FOUND", message: method)
    }
  }

  func tail(
    _ method: String, params: JSONValue?, shape: SubscriptionShape,
    onSnapshot: @escaping @MainActor (JSONValue) -> Void,
    onDelta: @escaping @MainActor (JSONValue) -> Void
  ) async throws -> HistoryTailHandle {
    let start = max(0, total - tailRows)
    onSnapshot(
      .object([
        "epoch": .string("tail-s1.1"), "revision": .int(Int64(total)),
        "rows": .array((start..<total).map(Self.row)),
      ]))
    return HistoryTailHandle {}
  }

  func close() { closed = true }
}

/// The reader's log lines, kept for the row that reads them.
@MainActor
private final class Lines {
  var all: [String] = []
}

@MainActor
private func settle(_ what: String, timeout: Duration = .seconds(5), _ condition: @MainActor () -> Bool) async {
  let deadline = ContinuousClock.now.advanced(by: timeout)
  while ContinuousClock.now < deadline {
    if condition() { return }
    try? await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("timed out waiting for \(what)")
}

/// The document's rows, in its order: one prose segment per agent row, by timeline id.
@MainActor
private func heldIds(_ reader: HistoryDesktopReader) -> [String] {
  (reader.corpus.document("s1")?.turns ?? []).flatMap { $0.segments.map(\.id) }
}

private func ids(_ ordinals: Range<Int>) -> [String] { ordinals.map { "r\($0)" } }

/// A reader over the door, its session open: the head page (20…59) and the tail's snapshot (0…59).
@MainActor
private func opened(_ door: SessionDoor, _ lines: Lines) async -> HistoryDesktopReader {
  let reader = HistoryDesktopReader(
    deviceId: "dev-1", name: "studio", door: door, log: { lines.all.append($0) })
  reader.start()
  reader.need(.session(device: "dev-1", id: "s1"))
  await settle("the document and its tail") { heldIds(reader).count == 60 }
  #expect(heldIds(reader) == ids(0..<60))
  return reader
}

@Suite("ITEM 109 — a tail reset past the rows held")
struct HistoryTailHoleTests {
  @Test("a hole within the fill's reach closes: the head is read until it meets the rows held, and nothing is dropped")
  @MainActor
  func holeFills() async throws {
    let door = SessionDoor(total: 60)
    let lines = Lines()
    let reader = await opened(door, lines)
    reader.pause()
    door.total = 280  // 220 rows while away: the reset carries 180…279, and 60…179 is the hole (120 rows)
    let asked = door.pages.count
    reader.resume()
    await settle("the reset's rows") { heldIds(reader).contains("r279") }
    await settle("the fill's six pages") { door.pages.count - asked == HistoryReads.fillPages }
    await settle("the hole closed") { heldIds(reader).count == 280 }
    #expect(heldIds(reader) == ids(0..<280), "every row, none twice, in order")
    #expect(
      Array(door.pages.suffix(HistoryReads.fillPages))
        == [nil, "before:240", "before:200", "before:160", "before:120", "before:80"],
      "from the head down, the sixth page meeting the newest row held (59)")
    #expect(
      reader.corpus.document("s1")?.nextCursor == "before:20",
      "the older pages read on below the rows first read")
    #expect(lines.all.isEmpty, "nothing was dropped, so nothing is said: \(lines.all)")
    reader.close()
  }

  @Test("a hole past the fill's reach: the rows below its pages are dropped and said, the copy is contiguous, and the older pages read on")
  @MainActor
  func holeTruncates() async throws {
    let door = SessionDoor(total: 60)
    let lines = Lines()
    let reader = await opened(door, lines)
    reader.pause()
    door.total = 1_160  // the reset carries 1060…1159, and 60…1059 is the hole (1,000 rows)
    let asked = door.pages.count
    reader.resume()
    await settle("the reset's rows") { heldIds(reader).contains("r1159") }
    await settle("the fill's six pages") { door.pages.count - asked == HistoryReads.fillPages }
    await settle("the drop, said") { !lines.all.isEmpty }
    #expect(heldIds(reader) == ids(920..<1_160), "the six pages and the reset, contiguous; 0…59 dropped")
    #expect(
      Array(door.pages.suffix(HistoryReads.fillPages))
        == [nil, "before:1120", "before:1080", "before:1040", "before:1000", "before:960"])
    #expect(reader.corpus.document("s1")?.nextCursor == "before:920", "the cursor re-seated on the last page's")
    #expect(lines.all.count == 1)
    let line = try #require(lines.all.first)
    #expect(line.contains("dropped 60 rows") && line.contains("ordinals 0–59"), "the count and the ordinals: \(line)")
    // the older pages read on from the fill's last page, contiguous
    reader.need(.older(device: "dev-1", session: "s1"))
    await settle("the older page") { heldIds(reader).first == "r880" }
    #expect(door.pages.last == "before:920")
    #expect(heldIds(reader) == ids(880..<1_160))
    reader.close()
  }

  @Test("a reset that reaches the rows held reads no page")
  @MainActor
  func overlapReadsNothing() async throws {
    let door = SessionDoor(total: 60)
    let lines = Lines()
    let reader = await opened(door, lines)
    reader.pause()
    door.total = 110  // the reset carries 10…109, which meets 0…59
    let asked = door.pages.count
    reader.resume()
    await settle("the reset's rows") { heldIds(reader).contains("r109") }
    try await Task.sleep(for: .milliseconds(100))
    #expect(door.pages.count == asked, "no fill: \(door.pages.suffix(door.pages.count - asked))")
    #expect(heldIds(reader) == ids(0..<110))
    #expect(lines.all.isEmpty)
    reader.close()
  }
}
