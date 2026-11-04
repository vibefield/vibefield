import Foundation

// PG-6 — WHERE THE TIMELINE'S PARTS STAND, transcribed from puppeteer-views 0.3.3 at the lock's `52d09c8e` (the
// timeline is byte-identical to 0.3.2's `95a70aa7`; its last change `5abe8f75`), `src/views/timeline/TimelineView.tsx`
// (dist `TimelineView.js`): `MAP_STRIP`, `AXIS`, `TERMINAL_LANE`, `DIVIDER`, `MAP_LEFT` and `LANE_MIN` :34-39,
// `columnsFor` :46-50, `layoutLanes` :51-73 and `dayLabel` :83-85. These are TimelineView's own, never exported, so no
// golden reaches them: the kit's hand row H1 holds them (`TimelineViewTests`).
//
// RUNTIME ONLY (fd's Q1 ruling, 2026-11-04): `OVERSCAN` :45 and the tall canvas ended runs make are not transcribed.

enum TimelineLayout {
  /// The map of the day's strip (TL-D17).
  static let mapStrip = 46.0
  /// The axis: the ticks and the clock chip.
  static let axis = 22.0
  /// A bare terminal's lane.
  static let terminalLane = 18.0
  /// The terminals' divider, `TERMINALS`.
  static let divider = 20.0
  /// The map's left inset.
  static let mapLeft = 14.0
  /// The shortest an agent's lane is squeezed to.
  static let laneMin = 24.0

  /// `columnsFor`: the names column, the head column, the track's right end (the head) and whether the head is
  /// narrow.
  struct Columns: Equatable, Sendable {
    let width: Double
    let names: Double
    let head: Double
    let x1: Double
    let narrow: Bool
  }

  static func columns(width: Double) -> Columns {
    let names: Double = width >= 900 ? 196 : width >= 640 ? 166 : 116
    let head: Double = width >= 900 ? 170 : width >= 640 ? 148 : 104
    return Columns(width: width, names: names, head: head, x1: max(1, width - head), narrow: width < 640)
  }

  /// `layoutLanes`' answer: the lanes in the rows' y, the divider's y (none without terminals), the rows' height.
  struct Placement: Equatable, Sendable {
    let placed: [TimelinePlacedLane]
    let divider: Double?
    let height: Double
  }

  /// `layoutLanes`: the agents share what is left of the body (at most `laneMax`, at least `laneMin` each, so a long
  /// fleet scrolls), then the divider and the bare terminals at 18.
  static func lanes(_ set: TimelineLaneSet, bodyHeight: Double, laneMax: Double) -> Placement {
    let terminals = Double(set.terminals.count)
    let block = terminals > 0 ? terminals * terminalLane + divider : 0
    let room = ((bodyHeight - 6 - block) / Double(max(1, set.agents.count))).rounded(.down)
    let h = min(laneMax, max(laneMin, room))
    var placed: [TimelinePlacedLane] = []
    var y = 2.0
    for lane in set.agents {
      placed.append(TimelinePlacedLane(lane: lane, y: y, h: h))
      y += h
    }
    var dividerY: Double?
    if !set.terminals.isEmpty {
      dividerY = y
      y += divider
      for lane in set.terminals {
        placed.append(TimelinePlacedLane(lane: lane, y: y, h: terminalLane))
        y += terminalLane
      }
    }
    return Placement(placed: placed, divider: dividerY, height: y + 4)
  }

  /// `dayLabel`: a midnight tick's words, the short weekday and the day, upper-cased. The desktop asks its own ICU
  /// (`toLocaleDateString(undefined, {weekday: 'short', day: 'numeric'})`); the phone asks the platform's for the same
  /// template, so the ORDER is each platform's (en_US: Node's `4 WED`, the phone's `WED 4`; measured 2026-11-04).
  static func dayLabel(_ t: Double, timeZone: TimeZone, locale: Locale) -> String {
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.timeZone = timeZone
    formatter.setLocalizedDateFormatFromTemplate("EEEd")
    // `toUpperCase`, not `toLocaleUpperCase`: the locale-free upper case
    return formatter.string(from: Date(timeIntervalSince1970: t / 1000)).uppercased()
  }
}
