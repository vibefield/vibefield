import FieldAgents
import FieldMesh
import FieldProduct
import Foundation

// PG-6 (RED SKELETON) — the timeline's lanes. Typed, and wrong on purpose until the green commit transcribes them.

/// The row as the timeline reads it: the replica's row and the host's joins.
struct TimelineRow: Equatable, Sendable {
  let monitor: MonitorAgentRow
  let isSelf: Bool
  let unread: Bool
  let colour: SwarmColor?
  let active: Bool
  let receded: Bool

  var id: String { monitor.id }

  init(
    monitor: MonitorAgentRow, isSelf: Bool, unread: Bool, colour: SwarmColor?, active: Bool, receded: Bool = false
  ) {
    self.monitor = monitor
    self.isSelf = isSelf
    self.unread = unread
    self.colour = colour
    self.active = active
    self.receded = receded
  }

  init(_ row: RemoteFieldRow, unread: Bool, colour: SwarmColor?, active: Bool) {
    self.init(monitor: row.row.monitor, isSelf: row.isSelf, unread: unread, colour: colour, active: active)
  }
}

enum TimelineStatus: String, Sendable, Equatable {
  case working, idle, blocked, unseen
}

struct TimelineWait: Equatable, Sendable {
  let kind: String
  let detail: String?
}

struct TimelineSpan: Equatable, Sendable {
  let status: TimelineStatus
  let fromMs: Double
  let wait: TimelineWait?
}

struct TimelineLane: Equatable, Sendable, Identifiable {
  let row: TimelineRow
  let bornMs: Double
  let sinceMs: Double
  let current: TimelineSpan

  var id: String { row.id }
  var kind: MonitorRowKind { row.monitor.kind }
  var receded: Bool { row.receded }
  var colour: SwarmColor? { row.colour }
}

struct TimelineLaneSet: Equatable, Sendable {
  let agents: [TimelineLane]
  let terminals: [TimelineLane]

  var all: [TimelineLane] { agents + terminals }
}

enum TimelineMoment: Equatable, Sendable {
  case unborn
  case unrecorded
  case span(TimelineSpan)

  var kind: String {
    switch self {
    case .unborn: "unborn"
    case .unrecorded: "unrecorded"
    case .span: "span"
    }
  }
}

enum TimelineLanes {
  static let quietAlpha = 0.0
  static let waitWordsMax = 0

  static func status(of row: TimelineRow) -> TimelineStatus { .idle }

  static func waitWords(kind: String, detail: String?, question: String?) -> String? { "" }

  static func lane(for row: TimelineRow, nowMs: Double) -> TimelineLane {
    TimelineLane(row: row, bornMs: 0, sinceMs: 0, current: TimelineSpan(status: .idle, fromMs: 0, wait: nil))
  }

  static func lanes(_ rows: [TimelineRow], nowMs: Double) -> TimelineLaneSet {
    TimelineLaneSet(agents: [], terminals: [])
  }

  static func state(of lane: TimelineLane, at t: Double) -> TimelineMoment { .unborn }

  static func alpha(_ lane: TimelineLane, index: Int, lit: Int) -> Double { 0 }

  static func contentKey(_ lanes: [TimelineLane]) -> String { "" }

  static func dayStart(_ set: TimelineLaneSet, spanMs: Double, nowMs: Double) -> Double { 0 }

  static func earliestHead(_ set: TimelineLaneSet, spanMs: Double, nowMs: Double) -> Double { 0 }
}
