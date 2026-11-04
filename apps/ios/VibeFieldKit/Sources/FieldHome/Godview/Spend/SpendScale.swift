import Foundation

// PG-7 (red skeleton) — spend's scales. The transcription lands in the green.

enum SpendScale {
  static let stepMs = 0.0
  static let stepCount = 0.0
  static let windowMs = 0.0
  static let timeTickMs = 0.0

  struct Window: Equatable, Sendable {
    let ta: Double
    let tb: Double
  }

  struct Tick: Equatable, Sendable {
    let t: Double
    let x: Double
  }

  static func spendWindow(nowMs: Double) -> Window { Window(ta: 0, tb: 0) }
  static func momentIn(_ t: Double, _ span: Window) -> Double { 0 }
  static func heldIn(_ held: Double?, _ span: Window) -> Double? { nil }
  static func niceStep(_ max: Double, _ count: Double) -> Double { 0 }
  static func moneyScale(top: Double, compact: Bool) -> (step: Double, max: Double) { (0, 0) }
  static func easeTop(shown: Double?, target: Double) -> Double { 0 }
  static func moneyTicks(max: Double, step: Double) -> [Double] { [] }
  static func timeTicks(
    ta: Double, tb: Double, x0: Double, x1: Double, chips: [Double], clear: Double = 46
  ) -> [Tick] { [] }
}
