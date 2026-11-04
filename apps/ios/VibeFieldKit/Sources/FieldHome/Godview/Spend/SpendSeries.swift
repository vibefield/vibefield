import FieldProduct
import Foundation

// PG-7 (red skeleton) — spend's lines. The transcription lands in the green.

/// One row as spend reads it: the replica's row, the window's `self` join, and the host's two facts.
struct SpendAgent: Equatable, Sendable {
  let monitor: MonitorAgentRow
  let isSelf: Bool
  let unread: Bool
  let active: Bool

  var id: String { monitor.id }
}

enum SpendSeries {
  static let minute = 60_000.0
  static let rateWindowMs = 0.0

  struct Point: Equatable, Sendable {
    var t: Double
    var v: Double
  }

  struct Meter: Equatable, Sendable {
    let id: String
    let agent: SpendAgent
    let bornMs: Double
    let partial: Bool
    let total: Double
    let points: [Point]
    let recorded: Bool
  }

  struct Unpriced: Equatable, Sendable {
    let id: String
    let agent: SpendAgent
    let bornMs: Double
  }

  struct Meters: Equatable, Sendable {
    let lines: [Meter]
    let unpriced: [Unpriced]
  }

  static func spendOf(_ agent: SpendAgent) -> (usd: Double, partial: Bool)? { nil }
  static func meterOf(_ agent: SpendAgent) -> Meter? { nil }
  static func spendMeters(_ agents: [SpendAgent]) -> Meters { Meters(lines: [], unpriced: []) }
  static func lineAt(_ meter: Meter, nowMs: Double) -> Meter { meter }
  static func lineOf(_ agent: SpendAgent, nowMs: Double) -> Meter? { nil }
  static func spendAt(_ set: Meters, nowMs: Double) -> Meters { set }
  static func spendSet(_ agents: [SpendAgent], nowMs: Double) -> Meters { Meters(lines: [], unpriced: []) }
  static func valueAt(_ line: Meter, _ t: Double) -> Double? { nil }
  static func rateAt(_ line: Meter, _ t: Double) -> Double? { nil }
  static func windowPoints(_ line: Meter, _ ta: Double, _ tb: Double) -> [Point] { [] }
  static func spentAt(_ line: Meter, _ ta: Double, _ t: Double) -> Double? { nil }
  static func spentPoints(_ line: Meter, _ ta: Double, _ tb: Double) -> [Point] { [] }
}
