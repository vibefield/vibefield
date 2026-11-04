import FieldAgents
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

// PG-6 — THE TIMELINE'S PAINT, HELD TO PUPPETEER'S OWN: `paintWakes`' stream, call for call, as
// `phone-timeline.golden.json` records it at the open (field-app's `perf/lib/phone-goldens-timeline.ts`: the desktop's
// `paintWakes` through a recording 2D context, over the open's lanes at the default window, light and dark), and the
// inks' `css` (`rgbaCss`) over the golden's vector. Each call is compared as one line of text, the numbers printed as
// JavaScript prints them, so a difference reads as the call that differs. The ticks' hairlines are elided on both sides
// (their instants are the host's zone; `ticksBetween` is held zone-free by the model rows). Here the paint's inks are
// the golden's numbers (on the host loop SwarmTheme is a scratch stand-in); the phone's own inks (SwarmTheme and the
// skin, through UIKit) are the kit's T10, and the same stream painted with them its T11 (`TimelineInksKitTests`).
//
// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).

@Suite("PG-6 — the timeline's paint")
struct TimelinePaintParityTests {
  // MARK: - T11

  /// T11 — `rgbaCss` over channels at a byte's tie and past the unit range, and alphas at `toFixed(4)`'s ties.
  @Test func theCssIsTheToolkits() throws {
    for entry in try TimelineGolden.entries("cssCalls") {
      let channels = (entry["colour"]?.arrayValue ?? []).map { $0.doubleValue ?? .nan }
      let alpha = entry["alpha"]?.doubleValue ?? .nan
      let colour = SwarmColor(r: channels[0], g: channels[1], b: channels[2], a: channels[3]).withAlpha(alpha)
      let out = entry["out"]?.stringValue
      #expect(TimelineInks.css(colour) == out, "\(channels) × \(alpha)")
    }
  }

  /// T11 — `paintWakes`' stream over the open's lanes at the default window, in each theme, with the golden's inks.
  @Test(arguments: ["light", "dark"])
  func theWakesPaintIsTheTimelines(theme: String) throws {
    let open = try TimelineGolden.open()
    try Self.wakesPaint(theme: theme, inks: try Self.inks(open, theme: theme))
  }

  // MARK: - Readers

  /// `paintWakes`' stream over the open's lanes at the default window in `theme`, painted with `inks`, against the
  /// golden's: the host row hands the golden's own inks, the kit's (`TimelineInksKitTests`) the phone's.
  static func wakesPaint(theme: String, inks: TimelineInks) throws {
    let open = try TimelineGolden.open()
    let paint = open["paint"]
    let streams = paint?["streams"]?.arrayValue ?? []
    let stream = streams.first { $0["theme"]?.stringValue == theme }
    let calls = try #require(stream?["calls"]?.arrayValue, "the golden records no \(theme) stream")
    var seen = false
    try TimelineWitness.walk { _, set, step in
      guard step.at == "open" else { return }
      seen = true
      let placed = paint?["lanes"]?.arrayValue ?? []
      let ids = placed.map { $0["id"]?.stringValue ?? "?" }
      let laneIds = set.all.map { $0.id }
      #expect(ids == laneIds, "the paint's lanes")
      let lanes = zip(set.all, placed).map { lane, record in
        TimelinePlacedLane(
          lane: lane, y: record["y"]?.doubleValue ?? .nan, h: record["h"]?.doubleValue ?? .nan)
      }
      let wake = TimelineWakePaint(
        width: paint?["width"]?.doubleValue ?? .nan, height: paint?["height"]?.doubleValue ?? .nan,
        ratio: paint?["ratio"]?.doubleValue ?? .nan, lanes: lanes, t0: paint?["t0"]?.doubleValue ?? .nan,
        t1: paint?["t1"]?.doubleValue ?? .nan, nowMs: paint?["nowMs"]?.doubleValue ?? .nan,
        lit: Int(paint?["lit"]?.intValue ?? 99), glow: paint?["glow"]?.doubleValue ?? .nan)
      let mine =
        TimelinePaint.frame(wake).map(Self.line) + ["ticks"]
        + TimelinePaint.lanes(wake, inks: inks).map(Self.line)
        + TimelinePaint.headLight(wake, inks: inks).map(Self.line)
      let expected = calls.map(Self.line)
      let count = mine.count
      #expect(count == expected.count, "\(theme): the calls")
      for (index, (line, expectedLine)) in zip(mine, expected).enumerated() {
        #expect(line == expectedLine, "\(theme) call \(index)")
      }
    }
    #expect(seen, "the run has an open step")
  }

