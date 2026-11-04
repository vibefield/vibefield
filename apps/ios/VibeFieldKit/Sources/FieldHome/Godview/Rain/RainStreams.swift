import FieldAgents
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
  /// `STREAMS_PER_AGENT` (:22): two adjacent streams per agent wherever the stage has room for them.
  static let perAgent = 2

  /// `nearestFreeColumn` (:24-32): from the ideal outward, the right first, then the left.
  static func nearestFree(_ taken: RainColumns, columns: Int, ideal: Int) -> Int? {
    var offset = 0
    while offset < columns {
      let right = ideal + offset
      if right < columns && !taken.has(right) { return right }
      let left = ideal - offset
      if left >= 0 && !taken.has(left) { return left }
      offset += 1
    }
    return nil
  }

  /// `reconcileRainColumns` (:44-74): the columns already placed are kept where they are (a stream never jumps when
  /// another agent arrives), every surplus stream is reclaimed before newcomers compete for free columns, and only new
  /// agents are placed, nearest their ideal. With no room for everyone, later agents go unplaced — visible on screen
  /// rather than silent.
  static func reconcile(
    agents: [String], columns: Int, previous: RainColumns, createDrop: (String) -> RainDrop
  ) -> RainColumns {
    var next = RainColumns()
    if columns <= 0 || agents.isEmpty { return next }
    let spacing = Double(columns) / Double(agents.count)
    let target = spacing >= Double(perAgent) ? perAgent : 1
    let live = Set(agents)
    var held: [String: Int] = [:]
    for (column, drop) in previous.entries {
      if column >= columns || !live.contains(drop.agentId) { continue }
      let existing = held[drop.agentId] ?? 0
      // Reclaim every surplus stream before newcomers compete for free columns.
      if existing >= target { continue }
      next.set(column, drop)
      held[drop.agentId] = existing + 1
    }
    for (index, agentId) in agents.enumerated() {
      let existing = held[agentId] ?? 0
      if existing >= target { continue }
      let floored = (Double(index) * spacing + spacing / 2).rounded(.down)
      let ideal = Swift.min(columns - 1, Swift.max(0, Int(floored)))
      var placed = existing
      while placed < target {
        guard let column = nearestFree(next, columns: columns, ideal: ideal) else { break }
        next.set(column, createDrop(agentId))
        placed += 1
      }
    }
    return next
  }

  /// `rainDataString` (:89-103): what a column says when you read it top to bottom, as UTF-16 code units. An agent says
  /// its project, branch, model and context; a terminal on ANOTHER desktop says that desktop's name first; a home
  /// terminal says its project and `terminal`. Every symbol is flattened to a space so each cell holds one glyph.
  static func data(_ agent: RainAgent) -> [UInt16] {
    let parts: [String?]
    switch agent.kind {
    case .agent:
      parts = [
        agent.projectName, agent.branch, agent.model,
        agent.usedPercent.map { "CTX:\(contextDigits($0))%" },
      ]
    case .terminal:
      parts = agent.isSelf ? [agent.projectName, "terminal"] : [agent.deviceName, agent.projectName]
    }
    // `parts.filter(Boolean)`: an absent part and an empty one are both dropped
    let joined = " " + parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ") + " "
    return flatten(joined)
  }

  /// `.replace(/[^a-zA-Z0-9\s%.]/g, ' ')`, unit by unit, as a regular expression with no `u` flag reads a string.
  static func flatten(_ text: String) -> [UInt16] {
    text.utf16.map { keeps($0) ? $0 : 0x20 }
  }

  /// The class `[a-zA-Z0-9\s%.]`: ASCII letters and digits, `%`, `.`, and JavaScript's `\s` (WhiteSpace and
  /// LineTerminator: TAB, LF, VT, FF, CR, SPACE, NBSP, U+1680, U+2000–U+200A, LS, PS, U+202F, U+205F, U+3000, BOM).
  static func keeps(_ unit: UInt16) -> Bool {
    switch unit {
    case 0x30...0x39, 0x41...0x5A, 0x61...0x7A, 0x25, 0x2E: true
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
    default: false
    }
  }

  /// `Math.round(percent).toString().padStart(2, '0')`, in FieldAgents' `JSNumber` (items 164/165): a tie toward
  /// +∞ (2.5 → 3, −2.5 → −2), −0 prints `0`, and a whole number prints JavaScript's digits however large (`1e+21`).
  static func contextDigits(_ percent: Double) -> String {
    let text = JSNumber.whole(JSNumber.round(percent))
    return text.utf16.count < 2 ? String(repeating: "0", count: 2 - text.utf16.count) + text : text
  }

  /// `rainTailLength` (:106-118): context usage sets the tail, floored so a stream always reads as one. An unmeasured
  /// window sits mid-scale (0.5); the tail is never shorter than the data and six cells.
  static func tailLength(_ agent: RainAgent, rows: Int, tailMultiplier: Double, dataLength: Int) -> Double {
    let usedPercent = agent.kind == .agent ? agent.usedPercent : nil
    let usage = usedPercent.map { Swift.min(1, Swift.max(0, $0 / 100)) } ?? 0.5
    let base = Swift.max(3, usage * Double(rows) * 0.9) * tailMultiplier
    return Swift.max(base, Double(dataLength + 6))
  }
}
