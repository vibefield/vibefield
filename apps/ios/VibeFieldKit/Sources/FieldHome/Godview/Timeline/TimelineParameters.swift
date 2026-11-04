import Foundation

// PG-6 (RED SKELETON) — the timeline's tunables. Wrong on purpose until the green commit.

struct TimelineParameters: Equatable, Sendable {
  var glow: Double
  var laneMax: Double

  static let defaults = TimelineParameters(glow: 0, laneMax: 0)

  static func normalized(glow: Double?, laneMax: Double?) -> TimelineParameters { defaults }
}
