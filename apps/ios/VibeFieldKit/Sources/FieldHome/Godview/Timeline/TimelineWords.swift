import FieldMesh
import FieldProduct
import Foundation

// PG-6 (RED SKELETON) — what the timeline says in words. Typed, and wrong on purpose until the green commit.

enum TimelineReadoutTone: String, Sendable, Equatable {
  case working, idle, blocked, unseen, none, unrecorded
}

struct TimelineReadout: Equatable, Sendable {
  let tone: TimelineReadoutTone
  let big: String
  let small: String
  let owed: Bool
}

enum TimelineWords {
  static func spanWord(_ span: TimelineSpan) -> String { "" }

  static func readout(
    _ lane: TimelineLane, moment: TimelineMoment, at: Double, live: Bool, nowMs: Double
  ) -> TimelineReadout {
    TimelineReadout(tone: .none, big: "", small: "", owed: false)
  }

  static func name(_ lane: TimelineLane) -> String { "" }

  static func subLine(_ lane: TimelineLane) -> String { "" }

  static func label(_ lane: TimelineLane, nowMs: Double) -> String { "" }
}
