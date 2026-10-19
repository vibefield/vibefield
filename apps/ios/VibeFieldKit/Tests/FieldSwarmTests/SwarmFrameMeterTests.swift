import Testing

@testable import FieldSwarm

/// 2026-10-18 — the measure the phone's smoothness work is judged by: a DEBUG
/// line every few seconds with the rate, the frame interval's spread, the long
/// frames and the physics steps a frame solved.
@Suite("the swarm says how it paints")
struct SwarmFrameMeterTests {
  /// Feed frames `interval` seconds apart from `start` until a window closes;
  /// the closed window's line.
  private func firstLine(start: Double = 10, frames: Int, interval: (Int) -> Double, steps: (Int) -> Int) -> String? {
    var meter = SwarmFrameMeter()
    var time = start
    #expect(meter.record(time: time, steps: 0) == nil)
    for frame in 0..<frames {
      time += interval(frame)
      if let line = meter.record(time: time, steps: steps(frame)) { return line }
    }
    return nil
  }

  @Test("a steady 120 Hz window: even frames, none long, one step a frame")
  func steady() {
    let line = firstLine(frames: 700, interval: { _ in 1.0 / 120 }, steps: { _ in 1 })
    #expect(line == "[swarm] 120 Hz · frame 8.3 / 8.3 / 8.3 ms (p50 / p95 / max) · 0 long · 1.00 steps a frame")
  }

  @Test("a 60 Hz window with one stall: the stall is the max and the one long frame; 30 Hz physics is half a step a frame")
  func stall() {
    let line = firstLine(frames: 400, interval: { $0 == 150 ? 0.05 : 1.0 / 60 }, steps: { $0 % 2 })
    #expect(line?.hasPrefix("[swarm] 60 Hz · frame 16.7 / 16.7 / 50.0 ms (p50 / p95 / max) · 1 long · ") == true)
    #expect(line?.hasSuffix(" 0.50 steps a frame") == true)
  }

  @Test("nothing is said while the window is open")
  func quietUntilTheWindowCloses() {
    #expect(firstLine(frames: 100, interval: { _ in 1.0 / 60 }, steps: { _ in 1 }) == nil)
  }
}
