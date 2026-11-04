import Foundation

// PG-8 — THE RAIN'S COLUMN BOOKKEEPING AND WHAT A COLUMN SAYS, transcribed from puppeteer-views 0.3.3 at the pin
// `52d09c8e` (views `e79fc53d`, 10-28; SDK words `e79fc53d`, state-words and motion `5abe8f75`):
// `views/rain/rain-streams.ts` — `STREAMS_PER_AGENT` :22, `nearestFreeColumn` :24-32, `reconcileRainColumns` :44-74,
// `rainDataString` :89-103, `rainTailLength` :106-118 (dist `rain-streams.js` :3, :4-14, :25-57, :71-84, :86-98).
// Held to `phone-rain.golden.json`'s `rows` and `columns` at every step of the witness run.
//
// Three exactnesses the transcription keeps (read-pg8 §2.1):
//   · the data string is UTF-16 code units: the flatten `/[^a-zA-Z0-9\s%.]/g` has no `u` flag, so an astral character
//     is two cells and `data[row % data.length]` indexes units, never Characters (`"\r\n"` is two cells);
//   · `CTX:` is `Math.round(usedPercent).toString().padStart(2, '0')`, never the toolkit's floored percent;
//   · a JavaScript `Map` iterates in insertion order and the draw paints in it, so `RainColumns` is an ORDERED list.

/// A stream's head (`RainDrop`, :6-11): its agent, its head position in rows (fractional, so a stream can crawl slower
/// than a row a frame) and its own speed. A class, as the JavaScript object is: the draw advances `y` in place, and a
/// kept drop is the same drop across reconciles.
final class RainDrop {
  let agentId: String
  var y: Double
  let speed: Double

  init(agentId: String, y: Double, speed: Double) {
    self.agentId = agentId
    self.y = y
    self.speed = speed
  }
}

/// The columns' drops, in the order they were placed: a JavaScript `Map<number, RainDrop>`, whose iteration order is
/// its insertion order and is the order the draw paints in.
struct RainColumns {
  private(set) var entries: [(column: Int, drop: RainDrop)] = []
  private var positions: [Int: Int] = [:]

  var count: Int { entries.count }
  var isEmpty: Bool { entries.isEmpty }

  func has(_ column: Int) -> Bool { positions[column] != nil }

  func drop(at column: Int) -> RainDrop? {
    positions[column].map { entries[$0].drop }
  }

  /// `Map.set`: a new column is appended; an existing one keeps its place and takes the drop.
  mutating func set(_ column: Int, _ drop: RainDrop) {
    if let position = positions[column] {
      entries[position].drop = drop
    } else {
      positions[column] = entries.count
      entries.append((column, drop))
    }
  }
}

enum RainStreams {
  /// `STREAMS_PER_AGENT` (:22). SKELETON (PG-8 red): the transcription lands in the green.
  static let perAgent = 2

  static func nearestFree(_ taken: RainColumns, columns: Int, ideal: Int) -> Int? { nil }

  static func reconcile(
    agents: [String], columns: Int, previous: RainColumns, createDrop: (String) -> RainDrop
  ) -> RainColumns {
    RainColumns()
  }

  static func data(_ agent: RainAgent) -> [UInt16] { [] }

  static func flatten(_ text: String) -> [UInt16] { [] }

  static func keeps(_ unit: UInt16) -> Bool { false }

  static func contextDigits(_ percent: Double) -> String { "" }

  static func tailLength(_ agent: RainAgent, rows: Int, tailMultiplier: Double, dataLength: Int) -> Double { 0 }
}
