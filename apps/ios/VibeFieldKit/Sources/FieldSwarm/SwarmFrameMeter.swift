import Foundation

/// How the swarm paints over a window of frames: the rate it reached, the
/// spread of the frame interval, the long frames, and how many physics steps
/// each frame solved. `SwarmStage.pump` says it in DEBUG every few seconds, so a
/// phone run's console carries the measure every smoothness change is judged by
/// (2026-10-18). Pure: fed times and step counts, it hands back the line when a
/// window closes and starts the next.
public struct SwarmFrameMeter: Sendable {
  /// How long one window runs, in seconds.
  public static let window: Double = 5

  private var start: Double?
  private var last: Double?
  private var intervals: [Double] = []
  private var steps = 0

  public init() {}

  /// One frame drawn at `time` (seconds) that solved `steps` physics steps.
  /// Returns the closed window's line, or nil while it is open.
  public mutating func record(time: Double, steps: Int) -> String? {
    defer { last = time }
    guard let opened = start else {
      start = time
      return nil
    }
    if let last { intervals.append(time - last) }
    self.steps += steps
    guard time - opened >= Self.window, !intervals.isEmpty else { return nil }
    let line = Self.line(intervals: intervals, steps: self.steps, seconds: time - opened)
    start = time
    intervals.removeAll(keepingCapacity: true)
    self.steps = 0
    return line
  }

  /// `[swarm] 120 Hz · frame 8.3 / 8.4 / 25.0 ms (p50 / p95 / max) · 2 long · 1.00 steps a frame`.
  /// A long frame is one past half again the median: a missed vsync.
  static func line(intervals: [Double], steps: Int, seconds: Double) -> String {
    let sorted = intervals.sorted()
    func at(_ quantile: Double) -> Double { sorted[Int((Double(sorted.count - 1) * quantile).rounded())] }
    func ms(_ interval: Double) -> String { String(format: "%.1f", interval * 1000) }
    let median = at(0.5)
    let long = sorted.filter { $0 > median * 1.5 }.count
    let rate = Int((Double(sorted.count) / seconds).rounded())
    let perFrame = String(format: "%.2f", Double(steps) / Double(sorted.count))
    return "[swarm] \(rate) Hz · frame \(ms(median)) / \(ms(at(0.95))) / \(ms(sorted[sorted.count - 1])) ms"
      + " (p50 / p95 / max) · \(long) long · \(perFrame) steps a frame"
  }
}