  /// The golden's inks for `theme`, as numbers.
  static func inks(_ open: JSONValue, theme: String) throws -> TimelineInks {
    let records = open["inks"]?.arrayValue ?? []
    let found = records.first { $0["theme"]?.stringValue == theme }
    let record = try #require(found, "the golden records no \(theme) inks")
    func colour(_ key: String) -> SwarmColor {
      let channels = (record[key]?.arrayValue ?? []).map { $0.doubleValue ?? .nan }
      guard channels.count == 4 else { return SwarmColor(r: .nan, g: .nan, b: .nan, a: .nan) }
      return SwarmColor(r: channels[0], g: channels[1], b: channels[2], a: channels[3])
    }
    return TimelineInks(
      dark: record["dark"]?.boolValue ?? false, ground: colour("ground"), ink: colour("ink"), muted: colour("muted"),
      faint: colour("faint"), border: colour("border"), grid: colour("grid"), orange: colour("orange"),
      blue: colour("blue"), orangeInk: colour("orangeInk"), blueInk: colour("blueInk"),
      orangeGround: colour("orangeGround"), blueGround: colour("blueGround"))
  }

  /// A number as JavaScript prints it.
  static func number(_ value: Double) -> String { TimelineFormat.number(value) }

  static func numbers(_ values: [Double]) -> String { values.map(number).joined(separator: ", ") }

  /// A path command as one word: its op and its numbers.
  static func word(_ command: WakePathCommand?) -> String {
    switch command {
    case .move(let x, let y)?: "M \(numbers([x, y]))"
    case .line(let x, let y)?: "L \(numbers([x, y]))"
    case .curve(let x1, let y1, let x2, let y2, let x, let y)?: "C \(numbers([x1, y1, x2, y2, x, y]))"
    case .arc(let cx, let cy, let r, let start, let end)?: "A \(numbers([cx, cy, r, start, end]))"
    case .close?: "Z"
    case nil: "none"
    }
  }

  static func fill(_ fill: TimelineFill) -> String {
    switch fill {
    case .colour(let colour): TimelineInks.css(colour)
    case .gradient(let gradient):
      "gradient(\(numbers([gradient.x0, gradient.y0, gradient.x1, gradient.y1])))["
        + gradient.stops.map { "\(number($0.offset)) \(TimelineInks.css($0.colour))" }.joined(separator: ", ") + "]"
    }
  }

  /// One of the phone's calls as one line.
  static func line(_ command: TimelineCanvas) -> String {
    switch command {
    case .setTransform(let a, let b, let c, let d, let e, let f): "setTransform(\(numbers([a, b, c, d, e, f])))"
    case .clearRect(let x, let y, let width, let height): "clearRect(\(numbers([x, y, width, height])))"
    case .save: "save()"
    case .restore: "restore()"
    case .globalAlpha(let alpha): "globalAlpha = \(number(alpha))"
    case .blur(let px): "filter = blur(\(number(px))px)"
    case .fillStyle(let style): "fillStyle = \(fill(style))"
    case .strokeStyle(let colour): "strokeStyle = \(TimelineInks.css(colour))"
    case .lineWidth(let width): "lineWidth = \(number(width))"
    case .lineDash(let dash): "setLineDash([\(numbers(dash))])"
    case .roundCap: "lineCap = round"
    case .fillRect(let x, let y, let width, let height): "fillRect(\(numbers([x, y, width, height])))"
    case .fillPath(let commands): "fill(path \(commands.count) \(word(commands.first)) … \(word(commands.last)))"
    case .beginPath: "beginPath()"
    case .moveTo(let x, let y): "moveTo(\(numbers([x, y])))"
    case .lineTo(let x, let y): "lineTo(\(numbers([x, y])))"
    case .closePath: "closePath()"
    case .fill: "fill()"
    case .stroke: "stroke()"
    case .fillText(let text, let x, let y): "fillText(\(text), \(numbers([x, y])))"
    }
  }

  /// One of the golden's recorded calls as one line, in the phone's words.
  static func line(_ call: JSONValue) -> String {
    let op = call["op"]?.stringValue ?? "?"
    let args = call["args"]?.arrayValue ?? []
    switch op {
    case "ticks":
      return "ticks"
    case "set":
      let key = call["key"]?.stringValue ?? "?"
      let value = call["value"]
      if let text = value?.stringValue { return "\(key) = \(text)" }
      if let gradient = value?["gradient"]?.arrayValue {
        let line = gradient.map { $0.doubleValue ?? .nan }
        let stops = (value?["stops"]?.arrayValue ?? []).map {
          "\(number($0["offset"]?.doubleValue ?? .nan)) \($0["color"]?.stringValue ?? "?")"
        }
        return "\(key) = gradient(\(numbers(line)))[\(stops.joined(separator: ", "))]"
      }
      return "\(key) = \(number(value?.doubleValue ?? .nan))"
    case "setLineDash":
      let dash = (args.first?.arrayValue ?? []).map { $0.doubleValue ?? .nan }
      return "setLineDash([\(numbers(dash))])"
    case "fill" where !args.isEmpty:
      let path = args[0]
      let count = path["count"]?.intValue ?? -1
      let first = path["first"].flatMap(TimelineGeometryParityTests.command)
      let last = path["last"].flatMap(TimelineGeometryParityTests.command)
      return "fill(path \(count) \(word(first)) … \(word(last)))"
    default:
      return "\(op)(\(numbers(args.map { $0.doubleValue ?? .nan })))"
    }
  }
}
